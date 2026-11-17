import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/index.ts";
import { ids, sample, store } from "./helpers.ts";

test("an empty search matches everything", () => {
  assert.deepEqual(ids(store.search("")), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(store.search("   ")), [1, 2, 3, 4, 5]);
});

test("a word is a case-insensitive substring of the title or the body", () => {
  assert.deepEqual(ids(store.search("login")), [1, 4]);
  assert.deepEqual(ids(store.search("LOGIN")), [1, 4]);
  assert.deepEqual(ids(store.search("typeerror")), [1]);
  assert.deepEqual(ids(store.search("ogi")), [1, 4]);
});

test("every word is required", () => {
  assert.deepEqual(ids(store.search("login crash")), [1]);
  assert.deepEqual(ids(store.search("login  security")), [4]);
  assert.deepEqual(ids(store.search("login dark")), []);
});

test("results come in id order", () => {
  const shuffled = new Store([...sample].reverse());
  assert.deepEqual(ids(shuffled.search("s")), [1, 2, 3, 4, 5].filter((n) => ids(store.search("s")).includes(n)));
});

test("labels and other fields are not searched", () => {
  assert.deepEqual(ids(store.search("performance")), []);
  assert.deepEqual(ids(store.search("carol")), []);
});

test("get and all", () => {
  assert.equal(store.get(4)?.title, "Upgrade the login library");
  assert.equal(store.get(99), undefined);
  assert.equal(store.all().length, 5);
});
