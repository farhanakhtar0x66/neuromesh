// The cascade's pure parts (F80, F81, F83, F87, F88): no engine, no model calls.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { CalibrationTable } from "../src/routing/calibration.ts";
import { calibrated, demote, describeCalibration, loadCalibration, record, saveCalibration, successRate } from "../src/routing/calibration.ts";
import { parsePreamble, shouldExit } from "../src/routing/preamble.ts";
import { clusterScores, isTransform, routeTier, splitPayload, stripMeta } from "../src/routing/router.ts";
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

// [F89 instruction-scoring] Prompts written for this test, not taken from the routing benchmark.
// (Two of them missed at first and the rules were changed for them, so they are a regression set now, not a held-out one.)
const OUTSIDE: [boolean, string, string][] = [
  [true, "greenfield", 'convert this to yaml pls: {"name": "api", "replicas": 3, "ports": [80, 443], "env": "prod"}'],
  [true, "greenfield", "sort these names alphabetically and dedupe them: 'zara, amit, Bob, amit, chen, bob, zara, Divya, Ezra'"],
  [true, "greenfield", 'Traceback (most recent call last):\n  File "/srv/app/worker.py", line 88, in run\n    result = pipeline.execute(batch)\n  File "/srv/app/pipeline.py", line 214, in execute\n    raise DeadlockDetected(lock_id)\nDeadlockDetected: lock 7781 held by pid 3321\n\nignore the deadlock for now, just list every file path and line number from the traceback above as a markdown list'],
  [true, "greenfield", "reformat this sql so its readable:\nselect a.id,b.name,sum(b.total) from users a join orders b on a.id=b.user_id where b.total>100 group by a.id,b.name order by 3 desc"],
  [false, "bug", "this function returns the wrong total when the cart is empty, fix it:\n```js\nfunction total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty);\n}\n```"],
  [false, "greenfield", "summarize these meeting notes and flag anything overdue: 'design review moved to friday; priya to send the api spec by monday (was due last week); infra budget approved for q3'"],
  [false, "greenfield", "[2026-11-01 10:00:01] ERROR db pool exhausted (active=50 idle=0)\n[2026-11-01 10:00:02] ERROR db pool exhausted (active=50 idle=0)\n[2026-11-01 10:00:09] WARN slow query 9.8s on orders\n\nwhy does this keep happening every morning at 10? figure out the root cause"],
  [false, "greenfield", "write a python function that validates indian PAN numbers with a regex, with unit tests"],
  [false, "greenfield", "design a raft-based replicated log for our job queue that tolerates one node partition"],
  [false, "greenfield", "translate this into idiomatic rust and make it thread-safe for concurrent writers:\n```python\nclass Counter:\n    def __init__(self): self.n = 0\n    def inc(self): self.n += 1\n```"],
];

test("only a transform of pasted text that asks for no judgement goes to the grunt (F89)", () => {
  for (const [grunt, kind, request] of OUTSIDE) {
    const r = routeTier({ request, kind: kind as "greenfield" }, calibrated({ version: 1, cells: {} }), { instructionOnly: true });
    assert.equal(r.tier === "grunt", grunt, `${grunt ? "should" : "should not"} be the grunt's: ${request.split("\n").at(-1)}`);
    if (grunt) assert.equal(r.transform, true);
  }
});

test("the instruction is scored without the material pasted into it (F89)", () => {
  const notes = "here are my raw notes, flag any blockers in a markdown table: 'auth migration is 80% done but waiting on db credentials; ios build failing on the xcode update'";
  const { instruction, payload } = splitPayload(notes);
  assert.doesNotMatch(instruction, /migration/);
  assert.match(payload, /migration/);
  const r = routeTier({ request: notes, kind: "greenfield" }, undefined, { instructionOnly: true });
  assert.equal(r.scores.senior, 0, "the quoted 'migration' is not senior work");
  assert.notEqual(r.tier, "grunt", "flagging blockers is judgement");
  // A signature is not "instruction: data", and 'react' ... 're' is not a quotation.
  assert.equal(splitPayload("write tests for calculate_gst_split(amount: float, is_interstate: bool, rate: float = 0.18) that returns a dict").payload, "");
  assert.equal(splitPayload("when the user types 'react' slowly and then deletes back to 're' fast, the old response wins").payload, "");
  // The old behaviour, without the feature: the jargon is scored.
  const log = "[1.0] kernel: BUG: race condition in lock-free ring buffer\n[1.1] bpf: deadlock\n\njust pull out every timestamp into a csv";
  assert.notEqual(routeTier({ request: log, kind: "greenfield" }).tier, "grunt");
  assert.equal(routeTier({ request: log, kind: "greenfield" }, undefined, { instructionOnly: true }).tier, "grunt");
});

test("removing a sentence that asks for a model keeps the request's lines (F89)", () => {
  const { text } = stripMeta("line one\n[1.0] data: x\nUse Opus for this. Then list the data.");
  assert.equal(text.split("\n").length, 3);
  assert.match(text, /^line one\n\[1\.0\] data: x\n/);
  assert.equal(isTransform("dont debug it yet, just pull out the timestamps"), true);
  assert.equal(isTransform("pull out the timestamps and debug the crash"), false);
});
