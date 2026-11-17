import test from "node:test";
import assert from "node:assert/strict";
import { PricingClient } from "../src/client.js";
import { ManualClock } from "../src/clock.js";

function transport(prices) {
  const calls = [];
  const fn = async (path) => {
    calls.push(path);
    const sku = decodeURIComponent(path.split("/").pop());
    if (!(sku in prices)) throw new Error(`404 ${path}`);
    return { cents: prices[sku] };
  };
  return { fn, calls };
}

test("price returns the price and caches it", async () => {
  const t = transport({ a: 250 });
  const client = new PricingClient(t.fn, { clock: new ManualClock(0) });
  assert.deepEqual(await client.price("a"), { sku: "a", cents: 250, currency: "USD" });
  await client.price("a");
  assert.deepEqual(t.calls, ["/prices/a"]);
  assert.deepEqual(client.stats(), { upstreamCalls: 1, cached: 1 });
});

test("a transport error reaches the caller", async () => {
  const t = transport({});
  const client = new PricingClient(t.fn, { clock: new ManualClock(0) });
  await assert.rejects(client.price("zzz"), /404/);
});

test("invalidate makes the next read go to the API", async () => {
  const prices = { a: 100 };
  const t = transport(prices);
  const client = new PricingClient(t.fn, { clock: new ManualClock(0) });
  await client.price("a");
  prices.a = 120;
  assert.equal(client.invalidate("a"), true);
  assert.equal((await client.price("a")).cents, 120);
});
