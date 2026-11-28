// The task suite runner. Each task is a seed repository, a prompt, and hidden
// tests the agents never see. A task passes only if its hidden check passes
// after the run's diff is applied.
//
// Results are saved after every task, so an eval stopped by Ctrl-C or a
// subscription limit continues where it left off when started again with the
// same --name.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Usage } from "../backends/types.ts";
import { applyRun } from "../engine/apply.ts";
import { perTurnAttempts, startRun, usageByModel } from "../engine/run.ts";
import { backends } from "../backends/index.ts";
import { loadState } from "../engine/store.ts";
import type { EngineContext, ModelUsage } from "../engine/run.ts";
import type { AttemptRecord, RunState } from "../engine/types.ts";
import type { Spec } from "../intake/brief.ts";
import type { Preset } from "../presets/presets.ts";
import { estimateCost } from "../usage/prices.ts";
import { inFeature, isOn } from "../features.ts";
import { evalResultLine } from "../record/backfill.ts";
import { appendRecord } from "../record/record.ts";
import { claimTask, release } from "./isolation.ts";

export const TASKS_DIR = fileURLToPath(new URL("../../evals/tasks/", import.meta.url));

export interface EvalTask {
  name: string;
  dir: string;
  kind: string;
  language: string;
  hiddenCheck: string;
  prompt: string;
  /** The project's checks while Neuromesh works, when the seed has none of its own that can run (written to the seed's neuromesh.json). */
  checks?: { name: string; command: string }[];
}

export function loadTasks(root = TASKS_DIR, filter?: { names?: string[]; kinds?: string[] }): EvalTask[] {
  const tasks: EvalTask[] = [];
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!existsSync(join(dir, "task.json"))) continue;
    const config = JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as Partial<EvalTask>;
    const task: EvalTask = {
      name,
      dir,
      kind: config.kind ?? "other",
      language: config.language ?? "unknown",
      hiddenCheck: config.hiddenCheck ?? "false",
      prompt: readFileSync(join(dir, "prompt.md"), "utf8").trim(),
      ...(Array.isArray(config.checks) ? { checks: config.checks } : {}),
    };
    if (filter?.names && !filter.names.includes(name)) continue;
    if (filter?.kinds && !filter.kinds.includes(task.kind)) continue;
    tasks.push(task);
  }
  if (filter?.names) {
    const missing = filter.names.filter((n) => !tasks.some((t) => t.name === n));
    if (missing.length > 0) throw new Error(`Unknown task(s): ${missing.join(", ")}`);
  }
  return tasks;
}

export interface TaskResult {
  task: string;
  kind: string;
  language: string;
  mode: "solo" | "team";
  status: RunState["status"];
  checks: "passed" | "failed" | "none" | "-";
  /** "error": the hidden check itself did not finish (timed out) or printed nothing: the grader broke, not the work. */
  hidden: "pass" | "fail" | "error" | "not run";
  hiddenTail?: string;
  /** Cases the hidden check counted, when it prints a line "SCORE passed/total". */
  score?: { passed: number; total: number };
  /**
   * Subscription quota (fraction used per window) read by a one-word call just
   * before and just after the task, when the eval was asked to probe it.
   */
  quota?: { before?: Record<string, number>; after?: Record<string, number> };
  files: number;
  insertions: number;
  deletions: number;
  turns: number;
  repairs: number;
  escalations: number;
  wallMs: number;
  usage: ModelUsage[];
  /** Tokens by tier; see totalTokens for what counts. */
  expertTokens: number;
  workerTokens: number;
  /** Agent tokens of any kind were not reported by some turn. */
  usageIncomplete: boolean;
  reason?: string;
  failure?: "agent" | "engine";
  runId: string;
  finishedAt: string;
}

export interface EvalReport {
  name: string;
  preset: string;
  presetDetail: Preset;
  startedAt: string;
  results: Record<string, TaskResult>;
}

/** Everything the model processed: fresh input, cache reads and writes, and output. */
export function totalTokens(usage: Usage): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0);
}

function tierTokens(attempts: AttemptRecord[]): { expert: number; worker: number; incomplete: boolean } {
  let expert = 0;
  let worker = 0;
  let incomplete = false;
  for (const a of attempts) {
    if (a.usage.input === undefined || a.usage.output === undefined) incomplete = true;
    const t = totalTokens(a.usage);
    if (a.tier === "expert") expert += t;
    else worker += t;
  }
  return { expert, worker, incomplete };
}

/** A hidden check's verdict: a check that timed out or said nothing failed to grade; that is not the work failing. */
export function hiddenVerdict(check: { code: number | null; output: string }): "pass" | "fail" | "error" {
  if (check.code === 0) return "pass";
  return check.code === null || check.output.trim() === "" ? "error" : "fail";
}

function sh(cwd: string, command: string): { code: number | null; output: string } {
  const r = spawnSync("sh", ["-c", `${command} 2>&1`], { cwd, encoding: "utf8", timeout: 10 * 60_000 });
  return { code: r.status, output: (r.stdout ?? "").trim() };
}

function seedRepo(task: EvalTask, into: string): string {
  if (existsSync(into)) rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  cpSync(join(task.dir, "seed"), into, { recursive: true });
  if (task.checks && !existsSync(join(into, "neuromesh.json"))) writeFileSync(join(into, "neuromesh.json"), `${JSON.stringify({ checks: task.checks }, null, 2)}\n`);
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) {
    const r = spawnSync("git", ["-c", "user.name=neuromesh-eval", "-c", "user.email=eval@localhost", ...args], { cwd: into });
    if (r.status !== 0) throw new Error(`could not seed ${task.name}: git ${args[0]} failed`);
  }
  return realpathSync(into);
}

/** The last "SCORE passed/total" line a hidden check printed. */
export function scoreOf(output: string): { passed: number; total: number } | undefined {
  const all = [...output.matchAll(/^SCORE (\d+)\/(\d+)\s*$/gm)];
  const last = all.at(-1);
  return last ? { passed: Number(last[1]), total: Number(last[2]) } : undefined;
}

export function evalDir(home: string, name: string): string {
  return join(home, "evals", name);
}

export function loadReport(home: string, name: string): EvalReport | undefined {
  const path = join(evalDir(home, name), "results.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as EvalReport) : undefined;
}

function saveReport(home: string, report: EvalReport): void {
  const dir = evalDir(home, report.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "results.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}

/** Statuses that mean the task did not really get its turn and should run again on resume. */
const RETRY_STATUSES = new Set(["paused", "interrupted", "running"]);

export interface EvalOptions {
  name: string;
  preset: Preset;
  tasks: EvalTask[];
  ctx: EngineContext;
  /** Tasks to run again even though they have a result. */
  rerun?: string[];
  /** Replace the preset's worker model for every task. */
  workerModel?: string;
  /** Read the subscription quota (a one-word live call); asked before the first task and after each one. */
  quotaProbe?: () => Promise<Record<string, number> | undefined>;
  /** A spec to build each task from instead of having one written (a frozen spec, for testing the roles after it). */
  specFor?: (task: EvalTask) => Spec | undefined;
  onTaskStart?: (task: EvalTask, index: number, total: number) => void;
  onTaskDone?: (result: TaskResult) => void;
  /** [F142 replay-harness] Claim each task while it runs, so two evals never run it at once unseen (src/eval/isolation.ts). */
  isolation?: { dir: string; mode: "warn" | "sequential"; warn?: (message: string) => void; pollMs?: number };
}

export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const { ctx, preset } = options;
  const existing = loadReport(ctx.home, options.name);
  if (existing && existing.preset !== preset.name) {
    throw new Error(`Eval "${options.name}" was run with preset ${existing.preset}, not ${preset.name}. Use another --name.`);
  }
  const report: EvalReport = existing ?? {
    name: options.name,
    preset: preset.name,
    presetDetail: preset,
    startedAt: new Date().toISOString(),
    results: {},
  };
  saveReport(ctx.home, report);

  const todo = options.tasks.filter((t) => {
    const done = report.results[t.name];
    return !done || RETRY_STATUSES.has(done.status) || options.rerun?.includes(t.name);
  });

  let quotaNow = todo.length > 0 ? await options.quotaProbe?.() : undefined;
  for (const [index, task] of todo.entries()) {
    if (ctx.signal?.aborted) break;
    // [F142 replay-harness] Cache isolation: warn about, or wait out, another eval running this task right now.
    const iso = options.isolation && isOn("replay-harness") ? options.isolation : undefined;
    const claim = { task: task.name, eval: options.name, preset: preset.name };
    let claimed = false;
    if (iso) {
      try {
        claimed = await claimTask(iso.dir, claim, iso.mode, { warn: iso.warn, signal: ctx.signal, pollMs: iso.pollMs });
      } catch (error) {
        // A claim that cannot be written never stops the eval: it runs unguarded, and says so.
        iso.warn?.(`[F142 replay-harness] could not claim ${task.name}: ${error instanceof Error ? error.message : String(error)}; running without cache isolation`);
      }
      if (!claimed && iso.mode === "sequential" && ctx.signal?.aborted) break;
    }
    options.onTaskStart?.(task, index, todo.length);
    const quotaBefore = quotaNow;
    const repo = seedRepo(task, join(evalDir(ctx.home, options.name), "repos", task.name));
    const started = Date.now();
    let state: RunState;
    try {
      state = await startRun({ cwd: repo, prompt: task.prompt, preset, worker: options.workerModel ? { model: options.workerModel } : undefined, spec: options.specFor?.(task) }, ctx);
    } finally {
      if (iso && claimed) release(iso.dir, task.name, claim);
    }
    const wallMs = Date.now() - started;
    quotaNow = await options.quotaProbe?.();

    let hidden: TaskResult["hidden"] = "not run";
    let hiddenTail: string | undefined;
    let score: TaskResult["score"];
    if (state.status === "finished") {
      applyRun(state, { force: true });
      cpSync(join(task.dir, "hidden"), join(repo, "hidden"), { recursive: true });
      const check = sh(repo, task.hiddenCheck);
      hidden = hiddenVerdict(check);
      if (hidden !== "pass") hiddenTail = check.output.split("\n").slice(-20).join("\n") || (check.code === null ? "the hidden check timed out" : "the hidden check printed nothing");
      score = scoreOf(check.output);
    }

    const tiers = tierTokens(state.attempts);
    const result: TaskResult = {
      task: task.name,
      kind: task.kind,
      language: task.language,
      mode: state.mode,
      status: state.status,
      checks: state.outcome?.checks ?? "-",
      hidden,
      hiddenTail,
      score,
      quota: quotaBefore || quotaNow ? { before: quotaBefore, after: quotaNow } : undefined,
      files: state.outcome?.files.length ?? 0,
      insertions: state.outcome?.insertions ?? 0,
      deletions: state.outcome?.deletions ?? 0,
      turns: state.attempts.length,
      repairs: state.attempts.filter((a) => a.kind === "repair" || a.kind === "review-fix").length,
      escalations: state.tasks.filter((t) => t.escalated).length,
      wallMs,
      usage: usageByModel(state.attempts),
      expertTokens: tiers.expert,
      workerTokens: tiers.worker,
      usageIncomplete: tiers.incomplete,
      reason: state.reason,
      failure: state.failure,
      runId: state.id,
      finishedAt: new Date().toISOString(),
    };
    report.results[task.name] = result;
    saveReport(ctx.home, report);
    // [F108 run-record] The result goes into the record as it happens, not only when a backfill finds the report.
    if (isOn("run-record")) {
      try {
        inFeature("F108", () => appendRecord(ctx.home, [evalResultLine(report.name, report.preset, task.name, result as unknown as Record<string, unknown>, "eval")]));
      } catch {
        // The record failing never touches the eval.
      }
    }
    options.onTaskDone?.(result);

    // Out of quota: stop here. Running on would only mark the rest as paused.
    if (state.status === "paused") break;
  }
  return report;
}

export interface Summary {
  tasks: number;
  passed: number;
  engineFailures: number;
  paused: number;
  /** [eval] What the paused tasks paused for: quota, sign-in, network, other or unknown. */
  pausedFor: string[];
  wallMs: number;
  expertTokens: number;
  workerTokens: number;
  expertShare: number | undefined;
  usageIncomplete: boolean;
  /** Estimated API list-price cost in USD (see src/usage/prices.ts); not money spent. */
  costEstimate: number;
  expertCostEstimate: number;
  /** Some usage could not be priced (a model without a listed price). */
  costIncomplete: boolean;
}

/** Estimated API cost of one task's usage, split by tier. */
export function costOf(result: TaskResult): { total: number; expert: number; incomplete: boolean } {
  let total = 0;
  let expert = 0;
  let incomplete = false;
  for (const u of result.usage) {
    const cost = estimateCost(u.model, u.usage);
    if (cost === undefined) {
      // A turn that never reached the model (a quota refusal) reports nothing and costs nothing.
      if (u.usage.input !== undefined || u.usage.output !== undefined) incomplete = true;
      continue;
    }
    total += cost;
    if (u.tier === "expert") expert += cost;
  }
  return { total, expert, incomplete };
}

/** Why a task paused, from the engine's reason: the summary used to call every pause "quota". */
export function pauseCause(reason: string | undefined): string {
  if (!reason) return "unknown";
  if (/no longer signed in/.test(reason)) return "sign-in";
  if (/cannot reach its service/.test(reason)) return "network";
  if (/subscription limits|quota/i.test(reason)) return "quota";
  return "other";
}

export function summarize(report: EvalReport, names?: string[]): Summary {
  const rows = Object.values(report.results).filter((r) => !names || names.includes(r.task));
  const expert = rows.reduce((s, r) => s + r.expertTokens, 0);
  const worker = rows.reduce((s, r) => s + r.workerTokens, 0);
  return {
    tasks: rows.length,
    passed: rows.filter((r) => r.hidden === "pass").length,
    engineFailures: rows.filter((r) => r.failure === "engine").length,
    paused: rows.filter((r) => r.status === "paused").length,
    pausedFor: [...new Set(rows.filter((r) => r.status === "paused").map((r) => pauseCause(r.reason)))],
    wallMs: rows.reduce((s, r) => s + r.wallMs, 0),
    expertTokens: expert,
    workerTokens: worker,
    expertShare: expert + worker > 0 ? expert / (expert + worker) : undefined,
    usageIncomplete: rows.some((r) => r.usageIncomplete),
    costEstimate: rows.reduce((s, r) => s + costOf(r).total, 0),
    expertCostEstimate: rows.reduce((s, r) => s + costOf(r).expert, 0),
    costIncomplete: rows.some((r) => costOf(r).incomplete),
  };
}

/**
 * Recount an eval's token usage from its runs' records, with resumed Codex
 * turns counted per turn (see perTurnAttempts). No model calls. Safe to repeat.
 */
export function recountEval(home: string, name: string): { task: string; before: number; after: number }[] {
  const report = loadReport(home, name);
  if (!report) throw new Error(`No eval results named "${name}"`);
  const totalsBackends = new Set(Object.values(backends).filter((b) => b.sessionTotals).map((b) => b.id));
  const projects = join(home, "projects");
  const changes: { task: string; before: number; after: number }[] = [];
  for (const result of Object.values(report.results)) {
    const dir = existsSync(projects)
      ? readdirSync(projects).map((p) => join(projects, p, "runs", result.runId)).find((d) => existsSync(join(d, "run.json")))
      : undefined;
    if (!dir) continue;
    const attempts = perTurnAttempts(loadState(dir), (b) => totalsBackends.has(b));
    const tiers = tierTokens(attempts);
    const before = result.expertTokens + result.workerTokens;
    result.usage = usageByModel(attempts);
    result.expertTokens = tiers.expert;
    result.workerTokens = tiers.worker;
    changes.push({ task: result.task, before, after: tiers.expert + tiers.worker });
  }
  saveReport(home, report);
  return changes;
}

/**
 * Run the hidden checks again on an eval's already-applied repositories, with
 * the current task definitions. No model calls: for fixing a broken check.
 */
export function recheckEval(home: string, name: string, tasks: EvalTask[]): { task: string; before: string; after: string }[] {
  const report = loadReport(home, name);
  if (!report) throw new Error(`No eval results named "${name}"`);
  const changes: { task: string; before: string; after: string }[] = [];
  for (const task of tasks) {
    const result = report.results[task.name];
    const repo = join(evalDir(home, name), "repos", task.name);
    if (!result || result.hidden === "not run" || !existsSync(repo)) continue;
    rmSync(join(repo, "hidden"), { recursive: true, force: true });
    cpSync(join(task.dir, "hidden"), join(repo, "hidden"), { recursive: true });
    const check = sh(repo, task.hiddenCheck);
    const hidden = hiddenVerdict(check);
    changes.push({ task: task.name, before: result.hidden, after: hidden });
    result.hidden = hidden;
    result.score = scoreOf(check.output);
    result.hiddenTail = hidden !== "pass" ? check.output.split("\n").slice(-20).join("\n") || (check.code === null ? "the hidden check timed out" : "the hidden check printed nothing") : undefined;
  }
  saveReport(home, report);
  return changes;
}
