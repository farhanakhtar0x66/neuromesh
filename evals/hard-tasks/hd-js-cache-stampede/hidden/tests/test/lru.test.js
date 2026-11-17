import test from "node:test";
import assert from "node:assert/strict";
import { LruList } from "../src/lru.js";

test("touch puts a key last and shift takes the first", () => {
  const l = new LruList();
  l.touch("a");
  l.touch("b");
  l.touch("a");
  assert.deepEqual(l.keys(), ["b", "a"]);
  assert.equal(l.shift(), "b");
  assert.equal(l.size, 1);
});

test("remove and clear forget keys", () => {
  const l = new LruList();
  l.touch("a");
  l.touch("b");
  l.remove("a");
  assert.deepEqual(l.keys(), ["b"]);
  l.clear();
  assert.equal(l.shift(), undefined);
});
