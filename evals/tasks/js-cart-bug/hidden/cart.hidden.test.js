import assert from "node:assert/strict";
import { test } from "node:test";
import { Cart } from "../src/cart.js";

test("hidden: exact to the cent", () => {
  const cart = new Cart();
  cart.add("a", 0.1, 3);
  cart.add("b", 0.2);
  cart.add("c", 29.6);
  assert.equal(cart.total(), 30.1);
  const c2 = new Cart();
  c2.add("x", 10.1);
  c2.add("y", 19.9);
  assert.equal(c2.total(), 30);
});

test("hidden: discount before tax, rounded to cents", () => {
  const cart = new Cart(0.08);
  cart.add("item", 19.99, 2);
  cart.applyDiscount(15);
  // subtotal 39.98, discounted 33.983, taxed 36.70164 -> 36.70
  assert.equal(cart.total(), 36.7);
  assert.equal(cart.subtotal(), 39.98);
});
