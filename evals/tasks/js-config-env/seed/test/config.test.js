import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.js";

test("defaults when there is no file", () => {
  assert.deepEqual(loadConfig("does-not-exist.json"), DEFAULTS);
});
