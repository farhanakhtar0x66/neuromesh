import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatCents } from "../src/money.js";
import { Inventory, OutOfStockError } from "../src/inventory.js";
import { Cart } from "../src/cart.js";
import { placeOrder } from "../src/orders.js";

test("hidden: money", () => {
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(-500), "-$5.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(100000000), "$1,000,000.00");
});

test("hidden: inventory", () => {
  const inv = new Inventory({ pen: 5, ink: 1, pad: 10 });
  assert.equal(inv.stock("pen"), 5);
  assert.equal(inv.stock("nope"), 0);
  inv.add("nope", 2);
  assert.equal(inv.stock("nope"), 2);
  inv.remove("pen", 5);
  assert.equal(inv.stock("pen"), 0);
  assert.deepEqual(inv.lowStock(3), ["ink", "nope", "pen"]);
  assert.throws(() => inv.add("pen", 0), RangeError);
  assert.throws(() => inv.remove("pen", 1.5), RangeError);
  try {
    inv.remove("ink", 4);
    assert.fail("expected OutOfStockError");
  } catch (e) {
    assert.ok(e instanceof OutOfStockError && e instanceof Error);
    assert.deepEqual([e.item, e.requested, e.available], ["ink", 4, 1]);
    assert.equal(e.message, "Out of stock: ink (requested 4, available 1)");
  }
  assert.equal(inv.stock("ink"), 1);
});

test("hidden: cart", () => {
  const cart = new Cart({ pen: 150, pad: 1999, ink: 333 });
  cart.add("pad");
  cart.add("pen", 2);
  cart.add("pad", 2);
  assert.deepEqual(cart.lines(), [
    { name: "pad", qty: 3, unitCents: 1999, totalCents: 5997 },
    { name: "pen", qty: 2, unitCents: 150, totalCents: 300 },
  ]);
  assert.equal(cart.subtotalCents(), 6297);
  assert.equal(cart.discountCents(), 0);
  assert.equal(cart.taxCents(), 504); // 503.76
  cart.applyCode("SAVE10");
  assert.equal(cart.discountCents(), 630); // 629.7
  assert.equal(cart.taxCents(), 453); // 5667 * 0.08 = 453.36
  assert.equal(cart.totalCents(), 6297 - 630 + 453);
  cart.applyCode("FLAT500");
  assert.equal(cart.discountCents(), 500);
  assert.throws(() => cart.applyCode("FREE"), /Unknown code: FREE/);
  assert.throws(() => cart.add("cup"), /Unknown product: cup/);
  const small = new Cart({ gum: 120 }, { taxRate: 0.1 });
  small.add("gum");
  small.applyCode("FLAT500");
  assert.equal(small.discountCents(), 120);
  assert.equal(small.totalCents(), 0);
});

test("hidden: orders", () => {
  const inv = new Inventory({ pen: 3, pad: 1 });
  const cart = new Cart({ pen: 150, pad: 1999 });
  cart.add("pen", 2);
  cart.add("pad", 2);
  assert.throws(() => placeOrder(cart, inv), (e) => e instanceof OutOfStockError && e.item === "pad");
  assert.equal(inv.stock("pen"), 3, "nothing changes when an item is short");
  const ok = new Cart({ pen: 150 });
  ok.add("pen", 3);
  const first = placeOrder(ok, inv);
  const second = placeOrder(new Cart({ pen: 150 }), inv);
  assert.equal(second.id, first.id + 1);
  assert.equal(inv.stock("pen"), 0);
  assert.deepEqual(
    { ...first, id: 0 },
    { id: 0, lines: [{ name: "pen", qty: 3, unitCents: 150, totalCents: 450 }], subtotalCents: 450, discountCents: 0, taxCents: 36, totalCents: 486 },
  );
});

test("hidden: command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "shop-"));
  const store = join(dir, "store.json");
  writeFileSync(store, JSON.stringify({ prices: { pen: 150, pad: 1999 }, stock: { pen: 10, pad: 1 }, taxRate: 0.08 }));
  const order = (o) => {
    const f = join(dir, `order-${Math.random()}.json`);
    writeFileSync(f, JSON.stringify(o));
    return f;
  };
  const run = (...args) => spawnSync(process.execPath, ["bin/shop.js", ...args], { encoding: "utf8" });

  const ok = run(store, order({ items: [{ name: "pen", qty: 2 }, { name: "pad", qty: 1 }], code: "SAVE10" }));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(ok.stdout.trim().split("\n"), [
    "2 x pen @ $1.50 = $3.00",
    "1 x pad @ $19.99 = $19.99",
    "Subtotal: $22.99",
    "Discount: -$2.30",
    "Tax: $1.66",
    "Total: $22.35",
  ]);
  const plain = run(store, order({ items: [{ name: "pen", qty: 1 }] }));
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!plain.stdout.includes("Discount"));
  const short = run(store, order({ items: [{ name: "pad", qty: 5 }] }));
  assert.equal(short.status, 1);
  assert.equal(short.stderr.trim(), "Out of stock: pad (requested 5, available 1)");
  assert.equal(run(store).status, 2);
  assert.equal(run(store, join(dir, "missing.json")).status, 2);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.equal(run(bad, order({ items: [] })).status, 2);
});
