import assert from "node:assert/strict";
import { test } from "node:test";
import { resetDelayMs } from "../src/engine/cooldown.ts";
import { attemptFrom, codeKey, newHistory, observe } from "../src/engine/progress.ts";
import type { CheckResult } from "../src/checks/checks.ts";

test("reset times are read from quota messages", () => {
  assert.equal(resetDelayMs("Individual quota reached. Resets in 4h55m56s."), (4 * 3600 + 55 * 60 + 56) * 1000);
  assert.equal(resetDelayMs("Resets in 30m"), 30 * 60_000);
  assert.equal(resetDelayMs("Please try again in 20 minutes."), 20 * 60_000);
  assert.equal(resetDelayMs("You've hit your usage limit."), undefined);
});

const failing = (tail: string, name = "test"): CheckResult => ({
  name,
  command: "npm test",
  status: "failed",
  exitCode: 1,
  durationMs: 1,
  tail,
  signature: tail.slice(0, 16),
  logPath: "",
});

test("the breaker continues while failures shrink, and stops on a repeat or two flat attempts", () => {
  const h = newHistory();
  const two = attemptFrom([failing("✖ adds\n✖ subtracts")], "+a\n");
  const one = attemptFrom([failing("✖ adds")], "+b\n");
  assert.deepEqual(two.failedCases, ["test: adds", "test: subtracts"]);
  assert.equal(observe(h, two, false), "continue");
  assert.equal(observe(h, one, false), "continue", "fewer failing cases is progress");
  assert.equal(observe(h, attemptFrom([failing("✖ adds")], "+c\n"), false), "continue", "one flat attempt after progress is allowed");
  assert.equal(observe(h, attemptFrom([failing("✖ adds")], "+d\n"), false), "no-progress", "two flat attempts in a row stop it");

  const h2 = newHistory();
  const same = attemptFrom([failing("✖ adds")], "+x\n");
  assert.equal(observe(h2, same, false), "continue");
  assert.equal(observe(h2, attemptFrom([failing("✖ adds")], "+x\n"), false), "oscillated", "the exact same state again");
  assert.equal(observe(newHistory(), same, true), "passed");
});

test("the code fingerprint ignores formatting and comments", () => {
  const a = "diff --git a/x b/x\n+++ b/x\n+  const x = 1;\n+// note\n";
  const b = "diff --git a/x b/x\n+++ b/x\n+const   x = 1;\n+\n";
  const c = "diff --git a/x b/x\n+++ b/x\n+const x = 2;\n";
  assert.equal(codeKey(a), codeKey(b));
  assert.notEqual(codeKey(a), codeKey(c));
});

test("a compile error is not counted as compiling", () => {
  assert.equal(attemptFrom([failing("src/a.ts(1,1): error TS2304: Cannot find name 'x'.", "typecheck")], "").compileOk, false);
  assert.equal(attemptFrom([failing("✖ adds")], "").compileOk, true);
});
