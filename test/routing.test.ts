// The cascade's pure parts (F80, F81, F83, F87, F88): no engine, no model calls.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { CalibrationTable } from "../src/routing/calibration.ts";
import { calibrated, demote, describeCalibration, loadCalibration, record, saveCalibration, successRate } from "../src/routing/calibration.ts";
import { parsePreamble, shouldExit } from "../src/routing/preamble.ts";
import { buildBreadth, clusterScores, isTransform, routeTier, splitPayload, stripMeta } from "../src/routing/router.ts";
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

// [F94 subsystem-breadth] Written by someone outside the project (the owner's friend) after the
// domain lists were drafted, so the lists are tested against phrasing they were not written for.
// Words taken from these prompts were removed from the lists before the test was run.
const BROAD = [
  "make me a local AI agent that logs into free LLM sites, routes keys via OpenRouter OAuth/BYOK, and manages state in CONTEXT.md",
  "build a local CLI password vault that encrypts secrets with Argon2 and ChaCha20, syncs encrypted blobs across devices over peer-to-peer mDNS, and exposes a local Unix socket for browser extensions",
  "create a real-time log monitor that tails docker container stdout streams, buffers spikes in a local sqlite ring table, triggers webhook alerts on regex matches, and streams live metrics over websockets",
  "make a documentation indexer that crawls a docs site respecting robots.txt, chunks code blocks by AST, stores embeddings in a local vector index, and serves search queries over stdio as an MCP server",
];
const NARROW = [
  "write a Fastify middleware function that reads a Bearer JWT from the Authorization header, checks if its jti claim exists in a Redis blocklist, and attaches the decoded user payload to the request",
  "write a python cli script that takes a csv file path and a sqlite db path as arguments, creates a table matching the csv headers, and bulk inserts all rows inside a single transaction",
  "in src/retry_client.ts, implement an HTTP fetch wrapper with exponential backoff, jitter, a circuit breaker that trips after 5 consecutive 5xx responses, and request timeout cancellation",
  "build a todo app with a list, a form to add items and a button to clear done ones",
];

test("a short new build across three or more subsystems, with no code file named, goes to the expert's plan (F94)", () => {
  for (const request of BROAD) {
    const r = routeTier({ request, kind: "greenfield" }, undefined, { instructionOnly: true, breadth: true });
    assert.equal(r.tier, "expert", request);
    assert.equal(r.stage, "rules", "a rules-stage expert route gets the sandwich (F93)");
    assert.ok((r.domains?.length ?? 0) >= 3);
  }
  for (const request of NARROW) {
    const r = routeTier({ request, kind: "greenfield" }, undefined, { instructionOnly: true, breadth: true });
    assert.equal(r.domains, undefined, request);
    assert.notEqual(r.stage === "rules" && r.tier === "expert", true, request);
  }
  // A fix or a refactor of something that exists is never a design from nothing.
  assert.equal(buildBreadth(BROAD[2]!, "bug"), undefined);
  // Off, the broad requests route as before.
  assert.equal(routeTier({ request: BROAD[0]!, kind: "greenfield" }, undefined, { instructionOnly: true }).domains, undefined);
  // The earlier regression set is unchanged by it.
  for (const [, kind, request] of OUTSIDE) {
    const a = routeTier({ request, kind: kind as "greenfield" }, undefined, { instructionOnly: true });
    const b = routeTier({ request, kind: kind as "greenfield" }, undefined, { instructionOnly: true, breadth: true });
    assert.equal(b.tier, a.tier, request);
  }
});

// [F99 prose-guard] A sentence after "In <file>:" is the instruction. The first is the owner's
// friend's example, the second the real follow-up request where the bug was found (2026-11-14).
test("prose with numbers after a colon is the instruction, and one-line data is still left out (F99)", () => {
  const ringbuf = "In src/ringbuf.rs: fix the memory ordering race condition when capacity > 1024, consumers == 8, and sequence wrap-around exceeds 65535.";
  assert.equal(splitPayload(ringbuf).payload, "");
  assert.equal(routeTier({ request: ringbuf, kind: "bug" }, undefined, { instructionOnly: true }).tier, "expert");
  const followUp = "Bound the Notes so neither CONTEXT.md nor the prompt can grow without limit.\n\nIn src/context.js: cap Notes at a maximum of 20 entries and 2,000 total characters on disk. When folding evicted turns (or adding a note) would go beyond either limit, compact the oldest entries into a single rollup line of at most 240 characters.\n\nIn src/agent.js: cap the Notes system message sent to the model at 2,000 characters.";
  assert.equal(splitPayload(followUp).payload, "");
  // Data after a colon is still data.
  const lines: [string, string][] = [
    ["sort these numbers from low to high: 12, 45, 7, 300, 18, 92, 4, 61, 77, 23, 108, 5, 66", "12, 45, 7, 300, 18, 92, 4, 61, 77, 23, 108, 5, 66"],
    ["convert this to json please: name=api; replicas=3; ports=80/443; env=prod; region=eu-west-1", "name=api; replicas=3; ports=80/443; env=prod; region=eu-west-1"],
    ["turn these timestamps into a csv column: 10:00:01, 10:00:02, 10:00:09, 10:01:44, 10:02:10", "10:00:01, 10:00:02, 10:00:09, 10:01:44, 10:02:10"],
  ];
  for (const [request, data] of lines) {
    assert.equal(splitPayload(request).payload, data, request);
    assert.equal(routeTier({ request, kind: "greenfield" }, undefined, { instructionOnly: true }).tier, "grunt", request);
  }
});
