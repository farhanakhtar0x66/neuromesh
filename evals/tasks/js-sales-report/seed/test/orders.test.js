import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOrders } from "../src/orders.js";

test("parses rows", () => {
  const rows = parseOrders("order_id,customer,item,quantity,unit_price_cents\n1,ana,pen,2,150\n");
  assert.deepEqual(rows, [{ orderId: "1", customer: "ana", item: "pen", quantity: 2, unitPriceCents: 150 }]);
});
