import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, InventoryError } from "../src/index.ts";
import type { ErrorCode } from "../src/index.ts";

function stocked(): Inventory {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  inv.addWarehouse("W2");
  inv.receive("W1", "A", 10);
  inv.receive("W1", "B", 5);
  inv.receive("W2", "A", 4);
  return inv;
}

function refuses(fn: () => unknown, code: ErrorCode, message?: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof InventoryError, "an InventoryError");
    assert.equal(e.code, code);
    if (message !== undefined) assert.equal(e.message, message);
    return true;
  });
}

// ---- warehouses ----

test("warehouses are listed in creation order", () => {
  const inv = new Inventory();
  inv.addWarehouse("W9");
  inv.addWarehouse("W1");
  assert.deepEqual(inv.warehouses(), ["W9", "W1"]);
});

test("a duplicate warehouse is refused", () => {
  refuses(() => stocked().addWarehouse("W1"), "DUPLICATE_WAREHOUSE", "warehouse W1 already exists");
});

test("an empty warehouse id is refused", () => {
  refuses(() => new Inventory().addWarehouse(""), "INVALID_ID", "warehouse id must be a non-empty string");
});

test("a warehouse id that is not a string is refused", () => {
  refuses(() => new Inventory().addWarehouse(7 as unknown as string), "INVALID_ID");
});

test("receiving into an unknown warehouse is refused", () => {
  refuses(() => stocked().receive("W9", "A", 1), "UNKNOWN_WAREHOUSE", "unknown warehouse W9");
});

// ---- receive ----

test("receive adds units on hand", () => {
  const inv = stocked();
  assert.equal(inv.onHand("W1", "A"), 10);
  assert.equal(inv.onHand("W2", "A"), 4);
});

test("receive accumulates", () => {
  const inv = stocked();
  inv.receive("W1", "A", 7);
  assert.equal(inv.onHand("W1", "A"), 17);
});

test("a sku that was never received has nothing on hand", () => {
  assert.equal(stocked().onHand("W1", "Z"), 0);
});

test("a quantity of zero is refused", () => {
  refuses(() => stocked().receive("W1", "A", 0), "INVALID_QUANTITY", "quantity must be a positive integer, got 0");
});

test("negative, fractional and non-numeric quantities are refused", () => {
  const inv = stocked();
  refuses(() => inv.receive("W1", "A", -3), "INVALID_QUANTITY", "quantity must be a positive integer, got -3");
  refuses(() => inv.receive("W1", "A", 1.5), "INVALID_QUANTITY", "quantity must be a positive integer, got 1.5");
  refuses(() => inv.receive("W1", "A", "4" as unknown as number), "INVALID_QUANTITY", "quantity must be a positive integer, got 4");
  assert.equal(inv.onHand("W1", "A"), 10);
});

test("an empty sku is refused", () => {
  refuses(() => stocked().receive("W1", "", 1), "INVALID_ID", "sku must be a non-empty string");
});

test("the warehouse is checked before the sku and the quantity", () => {
  refuses(() => stocked().receive("W9", "", 0), "UNKNOWN_WAREHOUSE");
  refuses(() => stocked().receive("W1", "", 0), "INVALID_ID");
});

// ---- ship ----

test("ship takes units off the shelf", () => {
  const inv = stocked();
  inv.ship("W1", "A", 3);
  assert.equal(inv.onHand("W1", "A"), 7);
});

test("ship refuses more than is available", () => {
  const inv = stocked();
  refuses(() => inv.ship("W1", "A", 11), "INSUFFICIENT_STOCK", "insufficient stock for A in W1: wanted 11, available 10");
  assert.equal(inv.onHand("W1", "A"), 10);
});

test("ship cannot take reserved units", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 8);
  refuses(() => inv.ship("W1", "A", 3), "INSUFFICIENT_STOCK", "insufficient stock for A in W1: wanted 3, available 2");
  inv.ship("W1", "A", 2);
  assert.equal(inv.available("W1", "A"), 0);
});

test("a row stays listed after it reaches zero", () => {
  const inv = stocked();
  inv.ship("W1", "B", 5);
  assert.deepEqual(inv.listStock("W1").map((r) => [r.sku, r.onHand]), [["A", 10], ["B", 0]]);
});

test("shipping a sku the warehouse never had reports zero available", () => {
  refuses(() => stocked().ship("W2", "B", 1), "INSUFFICIENT_STOCK", "insufficient stock for B in W2: wanted 1, available 0");
});

test("ship refuses an invalid quantity", () => {
  refuses(() => stocked().ship("W1", "A", 0), "INVALID_QUANTITY");
});

// ---- reserve ----

test("reserve sets units aside", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 6);
  assert.equal(inv.reserved("W1", "A"), 6);
  assert.equal(inv.available("W1", "A"), 4);
});

test("reserve leaves the units on hand", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 6);
  assert.equal(inv.onHand("W1", "A"), 10);
});

test("reserve refuses more than is available", () => {
  const inv = stocked();
  refuses(() => inv.reserve("o1", "W1", "A", 11), "INSUFFICIENT_STOCK", "insufficient stock for A in W1: wanted 11, available 10");
  assert.equal(inv.orderStatus("o1"), "unknown");
});

test("orders compete for the same available units", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 7);
  refuses(() => inv.reserve("o2", "W1", "A", 4), "INSUFFICIENT_STOCK", "insufficient stock for A in W1: wanted 4, available 3");
  inv.reserve("o2", "W1", "A", 3);
  assert.equal(inv.reserved("W1", "A"), 10);
});

test("reserving the same warehouse and sku again adds to the line", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 2);
  inv.reserve("o1", "W1", "A", 3);
  assert.deepEqual(inv.orderLines("o1"), [{ warehouse: "W1", sku: "A", qty: 5 }]);
});

test("order lines keep the order they were first reserved in", () => {
  const inv = stocked();
  inv.reserve("o1", "W2", "A", 1);
  inv.reserve("o1", "W1", "B", 1);
  inv.reserve("o1", "W1", "A", 1);
  inv.reserve("o1", "W2", "A", 1);
  assert.deepEqual(
    inv.orderLines("o1").map((l) => `${l.warehouse}/${l.sku}/${l.qty}`),
    ["W2/A/2", "W1/B/1", "W1/A/1"],
  );
});

test("a fulfilled order cannot reserve more", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  refuses(() => inv.reserve("o1", "W1", "A", 1), "ORDER_CLOSED", "order o1 is already fulfilled");
});

test("reserve checks the order id", () => {
  refuses(() => stocked().reserve("", "W1", "A", 1), "INVALID_ID", "order id must be a non-empty string");
});

test("a refused reserve leaves no trace", () => {
  const inv = stocked();
  refuses(() => inv.reserve("o1", "W9", "A", 1), "UNKNOWN_WAREHOUSE");
  refuses(() => inv.reserve("o1", "W1", "A", 99), "INSUFFICIENT_STOCK");
  assert.equal(inv.orderStatus("o1"), "unknown");
  assert.deepEqual(inv.orderLines("o1"), []);
  assert.equal(inv.reserved("W1", "A"), 0);
});

// ---- release ----

test("release frees the reserved units", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 6);
  inv.release("o1");
  assert.equal(inv.available("W1", "A"), 10);
  assert.equal(inv.reserved("W1", "A"), 0);
});

test("releasing an unknown order is refused", () => {
  refuses(() => stocked().release("nope"), "UNKNOWN_ORDER", "unknown order nope");
});

test("a released order is unknown and can be reserved again", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 1);
  inv.release("o1");
  assert.equal(inv.orderStatus("o1"), "unknown");
  inv.reserve("o1", "W1", "B", 2);
  assert.deepEqual(inv.orderLines("o1"), [{ warehouse: "W1", sku: "B", qty: 2 }]);
});

test("releasing a fulfilled order is refused", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  refuses(() => inv.release("o1"), "ORDER_CLOSED", "order o1 is already fulfilled");
});

// ---- fulfill ----

test("fulfill ships the reserved units", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 6);
  inv.fulfill("o1");
  assert.equal(inv.onHand("W1", "A"), 4);
  assert.equal(inv.reserved("W1", "A"), 0);
  assert.equal(inv.available("W1", "A"), 4);
});

test("fulfill ships every line of the order", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 2);
  inv.reserve("o1", "W1", "B", 5);
  inv.reserve("o1", "W2", "A", 4);
  inv.fulfill("o1");
  assert.deepEqual(inv.listStock().map((r) => r.onHand), [8, 0, 0]);
});

test("a fulfilled order has the status fulfilled and no open lines", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  assert.equal(inv.orderStatus("o1"), "fulfilled");
  assert.deepEqual(inv.orderLines("o1"), []);
});

test("fulfilling twice is refused", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 1);
  inv.fulfill("o1");
  refuses(() => inv.fulfill("o1"), "ORDER_CLOSED", "order o1 is already fulfilled");
  assert.equal(inv.onHand("W1", "A"), 9);
});

test("fulfilling an unknown order is refused", () => {
  refuses(() => stocked().fulfill("zzz"), "UNKNOWN_ORDER", "unknown order zzz");
});

test("fulfill leaves other orders' reservations alone", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 3);
  inv.reserve("o2", "W1", "A", 4);
  inv.fulfill("o1");
  assert.equal(inv.reserved("W1", "A"), 4);
  assert.equal(inv.available("W1", "A"), 3);
});

test("fulfill can take a row to zero and the row stays", () => {
  const inv = stocked();
  inv.reserve("o1", "W2", "A", 4);
  inv.fulfill("o1");
  assert.deepEqual(inv.listStock("W2"), [{ warehouse: "W2", sku: "A", onHand: 0, reserved: 0, available: 0 }]);
});

// ---- transfer ----

test("transfer moves units between warehouses", () => {
  const inv = stocked();
  inv.transfer("W1", "W2", "A", 6);
  assert.equal(inv.onHand("W1", "A"), 4);
  assert.equal(inv.onHand("W2", "A"), 10);
});

test("transfer creates the row in the destination", () => {
  const inv = stocked();
  inv.transfer("W1", "W2", "B", 2);
  assert.deepEqual(inv.listStock("W2").map((r) => [r.sku, r.onHand]), [["A", 4], ["B", 2]]);
});

test("transfer refuses more than is available at the source", () => {
  const inv = stocked();
  refuses(() => inv.transfer("W2", "W1", "A", 5), "INSUFFICIENT_STOCK", "insufficient stock for A in W2: wanted 5, available 4");
  assert.equal(inv.onHand("W1", "A"), 10);
});

test("transfer inside one warehouse is refused", () => {
  refuses(() => stocked().transfer("W1", "W1", "A", 1), "SAME_WAREHOUSE", "cannot transfer within the same warehouse W1");
});

test("a transfer to an unknown warehouse changes nothing", () => {
  const inv = stocked();
  refuses(() => inv.transfer("W1", "W9", "A", 1), "UNKNOWN_WAREHOUSE", "unknown warehouse W9");
  assert.equal(inv.onHand("W1", "A"), 10);
});

test("transfer cannot move reserved units", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 9);
  refuses(() => inv.transfer("W1", "W2", "A", 2), "INSUFFICIENT_STOCK", "insufficient stock for A in W1: wanted 2, available 1");
});

// ---- returns ----

test("returned units go back on the shelf they shipped from", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "A", 2);
  assert.equal(inv.onHand("W1", "A"), 7);
});

test("partial returns add up in returnsOf", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "A", 2);
  inv.returnItems("o1", "W1", "A", 1);
  assert.deepEqual(inv.returnsOf("o1"), [{ warehouse: "W1", sku: "A", qty: 5, returned: 3 }]);
});

test("returning more than shipped is refused", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  inv.fulfill("o1");
  inv.returnItems("o1", "W1", "A", 4);
  refuses(() => inv.returnItems("o1", "W1", "A", 2), "OVER_RETURN", "cannot return 2 of A for order o1: only 1 left to return");
  assert.equal(inv.onHand("W1", "A"), 9);
});

test("returning something the order did not ship is refused", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  inv.fulfill("o1");
  refuses(() => inv.returnItems("o1", "W1", "B", 1), "NOT_SHIPPED", "order o1 did not ship B from W1");
});

test("an open order cannot take returns", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  refuses(() => inv.returnItems("o1", "W1", "A", 1), "NOT_SHIPPED", "order o1 has not shipped");
});

test("returns for an unknown order are refused", () => {
  refuses(() => stocked().returnItems("nope", "W1", "A", 1), "UNKNOWN_ORDER", "unknown order nope");
});

test("returns go to the warehouse the order shipped from, not another", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 5);
  inv.fulfill("o1");
  refuses(() => inv.returnItems("o1", "W2", "A", 1), "NOT_SHIPPED", "order o1 did not ship A from W2");
});

// ---- questions ----

test("listStock goes by warehouse creation order, then by when each sku first appeared in that warehouse", () => {
  const inv = new Inventory();
  inv.addWarehouse("W2");
  inv.addWarehouse("W1");
  inv.receive("W1", "Z", 1);
  inv.receive("W2", "M", 1);
  inv.receive("W1", "B", 1);
  inv.receive("W2", "C", 1);
  inv.receive("W2", "M", 1);
  assert.deepEqual(inv.listStock().map((r) => `${r.warehouse}/${r.sku}`), ["W2/M", "W2/C", "W1/Z", "W1/B"]);
});

test("listStock for one warehouse lists only its rows, and an unknown warehouse is refused", () => {
  const inv = stocked();
  assert.deepEqual(inv.listStock("W2"), [{ warehouse: "W2", sku: "A", onHand: 4, reserved: 0, available: 4 }]);
  refuses(() => inv.listStock("W9"), "UNKNOWN_WAREHOUSE");
});

test("the rows listStock returns are copies", () => {
  const inv = stocked();
  const rows = inv.listStock();
  rows[0]!.onHand = 999;
  rows.pop();
  assert.equal(inv.onHand("W1", "A"), 10);
  assert.equal(inv.listStock().length, 3);
});

test("skus lists each sku once, in the order it first appeared in any warehouse", () => {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  inv.addWarehouse("W2");
  inv.receive("W1", "A", 1);
  inv.receive("W2", "B", 1);
  inv.receive("W1", "C", 1);
  inv.receive("W2", "A", 1);
  assert.deepEqual(inv.skus(), ["A", "B", "C"]);
  assert.deepEqual(inv.listStock().map((r) => r.sku), ["A", "C", "B", "A"]);
});

test("totalOnHand adds a sku over all warehouses", () => {
  const inv = stocked();
  assert.equal(inv.totalOnHand("A"), 14);
  assert.equal(inv.totalOnHand("Z"), 0);
});

test("lowStock lists the fewest available first, ties by sku, then in listing order", () => {
  const inv = new Inventory();
  inv.addWarehouse("W1");
  inv.addWarehouse("W2");
  inv.receive("W1", "B", 2);
  inv.receive("W1", "A", 2);
  inv.receive("W2", "A", 2);
  inv.receive("W2", "C", 1);
  inv.receive("W1", "D", 9);
  assert.deepEqual(inv.lowStock(3).map((r) => `${r.sku}@${r.warehouse}=${r.available}`), ["C@W2=1", "A@W1=2", "A@W2=2", "B@W1=2"]);
});

test("lowStock counts available units and is strict about the threshold", () => {
  const inv = stocked();
  inv.reserve("o1", "W1", "A", 8);
  assert.deepEqual(inv.lowStock(5).map((r) => `${r.sku}@${r.warehouse}`), ["A@W1", "A@W2"]);
  assert.deepEqual(inv.lowStock(2), []);
  assert.deepEqual(inv.lowStock(3).map((r) => `${r.sku}@${r.warehouse}`), ["A@W1"]);
});

test("orderStatus is open, fulfilled or unknown", () => {
  const inv = stocked();
  assert.equal(inv.orderStatus("o1"), "unknown");
  inv.reserve("o1", "W1", "A", 1);
  assert.equal(inv.orderStatus("o1"), "open");
  inv.fulfill("o1");
  assert.equal(inv.orderStatus("o1"), "fulfilled");
});

test("onHand, reserved and available refuse an unknown warehouse", () => {
  const inv = stocked();
  refuses(() => inv.onHand("W9", "A"), "UNKNOWN_WAREHOUSE");
  refuses(() => inv.reserved("W9", "A"), "UNKNOWN_WAREHOUSE");
  refuses(() => inv.available("W9", "A"), "UNKNOWN_WAREHOUSE");
});
