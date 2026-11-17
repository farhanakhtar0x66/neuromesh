// Seeded random operation sequences against a plain reference model of docs/CACHE_RULES.md.
// The model keeps entries in an array (index 0 = least recently used) and loads in a list; it shares no code
// with the cache. Every step compares: loader calls (count and keys), size, keys(), has(), delete's answer,
// and the outcome of every get promise issued so far.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoCache } from "../src/cache.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Model {
  constructor({ ttl, stale, max }, now) {
    Object.assign(this, { ttl, stale, max, now });
    this.entries = []; // { key, value, at }, least recently used first
    this.loads = []; // every load ever started: { key, waiters, settled }
    this.slots = new Map(); // key -> the load new callers may join
    this.outcomes = new Map(); // get id -> { ok, value | message }
  }
  purge() {
    const t = this.now();
    this.entries = this.entries.filter((e) => t - e.at < this.ttl + this.stale);
  }
  touch(key) {
    const i = this.entries.findIndex((e) => e.key === key);
    const [e] = this.entries.splice(i, 1);
    this.entries.push(e);
  }
  startLoad(key) {
    const load = { key, waiters: [], settled: false };
    this.loads.push(load);
    this.slots.set(key, load);
    return load;
  }
  store(key, value) {
    this.entries = this.entries.filter((e) => e.key !== key);
    this.entries.push({ key, value, at: this.now() });
    while (this.entries.length > this.max) this.entries.shift();
  }
  get(id, key) {
    this.purge();
    const e = this.entries.find((x) => x.key === key);
    if (e) {
      this.touch(key);
      if (this.now() - e.at >= this.ttl && !this.slots.has(key)) this.startLoad(key);
      this.outcomes.set(id, { ok: true, value: e.value });
      return;
    }
    (this.slots.get(key) ?? this.startLoad(key)).waiters.push(id);
  }
  set(key, value) {
    this.purge();
    this.slots.delete(key);
    this.store(key, value);
  }
  delete(key) {
    this.purge();
    this.slots.delete(key);
    const had = this.entries.some((e) => e.key === key);
    this.entries = this.entries.filter((e) => e.key !== key);
    return had;
  }
  clear() {
    this.slots.clear();
    this.entries = [];
  }
  size() {
    this.purge();
    return this.entries.length;
  }
  keys() {
    this.purge();
    return this.entries.map((e) => e.key);
  }
  has(key) {
    this.purge();
    return this.entries.some((e) => e.key === key);
  }
  pending() {
    return this.loads.map((l, i) => (l.settled ? -1 : i)).filter((i) => i >= 0);
  }
  settle(i, ok, payload) {
    const load = this.loads[i];
    load.settled = true;
    if (this.slots.get(load.key) === load) {
      this.slots.delete(load.key);
      if (ok) this.store(load.key, payload);
    }
    for (const id of load.waiters) this.outcomes.set(id, ok ? { ok: true, value: payload } : { ok: false, message: payload });
  }
}

async function runSequence(seed, cfg) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let t = 0;
  const clock = { now: () => t };
  const calls = [];
  const loader = (key) =>
    new Promise((resolve, reject) => {
      calls.push({ key, resolve, reject });
    });
  const cache = new MemoCache({ loader, ttlMs: cfg.ttl, staleMs: cfg.stale, ...(cfg.max === Infinity ? {} : { maxEntries: cfg.max }), clock });
  const model = new Model(cfg, () => t);
  const real = new Map();
  const keys = ["a", "b", "c", "d", "e", "f"].slice(0, cfg.keys);
  let getId = 0;
  let n = 0;
  const log = [];

  for (let step = 0; step < cfg.steps; step++) {
    const r = rand();
    let desc;
    if (r < 0.34) {
      const key = pick(keys);
      const id = getId++;
      desc = `get ${key} #${id}`;
      cache.get(key).then(
        (value) => real.set(id, { ok: true, value }),
        (error) => real.set(id, { ok: false, message: error.message }),
      );
      model.get(id, key);
    } else if (r < 0.44) {
      const key = pick(keys);
      const value = `s${n++}`;
      desc = `set ${key}=${value}`;
      cache.set(key, value);
      model.set(key, value);
    } else if (r < 0.53) {
      const key = pick(keys);
      desc = `delete ${key}`;
      assert.equal(cache.delete(key), model.delete(key), `${desc}: return value`);
    } else if (r < 0.56) {
      desc = "clear";
      cache.clear();
      model.clear();
    } else if (r < 0.74) {
      const ms = pick(cfg.ticks);
      desc = `tick ${ms}`;
      t += ms;
    } else {
      const pending = model.pending();
      if (pending.length === 0) continue;
      const i = pick(pending);
      if (rand() < 0.75) {
        const value = `v${n++}`;
        desc = `resolve load ${i} (${model.loads[i].key}) with ${value}`;
        calls[i].resolve(value);
        model.settle(i, true, value);
      } else {
        const message = `err${n++}`;
        desc = `reject load ${i} (${model.loads[i].key}) with ${message}`;
        calls[i].reject(new Error(message));
        model.settle(i, false, message);
      }
    }
    log.push(desc);
    await flush();
    const where = `seed ${seed}, step ${step} (${desc}); last steps: ${log.slice(-6).join(" | ")}`;
    assert.deepEqual(calls.map((c) => c.key), model.loads.map((l) => l.key), `${where}: loader calls`);
    assert.equal(cache.size, model.size(), `${where}: size`);
    assert.deepEqual(cache.keys(), model.keys(), `${where}: keys`);
    for (const k of keys) assert.equal(cache.has(k), model.has(k), `${where}: has(${k})`);
    assert.deepEqual([...real].sort((x, y) => x[0] - y[0]), [...model.outcomes].sort((x, y) => x[0] - y[0]), `${where}: get outcomes`);
  }
}

const CONFIGS = [
  ["ttl 100, stale 50, three entries", { ttl: 100, stale: 50, max: 3, keys: 5, ticks: [10, 40, 70, 120], steps: 80 }],
  ["no stale window, unbounded", { ttl: 100, stale: 0, max: Infinity, keys: 4, ticks: [10, 30, 60, 100], steps: 80 }],
  ["long stale window, one entry", { ttl: 60, stale: 200, max: 1, keys: 3, ticks: [20, 50, 90, 150], steps: 80 }],
  ["ttl 100, stale 100, two entries", { ttl: 100, stale: 100, max: 2, keys: 4, ticks: [15, 45, 80, 130], steps: 100 }],
];

for (const [name, cfg] of CONFIGS) {
  test(`100 random operation sequences agree with the reference model: ${name}`, async () => {
    for (let seed = 1; seed <= 100; seed++) await runSequence(seed * 7919 + cfg.max * 13, cfg);
  });
}
