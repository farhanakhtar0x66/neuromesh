import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.js";

test("hidden: edge cases", () => {
  assert.equal(slugify("a--b"), "a-b");
  assert.equal(slugify("---"), "");
  assert.equal(slugify(""), "");
  assert.equal(slugify("Rock & Roll 2026"), "rock-roll-2026");
  assert.equal(slugify("already-a-slug"), "already-a-slug");
});
