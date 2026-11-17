import test from "node:test";
import assert from "node:assert/strict";
import { MemoCache } from "../src/cache.js";
import { ManualClock } from "../src/clock.js";
import { countingLoader, flush, manualLoader } from "../testing/helpers.js";

function make(options = {}) {
  const clock = new ManualClock(1000);
  const { loader, seen } = countingLoader();
  const cache = new MemoCache({ loader, ttlMs: 100, clock, ...options });
  return { cache, clock, seen };
}

test("a miss calls the loader with the key and returns its value", async () => {
  const { cache, seen } = make();
  assert.equal(await cache.get("a"), "value-a-1");
  assert.deepEqual(seen, ["a"]);
});

test("a fresh entry is served without another load", async () => {
  const { cache, clock, seen } = make();
  await cache.get("a");
  clock.advance(99);
  assert.equal(await cache.get("a"), "value-a-1");
  assert.equal(seen.length, 1);
});

test("an entry older than the ttl is loaded again", async () => {
  const { cache, clock, seen } = make();
  await cache.get("a");
  clock.advance(100);
  assert.equal(await cache.get("a"), "value-a-2");
  assert.equal(seen.length, 2);
});

test("different keys are cached separately", async () => {
  const { cache, seen } = make();
  await cache.get("a");
  await cache.get("b");
  await cache.get("a");
  assert.deepEqual(seen, ["a", "b"]);
});

test("a stale entry is served at once and refreshed in the background", async () => {
  const clock = new ManualClock(0);
  const { loader, calls } = manualLoader();
  const cache = new MemoCache({ loader, ttlMs: 100, staleMs: 50, clock });
  const first = cache.get("a");
  calls[0].resolve("one");
  assert.equal(await first, "one");
  clock.advance(120);
  assert.equal(await cache.get("a"), "one");
  assert.equal(calls.length, 2);
  calls[1].resolve("two");
  await flush();
  assert.equal(await cache.get("a"), "two");
  assert.equal(calls.length, 2);
});

test("an entry past the stale window is gone", async () => {
  const clock = new ManualClock(0);
  const { loader, calls } = manualLoader();
  const cache = new MemoCache({ loader, ttlMs: 100, staleMs: 50, clock });
  const first = cache.get("a");
  calls[0].resolve("one");
  await first;
  clock.advance(150);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.size, 0);
});

test("a failed load rejects the caller with the loader's error", async () => {
  const clock = new ManualClock(0);
  const { loader, calls } = manualLoader();
  const cache = new MemoCache({ loader, ttlMs: 100, clock });
  const p = cache.get("a");
  const boom = new Error("upstream down");
  calls[0].reject(boom);
  await assert.rejects(p, (e) => e === boom);
});

test("a loader that throws rejects the caller", async () => {
  const cache = new MemoCache({
    loader: () => {
      throw new Error("sync failure");
    },
    ttlMs: 100,
    clock: new ManualClock(0),
  });
  await assert.rejects(cache.get("a"), /sync failure/);
});

test("set stores a value that get returns without loading", async () => {
  const { cache, seen } = make();
  cache.set("a", { cents: 5 });
  assert.deepEqual(await cache.get("a"), { cents: 5 });
  assert.equal(seen.length, 0);
});

test("set replaces the value and restarts the ttl", async () => {
  const { cache, clock } = make();
  cache.set("a", 1);
  clock.advance(90);
  cache.set("a", 2);
  clock.advance(90);
  assert.equal(await cache.get("a"), 2);
});

test("delete removes the entry and reports whether there was one", async () => {
  const { cache, seen } = make();
  await cache.get("a");
  assert.equal(cache.delete("a"), true);
  assert.equal(cache.delete("a"), false);
  assert.equal(cache.has("a"), false);
  await cache.get("a");
  assert.equal(seen.length, 2);
});

test("clear removes every entry", async () => {
  const { cache } = make();
  await cache.get("a");
  await cache.get("b");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.deepEqual(cache.keys(), []);
});

test("size counts the entries", async () => {
  const { cache } = make();
  assert.equal(cache.size, 0);
  await cache.get("a");
  cache.set("b", 1);
  assert.equal(cache.size, 2);
});

test("when full, the least recently used key is evicted", async () => {
  const { cache } = make({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  await cache.get("a"); // a is now more recent than b
  cache.set("c", 3);
  assert.deepEqual(cache.keys(), ["a", "c"]);
  assert.equal(cache.has("b"), false);
});

test("keys are listed from least to most recently used", async () => {
  const { cache } = make();
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  await cache.get("a");
  assert.deepEqual(cache.keys(), ["b", "c", "a"]);
});

test("the constructor checks its options", () => {
  const loader = async () => 1;
  assert.throws(() => new MemoCache({ ttlMs: 10 }), TypeError);
  assert.throws(() => new MemoCache({ loader, ttlMs: 0 }), RangeError);
  assert.throws(() => new MemoCache({ loader, ttlMs: 10, staleMs: -1 }), RangeError);
  assert.throws(() => new MemoCache({ loader, ttlMs: 10, maxEntries: 0 }), RangeError);
});
