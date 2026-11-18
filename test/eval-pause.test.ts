import assert from "node:assert/strict";
import { test } from "node:test";
import { pauseCause } from "../src/eval/eval.ts";

test("an eval summary names what a paused task paused for", () => {
  assert.equal(pauseCause("the worker's tool is no longer signed in (OAuth token revoked). Sign in again, then resume the run."), "sign-in");
  assert.equal(pauseCause("the worker's tool cannot reach its service (ECONNREFUSED). Check the network, then resume the run."), "network");
  assert.equal(pauseCause("subscription limits reached for every worker model: five_hour 100%"), "quota");
  assert.equal(pauseCause("stopped by hand"), "other");
  assert.equal(pauseCause(undefined), "unknown");
});
