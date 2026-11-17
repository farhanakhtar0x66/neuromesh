// The contract in docs/EVENTS.md, scripted. Nothing here depends on the shape of an event beyond `seq` and `type`.
import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, InventoryError } from "../src/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

function deepFreezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const walk = (v: any): void => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
      Object.freeze(v);
    }
  };
  walk(copy);
  return copy;
}

function observe(inv: Inventory): unknown {
  const warehouses = inv.warehouses();
  const orders = ["o1", "o2", "o3", "o4", "o5"];
  return {
    warehouses,
    skus: inv.skus(),
    stock: inv.listStock(),
    low: inv.lowStock(4),
    perWarehouse: warehouses.map((w) => inv.listStock(w)),
    totals: inv.skus().map((s) => [s, inv.totalOnHand(s)]),
    orders: orders.map((o) => [inv.orderStatus(o), inv.orderLines(o), inv.returnsOf(o)]),
    cells: warehouses.flatMap((w) => inv.skus().map((s) => [w, s, inv.onHand(w, s), inv.reserved(w, s), inv.available(w, s)])),
  };
}

/** Every kind of change at least once, a few skus whose names sort differently from how they appear. */
function scenario(): Inventory {
  const inv = new Inventory();
  inv.addWarehouse("N"); // 1
  inv.addWarehouse("S"); // 2
  inv.receive("N", "40", 10); // 3
  inv.receive("N", "bolt", 20); // 4
  inv.receive("S", "7", 5); // 5
  inv.reserve("o1", "N", "bolt", 6); // 6
  inv.reserve("o1", "N", "40", 4); // 7
  inv.reserve("o2", "S", "7", 2); // 8
  inv.ship("N", "bolt", 5); // 9
  inv.transfer("N", "S", "bolt", 3); // 10
  inv.fulfill("o1"); // 11
  inv.returnItems("o1", "N", "bolt", 2); // 12
  inv.release("o2"); // 13
  inv.reserve("o3", "S", "bolt", 1); // 14
  inv.receive("S", "40", 2); // 15
  return inv;
}

function scenarioRefusals(inv: Inventory): (() => unknown)[] {
  return [
    () => inv.addWarehouse("N"),
    () => inv.addWarehouse(""),
    () => inv.receive("X", "bolt", 1),
    () => inv.receive("N", "", 1),
    () => inv.receive("N", "bolt", 0),
    () => inv.ship("N", "bolt", 999),
    () => inv.reserve("o9", "N", "bolt", 999),
    () => inv.reserve("o1", "N", "bolt", 1),
    () => inv.release("nope"),
    () => inv.release("o1"),
    () => inv.fulfill("nope"),
    () => inv.fulfill("o1"),
    () => inv.transfer("N", "N", "bolt", 1),
    () => inv.transfer("N", "X", "bolt", 1),
    () => inv.transfer("N", "S", "bolt", 999),
    () => inv.returnItems("o1", "N", "bolt", 999),
    () => inv.returnItems("o3", "S", "bolt", 1),
    () => inv.returnItems("nope", "N", "bolt", 1),
    () => inv.returnItems("o1", "S", "bolt", 1),
  ];
}

test("log: a new inventory has no events and a snapshot at seq 0", () => {
  const inv = new Inventory();
  assert.deepEqual(inv.events(), []);
  assert.equal((inv.snapshot() as any).seq, 0);
});

test("log: each successful change appends exactly one event, numbered from 1", () => {
  const inv = new Inventory();
  const steps: (() => void)[] = [
    () => inv.addWarehouse("N"),
    () => inv.addWarehouse("S"),
    () => inv.receive("N", "a", 10),
    () => inv.ship("N", "a", 1),
    () => inv.reserve("o1", "N", "a", 2),
    () => inv.reserve("o1", "N", "a", 1),
    () => inv.transfer("N", "S", "a", 1),
    () => inv.fulfill("o1"),
    () => inv.returnItems("o1", "N", "a", 1),
    () => inv.reserve("o2", "N", "a", 1),
    () => inv.release("o2"),
  ];
  steps.forEach((step, i) => {
    step();
    const events = inv.events();
    assert.equal(events.length, i + 1, `after step ${i + 1}`);
    assert.equal((events[i] as any).seq, i + 1);
    assert.equal(typeof (events[i] as any).type, "string");
  });
});

test("log: questions append nothing", () => {
  const inv = scenario();
  const before = inv.events().length;
  observe(inv);
  inv.history("bolt");
  inv.snapshot();
  assert.equal(inv.events().length, before);
});

test("log: a refused call appends nothing and changes nothing", () => {
  const inv = scenario();
  const events = inv.events();
  const state = observe(inv);
  const snapshot = JSON.stringify(inv.snapshot());
  for (const refused of scenarioRefusals(inv)) {
    assert.throws(refused, (e) => e instanceof InventoryError);
    assert.equal(inv.events().length, events.length);
  }
  assert.deepEqual(inv.events(), events);
  assert.deepEqual(observe(inv), state);
  assert.equal(JSON.stringify(inv.snapshot()), snapshot);
});

test("log: every event is frozen all the way down", () => {
  const inv = scenario();
  for (const e of inv.events()) assert.ok(deepFrozen(e), `event ${(e as any).seq} (${(e as any).type}) is deeply frozen`);
  assert.throws(() => {
    (inv.events()[0] as any).seq = 99;
  }, TypeError);
});

test("log: events are plain data that survive JSON", () => {
  for (const e of scenario().events()) assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});

test("log: events() is a new array each time", () => {
  const inv = scenario();
  const a = inv.events() as any[];
  a.push({ seq: 99, type: "junk" });
  a.length = 0;
  assert.equal(inv.events().length, 15);
  assert.notEqual(inv.events(), inv.events());
});

test("log: a log that is replayed gives the same state and the same events", () => {
  const live = scenario();
  const replayed = Inventory.replay(live.events());
  assert.deepEqual(observe(replayed), observe(live));
  assert.deepEqual(replayed.events(), live.events());
});

test("replay: an empty log is a new inventory", () => {
  const inv = Inventory.replay([]);
  assert.deepEqual(observe(inv), observe(new Inventory()));
  assert.deepEqual(inv.events(), []);
});

test("replay: events that came back from JSON are accepted, frozen in the copy, and left alone", () => {
  const live = scenario();
  const wire = JSON.parse(JSON.stringify(live.events())) as any[];
  const wireAgain = JSON.parse(JSON.stringify(live.events()));
  const replayed = Inventory.replay(wire);
  assert.deepEqual(observe(replayed), observe(live));
  assert.ok(replayed.events().every(deepFrozen), "the replayed inventory's events are frozen");
  assert.ok(wire.every((e) => !Object.isFrozen(e)), "the events that were passed in are not frozen");
  assert.deepEqual(wire, wireAgain);
});

test("replay: the new inventory goes on like the original, with the same results and the next seq", () => {
  const live = scenario();
  const replayed = Inventory.replay(live.events());
  for (const inv of [live, replayed]) {
    inv.reserve("o4", "S", "bolt", 2);
    inv.returnItems("o1", "N", "40", 4);
    assert.throws(() => inv.release("o1"), /order o1 is already fulfilled/);
  }
  assert.deepEqual(observe(replayed), observe(live));
  assert.deepEqual(replayed.events(), live.events());
  assert.equal((replayed.events().at(-1) as any).seq, 17);
});

test("replay: a log that does not start at 1, skips a number or repeats one is refused", () => {
  const events = [...scenario().events()];
  const code = (log: unknown[]): unknown => {
    try {
      Inventory.replay(log as any);
    } catch (e) {
      return (e as InventoryError).code;
    }
    return "no error";
  };
  assert.equal(code(events.slice(1)), "BAD_EVENT_LOG");
  assert.equal(code([...events.slice(0, 5), ...events.slice(6)]), "BAD_EVENT_LOG");
  assert.equal(code([...events.slice(0, 5), events[4], ...events.slice(5)]), "BAD_EVENT_LOG");
  assert.equal(code(events), "no error");
});

test("snapshot: it is plain data that survives JSON", () => {
  const snap = scenario().snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.equal((snap as any).seq, 15);
});

test("snapshot: it is a copy, later calls on the inventory do not change it", () => {
  const inv = scenario();
  const snap = inv.snapshot();
  const before = JSON.stringify(snap);
  inv.receive("N", "new", 1);
  inv.release("o3");
  inv.addWarehouse("E");
  assert.equal(JSON.stringify(snap), before);
});

test("restore: a snapshot alone gives the state at that moment, no events and the next seq", () => {
  const live = scenario();
  const snap = live.snapshot();
  const restored = Inventory.restore(snap);
  assert.deepEqual(observe(restored), observe(live));
  assert.deepEqual(restored.events(), []);
  restored.receive("N", "bolt", 1);
  assert.equal((restored.events()[0] as any).seq, 16);
  assert.equal((restored.snapshot() as any).seq, 16);
});

test("restore: it does not touch the snapshot, which may be frozen, and two restores are independent", () => {
  const live = scenario();
  const snap = deepFreezeCopy(live.snapshot());
  const before = JSON.stringify(snap);
  const a = Inventory.restore(snap);
  const b = Inventory.restore(snap);
  a.receive("N", "bolt", 5);
  a.reserve("o7", "N", "40", 1);
  a.addWarehouse("W");
  assert.equal(JSON.stringify(snap), before);
  assert.deepEqual(observe(b), observe(live));
  assert.equal(b.warehouses().length, 2);
});

test("restore: a snapshot from JSON text works", () => {
  const live = scenario();
  const restored = Inventory.restore(JSON.parse(JSON.stringify(live.snapshot())));
  assert.deepEqual(observe(restored), observe(live));
});

test("restore: a snapshot in the middle plus the tail is the same as the whole log", () => {
  const live = scenario();
  const events = live.events();
  const mid = Inventory.replay(events.slice(0, 8));
  const snap = mid.snapshot();
  assert.equal((snap as any).seq, 8);
  const tail = events.slice(8);
  const restored = Inventory.restore(snap, tail);
  assert.deepEqual(observe(restored), observe(live));
  assert.deepEqual(restored.events(), tail);
});

test("restore: events at or before the snapshot are skipped, so a whole log can be passed", () => {
  const live = scenario();
  const events = live.events();
  const snap = Inventory.replay(events.slice(0, 8)).snapshot();
  const restored = Inventory.restore(snap, events);
  assert.deepEqual(observe(restored), observe(live));
  assert.deepEqual(restored.events(), events.slice(8));
});

test("restore: a tail that does not continue at snapshot.seq + 1 is refused", () => {
  const events = [...scenario().events()];
  const snap = Inventory.replay(events.slice(0, 8)).snapshot();
  const code = (tail: unknown[]): unknown => {
    try {
      Inventory.restore(snap, tail as any);
    } catch (e) {
      return (e as InventoryError).code;
    }
    return "no error";
  };
  assert.equal(code(events.slice(9)), "BAD_EVENT_LOG");
  assert.equal(code([events[8], events[10]]), "BAD_EVENT_LOG");
  assert.equal(code(events.slice(8)), "no error");
});

test("restore: the events passed in are copied, not frozen or changed", () => {
  const live = scenario();
  const snap = Inventory.replay(live.events().slice(0, 8)).snapshot();
  const wire = JSON.parse(JSON.stringify(live.events().slice(8))) as any[];
  const restored = Inventory.restore(snap, wire);
  assert.ok(wire.every((e) => !Object.isFrozen(e)));
  assert.ok(restored.events().every(deepFrozen));
});

test("restore: a restored inventory refuses and appends exactly like the original", () => {
  const live = scenario();
  const restored = Inventory.restore(live.snapshot());
  const refusals = scenarioRefusals(live);
  const refusalsRestored = scenarioRefusals(restored);
  refusals.forEach((fn, i) => {
    let a = "";
    let b = "";
    try {
      fn();
    } catch (e) {
      a = `${(e as InventoryError).code}|${(e as Error).message}`;
    }
    try {
      refusalsRestored[i]!();
    } catch (e) {
      b = `${(e as InventoryError).code}|${(e as Error).message}`;
    }
    assert.notEqual(a, "");
    assert.equal(b, a, `refusal ${i}`);
  });
  assert.deepEqual(restored.events(), []);
});

test("order: listing orders, integer-like names and prototype names survive snapshot and replay", () => {
  const inv = new Inventory();
  inv.addWarehouse("20");
  inv.addWarehouse("__proto__");
  inv.addWarehouse("3");
  for (const [w, s] of [["3", "9"], ["20", "100"], ["__proto__", "constructor"], ["20", "b"], ["3", "10"], ["20", "2"], ["__proto__", "__proto__"]] as const) inv.receive(w, s, 2);
  inv.reserve("o1", "3", "9", 1);
  inv.reserve("o1", "20", "2", 1);
  inv.reserve("o1", "3", "9", 1);
  inv.fulfill("o1");
  inv.returnItems("o1", "20", "2", 1);
  const expected = observe(inv);
  assert.deepEqual(observe(Inventory.replay(inv.events())), expected);
  assert.deepEqual(observe(Inventory.restore(inv.snapshot())), expected);
  assert.deepEqual(observe(Inventory.restore(JSON.parse(JSON.stringify(inv.snapshot())))), expected);
  assert.deepEqual(inv.skus(), ["9", "100", "constructor", "b", "10", "2", "__proto__"]);
  assert.deepEqual(Inventory.restore(inv.snapshot()).skus(), inv.skus());
});

test("history: the events that changed the units of a sku, in order", () => {
  const inv = scenario();
  const seqs = (sku: string): number[] => inv.history(sku).map((e: any) => e.seq);
  assert.deepEqual(seqs("bolt"), [4, 6, 9, 10, 11, 12, 14]);
  assert.deepEqual(seqs("40"), [3, 7, 11, 15]);
  assert.deepEqual(seqs("7"), [5, 8, 13]);
  assert.deepEqual(seqs("nothing"), []);
});

test("history: warehouse creation is in no sku's history, and a refused call is in none", () => {
  const inv = scenario();
  for (const sku of inv.skus()) assert.ok(inv.history(sku).every((e: any) => e.seq > 2));
  const before = inv.history("bolt").length;
  assert.throws(() => inv.ship("N", "bolt", 999));
  assert.equal(inv.history("bolt").length, before);
});

test("history: it is a new array of the log's own events", () => {
  const inv = scenario();
  const h = inv.history("bolt");
  const log = inv.events();
  assert.notEqual(inv.history("bolt"), h);
  for (const e of h) assert.ok(log.includes(e));
  (h as any[]).length = 0;
  assert.equal(inv.history("bolt").length, 7);
});

test("history: a restored inventory has only the events since the snapshot", () => {
  const live = scenario();
  const snap = Inventory.replay(live.events().slice(0, 10)).snapshot();
  const restored = Inventory.restore(snap, live.events());
  assert.deepEqual(restored.history("bolt").map((e: any) => e.seq), [11, 12, 14]);
  assert.deepEqual(restored.history("7").map((e: any) => e.seq), [13]);
  restored.receive("N", "bolt", 1);
  assert.deepEqual(restored.history("bolt").map((e: any) => e.seq), [11, 12, 14, 16]);
});

test("history: a release is in the history of every sku it freed", () => {
  const inv = new Inventory();
  inv.addWarehouse("N");
  inv.receive("N", "a", 5);
  inv.receive("N", "b", 5);
  inv.reserve("o1", "N", "a", 1);
  inv.reserve("o1", "N", "b", 1);
  inv.release("o1");
  const replayed = Inventory.replay(inv.events());
  for (const i of [inv, replayed]) {
    assert.deepEqual(i.history("a").map((e: any) => e.seq), [2, 4, 6]);
    assert.deepEqual(i.history("b").map((e: any) => e.seq), [3, 5, 6]);
  }
});
