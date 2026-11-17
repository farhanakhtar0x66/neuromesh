// Properties on 300 seeded random operation sequences. The generator mixes valid calls (biased towards what can
// succeed) with refused ones; names include integer-like ids and Object.prototype names on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, InventoryError } from "../src/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SEEDS = 300;
const WAREHOUSES = ["N", "S", "20", "__proto__"];
const SKUS = ["bolt", "40", "7", "constructor", "nut", "9"];
const ORDERS = ["o1", "o2", "o3", "o4", "o5"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op = { name: string; args: unknown[] };

function observe(inv: Inventory): unknown {
  const warehouses = inv.warehouses();
  return {
    warehouses,
    skus: inv.skus(),
    stock: inv.listStock(),
    low: inv.lowStock(5),
    perWarehouse: warehouses.map((w) => inv.listStock(w)),
    totals: inv.skus().map((s) => [s, inv.totalOnHand(s)]),
    orders: ORDERS.map((o) => [inv.orderStatus(o), inv.orderLines(o), inv.returnsOf(o)]),
    cells: warehouses.flatMap((w) => SKUS.map((s) => [w, s, inv.onHand(w, s), inv.reserved(w, s), inv.available(w, s)])),
  };
}

function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

/** The next operation, chosen against the live inventory so that many of them succeed. */
function nextOp(rand: () => number, inv: Inventory): Op {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const qty = (): number => pick([1, 1, 2, 3, 5, 8, 1, 2, 3, 0, -1, 1.5]);
  const openOrder = (): string => {
    const open = ORDERS.filter((o) => inv.orderStatus(o) === "open");
    return open.length && rand() < 0.85 ? pick(open) : pick(ORDERS);
  };
  const known = (): string => pick(inv.warehouses().length ? inv.warehouses() : WAREHOUSES);
  const rows = inv.listStock();
  const r = rand();
  if (r < 0.05) return { name: "addWarehouse", args: [pick([...WAREHOUSES, "", ""])] };
  if (r < 0.27) return { name: "receive", args: [rand() < 0.95 ? known() : "zz", rand() < 0.97 ? pick(SKUS) : "", qty()] };
  if (r < 0.34) {
    const row = rows.length ? pick(rows) : undefined;
    return { name: "ship", args: row ? [row.warehouse, row.sku, 1 + Math.floor(rand() * (row.available + 1))] : [known(), pick(SKUS), qty()] };
  }
  if (r < 0.52) {
    const row = rows.length && rand() < 0.75 ? pick(rows) : undefined;
    return { name: "reserve", args: [pick([...ORDERS, ""]), row ? row.warehouse : known(), row ? row.sku : pick(SKUS), row ? 1 + Math.floor(rand() * (row.available + 1)) : qty()] };
  }
  if (r < 0.58) return { name: "release", args: [openOrder()] };
  if (r < 0.66) return { name: "fulfill", args: [openOrder()] };
  if (r < 0.77) {
    const row = rows.length && rand() < 0.75 ? pick(rows) : undefined;
    return { name: "transfer", args: [row ? row.warehouse : known(), rand() < 0.9 ? known() : "zz", row ? row.sku : pick(SKUS), row ? 1 + Math.floor(rand() * (row.available + 1)) : qty()] };
  }
  const done = ORDERS.filter((o) => inv.orderStatus(o) === "fulfilled");
  const order = done.length && rand() < 0.9 ? pick(done) : pick(ORDERS);
  const lines = inv.returnsOf(order);
  const line = lines.length && rand() < 0.8 ? pick(lines) : undefined;
  return { name: "returnItems", args: line ? [order, line.warehouse, line.sku, 1 + Math.floor(rand() * (line.qty - line.returned + 1))] : [order, known(), pick(SKUS), qty()] };
}

type Outcome = { ok: true } | { ok: false; code: string; message: string };

function run(inv: Inventory, op: Op): Outcome {
  try {
    (inv as any)[op.name](...op.args);
    return { ok: true };
  } catch (e) {
    assert.ok(e instanceof InventoryError, `only InventoryError may escape, got ${e}`);
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Run one seeded sequence, calling `each(op, outcome, inv)` after every step. */
function sequence(seed: number, steps: number, each?: (op: Op, outcome: Outcome, inv: Inventory) => void): Inventory {
  const rand = mulberry32(seed);
  const inv = new Inventory();
  inv.addWarehouse(WAREHOUSES[0]!);
  inv.addWarehouse(WAREHOUSES[1]!);
  for (let i = 0; i < steps; i++) {
    const op = nextOp(rand, inv);
    const outcome = run(inv, op);
    each?.(op, outcome, inv);
  }
  return inv;
}

test("property: over 300 random sequences, replaying the log gives the live state, the same events, and frozen data", () => {
  let events = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const live = sequence(seed, 60);
    const log = live.events();
    events += log.length;
    log.forEach((e: any, i) => {
      assert.equal(e.seq, i + 1, `seed ${seed}: seq`);
      assert.ok(deepFrozen(e), `seed ${seed}: event ${i + 1} frozen`);
      assert.deepEqual(JSON.parse(JSON.stringify(e)), e, `seed ${seed}: event ${i + 1} is data`);
    });
    const replayed = Inventory.replay(log);
    assert.deepEqual(observe(replayed), observe(live), `seed ${seed}: replay`);
    assert.deepEqual(replayed.events(), log, `seed ${seed}: replayed log`);
    const viaJson = Inventory.replay(JSON.parse(JSON.stringify(log)));
    assert.deepEqual(observe(viaJson), observe(live), `seed ${seed}: replay of JSON`);
  }
  assert.ok(events > 300 * 10, `the sequences are not trivial (${events} events in all)`);
});

test("property: over 300 random sequences, a snapshot plus the tail gives the live state", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rand = mulberry32(seed * 31 + 7);
    const live = sequence(seed, 60);
    const log = live.events();
    const cut = Math.floor(rand() * (log.length + 1));
    const snapshot = Inventory.replay(log.slice(0, cut)).snapshot();
    assert.equal((snapshot as any).seq, cut, `seed ${seed}: snapshot seq`);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot, `seed ${seed}: snapshot is data`);
    const frozen = structuredClone(snapshot);
    const freeze = (v: any): void => {
      if (v && typeof v === "object") {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
      }
    };
    freeze(frozen);
    const tail = log.slice(cut);
    const restored = Inventory.restore(frozen, tail);
    assert.deepEqual(observe(restored), observe(live), `seed ${seed}: snapshot at ${cut} plus tail`);
    assert.deepEqual(restored.events(), tail, `seed ${seed}: restored events`);
    const whole = Inventory.restore(JSON.parse(JSON.stringify(snapshot)), log);
    assert.deepEqual(observe(whole), observe(live), `seed ${seed}: snapshot at ${cut} plus the whole log`);
    assert.equal(JSON.stringify(frozen), JSON.stringify(snapshot), `seed ${seed}: the snapshot was not changed`);
    // a snapshot of the live inventory at the end restores to the live state too
    assert.deepEqual(observe(Inventory.restore(live.snapshot())), observe(live), `seed ${seed}: snapshot at the end`);
  }
});

test("property: over 300 random sequences, a refused operation appends nothing and changes nothing", () => {
  let refused = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    let before: { events: readonly unknown[]; state: unknown; snapshot: string } | undefined;
    const rand = mulberry32(seed);
    const inv = new Inventory();
    inv.addWarehouse(WAREHOUSES[0]!);
    inv.addWarehouse(WAREHOUSES[1]!);
    for (let i = 0; i < 60; i++) {
      const op = nextOp(rand, inv);
      before = { events: inv.events(), state: observe(inv), snapshot: JSON.stringify(inv.snapshot()) };
      const outcome = run(inv, op);
      if (outcome.ok) {
        assert.equal(inv.events().length, before.events.length + 1, `seed ${seed} step ${i}: ${op.name} appends one event`);
      } else {
        refused++;
        assert.deepEqual(inv.events(), before.events, `seed ${seed} step ${i}: refused ${op.name}(${JSON.stringify(op.args)}) appended`);
        assert.deepEqual(observe(inv), before.state, `seed ${seed} step ${i}: refused ${op.name} changed the state`);
        assert.equal(JSON.stringify(inv.snapshot()), before.snapshot, `seed ${seed} step ${i}: refused ${op.name} changed the snapshot`);
      }
    }
  }
  assert.ok(refused > 300 * 5, `enough refusals were tried (${refused})`);
});

test("property: a replayed and a restored inventory go on exactly like the live one", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rand = mulberry32(seed * 17 + 3);
    const live = sequence(seed, 40);
    const replayed = Inventory.replay(live.events());
    const restored = Inventory.restore(live.snapshot());
    for (let i = 0; i < 30; i++) {
      const op = nextOp(rand, live);
      const a = run(live, op);
      const b = run(replayed, op);
      const c = run(restored, op);
      assert.deepEqual(b, a, `seed ${seed} step ${i}: replayed, ${op.name}(${JSON.stringify(op.args)})`);
      assert.deepEqual(c, a, `seed ${seed} step ${i}: restored, ${op.name}(${JSON.stringify(op.args)})`);
    }
    assert.deepEqual(observe(replayed), observe(live), `seed ${seed}: replayed state`);
    assert.deepEqual(observe(restored), observe(live), `seed ${seed}: restored state`);
    assert.deepEqual(replayed.events(), live.events(), `seed ${seed}: replayed events`);
    assert.deepEqual(restored.events(), live.events().slice(live.events().length - restored.events().length), `seed ${seed}: restored events are the last ones`);
  }
});

test("property: history(sku) lists exactly the events that changed that sku", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const expected = new Map<string, number[]>();
    const note = (sku: string, seq: number): void => {
      if (!expected.has(sku)) expected.set(sku, []);
      const list = expected.get(sku)!;
      if (list.at(-1) !== seq) list.push(seq);
    };
    const rand = mulberry32(seed);
    const inv = new Inventory();
    inv.addWarehouse(WAREHOUSES[0]!);
    inv.addWarehouse(WAREHOUSES[1]!);
    for (let i = 0; i < 60; i++) {
      const op = nextOp(rand, inv);
      const skusTouched: string[] =
        op.name === "release" || op.name === "fulfill"
          ? inv.orderLines(op.args[0] as string).map((l) => l.sku)
          : op.name === "receive" || op.name === "ship"
            ? [op.args[1] as string]
            : op.name === "reserve" || op.name === "transfer"
              ? [op.args[op.name === "reserve" ? 2 : 2] as string]
              : op.name === "returnItems"
                ? [op.args[2] as string]
                : [];
      const outcome = run(inv, op);
      if (outcome.ok) for (const s of skusTouched) note(s, inv.events().length);
    }
    for (const sku of [...SKUS, "unknown-sku"]) {
      assert.deepEqual(inv.history(sku).map((e: any) => e.seq), expected.get(sku) ?? [], `seed ${seed}: history(${sku})`);
    }
    const replayed = Inventory.replay(inv.events());
    for (const sku of SKUS) assert.deepEqual(replayed.history(sku), inv.history(sku), `seed ${seed}: replayed history(${sku})`);
  }
});
