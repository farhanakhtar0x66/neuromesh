// The beta's week-2 baselines (HANDOFF.md item 6f): the same task suite on Haiku alone, on the cascade twice and on
// Opus alone, one after the other, each in its own five-hour window, then the paired comparisons.
//
//   node evals/baselines.ts [--suite evals/real-tasks-2] [--only haiku,cascade1,cascade2,opus] [--allow-opus] [--fake]
//   node evals/baselines.ts --report                  only (re)write RESULTS.md from what is on disk, no run
//
// The runs, in this order:   haiku     rt2-haiku-1    solo-haiku
//                            cascade1  rt2-cascade-1  cascade-claude
//                            cascade2  rt2-cascade-2  cascade-claude
//                            opus      rt2-opus-1     solo-opus      (only with --allow-opus; Opus is the dearest step)
//
// Each run is `neuromesh eval --suite <suite> --preset <p> --name <n> --quota`. Before each one the script waits for the
// five-hour window to reset (evals/wait-reset.ts, as routing-bench's --wait-reset does). A run that stops with tasks
// paused or interrupted (out of quota) is waited out and started again under the same name, which redoes only those
// tasks, until every task has a final result; after 12 tries it gives up and says so. One line per event goes to
// <home>/evals/baselines.log (~/.neuromesh/evals/baselines.log). It ends by writing <suite>/RESULTS.md.
//
// --fake makes no model calls and touches nothing real: a throw-away Neuromesh home, no waiting for resets, and
// RESULTS.md written inside that home. The suite's tasks need a reference/ folder (evals/real-tasks-2 has them once built).
// --fake-pause <n> makes every run's first try hit a simulated subscription limit after n model turns, to exercise the
// wait-and-resume path.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backends as liveBackends } from "../src/backends/index.ts";
import { clearCooldowns, coolingModels } from "../src/engine/cooldown.ts";
import { defaultHome } from "../src/engine/store.ts";
import { loadReport, loadTasks, summarize } from "../src/eval/eval.ts";
import type { EvalReport, EvalTask, TaskResult } from "../src/eval/eval.ts";
import { utcMinute, waitForReset } from "./wait-reset.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_TRIES = 12;
const MARGIN = 10;

export interface RunSpec {
  key: "haiku" | "cascade1" | "cascade2" | "opus";
  name: string;
  preset: string;
  /** Needs --allow-opus. */
  opus?: boolean;
}

export const RUNS: RunSpec[] = [
  { key: "haiku", name: "rt2-haiku-1", preset: "solo-haiku" },
  { key: "cascade1", name: "rt2-cascade-1", preset: "cascade-claude" },
  { key: "cascade2", name: "rt2-cascade-2", preset: "cascade-claude" },
  { key: "opus", name: "rt2-opus-1", preset: "solo-opus", opus: true },
];

/**
 * The runs for a suite: the same four, named after a real-tasks-<n> folder (real-tasks-3 gives rt3-haiku-1, ...), so
 * two real suites never continue each other's run. Any other folder keeps the names in RUNS (rt2-...).
 */
export function runsFor(suite: string): RunSpec[] {
  const folder = suite.replace(/\/+$/, "").replace(/^.*\//, "");
  const n = /^real-tasks-(\d+)$/.exec(folder)?.[1];
  const prefix = n !== undefined ? `rt${n}` : "rt2";
  return RUNS.map((r) => ({ ...r, name: r.name.replace(/^rt2/, prefix) }));
}

/** A result that is not final: the task did not really get its turn (eval.ts redoes these on resume). */
const UNFINISHED = new Set(["paused", "interrupted", "running"]);

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---- how far a run has got ----

export interface Progress {
  total: number;
  /** Tasks with a final result (pass, fail or an engine failure). */
  final: number;
  /** Tasks whose result is paused, interrupted or running. */
  stopped: string[];
  /** Tasks with no result at all. */
  missing: string[];
}

export function progressOf(report: EvalReport | undefined, tasks: EvalTask[]): Progress {
  const stopped: string[] = [];
  const missing: string[] = [];
  for (const t of tasks) {
    const r = report?.results[t.name];
    if (!r) missing.push(t.name);
    else if (UNFINISHED.has(r.status)) stopped.push(t.name);
  }
  return { total: tasks.length, final: tasks.length - stopped.length - missing.length, stopped, missing };
}

const isComplete = (p: Progress): boolean => p.final === p.total;

// ---- the log ----

let logPath = "";
function note(line: string): void {
  const stamped = `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC  ${line}\n`;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, stamped);
  process.stderr.write(stamped);
}

// ---- running ----

function evalCommand(suite: string, run: RunSpec): string[] {
  return ["src/cli/main.ts", "eval", "--suite", suite, "--preset", run.preset, "--name", run.name, "--quota"];
}

/**
 * Before a run, and before each try after a pause: wait until the limits the engine recorded (cooldowns.json: a model
 * that hit its limit stays out until its reset, across processes) are over, then until the five-hour window has reset.
 * --fake makes no waiting: it clears the cooldowns, as a reset would.
 */
async function waitOutLimits(tag: string, home: string, fake: boolean): Promise<void> {
  const cooling = Object.entries(coolingModels(home));
  if (fake) {
    if (cooling.length > 0) note(`${tag}  --fake: simulated reset, cooldowns cleared (${cooling.map(([m]) => m).join(", ")})`);
    else note(`${tag}  --fake: not waiting for a window reset`);
    clearCooldowns(home);
    return;
  }
  if (cooling.length > 0) {
    const until = Math.max(...cooling.map(([, c]) => Date.parse(c.until))) + 90_000;
    note(`${tag}  waiting until ${utcMinute(until / 1000)} UTC (${Math.round((until - Date.now()) / 60_000)} min): ${cooling.map(([m]) => m.replace(/^claude\//, "")).join(", ")} hit a limit`);
    await new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())));
  }
  await waitForReset(liveBackends.claude!, (line) => note(`${tag}  ${line}`), { freshBelow: 0.02 });
}

async function runOne(run: RunSpec, suite: string, tasks: EvalTask[], home: string, fake: boolean): Promise<"finished" | "gave-up" | "interrupted"> {
  const tag = run.name;
  const existing = loadReport(home, run.name);
  if (existing && existing.preset !== run.preset) {
    note(`${tag}  cannot run: this name was used with preset ${existing.preset}, not ${run.preset}; move it aside first`);
    return "gave-up";
  }
  let noProgress = 0;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const before = progressOf(loadReport(home, run.name), tasks);
    if (isComplete(before)) {
      note(`${tag}  finished: all ${before.total} tasks have a final result${attempt === 1 ? " (nothing to run)" : ""}`);
      return "finished";
    }
    await waitOutLimits(tag, home, fake);
    note(`${tag}  started: try ${attempt} of ${MAX_TRIES}, preset ${run.preset}, ${before.final} of ${before.total} tasks already final`);
    const env = { ...process.env };
    if (fake && attempt === 1 && option("fake-pause") !== undefined) env.NEUROMESH_FAKE_QUOTA_AFTER = option("fake-pause");
    else delete env.NEUROMESH_FAKE_QUOTA_AFTER;
    const r = spawnSync(process.execPath, [...evalCommand(suite, run), ...(fake ? ["--fake"] : [])], { cwd: REPO, env, stdio: ["ignore", "inherit", "inherit"] });
    if (r.signal === "SIGINT" || r.signal === "SIGTERM") {
      note(`${tag}  interrupted by ${r.signal}; run the same command again to continue`);
      return "interrupted";
    }
    const after = progressOf(loadReport(home, run.name), tasks);
    if (isComplete(after)) {
      note(`${tag}  finished: ${after.total} tasks, try ${attempt}`);
      return "finished";
    }
    const quotaStop = after.stopped.length > 0;
    note(`${tag}  ${quotaStop ? "paused" : "stopped"}: ${after.final} of ${after.total} tasks final; ${quotaStop ? `paused or interrupted: ${after.stopped.join(", ")}` : `no task paused, exit ${r.status ?? "?"}: not a quota stop`}${after.missing.length > 0 ? `; not started: ${after.missing.length}` : ""}`);
    noProgress = after.final > before.final || quotaStop ? 0 : noProgress + 1;
    if (noProgress >= 2) {
      note(`${tag}  gave up: two tries in a row ended with no quota pause and no new result, so waiting for a reset would not help. Look at the output above (an engine or setup failure).`);
      return "gave-up";
    }
    if (attempt === MAX_TRIES) break;
  }
  note(`${tag}  gave up after ${MAX_TRIES} tries: ${progressOf(loadReport(home, run.name), tasks).final} of ${tasks.length} tasks final. Run the same command again to keep going.`);
  return "gave-up";
}

// ---- the report ----

const UNKNOWN = "unknown";

interface Points {
  /** Sum of the readings that were usable. */
  sum: number;
  /** Tasks with no usable reading (no probe, or the window reset in between). */
  unknown: number;
}

function windowPoints(report: EvalReport, window: string): Points {
  let sum = 0;
  let unknown = 0;
  for (const r of Object.values(report.results)) {
    const b = r.quota?.before?.[window];
    const a = r.quota?.after?.[window];
    // A window that reset in between reads lower afterwards: unknown, not negative (as bench.ts does).
    if (b === undefined || a === undefined || a < b) unknown += 1;
    else sum += Math.round((a - b) * 100);
  }
  return { sum, unknown };
}

const showPoints = (p: Points, results: number): string => (results === 0 || p.unknown === results ? UNKNOWN : p.unknown > 0 ? `at least ${p.sum} (${p.unknown} of ${results} tasks unread)` : String(p.sum));
const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(1)}%`;

export interface RunFigures {
  run: RunSpec;
  report?: EvalReport;
  progress: Progress;
  passed: number;
  engineFailures: number;
  taskFailures: number;
}

export function figuresOf(run: RunSpec, report: EvalReport | undefined, tasks: EvalTask[]): RunFigures {
  const progress = progressOf(report, tasks);
  const finals = tasks.map((t) => report?.results[t.name]).filter((r): r is TaskResult => r !== undefined && !UNFINISHED.has(r.status));
  const passed = finals.filter((r) => r.hidden === "pass").length;
  const engineFailures = finals.filter((r) => r.failure === "engine").length;
  return { run, report, progress, passed, engineFailures, taskFailures: finals.length - passed - engineFailures };
}

function runTable(figs: RunFigures[], tasks: EvalTask[]): string {
  const names = new Set(tasks.map((t) => t.name));
  const lines = [
    "| Run | Preset | Tasks final | Resolved | Engine failures | Est. cost (API list prices) | 5-hour window, points | Weekly window, points | Minutes of work |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const f of figs) {
    if (!f.report) {
      lines.push(`| ${f.run.name} | ${f.run.preset} | not run | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} |`);
      continue;
    }
    const mine = { ...f.report, results: Object.fromEntries(Object.entries(f.report.results).filter(([n]) => names.has(n))) } as EvalReport;
    const results = Object.values(mine.results).filter((r) => !UNFINISHED.has(r.status));
    const s = summarize(mine, results.map((r) => r.task));
    const done = isComplete(f.progress);
    const resolved = f.progress.final === 0 ? UNKNOWN : `${f.passed} of ${f.progress.final} (${pct(f.passed, f.progress.final)}), one run${done ? "" : ", unfinished"}`;
    const cost = f.progress.final === 0 ? UNKNOWN : `${s.costIncomplete ? "at least " : ""}$${s.costEstimate.toFixed(2)} (estimate${done ? "" : ", finished tasks only"})`;
    lines.push(
      `| ${f.run.name} | ${f.run.preset} | ${f.progress.final} of ${f.progress.total}${done ? "" : ` (${f.progress.stopped.length + f.progress.missing.length} to do)`} | ${resolved} | ${f.engineFailures} | ${cost} | ${showPoints(windowPoints(mine, "five_hour"), Object.keys(mine.results).length)} | ${showPoints(windowPoints(mine, "seven_day"), Object.keys(mine.results).length)} | ${f.progress.final === 0 ? UNKNOWN : (s.wallMs / 60_000).toFixed(1)} |`,
    );
  }
  return lines.join("\n");
}

function perTaskTable(figs: RunFigures[], tasks: EvalTask[]): string {
  const cell = (f: RunFigures, t: EvalTask): string => {
    const r = f.report?.results[t.name];
    if (!r) return "-";
    if (UNFINISHED.has(r.status)) return r.status;
    if (r.failure === "engine") return "engine failure";
    return r.hidden === "pass" ? "pass" : "fail";
  };
  const lines = [`| Task | Kind | ${figs.map((f) => f.run.name).join(" | ")} |`, `| --- | --- | ${figs.map(() => "---").join(" | ")} |`];
  for (const t of tasks) lines.push(`| ${t.name} | ${t.kind} | ${figs.map((f) => cell(f, t)).join(" | ")} |`);
  return lines.join("\n");
}

export interface Comparison {
  title: string;
  /** The raw lines of `bench.ts --compare`. */
  text?: string;
  /** Why there is none. */
  missing?: string;
  resolvedA?: number;
  resolvedB?: number;
  low?: number;
  high?: number;
  shown?: boolean;
}

/** Read the numbers back out of describeComparison's lines (src/eval/stats.ts). */
export function parseComparison(text: string): Pick<Comparison, "resolvedA" | "resolvedB" | "low" | "high" | "shown"> {
  const resolved = /resolved: ([\d.]+)% and ([\d.]+)%/.exec(text);
  const interval = /interval for the difference: ([+-][\d.]+) to ([+-][\d.]+) points/.exec(text);
  const shown = /: (shown|not shown)\s*$/m.exec(text);
  return {
    ...(resolved ? { resolvedA: Number(resolved[1]), resolvedB: Number(resolved[2]) } : {}),
    ...(interval ? { low: Number(interval[1]), high: Number(interval[2]) } : {}),
    ...(shown ? { shown: shown[1] === "shown" } : {}),
  };
}

/** Two groups of complete runs through `node evals/bench.ts --compare`; a group is left out, with the reason, when a run is not complete. */
function compareGroups(title: string, a: RunFigures[], b: RunFigures[]): Comparison {
  const unfinished = [...a, ...b].filter((f) => !isComplete(f.progress));
  if (unfinished.length > 0) {
    const why = (f: RunFigures): string => (f.report ? `${f.run.name} is not finished (${f.progress.final} of ${f.progress.total} tasks have a final result; a paused task counts as nothing, so it is not compared)` : `${f.run.name} has not been run`);
    return { title, missing: unfinished.map(why).join("; ") };
  }
  const r = spawnSync(process.execPath, ["evals/bench.ts", "--compare", a.map((f) => f.run.name).join(","), b.map((f) => f.run.name).join(","), "--margin", String(MARGIN)], { cwd: REPO, env: process.env, encoding: "utf8" });
  if (r.status !== 0) return { title, missing: `evals/bench.ts --compare failed: ${(r.stderr ?? "").trim().split("\n").at(-1) ?? "no message"}` };
  const text = (r.stdout ?? "").trim();
  return { title, text, ...parseComparison(text) };
}

const sign = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const separated = (c: Comparison): boolean | undefined => (c.low === undefined || c.high === undefined ? undefined : c.low > 0 || c.high < 0);

export interface GateLine {
  criterion: string;
  met: boolean | undefined;
  detail: string;
}

/** Phase 1's gate (docs/22-path-to-the-goal.md): (a) Haiku 40 to 70 and Opus 80 or more, (b) Haiku and Opus separated, (c) two cascade runs not separated. */
export function gate(haiku: RunFigures, opus: RunFigures, haikuVsOpus: Comparison, cascadeVsCascade: Comparison): GateLine[] {
  const rate = (f: RunFigures): number | undefined => (isComplete(f.progress) && f.progress.total > 0 ? (100 * f.passed) / f.progress.total : undefined);
  const h = rate(haiku);
  const o = rate(opus);
  const sepHO = separated(haikuVsOpus);
  const sepCC = separated(cascadeVsCascade);
  const noWidth = cascadeVsCascade.low !== undefined && cascadeVsCascade.low === cascadeVsCascade.high;
  return [
    {
      criterion: "(a) Haiku alone resolves 40 to 70%",
      met: h === undefined ? undefined : h >= 40 && h <= 70,
      detail: h === undefined ? `${UNKNOWN}: ${haiku.run.name} is not complete` : `${h.toFixed(1)}%, one run`,
    },
    {
      criterion: "(a) Opus alone resolves 80% or more",
      met: o === undefined ? undefined : o >= 80,
      detail: o === undefined ? `${UNKNOWN}: ${opus.run.name} is not complete${opus.report ? "" : " (Opus runs only with --allow-opus)"}` : `${o.toFixed(1)}%, one run`,
    },
    {
      criterion: "(b) Haiku alone and Opus alone are separated (the 90% interval of the difference excludes zero)",
      met: sepHO,
      detail: sepHO === undefined ? `${UNKNOWN}: ${haikuVsOpus.missing ?? "no interval"}` : `interval ${sign(haikuVsOpus.low!)} to ${sign(haikuVsOpus.high!)} points`,
    },
    {
      criterion: "(c) cascade run 1 and cascade run 2 are not separated (the interval holds zero)",
      met: sepCC === undefined ? undefined : !sepCC,
      detail: sepCC === undefined ? `${UNKNOWN}: ${cascadeVsCascade.missing ?? "no interval"}` : `interval ${sign(cascadeVsCascade.low!)} to ${sign(cascadeVsCascade.high!)} points${noWidth ? " (no width: every task gave the same answer both times, a ceiling or a floor, which says little)" : ""}`,
    },
  ];
}

function comparisonTable(cs: Comparison[]): string {
  const lines = [
    `| Comparison (A against B) | Resolved A / B | Difference A − B, 90% interval (points) | A not worse than B by more than ${MARGIN} points |`,
    "| --- | --- | --- | --- |",
  ];
  for (const c of cs) {
    if (c.text === undefined || c.low === undefined || c.high === undefined) lines.push(`| ${c.title} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} (${c.missing ?? "no interval in the tool's output"}) |`);
    else lines.push(`| ${c.title} | ${c.resolvedA?.toFixed(1) ?? UNKNOWN}% / ${c.resolvedB?.toFixed(1) ?? UNKNOWN}% | ${sign(c.low)} to ${sign(c.high)} | ${c.shown === undefined ? UNKNOWN : c.shown ? "shown" : "not shown"} |`);
  }
  return lines.join("\n");
}

export function renderResults(params: { suite: string; tasks: EvalTask[]; fake: boolean; generated?: string }): string {
  const home = defaultHome();
  const { tasks } = params;
  const figs = runsFor(params.suite).map((run) => figuresOf(run, loadReport(home, run.name), tasks));
  const [haiku, c1, c2, opus] = figs as [RunFigures, RunFigures, RunFigures, RunFigures];
  const cascade = [c1, c2];
  const complete = (fs: RunFigures[]): RunFigures[] => fs.filter((f) => isComplete(f.progress));
  // The cascade group is the runs that are complete; with none, the comparison says which are missing.
  const cascadeDone = complete(cascade).length > 0 ? complete(cascade) : cascade;
  const cAgainstOpus = compareGroups(`cascade-claude (${cascadeDone.map((f) => f.run.name).join(" + ")}) against Opus alone (${opus.run.name})`, cascadeDone, [opus]);
  const cAgainstHaiku = compareGroups(`cascade-claude (${cascadeDone.map((f) => f.run.name).join(" + ")}) against Haiku alone (${haiku.run.name})`, cascadeDone, [haiku]);
  const hAgainstOpus = compareGroups(`Haiku alone (${haiku.run.name}) against Opus alone (${opus.run.name})`, [haiku], [opus]);
  const c1AgainstC2 = compareGroups(`cascade run 1 (${c1.run.name}) against cascade run 2 (${c2.run.name})`, [c1], [c2]);
  const comparisons = [cAgainstOpus, cAgainstHaiku, hAgainstOpus, c1AgainstC2];
  const g = gate(haiku, opus, hAgainstOpus, c1AgainstC2);
  const mark = (m: boolean | undefined): string => (m === undefined ? "unknown" : m ? "met" : "not met");

  const out: string[] = [];
  if (params.fake) out.push("> **FAKE DATA.** Made with `--fake`: no model was called, every answer is a task's own reference solution. These numbers mean nothing about any preset.", "");
  out.push(
    `# Beta baselines on ${params.suite.replace(/^.*\/(?=[^/]+$)/, "")}`,
    "",
    `Generated ${params.generated ?? new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`node evals/baselines.ts\` from the saved evals in \`${home}/evals\`. ${tasks.length} tasks. Every figure is from **one run** of its preset (the cascade has two) and is a hint, not a measurement. "unknown" means the number was not recorded or the run is not finished; it is never 0.`,
    "",
    "## Runs",
    "",
    runTable(figs, tasks),
    "",
    "Costs are **estimates** at API list prices (`src/usage/prices.ts`), not money spent: the runs draw on one Claude plan. Window points are whole points of the plan's windows read by a one-word call before and after each task; a window that reset in between, or a task with no reading, is counted as unknown, not 0. Minutes are the time the final attempt of each task took; waiting for a reset is not counted. A task that failed because the engine failed (crash, hang) is counted separately from one where the model wrote wrong code.",
    "",
    "## Paired comparisons",
    "",
    comparisonTable(comparisons),
    "",
    `Each comparison pairs the tasks both configurations ran and resamples them 10,000 times (\`node evals/bench.ts --compare A B --margin ${MARGIN}\`; src/eval/stats.ts). "Shown" means the lower end of the 90% interval is above −${MARGIN} points. A comparison is made only when every run in it has a final result on every task.`,
    "",
  );
  for (const c of comparisons) out.push(`<details><summary>${c.title}</summary>`, "", c.text ? ["```", c.text, "```"].join("\n") : `Not made: ${c.missing ?? "no output"}.`, "", "</details>", "");
  out.push(
    "## Phase 1 gate (docs/22-path-to-the-goal.md)",
    "",
    "| Check | Result | Number |",
    "| --- | --- | --- |",
    ...g.map((l) => `| ${l.criterion} | ${mark(l.met)} | ${l.detail} |`),
    "",
    g.every((l) => l.met === true)
      ? "All four hold: the suite can tell a cheap preset from the frontier one and does not invent differences between two runs of the same preset."
      : g.some((l) => l.met === false)
        ? "The gate is **missed** on at least one line. Doc 22 says what each miss means (a Haiku rate above 70% or an Opus rate below 80% changes the plan; a cascade run that separates from itself means flaky checks or too few runs)."
        : "The gate is not decided yet: the lines marked unknown need their runs.",
    "",
    "## Per task",
    "",
    perTaskTable(figs, tasks),
    "",
  );
  return out.join("\n");
}

// ---- main ----

function printLater(suite: string): void {
  const name = runsFor(suite).find((r) => r.opus)?.name ?? "the Opus run";
  process.stderr.write(`\nOpus alone (${name}) was not started: it is the dearest step of the plan and needs --allow-opus. When you want it:\n\n  node evals/baselines.ts --suite ${suite} --only opus --allow-opus\n\n`);
}

async function main(): Promise<number> {
  const fake = flag("fake");
  const suiteArg = option("suite") ?? "evals/real-tasks-2";
  const suite = resolve(REPO, suiteArg);
  if (fake && !process.env.NEUROMESH_HOME) process.env.NEUROMESH_HOME = mkdtempSync(join(tmpdir(), "neuromesh-baselines-fake-"));
  const home = defaultHome();
  logPath = join(home, "evals", "baselines.log");
  if (!existsSync(suite)) {
    process.stderr.write(`No suite folder at ${suite}\n`);
    return 2;
  }
  const tasks = loadTasks(suite);
  if (tasks.length === 0) {
    process.stderr.write(`${suite} holds no task folders (task.json). Build them from the recipe first: see ${join(suiteArg, "README.md")}\n`);
    return 2;
  }
  const out = option("out") ?? (fake ? join(home, "RESULTS.md") : join(suite, "RESULTS.md"));

  if (!flag("report")) {
    const keys = option("only")?.split(",").filter(Boolean);
    const bad = (keys ?? []).filter((k) => !RUNS.some((r) => r.key === k));
    if (bad.length > 0) {
      process.stderr.write(`--only takes ${RUNS.map((r) => r.key).join(", ")}, not ${bad.join(", ")}\n`);
      return 2;
    }
    const allowOpus = flag("allow-opus");
    const wanted = runsFor(suiteArg).filter((r) => !keys || keys.includes(r.key));
    note(`baselines: ${tasks.length} tasks in ${suiteArg}${fake ? " (--fake, home " + home + ")" : ""}; runs: ${wanted.map((r) => r.key).join(", ")}${allowOpus ? "; Opus allowed" : ""}`);
    let stoppedEarly = false;
    for (const run of wanted) {
      if (run.opus && !allowOpus) {
        note(`${run.name}  not started: needs --allow-opus`);
        printLater(suiteArg);
        continue;
      }
      const result = await runOne(run, suite, tasks, home, fake);
      if (result === "interrupted") {
        stoppedEarly = true;
        break;
      }
      // A run that gave up leaves a gap, but the later ones are still worth having.
    }
    if (stoppedEarly) return 130;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderResults({ suite: suiteArg, tasks, fake }));
  note(`wrote ${out}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
