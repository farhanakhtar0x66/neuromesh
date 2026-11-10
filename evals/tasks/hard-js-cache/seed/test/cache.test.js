import assert from "node:assert/strict";
import { test } from "node:test";
import { createCache } from "../src/cache.js";

test("set and get", () => {
  const cache = createCache({ max: 2, ttlMs: 1000 });
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});
