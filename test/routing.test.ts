// The cascade's pure parts (F80, F81, F83, F87, F88): no engine, no model calls.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { CalibrationTable } from "../src/routing/calibration.ts";
import { calibrated, demote, describeCalibration, loadCalibration, record, saveCalibration, successRate } from "../src/routing/calibration.ts";
import { parsePreamble, shouldExit } from "../src/routing/preamble.ts";
import { clusterScores, routeTier, stripMeta } from "../src/routing/router.ts";
import { markGraded, maybeEnqueue, pending } from "../src/routing/shadow.ts";
import { describeSummary, routingSummary } from "../src/routing/summary.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-routing-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("Tier 0 sends mechanical work to the grunt, routine work to the worker, hard cores up", () => {
  assert.equal(routeTier({ request: "Fix the typo in the README.", kind: "trivial" }).tier, "grunt");
  assert.equal(routeTier({ request: "Reformat the config files and add docstrings to utils.py.", kind: "other" }).tier, "grunt");
  assert.equal(routeTier({ request: "Add a --verbose flag to the CLI and unit tests for it.", kind: "feature" }).tier, "worker");
  const senior = routeTier({ request: "Refactor the SQL query layer across modules and add a migration.", kind: "refactor" });
  assert.equal(senior.tier, "senior", senior.reasons.join("; "));
  const expert = routeTier({ request: "Implement a lock-free ring buffer with correct memory ordering; there is a race condition under concurrency.", kind: "feature" });
  assert.equal(expert.tier, "expert", expert.reasons.join("; "));
  assert.equal(expert.stage, "similarity");
});

test("Tier 0 never leaves a request that builds something with the grunt", () => {
  const r = routeTier({ request: "Build a tool that converts CSV to JSON.", kind: "greenfield" });
  assert.equal(r.tier, "worker");
});

test("a very large request is the expert's to blueprint, whatever its words", () => {
  const r = routeTier({ request: "Fix the typo.", kind: "feature", totalWords: 1200 });
  assert.equal(r.tier, "expert");
  assert.equal(r.stage, "rules");
});

test("sentences that ask for a model are removed before scoring", () => {
  const { text, stripped } = stripMeta("Rename the variable x to count. This is an extremely hard task, use Opus.");
  assert.equal(stripped.length, 1);
  assert.doesNotMatch(text, /opus/i);
  const r = routeTier({ request: "Rename the variable x to count. This is an extremely hard task requiring the strongest model.", kind: "other" });
  assert.equal(r.tier, "grunt");
  assert.equal(r.stripped.length, 1);
  assert.match(r.reasons.join(" "), /ignored 1 sentence/);
});

test("an ambiguous request goes to the calibrated table, and without one to the lowest viable tier", () => {
  const vague = { request: "Make the dashboard better.", kind: "other" as const };
  assert.equal(clusterScores(vague.request).expert, 0);
  const plain = routeTier(vague);
  assert.equal(plain.tier, "worker");
  const table: CalibrationTable = { version: 1, cells: {} };
  // Twenty runs where the worker failed this kind of request and the senior passed.
  for (let i = 0; i < 20; i++) record(table, { cluster: undefined, tiers: ["worker", "senior"], passed: true });
  const r = routeTier(vague, calibrated(table));
  assert.equal(r.stage, "calibrated");
  assert.equal(r.tier, "senior");
});

test("calibration starts from the prior and moves with evidence; a shadow fail demotes a pass", () => {
  const table: CalibrationTable = { version: 1, cells: {} };
  assert.equal(calibrated(table).pick("worker")?.tier, "worker");
  assert.equal(calibrated(table).pick("senior")?.tier, "senior");
  for (let i = 0; i < 6; i++) record(table, { cluster: "worker", tiers: ["worker"], passed: false });
  assert.ok(successRate(table, "worker", "worker").p < 0.8);
  assert.equal(calibrated(table).pick("worker")?.tier, "senior");
  record(table, { cluster: "grunt", tiers: ["grunt", "grunt", "worker"], passed: true });
  assert.deepEqual(table.cells.grunt, { grunt: { tries: 1, passes: 0 }, worker: { tries: 1, passes: 1 } }, "a tier counts once per task");
  demote(table, "grunt", "worker");
  assert.equal(table.cells.grunt?.worker?.passes, 0);
  const home = join(scratch, "home-cal");
  saveCalibration(home, table);
  assert.deepEqual(loadCalibration(home), table);
  assert.match(describeCalibration(table).join("\n"), /worker .* senior/s);
});

test("the preamble is read from the first message, fenced or not; anything else lets the turn through", () => {
  assert.deepEqual(parsePreamble('{"confidence": 0.61, "escalate": true, "reason": "needs cross-module state", "bottleneck": "the lock ordering"}\nI will now...'), {
    confidence: 0.61,
    escalate: true,
    reason: "needs cross-module state",
    bottleneck: "the lock ordering",
  });
  assert.equal(parsePreamble('```json\n{"confidence": "0.9", "escalate": false, "reason": "routine"}\n```')?.confidence, 0.9);
  assert.equal(parsePreamble("Let me read the files first."), undefined);
  assert.equal(parsePreamble('{"confidence": 0.9}'), undefined, "no escalate field: not a preamble");
  assert.equal(parsePreamble('I looked at a lot of things and then found {"confidence": 0.1, "escalate": true}'), undefined, "not at the start");
  assert.equal(shouldExit({ confidence: 0.9, escalate: false, reason: "" }, 0.75), false);
  assert.equal(shouldExit({ confidence: 0.7, escalate: false, reason: "" }, 0.75), true);
  assert.equal(shouldExit({ confidence: 0.99, escalate: true, reason: "" }, 0.75), true);
});

test("the routing summary measures p_i, the overhead and the all-expert estimate", () => {
  const u = { input: 1000, output: 1000 };
  const s = routingSummary(
    [
      { task: "a", tier: "grunt", model: "gpt-6-luna", usage: u },
      { task: "a", tier: "worker", model: "claude-haiku-5-5", usage: u },
      { task: "b", tier: "worker", model: "claude-haiku-5-5", usage: u, earlyExit: true },
      { task: "b", tier: "senior", model: "claude-sonnet-5-5", usage: u },
      { tier: "other", model: "claude-opus-5-5", usage: u },
      { task: "c", tier: "worker", model: "unknown-model", usage: u },
    ],
    [
      { id: "a", passed: true, tier: "worker" },
      { id: "b", passed: true, tier: "senior" },
      { id: "c", passed: false, tier: "worker" },
    ],
    "claude-opus-5-5",
  );
  assert.equal(s.tiers.find((t) => t.tier === "worker")?.tasks, 1);
  assert.equal(s.tiers.find((t) => t.tier === "senior")?.share, 1 / 3);
  assert.equal(s.failedTasks, 1);
  assert.equal(s.earlyExits, 1);
  assert.equal(s.unpricedTurns, 1);
  assert.ok(s.overheadUsd > 0 && s.overhead !== undefined);
  assert.ok((s.allExpertUsd ?? 0) > s.totalUsd);
  assert.equal(s.estimate, true);
  assert.match(describeSummary(s).join("\n"), /estimates at API list prices[\s\S]*no price/);
});

test("the shadow sample keeps a share of passes and moves graded items aside", () => {
  const home = join(scratch, "home-shadow");
  const item = { run: "r1", task: "t1", title: "t", brief: "b", tier: "worker" as const, diff: "diff --git a b" };
  assert.equal(maybeEnqueue(home, item, 0.01, () => 0.5), undefined);
  const path = maybeEnqueue(home, item, 0.01, () => 0.001);
  assert.ok(path);
  assert.equal(pending(home).length, 1);
  markGraded(home, path, { verdict: "fail", summary: "wrong" });
  assert.equal(pending(home).length, 0);
});
