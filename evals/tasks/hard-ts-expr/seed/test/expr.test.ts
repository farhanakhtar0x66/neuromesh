import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/expr.ts";

test("adds", () => {
  assert.equal(evaluate("1 + 2"), 3);
});
