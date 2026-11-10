import assert from "node:assert/strict";
import { test } from "node:test";
import { Cart } from "../src/cart.js";

test("total of simple items", () => {
  const cart = new Cart();
  cart.add("pen", 2, 3);
  assert.equal(cart.total(), 6);
});
