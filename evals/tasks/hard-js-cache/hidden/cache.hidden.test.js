import assert from "node:assert/strict";
import { test } from "node:test";
import { createCache } from "../src/cache.js";

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("hidden: LRU order follows get and set, not has", () => {
  const c = clock();
  const cache = createCache({ max: 3, ttlMs: 10_000, now: c.now });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.get("a");
  assert.equal(cache.has("b"), true);
  cache.set("d", 4); // evicts b: a was used, has(b) does not count
  assert.equal(cache.has("b"), false);
  assert.deepEqual(["a", "c", "d"].map((k) => cache.get(k)), [1, 3, 4]);
  cache.set("c", 30); // updating makes c most recent
  cache.set("e", 5); // the gets above left the order a, c, d; setting c made it a, d, c; so a is evicted
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("c"), 30);
  assert.equal(cache.stats().evictions, 2);
});

test("hidden: expiry", () => {
  const c = clock();
  const cache = createCache({ max: 2, ttlMs: 100, now: c.now });
  cache.set("a", 1);
  c.advance(99);
  assert.equal(cache.get("a"), 1);
  c.advance(1);
  assert.equal(cache.get("a"), undefined, "expired at exactly ttl");
  assert.equal(cache.has("a"), false);
  cache.set("b", 2);
  cache.set("c", 3);
  c.advance(50);
  cache.set("d", 4); // b and c live, so one is evicted
  assert.equal(cache.size(), 2);
  c.advance(60); // b, c expired (if still there); d still live
  assert.equal(cache.size(), 1);
  cache.set("e", 5);
  cache.set("f", 6); // expired entries do not count: no eviction needed beyond max live
  assert.equal(cache.size(), 2);
  assert.equal(cache.get("d"), undefined, "d was least recently used among live entries");
  assert.equal(cache.delete("zzz"), false);
  assert.equal(cache.delete("e"), true);
  assert.equal(cache.delete("e"), false);
});

test("hidden: expired entries do not cause evictions", () => {
  const c = clock();
  const cache = createCache({ max: 2, ttlMs: 100, now: c.now });
  cache.set("a", 1);
  cache.set("b", 2);
  c.advance(100);
  cache.set("c", 3);
  cache.set("d", 4);
  assert.equal(cache.stats().evictions, 0);
  assert.deepEqual([cache.get("c"), cache.get("d")], [3, 4]);
});

test("hidden: stats count hits and misses", () => {
  const c = clock();
  const cache = createCache({ max: 1, ttlMs: 100, now: c.now });
  cache.get("x");
  cache.set("x", 1);
  cache.get("x");
  cache.has("x");
  cache.set("y", 2);
  cache.get("x");
  assert.deepEqual(cache.stats(), { hits: 1, misses: 2, evictions: 1 });
});

test("hidden: getOrLoad shares one load and caches the result", async () => {
  const c = clock();
  const cache = createCache({ max: 5, ttlMs: 100, now: c.now });
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const loader = async (key) => {
    calls += 1;
    await gate;
    return `value of ${key}`;
  };
  const p1 = cache.getOrLoad("k", loader);
  const p2 = cache.getOrLoad("k", loader);
  assert.equal(p1, p2, "concurrent callers share the same promise");
  release();
  assert.deepEqual(await Promise.all([p1, p2]), ["value of k", "value of k"]);
  assert.equal(calls, 1);
  assert.equal(await cache.getOrLoad("k", loader), "value of k");
  assert.equal(calls, 1, "a live entry is not loaded again");
  assert.equal(cache.get("k"), "value of k");
  c.advance(100);
  await cache.getOrLoad("k", loader);
  assert.equal(calls, 2, "an expired entry is loaded again");
  const s = cache.stats();
  assert.equal(s.misses, 2);
  assert.equal(s.hits, 2);
});

test("hidden: a failed load is shared, not cached, and retried next time", async () => {
  const cache = createCache({ max: 5, ttlMs: 100, now: clock().now });
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error(`boom ${calls}`);
  };
  const a = cache.getOrLoad("k", failing);
  const b = cache.getOrLoad("k", failing);
  await assert.rejects(a, /boom 1/);
  await assert.rejects(b, /boom 1/);
  assert.equal(cache.has("k"), false);
  await assert.rejects(cache.getOrLoad("k", failing), /boom 2/);
  assert.equal(await cache.getOrLoad("k", async () => "ok"), "ok");
});

test("hidden: bad options", () => {
  assert.throws(() => createCache({ max: 0, ttlMs: 10 }), RangeError);
  assert.throws(() => createCache({ max: 1.5, ttlMs: 10 }), RangeError);
  assert.throws(() => createCache({ max: 2, ttlMs: 0 }), RangeError);
});
