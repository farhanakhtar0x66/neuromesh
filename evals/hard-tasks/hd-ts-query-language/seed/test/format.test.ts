import { test } from "node:test";
import assert from "node:assert/strict";
import { formatIssue, formatList } from "../src/index.ts";
import { sample } from "./helpers.ts";

test("one line per issue", () => {
  assert.equal(formatIssue(sample[2]!), "#3 [closed] P5 @bob Fix typo in README");
});

test("the count line", () => {
  assert.deepEqual(formatList([]), ["0 issues"]);
  assert.deepEqual(formatList([sample[0]!]).at(-1), "1 issue");
});
