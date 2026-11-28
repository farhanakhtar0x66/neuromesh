// [F142 replay-harness] The offline replay on synthetic history (run folders, evals' results, the record, stream
// logs), the cache-isolation claims and the eval runner's guard, and the all27/all21 rollup. No model calls; the
// only network is a mock Laya on 127.0.0.1. Nothing here reads or writes the real ~/.neuromesh.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { enable, resetFeatures } from "../src/features.ts";
import { CLASS_WEIGHTS, DEFAULT_WEIGHTS, buildSamples, formatReplay, labelsOf, loadHistory, quotaUnits, replay, sliceLog, typedRequest, writeLabels } from "../src/eval/replay.ts";
import { claimTask, describeClash, heldBy, release, tryClaim } from "../src/eval/isolation.ts";
import { frontierSubset, rollupTable, sweRollup } from "../src/eval/rollup.ts";
import type { EvalReport } from "../src/eval/eval.ts";
import type { LayaDecision } from "../src/routing/laya-client.ts";
import { LayaClient, layaConfig } from "../src/routing/laya-client.ts";
import { conformal, startMockLaya } from "./support/mock-laya.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-replay-test-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  resetFeatures();
});
beforeEach(() => resetFeatures());

// ---- fixtures ----

/** A Claude Code stream-json log: one assistant message per call (some split over two events with one id), each with a tool call. */
function streamLog(calls: { tool: string; input: Record<string, unknown>; usage: Record<string, number>; text?: string }[]): string {
  const lines: string[] = [JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "claude-haiku-5-5" })];
  calls.forEach((c, i) => {
    const id = `msg_${i + 1}`;
    if (c.text) lines.push(JSON.stringify({ type: "assistant", message: { id, content: [{ type: "text", text: c.text }], usage: c.usage } }));
    lines.push(JSON.stringify({ type: "assistant", message: { id, content: [{ type: "tool_use", id: `tu_${i + 1}`, name: c.tool, input: c.input }], usage: c.usage } }));
    lines.push(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tu_${i + 1}`, is_error: false, content: "ok" }] } }));
  });
  lines.push(JSON.stringify({ type: "result", subtype: "success", usage: {} }));
  return lines.join("\n") + "\n";
}

const callUsage = { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 };
const sixCalls = [
  { tool: "Read", input: { file_path: "calc.py" }, usage: callUsage, text: "I think the bug is the CHEAP_DIAGNOSIS in calc.py" },
  { tool: "Read", input: { file_path: "test_calc.py" }, usage: callUsage },
  { tool: "Edit", input: { file_path: "calc.py" }, usage: callUsage },
  { tool: "Bash", input: { command: "python -m pytest" }, usage: callUsage },
  { tool: "Edit", input: { file_path: "other.py" }, usage: callUsage },
  { tool: "Bash", input: { command: "python -m pytest -x" }, usage: callUsage },
];

interface RunFixture {
  id: string;
  model: string;
  usage: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number };
  outcome?: { checks: "passed" | "failed" | "none"; files: number; lines: number };
  log?: string;
  probe?: boolean;
  repo?: { dir: string; base: string };
  request?: string;
}

function writeRun(home: string, r: RunFixture): void {
  const dir = join(home, "projects", "proj", "runs", r.id);
  mkdirSync(dir, { recursive: true });
  let logPath: string | undefined;
  if (r.log) {
    logPath = join(dir, "turn-1.log");
    writeFileSync(logPath, r.log);
  }
  const state = {
    version: 2,
    id: r.id,
    dir,
    repo: r.repo?.dir ?? join(scratch, "gone-repo"),
    base: r.repo?.base ?? "0000000",
    prompt: r.request ?? "Fix the add() function in calc.py: add(2, 3) gives 6.",
    preset: "solo-haiku",
    checks: [{ name: "tests", command: "python -m pytest" }],
    baseline: [{ name: "tests", status: "failed", output: "1 failed", durationMs: 10 }],
    ...(r.probe
      ? { probe: { facts: { version: 1, ms: 1, truncated: false, requestWords: 10, repoFileCount: 3, codeFileCount: 2, skipped: { links: 0, unreadable: 0, binary: 0, large: 0 }, namedSymbols: ["add"], namedFiles: ["calc.py"], resolvedHits: [{ name: "calc.py", files: ["calc.py"] }], unresolvedNames: [], candidateFiles: ["calc.py"], fanIn: [], couplingSignal: "low", couplingBasis: "named code", mechanicalScore: 0.7, mechanicalSignals: [], complexitySignals: [], hasExistingSpec: false, specSignals: [], testRunners: [], trivialSelfContained: true, skipDossier: true }, layaStateText: "A tiny repository; the request names one function in one file." } }
      : {}),
    attempts: [{ role: "worker", tier: "worker", round: 1, kind: "initial", backend: "claude", model: r.model, stop: "done", startedAt: "2026-11-20T10:00:00.000Z", durationMs: 1000, usage: r.usage, ...(logPath ? { logPath } : {}) }],
    tasks: [],
    status: "finished",
    ...(r.outcome ? { outcome: { checks: r.outcome.checks, files: Array.from({ length: r.outcome.files }, (_, i) => ({ path: `f${i}.py`, status: "M" })), insertions: r.outcome.lines, deletions: 0 } } : {}),
    createdAt: "2026-11-20T10:00:00.000Z",
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(state, null, 2));
}

function writeEval(home: string, name: string, preset: string, results: { task: string; runId: string; hidden: string; usage?: unknown[] }[]): void {
  const dir = join(home, "evals", name);
  mkdirSync(dir, { recursive: true });
  const report = { name, preset, presetDetail: {}, startedAt: "2026-11-20T00:00:00.000Z", results: Object.fromEntries(results.map((r) => [r.task, { task: r.task, kind: "bug", language: "python", mode: "solo", status: "finished", checks: "passed", hidden: r.hidden, files: 1, insertions: 1, deletions: 0, turns: 1, repairs: 0, escalations: 0, wallMs: 60_000, usage: r.usage ?? [], expertTokens: 0, workerTokens: 0, usageIncomplete: false, runId: r.runId, finishedAt: "2026-11-20T01:00:00.000Z" }])) };
  writeFileSync(join(dir, "results.json"), JSON.stringify(report, null, 2));
}

function gitRepo(): { dir: string; base: string } {
  const dir = mkdtempSync(join(scratch, "repo-t2-"));
  writeFileSync(join(dir, "calc.py"), "def add(a, b):\n    return a * b\n");
  writeFileSync(join(dir, "test_calc.py"), "from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n");
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  const base = git("rev-parse", "HEAD");
  // The working tree moved on after the run started: the replay must probe the base commit, not this.
  writeFileSync(join(dir, "calc.py"), "def add(a, b):\n    return a + b\n");
  return { dir, base };
}

const haikuUsage = { input: 1000, cacheRead: 10_000, cacheWrite: 2000, output: 500 };
const opusUsage = { input: 2000, cacheRead: 50_000, cacheWrite: 4000, output: 3000 };

/** The synthetic history: T1 Haiku resolves, T2 Haiku fails its hidden check with passing checks, T3 Sonnet fails with no repository, a cascade, a record-only run, a broken grade. */
function makeHome(): { home: string; repo: { dir: string; base: string } } {
  const home = mkdtempSync(join(scratch, "home-"));
  const repo = gitRepo();
  writeRun(home, { id: "r-h1", model: "claude-haiku-5-5", usage: haikuUsage, outcome: { checks: "passed", files: 1, lines: 10 }, log: streamLog(sixCalls), probe: true });
  writeRun(home, { id: "r-h2", model: "claude-haiku-5-5", usage: haikuUsage, outcome: { checks: "passed", files: 1, lines: 4 }, log: streamLog(sixCalls), repo });
  writeRun(home, { id: "r-s3", model: "claude-sonnet-5-5", usage: { input: 500 }, outcome: { checks: "failed", files: 2, lines: 30 }, log: streamLog(sixCalls.slice(0, 2)) });
  writeRun(home, { id: "r-o1", model: "claude-opus-5-5", usage: opusUsage, outcome: { checks: "passed", files: 1, lines: 10 } });
  writeRun(home, { id: "r-o2", model: "claude-opus-5-5", usage: opusUsage, outcome: { checks: "passed", files: 5, lines: 200 } });
  writeRun(home, { id: "r-err", model: "claude-haiku-5-5", usage: haikuUsage, log: streamLog(sixCalls) });
  writeRun(home, { id: "r-real", model: "claude-haiku-5-5", usage: haikuUsage, outcome: { checks: "passed", files: 1, lines: 3 }, log: streamLog(sixCalls) });
  // A cascade: Haiku then Opus in one run; its outcome is not Haiku's.
  writeRun(home, { id: "r-mix", model: "claude-haiku-5-5", usage: haikuUsage, log: streamLog(sixCalls) });
  const mix = JSON.parse(readFileSync(join(home, "projects", "proj", "runs", "r-mix", "run.json"), "utf8"));
  mix.attempts.push({ ...mix.attempts[0], model: "claude-opus-5-5", logPath: undefined });
  writeFileSync(join(home, "projects", "proj", "runs", "r-mix", "run.json"), JSON.stringify(mix));
  writeEval(home, "swl-haiku-1", "solo-haiku", [{ task: "T1", runId: "r-h1", hidden: "pass" }, { task: "T2", runId: "r-h2", hidden: "fail" }, { task: "T9", runId: "r-err", hidden: "error" }]);
  writeEval(home, "swl-opus-1", "solo-opus", [{ task: "T1", runId: "r-o1", hidden: "pass" }, { task: "T2", runId: "r-o2", hidden: "pass" }]);
  writeEval(home, "swl-sonnet-1", "solo-sonnet", [{ task: "T3", runId: "r-s3", hidden: "fail" }]);
  writeEval(home, "swl-cascade-1", "cascade-claude", [{ task: "T1", runId: "r-mix", hidden: "pass" }]);
  mkdirSync(join(home, "record"), { recursive: true });
  writeFileSync(join(home, "record", "record.jsonl"), [
    JSON.stringify({ v: 1, kind: "run", run: "r-real", at: "2026-11-21T00:00:00.000Z", src: "live", preset: "solo-haiku", status: "finished", checks: "passed" }),
    JSON.stringify({ v: 1, kind: "run", run: "r-nochecks", at: "2026-11-21T00:00:00.000Z", src: "live", preset: "solo-haiku", status: "finished", checks: "none" }),
  ].join("\n") + "\n");
  return { home, repo };
}

/** Every file under a folder with its bytes and modification time, to prove the replay wrote nothing there. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, `${statSync(p).mtimeMs} ${readFileSync(p, "base64")}`);
    }
  };
  walk(dir);
  return out;
}

const ok = (answers: Record<string, unknown>[]): LayaDecision => {
  const out = {} as Record<string, unknown>;
  for (const a of answers) out[a.id as string] = { id: a.id, value: a.noul === "yes", route: a.route, abstain: a.abstain, predictionSet: a.prediction_set, unbound: false, conformal: true };
  return { status: "ok", answers: out, ms: 1 } as LayaDecision;
};
const cheapYes = ok([conformal("is_mechanical_or_localized", true), conformal("has_implied_invariants", false), conformal("cheap_will_resolve", true)]);
const abstained = ok([conformal("is_mechanical_or_localized", true), conformal("has_implied_invariants", false, { route: "review", abstain: true, prediction_set: ["yes", "no"] }), conformal("cheap_will_resolve", true)]);

/** Laya's answers in the order the samples are asked: T1, T2 (both "cheap will resolve"), T3 abstains, the record's run finds Laya down. */
function scripted(): { ask: (text: string) => Promise<LayaDecision>; texts: string[] } {
  const plan = [cheapYes, cheapYes, abstained, { status: "unavailable", route: "review", reason: "ECONNREFUSED", ms: 0 } as LayaDecision];
  const texts: string[] = [];
  return { texts, ask: async (text) => { texts.push(text); return plan[texts.length - 1] ?? plan.at(-1)!; } };
}

// ---- tests ----

test("F142: sliceLog keeps the first N model calls (one id split over two events is one call) and sums their tokens", () => {
  const log = streamLog(sixCalls);
  const s = sliceLog(log, 4);
  assert.equal(s.calls, 4);
  assert.equal(s.totalCalls, 6);
  assert.deepEqual(s.tokens, { inputUncached: 400, cacheRead: 4000, cacheCreation: 800, output: 200, calls: 4 });
  assert.ok(!s.text.includes("other.py"), "the fifth call is cut");
  assert.equal(sliceLog(log, 10).calls, 6, "a turn shorter than the cutoff is kept whole");
  // A call that reported no output count leaves output unknown, not 0.
  const noOut = streamLog([{ tool: "Read", input: { file_path: "a.py" }, usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 } }]);
  assert.equal(sliceLog(noOut, 3).tokens?.output, undefined);
});

test("F142: quota units weigh F137's four fields by the list prices' shape and the model; an unknown field is unknown", () => {
  const f = { inputUncached: 1000, cacheRead: 10_000, cacheCreation: 2000, output: 500 };
  const raw = 1000 * CLASS_WEIGHTS.inputUncached + 10_000 * CLASS_WEIGHTS.cacheRead + 2000 * CLASS_WEIGHTS.cacheCreation + 500 * CLASS_WEIGHTS.output;
  assert.equal(quotaUnits(f, "opus"), raw);
  assert.equal(quotaUnits(f, "haiku"), raw / 6);
  assert.equal(quotaUnits(f, "sonnet", { ...DEFAULT_WEIGHTS, sonnet: 0.4 }), raw * 0.4);
  assert.equal(quotaUnits({ ...f, cacheRead: undefined }, "opus"), undefined);
});

test("F142: the request as typed is the run's request, else its prompt only when no brief rewrote it (F109)", () => {
  assert.equal(typedRequest({ request: "typed", prompt: "brief text", brief: {} as never }), "typed");
  assert.equal(typedRequest({ prompt: "typed", brief: undefined }), "typed");
  assert.equal(typedRequest({ prompt: "the brief's rewrite", brief: {} as never }), undefined);
});

test("F142: loadHistory takes hidden-check outcomes from evals and checks outcomes from the record, and says why each other run is out", () => {
  const { home } = makeHome();
  const h = loadHistory(home);
  assert.deepEqual(h.runs.map((r) => [r.runId, r.task, r.tier, r.truth, r.resolved]), [
    ["r-mix", "T1", "mixed", "hidden", true],
    ["r-h1", "T1", "haiku", "hidden", true],
    ["r-h2", "T2", "haiku", "hidden", false],
    ["r-o1", "T1", "opus", "hidden", true],
    ["r-o2", "T2", "opus", "hidden", true],
    ["r-s3", "T3", "sonnet", "hidden", false],
    ["r-real", "run:r-real", "haiku", "checks", true],
  ]);
  assert.deepEqual(h.skipped, { "hidden check error": 1, "record: no checks to judge by": 1 });
});

test("F142: the replay gives a deterministic confusion matrix, coverage, quota simulation and label export, and writes nothing to history", async () => {
  const { home, repo } = makeHome();
  const before = snapshot(home);
  const repoBefore = snapshot(repo.dir);
  const history = loadHistory(home);
  const one = scripted();
  const a = await replay(history.runs, history.skipped, { cutoff: 4, ask: one.ask, tmpRoot: scratch });
  const r = a.report;

  assert.equal(r.samples, 4, "T1, T2, T3 and the record's run; the cascade and the opus runs are not cheap samples");
  assert.equal(r.skipped["ran on more than one model (its outcome is not the cheap model's)"], 1);
  assert.deepEqual(r.probeSources, { recorded: 1, snapshot: 1, metadata: 2 });
  assert.equal(r.judged, 3, "the record's run is judged only with --include-checks");
  assert.deepEqual(r.matrix, { cheapResolvedRoutedCheap: 1, cheapResolvedRoutedFrontier: 0, cheapFailedRoutedCheap: 1, cheapFailedRoutedFrontier: 1 });
  assert.equal(r.falseCheapRate, 0.5);
  assert.equal(r.falseFrontierRate, 0);
  assert.deepEqual(r.actions, { continue_cheap: 2, escalate_sonnet: 0, escalate_opus: 2 });
  assert.equal(r.laya.unavailable, 1);
  assert.deepEqual(r.laya.questions.has_implied_invariants, { answers: 3, abstained: 1, decisiveLabelled: 2, covered: 1 });
  assert.deepEqual(r.laya.questions.cheap_will_resolve, { answers: 3, abstained: 0, decisiveLabelled: 3, covered: 1 });
  assert.deepEqual(r.laya.questions.is_mechanical_or_localized, { answers: 3, abstained: 0, decisiveLabelled: 2, covered: 1 });

  // T1 and T2 stayed cheap: Haiku's whole run against Opus alone; T3 has no Opus run, so it is unknown, not 0.
  const haiku = (1000 + 10_000 * 0.05 + 2000 * 2 + 500 * 5) / 6;
  const opus = 2000 + 50_000 * 0.05 + 4000 * 2 + 3000 * 5;
  assert.equal(r.quota.tasks, 2);
  assert.equal(r.quota.unknown, 1);
  assert.ok(Math.abs(r.quota.routedUnits - 2 * haiku) < 1e-9);
  assert.equal(r.quota.soloOpusUnits, 2 * opus);
  assert.equal(r.quota.routedResolved, 1);
  assert.equal(r.quota.soloOpusResolved, 2);

  // The state text: the probe's text plus the digest; never the cheap model's words, names or paths, nor anything after the cut.
  assert.match(one.texts[0]!, /^A tiny repository; the request names one function in one file\. /);
  assert.match(one.texts[2]!, /could not be probed again/);
  for (const t of one.texts) {
    assert.ok(!/CHEAP_DIAGNOSIS|calc\.py|other\.py|pytest|\//.test(t), t);
  }
  assert.ok(!/several modules/.test(one.texts[0]!), "the edit to other.py is after the cut");

  // Labels: true, false or unknown.
  assert.deepEqual(a.rows.map((row) => row.labels), [
    { is_mechanical_or_localized: true, has_implied_invariants: false, cheap_will_resolve: true },
    { is_mechanical_or_localized: false, has_implied_invariants: true, cheap_will_resolve: false },
    { is_mechanical_or_localized: null, has_implied_invariants: null, cheap_will_resolve: false },
    { is_mechanical_or_localized: true, has_implied_invariants: false, cheap_will_resolve: true },
  ]);
  const out = join(home, "routing", "laya-labels.jsonl");
  writeLabels(out, a.rows);
  const written = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(written.length, 4);
  assert.deepEqual(Object.keys(written[0]), ["stateText", "labels"]);

  // Deterministic: the same history and answers give the same report and rows.
  const b = await replay(history.runs, history.skipped, { cutoff: 4, ask: scripted().ask, tmpRoot: scratch });
  assert.deepEqual(b.report, a.report);
  assert.deepEqual(b.rows, a.rows);

  // Read only: every historical file as it was, the repository's working tree too; the export is the one new file.
  const afterwards = snapshot(home);
  afterwards.delete(out);
  assert.deepEqual(afterwards, before);
  assert.deepEqual(snapshot(repo.dir), repoBefore);
  assert.equal(readdirSync(scratch).filter((n) => n.startsWith("neuromesh-replay-")).length, 0, "the snapshot folder is removed");

  const text = formatReplay(r);
  assert.match(text, /false-cheap rate \(quality loss risk\): 50\.0%/);
  assert.match(text, /on 2 tasks \(1 left out/);
  assert.match(text, /Sonnet 0\.5 of Opus, assumed/);
});

test("F142: the snapshot probe reads the run's base commit, not the working tree as it is now", () => {
  const { home } = makeHome();
  const history = loadHistory(home);
  const s = buildSamples(history.runs.filter((h) => h.runId === "r-h2"), 3, { tmpRoot: scratch }).samples[0]!;
  assert.equal(s.probeSource, "snapshot");
  assert.equal(s.facts?.repoFileCount, 2);
  assert.equal(s.callsKept, 3);
});

test("F142: labels and the cutoff: a later cutoff sees more of the turn", () => {
  const { home } = makeHome();
  const history = loadHistory(home);
  const h1 = history.runs.filter((h) => h.runId === "r-h1");
  const at3 = buildSamples(h1, 3).samples[0]!;
  const at5 = buildSamples(h1, 5).samples[0]!;
  assert.equal(at3.callsKept, 3);
  assert.equal(at5.callsKept, 5);
  // Before its first edit (call 3) the digest says so; from the cut at call 3 on, it does not.
  assert.match(buildSamples(h1, 2).samples[0]!.stateText, /It made no edit\./);
  assert.match(at3.stateText, /It made a focused edit\./);
  assert.ok(at5.cutUnits! > at3.cutUnits!);
  assert.deepEqual(labelsOf(at3, history.runs), { is_mechanical_or_localized: true, has_implied_invariants: false, cheap_will_resolve: true });
});

test("F142: through the real client, a mock Laya on 127.0.0.1 is asked once per sample; Laya down routes every run by the probe", async () => {
  enable("laya-gate");
  const { home } = makeHome();
  const history = loadHistory(home);
  const mock = await startMockLaya();
  try {
    mock.reply = { json: { answers: [conformal("is_mechanical_or_localized", true), conformal("has_implied_invariants", false), conformal("cheap_will_resolve", true)] } };
    const client = new LayaClient({ ...layaConfig({}), url: mock.url, timeoutMs: 2000 });
    const up = await replay(history.runs, history.skipped, { cutoff: 4, ask: (t) => client.decideRouting(t), tmpRoot: scratch, includeChecks: true });
    assert.equal(mock.requests.filter((q) => q.path === "/v1/ask").length, 4);
    assert.equal(up.report.actions.continue_cheap, 4);
    assert.equal(up.report.judged, 4);
    assert.deepEqual(up.report.matrix, { cheapResolvedRoutedCheap: 2, cheapResolvedRoutedFrontier: 0, cheapFailedRoutedCheap: 2, cheapFailedRoutedFrontier: 0 });
  } finally {
    await mock.close();
  }
  const down = new LayaClient({ ...layaConfig({}), url: "http://127.0.0.1:1", timeoutMs: 500 });
  const off = await replay(history.runs, history.skipped, { cutoff: 4, ask: (t) => down.decideRouting(t), tmpRoot: scratch });
  assert.equal(off.report.laya.unavailable, 4);
  assert.equal(off.report.actions.continue_cheap, 0, "never cheap without Laya");
  assert.equal(off.report.falseCheapRate, 0);
  assert.equal(off.report.falseFrontierRate, 1);
});

// ---- cache isolation ----

test("F142: a task claimed by another live eval is reported, a stale claim is taken over, and a release frees it", async () => {
  const dir = mkdtempSync(join(scratch, "claims-"));
  // Another eval, alive: this test's parent process.
  writeFileSync(join(dir, "T1.json"), JSON.stringify({ task: "T1", eval: "swl-trialB", preset: "dossier-sonnet", pid: process.ppid, at: "x" }));
  const mine = { task: "T1", eval: "swl-trialA", preset: "dossier-claude" };
  assert.equal(tryClaim(dir, mine), false);
  assert.equal(heldBy(dir, "T1", mine)?.eval, "swl-trialB");
  const warnings: string[] = [];
  assert.equal(await claimTask(dir, mine, "warn", { warn: (m) => warnings.push(m) }), false);
  assert.match(warnings[0]!, /running in eval swl-trialB .* another preset \(dossier-sonnet\)/);
  assert.match(describeClash("T1", { eval: "a", preset: "p" }, { task: "T1", eval: "b", preset: "p", pid: 1, at: "" }), /same preset \(p\)/);
  release(dir, "T1", mine);
  assert.equal(tryClaim(dir, mine), false, "a release never removes another eval's claim");

  // Sequential: wait until the other eval lets go.
  let polls = 0;
  const waited = await claimTask(dir, mine, "sequential", { warn: (m) => warnings.push(m), sleep: async () => { if (++polls === 2) rmSync(join(dir, "T1.json")); } });
  assert.equal(waited, true);
  assert.equal(polls, 2);
  assert.match(warnings.at(-1)!, /Waiting for it to finish/);
  assert.equal(JSON.parse(readFileSync(join(dir, "T1.json"), "utf8")).eval, "swl-trialA");
  release(dir, "T1", mine);

  // A claim left by a process that is gone is stale.
  const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  writeFileSync(join(dir, "T2.json"), JSON.stringify({ task: "T2", eval: "old", preset: "solo-opus", pid: Number(gone.stdout), at: "x" }));
  assert.equal(tryClaim(dir, { ...mine, task: "T2" }), true);

  // Aborted while waiting: false.
  writeFileSync(join(dir, "T3.json"), JSON.stringify({ task: "T3", eval: "b", preset: "p", pid: process.ppid, at: "x" }));
  const controller = new AbortController();
  const aborted = await claimTask(dir, { ...mine, task: "T3" }, "sequential", { signal: controller.signal, sleep: async () => controller.abort() });
  assert.equal(aborted, false);
});

test("F142: the eval runner warns about a task another eval is running, or waits it out with sequential mode, and releases its own claims", async () => {
  const { runEval, loadTasks } = await import("../src/eval/eval.ts");
  const { createFakeBackend } = await import("../src/backends/fake.ts");
  const { loadPreset } = await import("../src/presets/presets.ts");
  const suite = join(scratch, "iso-suite");
  mkdirSync(join(suite, "t1", "seed"), { recursive: true });
  mkdirSync(join(suite, "t1", "hidden"), { recursive: true });
  writeFileSync(join(suite, "t1", "task.json"), JSON.stringify({ kind: "bug", language: "javascript", hiddenCheck: "true" }));
  writeFileSync(join(suite, "t1", "prompt.md"), "Fix it.\n");
  writeFileSync(join(suite, "t1", "seed", "a.txt"), "a\n");
  const tasks = loadTasks(suite);
  const idle = () => createFakeBackend((req) => ("status" in ((req.outputSchema?.properties ?? {}) as object) ? { structured: { status: "done", summary: "nothing", notes: "", run: "" } } : { structured: {} }), "claude");
  const claims = mkdtempSync(join(scratch, "iso-claims-"));
  const other = JSON.stringify({ task: "t1", eval: "other-eval", preset: "solo-opus", pid: process.ppid, at: "x" });
  writeFileSync(join(claims, "t1.json"), other);
  const warnings: string[] = [];
  const preset = loadPreset("solo-haiku");
  const ctx = (home: string) => ({ home, backends: { claude: idle() }, onEvent: () => {}, turnTimeoutMs: 60_000 });
  const warned = await runEval({ name: "iso-a", preset, tasks, ctx: ctx(join(scratch, "iso-home-a")), isolation: { dir: claims, mode: "warn", warn: (m) => warnings.push(m) } });
  assert.equal(warned.results.t1?.hidden, "pass", "warn mode still runs the task");
  assert.match(warnings[0]!, /Task t1 is running in eval other-eval/);
  assert.equal(readFileSync(join(claims, "t1.json"), "utf8"), other, "the other eval's claim is left alone");

  setTimeout(() => rmSync(join(claims, "t1.json"), { force: true }), 50);
  const waited = await runEval({ name: "iso-b", preset, tasks, ctx: ctx(join(scratch, "iso-home-b")), isolation: { dir: claims, mode: "sequential", warn: (m) => warnings.push(m), pollMs: 10 } });
  assert.equal(waited.results.t1?.hidden, "pass");
  assert.deepEqual(readdirSync(claims), [], "its own claim is released when the task ends");
});

// ---- all27 next to all21 ----

test("F142: the rollup shows every run on the whole suite and on the frontier subset (tasks an Opus-alone run finished)", () => {
  const result = (task: string, hidden: string, status = "finished") => ({ task, hidden, status, usage: [] });
  const report = (name: string, preset: string, rs: ReturnType<typeof result>[]) => ({ name, preset, results: Object.fromEntries(rs.map((r) => [r.task, r])) }) as unknown as EvalReport;
  const haiku = report("swl-haiku-1", "solo-haiku", [result("easy1", "pass"), result("easy2", "pass"), result("hard1", "fail"), result("hard2", "fail")]);
  const opus = report("swl-opus-1", "solo-opus", [result("hard1", "pass"), result("hard2", "fail"), result("easy1", "pass", "paused")]);
  const all = ["easy1", "easy2", "hard1", "hard2"];
  const frontier = frontierSubset([haiku, opus]);
  assert.deepEqual([...frontier].sort(), ["hard1", "hard2"], "a paused result does not put a task in the subset");
  const rows = sweRollup([haiku, opus], all, frontier);
  assert.deepEqual(rows.map((r) => [r.name, r.all.resolved, r.all.final, r.frontier.resolved, r.frontier.final]), [["swl-haiku-1", 2, 4, 0, 2], ["swl-opus-1", 1, 2, 1, 2]]);
  const table = rollupTable(rows, { all: 4, frontier: 2 });
  assert.match(table, /\| Run \| Preset \| all4 resolved \| all4 est\. cost \| all2 resolved \(frontier\) \| all2 est\. cost \|/);
  assert.match(table, /\| swl-opus-1 \| solo-opus \| 1 of 2 run \(2 not run\) \|/);
  assert.match(rollupTable(sweRollup([haiku], all, new Set()), { all: 4, frontier: 0 }), /unknown \(no solo-opus run\)/);
});

test("F142: SWE-bench-Live's RESULTS.md gets the all-and-frontier table; other suites do not", async () => {
  const { sweSubsets } = await import("../evals/baselines.ts");
  const { home } = makeHome();
  const tasks = ["T1", "T2", "T3"].map((name) => ({ name, dir: "", kind: "bug", language: "python", hiddenCheck: "true", prompt: "" }));
  const lines = sweSubsets("evals/swe-live/tasks", home, tasks).join("\n");
  assert.match(lines, /### Whole suite and frontier subset \(all3 and all2\)/);
  assert.match(lines, /\| swl-haiku-1 \| solo-haiku \| 1 of 2 run \(1 not run\) \|/);
  assert.deepEqual(sweSubsets("evals/real-tasks-2", home, tasks), []);
});

test("F142: replay-temporal.ts runs end to end on a synthetic home with Laya down, and exports the labels there", () => {
  const { home } = makeHome();
  const r = spawnSync(process.execPath, ["evals/replay-temporal.ts", "--home", home, "--cutoff", "3", "--timeout", "300"], { encoding: "utf8", env: { ...process.env, NEUROMESH_LAYA_URL: "http://127.0.0.1:1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Replay at cutoff 3 model calls: 4 cheap runs replayed/);
  assert.match(r.stdout, /unavailable 4/);
  assert.equal(readFileSync(join(home, "routing", "laya-labels.jsonl"), "utf8").trim().split("\n").length, 4);
  const bad = spawnSync(process.execPath, ["evals/replay-temporal.ts", "--home", home, "--cutoff", "7"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
