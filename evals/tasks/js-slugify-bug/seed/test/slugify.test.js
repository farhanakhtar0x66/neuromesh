import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.js";

test("simple words", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("punctuation and padding", () => {
  assert.equal(slugify("  Hello,   World! "), "hello-world");
});
