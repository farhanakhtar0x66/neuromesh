// Deterministic interleavings: every loader call stays pending until the test settles it, and time is a clock the
// test moves. Each assertion follows from docs/CACHE_RULES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoCache } from "../src/cache.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function rig(options = {}) {
  let t = 0;
  const clock = { now: () => t };
  const calls = [];
  const loader = (key) =>
    new Promise((resolve, reject) => {
      calls.push({ key, resolve, reject });
    });
  const cache = new MemoCache({ loader, ttlMs: 100, clock, ...options });
  return { cache, calls, advance: (ms) => (t += ms), time: () => t };
}

/** Collect the outcome of a promise without leaving an unhandled rejection. */
function watch(promise) {
  const box = { state: "pending" };
  promise.then(
    (value) => Object.assign(box, { state: "ok", value }),
    (error) => Object.assign(box, { state: "err", error }),
  );
  return box;
}

/** Load `key` through the cache and settle it with `value`. */
async function seedValue(r, key, value) {
  const p = r.cache.get(key);
  r.calls.at(-1).resolve(value);
  assert.equal(await p, value);
}

test("concurrent misses for one key share a single load", async () => {
  const r = rig();
  const a = watch(r.cache.get("k"));
  const b = watch(r.cache.get("k"));
  const c = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 1);
  r.calls[0].resolve("v1");
  await flush();
  assert.deepEqual([a, b, c].map((x) => x.value), ["v1", "v1", "v1"]);
  assert.equal(await r.cache.get("k"), "v1");
  assert.equal(r.calls.length, 1);
});

test("misses for different keys load separately", async () => {
  const r = rig();
  r.cache.get("a");
  r.cache.get("b");
  r.cache.get("a");
  assert.deepEqual(r.calls.map((c) => c.key), ["a", "b"]);
});

test("the loader is called before get returns, for a miss and for a refresh", async () => {
  const r = rig({ staleMs: 100 });
  const p = r.cache.get("k");
  assert.equal(r.calls.length, 1);
  r.calls[0].resolve("v1");
  await p;
  r.advance(120);
  const q = r.cache.get("k");
  assert.equal(r.calls.length, 2);
  r.calls[1].resolve("v2");
  assert.equal(await q, "v1");
});

test("a failed shared load rejects every waiter with the same error", async () => {
  const r = rig();
  const boom = new Error("upstream down");
  const waiters = [watch(r.cache.get("k")), watch(r.cache.get("k")), watch(r.cache.get("k"))];
  assert.equal(r.calls.length, 1);
  r.calls[0].reject(boom);
  await flush();
  for (const w of waiters) {
    assert.equal(w.state, "err");
    assert.equal(w.error, boom);
  }
});

test("a failed load is not cached: the next get loads again", async () => {
  const r = rig();
  const first = watch(r.cache.get("k"));
  r.calls[0].reject(new Error("bad minute"));
  await flush();
  assert.equal(first.state, "err");
  assert.equal(r.cache.size, 0);
  assert.equal(r.cache.has("k"), false);
  const second = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 2);
  r.calls[1].resolve("recovered");
  await flush();
  assert.equal(second.value, "recovered");
  assert.equal(r.cache.size, 1);
});

test("a failed load does not touch the entries of other keys", async () => {
  const r = rig({ maxEntries: 2 });
  await seedValue(r, "a", "A");
  const p = watch(r.cache.get("b"));
  r.calls.at(-1).reject(new Error("x"));
  await flush();
  assert.equal(p.state, "err");
  assert.deepEqual(r.cache.keys(), ["a"]);
});

test("a failed refresh keeps the stale entry as it was and the next stale read tries again", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "k", "old");
  r.advance(120);
  assert.equal(await r.cache.get("k"), "old");
  assert.equal(r.calls.length, 2);
  r.calls[1].reject(new Error("refresh failed"));
  await flush();
  assert.equal(r.cache.has("k"), true);
  assert.equal(await r.cache.get("k"), "old"); // still the old value, still stale
  assert.equal(r.calls.length, 3); // a new refresh was started
  r.calls[2].resolve("new");
  await flush();
  assert.equal(await r.cache.get("k"), "new");
  assert.equal(r.calls.length, 3);
});

test("a failed refresh does not extend the stale entry's life", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "k", "old");
  r.advance(120);
  await r.cache.get("k"); // refresh pending
  r.advance(40); // 160: still stale
  r.calls[1].reject(new Error("late failure"));
  await flush();
  assert.equal(r.cache.has("k"), true);
  r.advance(45); // 205: past ttl + stale, counted from the first store
  assert.equal(r.cache.has("k"), false);
  assert.equal(r.cache.size, 0);
});

test("a loader that throws synchronously while refreshing does not break the read", async () => {
  let t = 0;
  let boom = false;
  const cache = new MemoCache({
    loader: (k) => {
      if (boom) throw new Error("threw");
      return Promise.resolve(`${k}-1`);
    },
    ttlMs: 100,
    staleMs: 100,
    clock: { now: () => t },
  });
  assert.equal(await cache.get("k"), "k-1");
  t = 120;
  boom = true;
  assert.equal(await cache.get("k"), "k-1");
  await flush();
  assert.equal(cache.has("k"), true);
});

test("a loader that throws synchronously is a failed load", async () => {
  let t = 0;
  let calls = 0;
  const cache = new MemoCache({
    loader: (k) => {
      calls++;
      if (calls === 1) throw new Error("threw");
      return Promise.resolve("ok");
    },
    ttlMs: 100,
    clock: { now: () => t },
  });
  const a = watch(cache.get("k"));
  await flush();
  assert.equal(a.state, "err");
  assert.equal(calls, 1);
  assert.equal(cache.size, 0);
  assert.equal(await cache.get("k"), "ok");
  assert.equal(calls, 2);
});

test("stale reads while a refresh is running start no second refresh", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "k", "old");
  r.advance(110);
  assert.equal(await r.cache.get("k"), "old");
  assert.equal(await r.cache.get("k"), "old");
  assert.equal(await r.cache.get("k"), "old");
  assert.equal(r.calls.length, 2);
});

test("a caller that finds the entry expired joins the refresh that is still running", async () => {
  const r = rig({ staleMs: 50 });
  await seedValue(r, "k", "old");
  r.advance(120); // stale
  assert.equal(await r.cache.get("k"), "old"); // refresh started (call 2)
  r.advance(40); // now 160: expired
  const waiter = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 2); // joined, not a new load
  await flush();
  assert.equal(waiter.state, "pending");
  r.calls[1].resolve("fresh");
  await flush();
  assert.equal(waiter.value, "fresh");
  assert.equal(await r.cache.get("k"), "fresh");
  assert.equal(r.calls.length, 2);
});

test("a caller that joined a failing refresh gets its error", async () => {
  const r = rig({ staleMs: 50 });
  await seedValue(r, "k", "old");
  r.advance(120);
  await r.cache.get("k");
  r.advance(40);
  const waiter = watch(r.cache.get("k"));
  const boom = new Error("refresh died");
  r.calls[1].reject(boom);
  await flush();
  assert.equal(waiter.state, "err");
  assert.equal(waiter.error, boom);
  assert.equal(r.cache.has("k"), false);
});

test("delete while a miss load is pending: the waiters get the value, the cache does not keep it", async () => {
  const r = rig();
  const waiter = watch(r.cache.get("k"));
  assert.equal(r.cache.delete("k"), false); // nothing stored yet
  r.calls[0].resolve("late");
  await flush();
  assert.equal(waiter.value, "late");
  assert.equal(r.cache.has("k"), false);
  assert.equal(r.cache.size, 0);
});

test("a get after a delete does not join the invalidated load", async () => {
  const r = rig();
  const w1 = watch(r.cache.get("k"));
  r.cache.delete("k");
  const w2 = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 2);
  r.calls[0].resolve("old-load"); // the invalidated one settles first: thrown away
  await flush();
  assert.equal(w1.value, "old-load");
  assert.equal(w2.state, "pending");
  assert.equal(r.cache.has("k"), false);
  r.calls[1].resolve("new-load");
  await flush();
  assert.equal(w2.value, "new-load");
  assert.equal(await r.cache.get("k"), "new-load");
});

test("a refresh that finishes after delete does not bring the old value back", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "k", "old");
  r.advance(120);
  await r.cache.get("k"); // refresh pending
  assert.equal(r.cache.delete("k"), true);
  r.calls[1].resolve("old-again");
  await flush();
  assert.equal(r.cache.has("k"), false);
  assert.equal(r.cache.size, 0);
  const next = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 3);
  r.calls[2].resolve("fresh");
  await flush();
  assert.equal(next.value, "fresh");
});

test("a refresh that finishes after clear stores nothing", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "a", "A");
  await seedValue(r, "b", "B");
  r.advance(120);
  await r.cache.get("a");
  await r.cache.get("b");
  r.cache.clear();
  r.calls[2].resolve("A2");
  r.calls[3].resolve("B2");
  await flush();
  assert.equal(r.cache.size, 0);
  assert.deepEqual(r.cache.keys(), []);
});

test("a miss load that finishes after clear stores nothing, and its waiters still get the value", async () => {
  const r = rig();
  const w = watch(r.cache.get("k"));
  r.cache.clear();
  r.calls[0].resolve("v");
  await flush();
  assert.equal(w.value, "v");
  assert.equal(r.cache.size, 0);
});

test("clear does not stop the load of a key that is asked for afterwards", async () => {
  const r = rig();
  r.cache.get("k");
  r.cache.clear();
  const later = watch(r.cache.get("k"));
  assert.equal(r.calls.length, 2);
  r.calls[1].resolve("v2");
  await flush();
  assert.equal(later.value, "v2");
  assert.equal(r.cache.has("k"), true);
});

test("set while a load is pending: the set value stays, the waiters get the load's value", async () => {
  const r = rig();
  const w = watch(r.cache.get("k"));
  r.cache.set("k", "set-value");
  r.calls[0].resolve("loaded");
  await flush();
  assert.equal(w.value, "loaded");
  assert.equal(await r.cache.get("k"), "set-value");
  assert.equal(r.calls.length, 1);
  assert.equal(r.cache.size, 1);
});

test("set while a refresh is pending: the refresh result is thrown away", async () => {
  const r = rig({ staleMs: 100 });
  await seedValue(r, "k", "old");
  r.advance(120);
  await r.cache.get("k");
  r.cache.set("k", "manual");
  r.calls[1].resolve("refreshed");
  await flush();
  assert.equal(await r.cache.get("k"), "manual");
});

test("size does not drift when values are replaced", async () => {
  const r = rig({ staleMs: 100 });
  for (let i = 0; i < 5; i++) r.cache.set("k", i);
  assert.equal(r.cache.size, 1);
  assert.deepEqual(r.cache.keys(), ["k"]);
  r.cache.set("j", 1);
  r.cache.set("j", 2);
  assert.equal(r.cache.size, 2);
  r.advance(120);
  await r.cache.get("k"); // stale: refresh
  r.calls[0].resolve("again");
  await flush();
  assert.equal(r.cache.size, 2);
  r.cache.delete("k");
  r.cache.delete("k");
  assert.equal(r.cache.size, 1);
});

test("size stays within maxEntries when values are replaced and refreshed", async () => {
  const r = rig({ maxEntries: 2, staleMs: 100 });
  for (let i = 0; i < 6; i++) r.cache.set(i % 2 ? "a" : "b", i);
  r.cache.set("c", 1);
  assert.equal(r.cache.size, 2);
  assert.equal(r.cache.keys().length, 2);
});

test("a stale read counts as a use for the eviction order", async () => {
  const r = rig({ maxEntries: 2, staleMs: 200 });
  r.cache.set("a", "A");
  r.advance(1);
  r.cache.set("b", "B");
  r.advance(120); // both stale
  assert.equal(await r.cache.get("a"), "A"); // a is used last
  r.cache.set("c", "C");
  assert.deepEqual(r.cache.keys(), ["a", "c"]);
  assert.equal(r.cache.has("b"), false);
});

test("has, keys and size do not change the order", async () => {
  const r = rig({ maxEntries: 2 });
  r.cache.set("a", 1);
  r.cache.set("b", 2);
  r.cache.has("a");
  r.cache.keys();
  void r.cache.size;
  r.cache.set("c", 3);
  assert.deepEqual(r.cache.keys(), ["b", "c"]);
});

test("a load result is stored as the most recently used and evicts the least recently used", async () => {
  const r = rig({ maxEntries: 2 });
  r.cache.set("a", 1);
  r.cache.set("b", 2);
  const p = r.cache.get("c");
  r.calls[0].resolve(3);
  await p;
  assert.deepEqual(r.cache.keys(), ["b", "c"]);
});

test("a pending load still stores its value after its key was evicted by other sets", async () => {
  const r = rig({ maxEntries: 1 });
  r.cache.get("a"); // pending
  r.cache.set("b", "B");
  r.calls[0].resolve("A");
  await flush();
  assert.deepEqual(r.cache.keys(), ["a"]); // a stored, b (least recently used) evicted
});

test("eviction does not cancel a refresh that is running", async () => {
  const r = rig({ maxEntries: 1, staleMs: 100 });
  await seedValue(r, "a", "old");
  r.advance(120);
  await r.cache.get("a"); // refresh pending (call 2)
  r.cache.set("b", "B"); // evicts a
  assert.equal(r.cache.has("a"), false);
  r.calls[1].resolve("new");
  await flush();
  assert.deepEqual(r.cache.keys(), ["a"]);
  assert.equal(await r.cache.get("a"), "new");
});

test("expired entries are not counted and do not take a slot", async () => {
  const r = rig({ maxEntries: 2 });
  r.cache.set("a", 1);
  r.cache.set("b", 2);
  r.advance(100);
  assert.equal(r.cache.size, 0);
  assert.equal(r.cache.delete("a"), false);
  r.cache.set("c", 3);
  r.cache.set("d", 4);
  assert.deepEqual(r.cache.keys(), ["c", "d"]);
});

test("an entry stored by a load is dated from the moment the load settled", async () => {
  const r = rig();
  const p = r.cache.get("k");
  r.advance(90);
  r.calls[0].resolve("v");
  await p;
  r.advance(90); // 180 after the call, 90 after settling: still fresh
  assert.equal(await r.cache.get("k"), "v");
  assert.equal(r.calls.length, 1);
  r.advance(10);
  r.cache.get("k");
  assert.equal(r.calls.length, 2);
});

test("a hit on a fresh entry never starts a load, even while an older one is pending", async () => {
  const r = rig();
  r.cache.get("k"); // call 1, pending
  r.cache.set("k", "now");
  assert.equal(await r.cache.get("k"), "now");
  assert.equal(r.calls.length, 1);
});
