// F108 run-record (plan item L1): the one append-only record, live and backfilled. Fake backend only: no model calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { EventLog } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { resetFeatures } from "../src/features.ts";
import type { Preset } from "../src/presets/presets.ts";
import { backfill, findRunDirs } from "../src/record/backfill.ts";
import { linesFromEvent, outcomeOf, readRecord, recordPath, select, summarize, writeIndex } from "../src/record/record.ts";
import type { DecisionLine, TurnLine } from "../src/record/record.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-record-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.NEUROMESH_FAULT;
  resetFeatures();
});
let n = 0;
const dir = (): string => join(scratch, `d${++n}`);
const ev = (type: string, data: Record<string, unknown> = {}): NeuromeshEvent => ({ t: "2026-11-15T10:00:00.000Z", run: "r1", type, ...data });

test("F108: a turn and a decision become lines; narration, the request's text and unknown numbers do not", () => {
  const turn = linesFromEvent(ev("agent.finished", { task: "t1", role: "worker", kind: "initial", tier: "worker", cascadeTier: "grunt", model: "claude-haiku-5-5", stop: "done", durationMs: 900, usage: { input: 5, output: 7, split: { files: 1, commands: 2, earlier: 3, calls: 2, estimated: true } } }))[0] as TurnLine;
  assert.equal(turn.kind, "turn");
  assert.equal(turn.cascadeTier, "grunt");
  assert.equal(turn.usage?.split?.calls, 2);
  assert.ok(!("costEstimateUsd" in turn), "no price known: the field is absent, not 0");
  const decision = linesFromEvent(ev("route.tier", { feature: "F80", tier: "grunt", reasons: ["a mechanical transform"], prompt: "SECRET REQUEST TEXT" }))[0] as DecisionLine;
  assert.equal(decision.name, "route.tier");
  assert.equal(decision.feature, "F80");
  assert.deepEqual(decision.inputs.reasons, ["a mechanical transform"]);
  const started = JSON.stringify(linesFromEvent(ev("run.started", { prompt: "SECRET REQUEST TEXT", repo: "/Users/x/private", preset: "p" })));
  assert.ok(!started.includes("SECRET") && !started.includes("/Users/x"), "no request text, no paths");
  assert.match(started, /"promptChars":19/);
  assert.deepEqual(linesFromEvent(ev("agent.activity", { summary: "reading a file" })), []);
  assert.deepEqual(linesFromEvent(ev("run.finished")), [], "a run's end comes from run.json, not from the event");
});

function fakeState(id: string, extra: Partial<RunState> = {}): RunState {
  return {
    id, dir: "", repo: "/x/proj", prompt: "p", preset: "cascade-claude", status: "finished", createdAt: "2026-11-15T10:00:00.000Z", updatedAt: "2026-11-15T10:05:00.000Z",
    tasks: [{ id: "t1", title: "t", status: "passed", escalated: true }], attempts: [{ role: "worker", tier: "worker", task: "t1", round: 0, kind: "initial", backend: "claude", stop: "done", startedAt: "", durationMs: 1, usage: {}, costUsdEquivalent: 0.01 }],
    features: ["run-record"], inFlight: {},
    ...extra,
  } as unknown as RunState;
}

test("F108: live, an event log writes the record; a run's end adds the run and task lines; outcomes join by run and task", () => {
  const home = dir();
  const runDir = join(home, "projects", "proj-1", "runs", "r1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify(fakeState("r1")));
  const log = new EventLog(join(runDir, "events.jsonl"), "r1", undefined, home);
  log.emit("route.tier", { feature: "F80", task: "t1", tier: "worker" });
  log.emit("task.climbed", { feature: "F82", task: "t1", from: "worker", to: "senior" });
  log.emit("agent.finished", { task: "t1", role: "worker", stop: "done", usage: { output: 3 }, tier: "worker" });
  log.emit("run.finished", {});
  const lines = readRecord(home);
  assert.deepEqual(lines.map((l) => l.kind), ["decision", "decision", "turn", "run", "task"]);
  const climbed = select<DecisionLine>(lines, { kind: "decision", name: "task.climbed" })[0]!;
  const after = outcomeOf(lines, climbed);
  assert.equal(after.task?.status, "passed");
  assert.equal(after.task?.escalated, true);
  assert.equal(after.run?.status, "finished");
  assert.equal(after.run?.costEstimateUsd, 0.01, "an estimate, and only because every turn reported one");
  const s = summarize(lines);
  assert.equal(s.runs, 1);
  assert.equal(s.decisions["task.climbed"], 1);
  assert.equal(writeIndex(home).lines, 5);
  assert.ok(existsSync(join(home, "record", "index.json")));
});

test("F108: an engine run on the fake backend records itself in its home", async () => {
  const repo = join(scratch, `repo-${++n}`);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }));
  writeFileSync(join(repo, "check.js"), "const fs=require('fs');if(!fs.existsSync('fixed.txt'))process.exit(1)");
  const git = (...a: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  const fake = createFakeBackend((req) => {
    writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
    return { structured: { status: "done", summary: "wrote it", notes: "" } };
  });
  const ctx: EngineContext = { home: join(scratch, `home-${++n}`), backends: { fake }, turnTimeoutMs: 5_000 };
  const preset: Preset = { name: "test", description: "", mode: "solo", roles: { worker: [{ backend: "fake", model: "fake-worker", tier: "worker" }] }, repairs: 1, maxTasks: 4, maxParallel: 1, turnTimeoutMinutes: 1, intake: false, brief: false, routing: "rules", advise: false, test: "always" };
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset }, ctx);
  assert.equal(state.status, "finished");
  const lines = readRecord(ctx.home);
  assert.ok(select(lines, { kind: "turn", run: state.id }).length >= 1);
  assert.equal(select(lines, { kind: "run", run: state.id })[0]?.kind, "run");
  assert.ok(!JSON.stringify(lines).includes("make the test pass"), "the request's text is not in the record");
});

test("F108: a failing record is switched off for the run, the event says which feature, and the run goes on", () => {
  const home = dir();
  const events = join(home, "e", "events.jsonl");
  const seen: NeuromeshEvent[] = [];
  process.env.NEUROMESH_FAULT = "run-record";
  const log = new EventLog(events, "r1", (e) => seen.push(e), home);
  log.emit("route.tier", { tier: "worker" });
  log.emit("route.tier", { tier: "senior" });
  assert.equal(readRecord(home).length, 0);
  const failed = seen.filter((e) => e.type === "feature.failed");
  assert.equal(failed.length, 1, "told once, not on every event");
  assert.equal(failed[0]!.feature, "F108");
  assert.match(String(failed[0]!.hint), /--disable run-record/);
  assert.equal(readFileSync(events, "utf8").split("\n").filter(Boolean).length, 3, "both events and the failure are in the log");
});

test("F108: the record is skipped when switched off", () => {
  const home = dir();
  process.env.NEUROMESH_DISABLE = "run-record";
  resetFeatures();
  try {
    new EventLog(join(home, "e", "events.jsonl"), "r1", undefined, home).emit("route.tier", { tier: "worker" });
    assert.ok(!existsSync(recordPath(home)));
  } finally {
    delete process.env.NEUROMESH_DISABLE;
  }
});

test("F108: the backfill reads run folders, benchmark results and ratings, and does not add them twice", () => {
  const home = dir();
  const root = join(home, "projects", "proj-1", "runs", "r9");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "worktree"), { recursive: true });
  writeFileSync(join(root, "worktree", "run.json"), "{}");
  writeFileSync(join(root, "run.json"), JSON.stringify(fakeState("r9")));
  writeFileSync(join(root, "events.jsonl"), [ev("route.tier", { run: "r9", task: "t1", tier: "grunt" }), ev("agent.finished", { run: "r9", task: "t1", usage: { output: 4 }, tier: "worker", model: "claude-haiku-5-5" }), "{half a line"].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  const results = join(home, "bench", "rb-x");
  mkdirSync(results, { recursive: true });
  writeFileSync(join(results, "t11.json"), JSON.stringify({ id: "1.1", slug: "t11", name: "rb-x", config: "cascade", runId: "r9", score: { passed: 7, total: 7 }, quality: 10, costUsd: 0.005, finishedAt: "2026-11-15T10:06:00.000Z" }));
  mkdirSync(join(home, "usage"), { recursive: true });
  writeFileSync(join(home, "usage", "runs.jsonl"), `${JSON.stringify({ type: "rating", run: "r9", at: "2026-11-15T11:00:00.000Z", score: 4 })}\n${JSON.stringify({ type: "run", run: "r9" })}\n`);
  assert.deepEqual(findRunDirs(join(home, "projects")), [root], "the agent's worktree is not entered");
  const first = backfill({ roots: [join(home, "projects")], benchResults: [join(home, "bench")], home });
  assert.deepEqual([first.runsAdded, first.resultsAdded, first.ratingsAdded], [1, 1, 1]);
  const second = backfill({ roots: [join(home, "projects")], benchResults: [join(home, "bench")], home });
  assert.deepEqual([second.runsAdded, second.runsSkipped, second.resultsAdded, second.ratingsAdded, second.linesAdded], [0, 1, 0, 0, 0]);
  const lines = readRecord(home);
  assert.deepEqual(summarize(lines).byKind, { decision: 1, turn: 1, run: 1, task: 1, result: 1, rating: 1 });
  assert.equal(select(lines, { kind: "turn", model: "haiku" }).length, 1);
  assert.equal(select(lines, { kind: "result" })[0]!.src, "backfill:routing-bench");
  assert.ok(dirname(recordPath(home)).endsWith("record"));
});

test("F108: benchmark results are tagged with their prompt set, original or held-out", () => {
  const home = dir();
  const results = join(home, "bench", "ho-x");
  mkdirSync(results, { recursive: true });
  writeFileSync(join(results, "a.json"), JSON.stringify({ id: "1.1", slug: "t11", name: "ho-x", config: "cascade", score: { passed: 7, total: 7 }, quality: 10, finishedAt: "2026-11-15T10:00:00.000Z" }));
  writeFileSync(join(results, "b.json"), JSON.stringify({ id: "H1.1", slug: "h11", name: "ho-x", config: "cascade", score: { passed: 8, total: 8 }, quality: 10, finishedAt: "2026-11-15T10:01:00.000Z" }));
  writeFileSync(join(results, "c.json"), JSON.stringify({ id: "H2.1", set: "held-out", slug: "h21", name: "ho-x", config: "haiku", score: { passed: 3, total: 6 }, quality: 5, finishedAt: "2026-11-15T10:02:00.000Z" }));
  backfill({ roots: [], benchResults: [join(home, "bench")], home });
  const sets = Object.fromEntries(select(readRecord(home), { kind: "result" }).map((l) => [(l as { task: string }).task, (l as { set?: string }).set]));
  assert.deepEqual(sets, { "1.1": "original", "H1.1": "held-out", "H2.1": "held-out" });
});

test("F108: a rescored benchmark result is added as a new line, once, and the old line stays", () => {
  const home = dir();
  const results = join(home, "bench", "rb-r");
  mkdirSync(results, { recursive: true });
  const file = join(results, "t23.json");
  writeFileSync(file, JSON.stringify({ id: "2.3", slug: "t23", name: "rb-r", config: "cascade", score: { passed: 3, total: 15 }, quality: 2, finishedAt: "2026-11-15T10:00:00.000Z" }));
  assert.equal(backfill({ roots: [], benchResults: [join(home, "bench")], home }).resultsAdded, 1);
  writeFileSync(file, JSON.stringify({ id: "2.3", slug: "t23", name: "rb-r", config: "cascade", score: { passed: 15, total: 15 }, scoreAtRun: { passed: 3, total: 15 }, quality: 10, finishedAt: "2026-11-15T10:00:00.000Z" }));
  assert.equal(backfill({ roots: [], benchResults: [join(home, "bench")], home }).resultsAdded, 1, "the new score is a new line");
  assert.equal(backfill({ roots: [], benchResults: [join(home, "bench")], home }).resultsAdded, 0, "and only once");
  const lines = select(readRecord(home), { kind: "result" }) as { passed: number; scoreAtRun?: { passed: number } }[];
  assert.deepEqual(lines.map((l) => l.passed), [3, 15]);
  assert.equal(lines[1]!.scoreAtRun?.passed, 3);
});
