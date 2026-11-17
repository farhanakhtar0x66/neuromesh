// Forty more tests of the public behaviour the seed already has (see README.md and the seed's own tests).
import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, InventoryError } from "../src/index.ts";

function base(): Inventory {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  inv.addWarehouse("W2");
  inv.receive("W1", "A", 10);
  inv.receive("W1", "B", 5);
  inv.receive("W2", "A", 4);
  return inv;
}
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof InventoryError) return `${e.code}: ${e.message}`;
    throw e;
  }
  return "no error";
}

test("more: a row received again after reaching zero keeps its place in the listing", () => {
  const inv = base();
  inv.ship("W1", "A", 10);
  inv.receive("W1", "C", 1);
  inv.receive("W1", "A", 2);
  assert.deepEqual(inv.listStock("W1").map((r) => `${r.sku}=${r.onHand}`), ["A=2", "B=5", "C=1"]);
});

test("more: a transfer appends the sku to the end of the destination's rows", () => {
  const inv = base();
  inv.receive("W2", "Z", 1);
  inv.transfer("W1", "W2", "B", 1);
  assert.deepEqual(inv.listStock("W2").map((r) => r.sku), ["A", "Z", "B"]);
});

test("more: a transfer to a warehouse that already has the row does not move it", () => {
  const inv = base();
  inv.receive("W2", "Z", 1);
  inv.transfer("W1", "W2", "A", 1);
  assert.deepEqual(inv.listStock("W2").map((r) => `${r.sku}=${r.onHand}`), ["A=5", "Z=1"]);
});

test("more: skus() is not reordered by later activity", () => {
  const inv = base();
  inv.receive("W2", "Q", 1);
  inv.ship("W1", "A", 10);
  inv.receive("W1", "A", 1);
  assert.deepEqual(inv.skus(), ["A", "B", "Q"]);
});

test("more: a refused call does not register a sku", () => {
  const inv = base();
  assert.match(code(() => inv.ship("W1", "Nope", 1)), /^INSUFFICIENT_STOCK/);
  assert.match(code(() => inv.reserve("o1", "W1", "Nope", 1)), /^INSUFFICIENT_STOCK/);
  assert.match(code(() => inv.receive("W9", "Nope", 1)), /^UNKNOWN_WAREHOUSE/);
  assert.deepEqual(inv.skus(), ["A", "B"]);
});

test("more: skus that look like integers keep the order they appeared in", () => {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  for (const sku of ["30", "5", "100", "b", "7"]) inv.receive("W1", sku, 1);
  assert.deepEqual(inv.skus(), ["30", "5", "100", "b", "7"]);
  assert.deepEqual(inv.listStock().map((r) => r.sku), ["30", "5", "100", "b", "7"]);
});

test("more: warehouse ids that look like integers keep creation order", () => {
  const inv = new Inventory();
  for (const id of ["20", "3", "x", "1"]) inv.addWarehouse(id);
  assert.deepEqual(inv.warehouses(), ["20", "3", "x", "1"]);
  inv.receive("1", "s", 1);
  inv.receive("20", "s", 1);
  assert.deepEqual(inv.listStock().map((r) => r.warehouse), ["20", "1"]);
});

test("more: names that are also Object.prototype names work as ids", () => {
  const inv = new Inventory();
  inv.addWarehouse("__proto__");
  inv.addWarehouse("constructor");
  inv.receive("__proto__", "toString", 3);
  inv.receive("constructor", "__proto__", 2);
  inv.reserve("hasOwnProperty", "__proto__", "toString", 1);
  assert.equal(inv.onHand("__proto__", "toString"), 3);
  assert.equal(inv.available("__proto__", "toString"), 2);
  assert.deepEqual(inv.skus(), ["toString", "__proto__"]);
  assert.equal(inv.orderStatus("hasOwnProperty"), "open");
  assert.equal(inv.orderStatus("valueOf"), "unknown");
});

test("more: listStock reports reserved and available per row", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 3);
  inv.reserve("o2", "W1", "A", 2);
  assert.deepEqual(inv.listStock("W1")[0], { warehouse: "W1", sku: "A", onHand: 10, reserved: 5, available: 5 });
});

test("more: reservations of one sku in two warehouses are separate", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 3);
  inv.reserve("o1", "W2", "A", 4);
  assert.equal(inv.available("W1", "A"), 7);
  assert.equal(inv.available("W2", "A"), 0);
  assert.deepEqual(inv.orderLines("o1").map((l) => `${l.warehouse}/${l.qty}`), ["W1/3", "W2/4"]);
});

test("more: two orders fulfilled one after the other leave the right stock", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 6);
  inv.reserve("o2", "W1", "A", 4);
  inv.fulfill("o2");
  assert.equal(inv.onHand("W1", "A"), 6);
  assert.equal(inv.available("W1", "A"), 0);
  inv.fulfill("o1");
  assert.equal(inv.onHand("W1", "A"), 0);
  assert.equal(inv.reserved("W1", "A"), 0);
});

test("more: returns can be taken in several steps and make the units available again", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 10);
  inv.fulfill("o1");
  assert.equal(inv.available("W1", "A"), 0);
  inv.returnItems("o1", "W1", "A", 4);
  inv.returnItems("o1", "W1", "A", 6);
  assert.equal(inv.available("W1", "A"), 10);
  assert.match(code(() => inv.returnItems("o1", "W1", "A", 1)), /^OVER_RETURN: cannot return 1 of A for order o1: only 0 left to return$/);
});

test("more: returnsOf keeps the shipping order of the lines", () => {
  const inv = base();
  inv.reserve("o1", "W2", "A", 1);
  inv.reserve("o1", "W1", "B", 2);
  inv.reserve("o1", "W1", "A", 3);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "A", 1);
  assert.deepEqual(inv.returnsOf("o1").map((l) => `${l.warehouse}/${l.sku}/${l.qty}/${l.returned}`), ["W2/A/1/0", "W1/B/2/0", "W1/A/3/1"]);
});

test("more: returnsOf is empty for open and unknown orders", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 1);
  assert.deepEqual(inv.returnsOf("o1"), []);
  assert.deepEqual(inv.returnsOf("zz"), []);
});

test("more: orderLines and returnsOf return copies", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 1);
  inv.orderLines("o1")[0]!.qty = 99;
  assert.equal(inv.orderLines("o1")[0]!.qty, 1);
  inv.fulfill("o1");
  inv.returnsOf("o1")[0]!.returned = 99;
  assert.equal(inv.returnsOf("o1")[0]!.returned, 0);
});

test("more: lowStock compares skus by plain character order", () => {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  for (const sku of ["a", "B", "c", "A"]) inv.receive("W1", sku, 1);
  assert.deepEqual(inv.lowStock(2).map((r) => r.sku), ["A", "B", "a", "c"]);
});

test("more: lowStock returns copies and does not change the listing", () => {
  const inv = base();
  inv.lowStock(100)[0]!.onHand = 0;
  assert.deepEqual(inv.listStock().map((r) => r.onHand), [10, 5, 4]);
});

test("more: lowStock keeps rows that are at zero", () => {
  const inv = base();
  inv.ship("W1", "B", 5);
  assert.deepEqual(inv.lowStock(1).map((r) => `${r.sku}@${r.warehouse}`), ["B@W1"]);
});

test("more: the same row in two warehouses sorts by listing order when available and sku tie", () => {
  const inv = new Inventory();
  inv.addWarehouse("W2");
  inv.addWarehouse("W1");
  inv.receive("W1", "A", 1);
  inv.receive("W2", "A", 1);
  assert.deepEqual(inv.lowStock(5).map((r) => r.warehouse), ["W2", "W1"]);
});

test("more: totalOnHand follows transfers, shipments and returns", () => {
  const inv = base();
  inv.transfer("W1", "W2", "A", 3);
  assert.equal(inv.totalOnHand("A"), 14);
  inv.ship("W2", "A", 2);
  assert.equal(inv.totalOnHand("A"), 12);
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "A", 1);
  assert.equal(inv.totalOnHand("A"), 12);
});

test("more: totalOnHand does not need the sku to exist", () => {
  assert.equal(new Inventory().totalOnHand("x"), 0);
});

test("more: a warehouse with no rows lists nothing", () => {
  const inv = base();
  inv.addWarehouse("W3");
  assert.deepEqual(inv.listStock("W3"), []);
  assert.equal(inv.listStock().length, 3);
});

test("more: an order that reserved nothing successfully stays unknown", () => {
  const inv = base();
  try {
    inv.reserve("o1", "W1", "A", 100);
  } catch {
    // refused
  }
  assert.equal(inv.orderStatus("o1"), "unknown");
  assert.match(code(() => inv.fulfill("o1")), /^UNKNOWN_ORDER/);
});

test("more: validation order for reserve: id, warehouse, sku, quantity, closed order, stock", () => {
  const inv = base();
  inv.reserve("done", "W1", "A", 1);
  inv.fulfill("done");
  assert.match(code(() => inv.reserve("", "W9", "", 0)), /^INVALID_ID: order id/);
  assert.match(code(() => inv.reserve("o", "W9", "", 0)), /^UNKNOWN_WAREHOUSE/);
  assert.match(code(() => inv.reserve("o", "W1", "", 0)), /^INVALID_ID: sku/);
  assert.match(code(() => inv.reserve("o", "W1", "A", 0)), /^INVALID_QUANTITY/);
  assert.match(code(() => inv.reserve("done", "W1", "A", 999)), /^ORDER_CLOSED/);
  assert.match(code(() => inv.reserve("o", "W1", "A", 999)), /^INSUFFICIENT_STOCK/);
});

test("more: validation order for transfer: both warehouses, same warehouse, sku, quantity, stock", () => {
  const inv = base();
  assert.match(code(() => inv.transfer("W9", "W8", "", 0)), /^UNKNOWN_WAREHOUSE: unknown warehouse W9/);
  assert.match(code(() => inv.transfer("W1", "W8", "", 0)), /^UNKNOWN_WAREHOUSE: unknown warehouse W8/);
  assert.match(code(() => inv.transfer("W1", "W1", "", 0)), /^SAME_WAREHOUSE/);
  assert.match(code(() => inv.transfer("W1", "W2", "", 0)), /^INVALID_ID/);
  assert.match(code(() => inv.transfer("W1", "W2", "A", 0)), /^INVALID_QUANTITY/);
  assert.match(code(() => inv.transfer("W1", "W2", "A", 99)), /^INSUFFICIENT_STOCK: insufficient stock for A in W1/);
});

test("more: validation order for returnItems: ids and quantity first, then the order", () => {
  const inv = base();
  assert.match(code(() => inv.returnItems("", "W1", "A", 1)), /^INVALID_ID: order id/);
  assert.match(code(() => inv.returnItems("o", "W9", "A", 1)), /^UNKNOWN_WAREHOUSE/);
  assert.match(code(() => inv.returnItems("o", "W1", "", 1)), /^INVALID_ID: sku/);
  assert.match(code(() => inv.returnItems("o", "W1", "A", 0)), /^INVALID_QUANTITY/);
  assert.match(code(() => inv.returnItems("o", "W1", "A", 1)), /^UNKNOWN_ORDER/);
});

test("more: release and fulfill report a fulfilled order as closed and an open one as fine", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  assert.match(code(() => inv.release("o1")), /^ORDER_CLOSED: order o1 is already fulfilled$/);
  assert.match(code(() => inv.fulfill("o1")), /^ORDER_CLOSED: order o1 is already fulfilled$/);
  assert.match(code(() => inv.release("never")), /^UNKNOWN_ORDER: unknown order never$/);
});

test("more: release and reserve again can put an order on different lines", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 5);
  inv.reserve("o1", "W2", "A", 1);
  inv.release("o1");
  inv.reserve("o1", "W2", "A", 2);
  assert.deepEqual(inv.orderLines("o1"), [{ warehouse: "W2", sku: "A", qty: 2 }]);
  assert.equal(inv.reserved("W1", "A"), 0);
});

test("more: ship does not look at other warehouses", () => {
  const inv = base();
  assert.match(code(() => inv.ship("W2", "A", 5)), /^INSUFFICIENT_STOCK: insufficient stock for A in W2: wanted 5, available 4$/);
});

test("more: ship counts reservations of every order against availability", () => {
  const inv = base();
  inv.reserve("o1", "W1", "B", 2);
  inv.reserve("o2", "W1", "B", 2);
  assert.match(code(() => inv.ship("W1", "B", 2)), /available 1$/);
  inv.ship("W1", "B", 1);
});

test("more: the quantity message names the value as given", () => {
  const inv = base();
  assert.equal(code(() => inv.ship("W1", "A", NaN)), "INVALID_QUANTITY: quantity must be a positive integer, got NaN");
  assert.equal(code(() => inv.ship("W1", "A", Infinity)), "INVALID_QUANTITY: quantity must be a positive integer, got Infinity");
  assert.equal(code(() => inv.ship("W1", "A", undefined as unknown as number)), "INVALID_QUANTITY: quantity must be a positive integer, got undefined");
});

test("more: the error is an Error with a name and a code", () => {
  const inv = base();
  try {
    inv.ship("W1", "A", 99);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e instanceof InventoryError);
    assert.equal((e as InventoryError).name, "InventoryError");
    assert.equal((e as InventoryError).code, "INSUFFICIENT_STOCK");
  }
});

test("more: onHand of a sku the warehouse does not hold is zero, of an unknown warehouse is an error", () => {
  const inv = base();
  assert.equal(inv.onHand("W2", "B"), 0);
  assert.equal(inv.reserved("W2", "B"), 0);
  assert.equal(inv.available("W2", "B"), 0);
});

test("more: a big sequence of receives and ships keeps the arithmetic exact", () => {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  let expected = 0;
  for (let i = 1; i <= 200; i++) {
    inv.receive("W1", "S", i);
    expected += i;
    if (i % 3 === 0) {
      inv.ship("W1", "S", i - 1);
      expected -= i - 1;
    }
  }
  assert.equal(inv.onHand("W1", "S"), expected);
});

test("more: two inventories do not share state", () => {
  const a = new Inventory();
  const b = new Inventory();
  a.addWarehouse("W1");
  assert.deepEqual(b.warehouses(), []);
  b.addWarehouse("W1");
  a.receive("W1", "A", 1);
  assert.equal(b.listStock().length, 0);
});

test("more: a fulfilled order's lines come out in reservation order even after merges", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 1);
  inv.reserve("o1", "W1", "B", 1);
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  assert.deepEqual(inv.returnsOf("o1").map((l) => `${l.sku}/${l.qty}`), ["A/2", "B/1"]);
});

test("more: a fulfilled order frees its id for nothing: it stays fulfilled", () => {
  const inv = base();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  assert.equal(inv.orderStatus("o1"), "fulfilled");
  assert.match(code(() => inv.reserve("o1", "W1", "B", 1)), /^ORDER_CLOSED/);
});

test("more: return into a row that was shipped down to zero", () => {
  const inv = base();
  inv.reserve("o1", "W1", "B", 5);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "B", 5);
  assert.equal(inv.onHand("W1", "B"), 5);
  assert.deepEqual(inv.listStock("W1").map((r) => r.sku), ["A", "B"]);
});

test("more: after a transfer the source row stays even at zero", () => {
  const inv = base();
  inv.transfer("W2", "W1", "A", 4);
  assert.deepEqual(inv.listStock("W2"), [{ warehouse: "W2", sku: "A", onHand: 0, reserved: 0, available: 0 }]);
});

test("more: reserving a transferred-in sku sees the arrived units", () => {
  const inv = base();
  inv.transfer("W1", "W2", "B", 3);
  inv.reserve("o1", "W2", "B", 3);
  assert.match(code(() => inv.reserve("o2", "W2", "B", 1)), /available 0$/);
});
