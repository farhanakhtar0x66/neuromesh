import assert from "node:assert/strict";
import { test } from "node:test";
import { retry } from "../src/retry.ts";

test("returns the first success", async () => {
  assert.equal(await retry(async () => 42), 42);
});
