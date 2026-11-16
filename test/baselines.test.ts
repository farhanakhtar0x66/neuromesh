// The week-2 baseline runner (evals/baselines.ts), offline: the fake backend, a throw-away home, no model calls.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gate, parseComparison, progressOf, RUNS, runsFor } from "../evals/baselines.ts";
import type { Comparison, RunFigures } from "../evals/baselines.ts";
import type { EvalReport, EvalTask } from "../src/eval/eval.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-baselines-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A suite of `n` tasks; the last has no reference, so the fake backend fails it. */
function suite(n: number): string {
  const root = join(scratch, `suite-${n}`);
  for (let i = 1; i <= n; i++) {
    const d = join(root, `t${i}`);
    for (const sub of ["seed", "hidden"]) mkdirSync(join(d, sub), { recursive: true });
    writeFileSync(join(d, "seed", "README.md"), `task ${i}\n`);
    writeFileSync(join(d, "hidden", "h.txt"), "x\n");
    writeFileSync(join(d, "prompt.md"), `Write out.txt for task ${i}\n`);
    writeFileSync(join(d, "task.json"), JSON.stringify({ kind: i % 2 ? "bug" : "feature", language: "text", hiddenCheck: 'test -f out.txt && echo "SCORE 1/1"' }));
    if (i < n) {
      mkdirSync(join(d, "reference", "files"), { recursive: true });
      writeFileSync(join(d, "reference", "files", "out.txt"), "done\n");
    }
  }
  return root;
}

const baselines = (home: string, ...args: string[]) =>
  spawnSync(process.execPath, ["evals/baselines.ts", ...args], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_FAKE_QUOTA_AFTER: "" } });

test("--fake: a simulated quota pause is waited out and redone, Opus is not started, RESULTS.md renders", () => {
  const home = join(scratch, "home-a");
  const dir = suite(3);
  const r = baselines(home, "--suite", dir, "--fake", "--fake-pause", "1", "--only", "haiku,cascade1,opus");
  assert.equal(r.status, 0, r.stderr);
  const log = readFileSync(join(home, "evals", "baselines.log"), "utf8");
  assert.match(log, /rt2-haiku-1 {2}started: try 1 of 12/);
  assert.match(log, /rt2-haiku-1 {2}paused: /);
  assert.match(log, /rt2-haiku-1 {2}started: try 2 of 12/);
  assert.match(log, /rt2-haiku-1 {2}finished/);
  assert.match(log, /rt2-cascade-1 {2}finished/);
  assert.match(log, /rt2-opus-1 {2}not started: needs --allow-opus/);
  assert.match(r.stderr, /--only opus --allow-opus/);
  assert.equal(existsSync(join(home, "evals", "rt2-opus-1")), false, "no Opus eval was started");
  assert.equal(existsSync(join(dir, "RESULTS.md")), false, "a fake run never writes into the suite folder");
  const md = readFileSync(join(home, "RESULTS.md"), "utf8");
  assert.match(md, /FAKE DATA/);
  assert.match(md, /\| rt2-haiku-1 \| solo-haiku \| 3 of 3 \| 2 of 3 \(66\.7%\), one run \| 0 \| \$0\.00 \(estimate\)/);
  assert.match(md, /\| rt2-opus-1 \| solo-opus \| not run \| unknown \|/);
  assert.match(md, /cascade-claude \(rt2-cascade-1\) against Haiku alone[^\n]*\| shown \|/);
  assert.match(md, /Phase 1 gate/);
  assert.match(md, /\| t3 \| bug \| fail \| fail \| - \| - \|/);
  assert.doesNotMatch(md, /\bNaN\b|undefined/);
});

test("--only opus without --allow-opus prints the command and runs nothing; --report alone makes no run", () => {
  const home = join(scratch, "home-b");
  const dir = suite(2);
  const r = baselines(home, "--suite", dir, "--fake", "--only", "opus");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /needs --allow-opus/);
  assert.equal(existsSync(join(home, "evals", "rt2-opus-1")), false);
  const again = baselines(home, "--suite", dir, "--fake", "--report");
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(readFileSync(join(home, "evals", "baselines.log"), "utf8"), /started: try/);
  assert.match(readFileSync(join(home, "RESULTS.md"), "utf8"), /\| rt2-haiku-1 \| solo-haiku \| not run \| unknown/);
});

test("a finished run is not started again, and a suite with no tasks is refused", () => {
  const home = join(scratch, "home-c");
  const dir = suite(2);
  assert.equal(baselines(home, "--suite", dir, "--fake", "--only", "haiku").status, 0);
  const second = baselines(home, "--suite", dir, "--fake", "--only", "haiku");
  assert.equal(second.status, 0);
  assert.match(second.stderr, /rt2-haiku-1 {2}finished: all 2 tasks have a final result \(nothing to run\)/);
  const empty = join(scratch, "empty");
  mkdirSync(empty);
  assert.equal(baselines(home, "--suite", empty, "--fake").status, 2);
});

const task = (name: string): EvalTask => ({ name, dir: "", kind: "bug", language: "ts", hiddenCheck: "true", prompt: "" });
const result = (status: string) => ({ status, hidden: status === "applied" ? "pass" : "not run" }) as unknown as EvalReport["results"][string];

test("progressOf: paused, interrupted and missing tasks are not final", () => {
  const report = { name: "x", preset: "p", results: { a: result("applied"), b: result("paused"), c: result("interrupted") } } as unknown as EvalReport;
  const p = progressOf(report, ["a", "b", "c", "d"].map(task));
  assert.deepEqual({ final: p.final, stopped: p.stopped, missing: p.missing }, { final: 1, stopped: ["b", "c"], missing: ["d"] });
  assert.equal(progressOf(undefined, [task("a")]).final, 0);
});

test("parseComparison reads the numbers back from bench --compare's lines", () => {
  const text = [
    "a against b, paired over 29 tasks (runs per task: 2 and 1)",
    "  resolved: 55.2% and 79.3%; mean difference -24.1 points",
    "  90% interval for the difference: -37.9 to -10.3 points (10,000 task resamples, seed 1)",
    "  not worse than b by more than 10 points: not shown",
  ].join("\n");
  assert.deepEqual(parseComparison(text), { resolvedA: 55.2, resolvedB: 79.3, low: -37.9, high: -10.3, shown: false });
  assert.deepEqual(parseComparison("nothing"), {});
});

test("gate: each line is met, not met or unknown, never guessed", () => {
  const fig = (name: string, passed: number, total = 29, final = total): RunFigures =>
    ({ run: RUNS.find((r) => r.name === name)!, report: final > 0 ? ({} as EvalReport) : undefined, progress: { total, final, stopped: [], missing: [] }, passed, engineFailures: 0, taskFailures: 0 });
  const cmp = (low?: number, high?: number): Comparison => (low === undefined ? { title: "t", missing: "not run" } : { title: "t", text: "x", low, high });
  const good = gate(fig("rt2-haiku-1", 14), fig("rt2-opus-1", 25), cmp(-50, -20), cmp(-8, 6));
  assert.deepEqual(good.map((l) => l.met), [true, true, true, true]);
  const bad = gate(fig("rt2-haiku-1", 26), fig("rt2-opus-1", 20), cmp(-10, 5), cmp(2, 15));
  assert.deepEqual(bad.map((l) => l.met), [false, false, false, false]);
  const none = gate(fig("rt2-haiku-1", 14), fig("rt2-opus-1", 0, 29, 0), cmp(), cmp());
  assert.deepEqual(none.map((l) => l.met), [true, undefined, undefined, undefined]);
  assert.match(none[1]!.detail, /unknown/);
});

test("each real-tasks suite gets its own run names, so suites never continue each other's run", () => {
  assert.deepEqual(runsFor("evals/real-tasks-2").map((r) => r.name), RUNS.map((r) => r.name));
  assert.deepEqual(runsFor("evals/real-tasks-3/").map((r) => r.name), ["rt3-haiku-1", "rt3-cascade-1", "rt3-cascade-2", "rt3-opus-1"]);
  assert.equal(runsFor("/tmp/x/suite-4")[0]!.name, "rt2-haiku-1");
  assert.equal(runsFor("evals/real-tasks-3").find((r) => r.opus)?.preset, "solo-opus");
});
