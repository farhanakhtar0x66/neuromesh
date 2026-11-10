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
import { startRun, usageByModel } from "../engine/run.ts";
import type { EngineContext, ModelUsage } from "../engine/run.ts";
import type { AttemptRecord, RunState } from "../engine/types.ts";
import type { Preset } from "../presets/presets.ts";

export const TASKS_DIR = fileURLToPath(new URL("../../evals/tasks/", import.meta.url));

export interface EvalTask {
  name: string;
  dir: string;
  kind: string;
  language: string;
  hiddenCheck: string;
  prompt: string;
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
  hidden: "pass" | "fail" | "not run";
  hiddenTail?: string;
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

function sh(cwd: string, command: string): { code: number | null; output: string } {
  const r = spawnSync("sh", ["-c", `${command} 2>&1`], { cwd, encoding: "utf8", timeout: 10 * 60_000 });
  return { code: r.status, output: (r.stdout ?? "").trim() };
}

function seedRepo(task: EvalTask, into: string): string {
  if (existsSync(into)) rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  cpSync(join(task.dir, "seed"), into, { recursive: true });
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) {
    const r = spawnSync("git", ["-c", "user.name=neuromesh-eval", "-c", "user.email=eval@localhost", ...args], { cwd: into });
    if (r.status !== 0) throw new Error(`could not seed ${task.name}: git ${args[0]} failed`);
  }
  return realpathSync(into);
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
  onTaskStart?: (task: EvalTask, index: number, total: number) => void;
  onTaskDone?: (result: TaskResult) => void;
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
    return !done || RETRY_STATUSES.has(done.status);
  });

  for (const [index, task] of todo.entries()) {
    if (ctx.signal?.aborted) break;
    options.onTaskStart?.(task, index, todo.length);
    const repo = seedRepo(task, join(evalDir(ctx.home, options.name), "repos", task.name));
    const started = Date.now();
    const state = await startRun({ cwd: repo, prompt: task.prompt, preset }, ctx);
    const wallMs = Date.now() - started;

    let hidden: TaskResult["hidden"] = "not run";
    let hiddenTail: string | undefined;
    if (state.status === "finished") {
      applyRun(state, { force: true });
      cpSync(join(task.dir, "hidden"), join(repo, "hidden"), { recursive: true });
      const check = sh(repo, task.hiddenCheck);
      hidden = check.code === 0 ? "pass" : "fail";
      if (hidden === "fail") hiddenTail = check.output.split("\n").slice(-20).join("\n");
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
  wallMs: number;
  expertTokens: number;
  workerTokens: number;
  expertShare: number | undefined;
  usageIncomplete: boolean;
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
    wallMs: rows.reduce((s, r) => s + r.wallMs, 0),
    expertTokens: expert,
    workerTokens: worker,
    expertShare: expert + worker > 0 ? expert / (expert + worker) : undefined,
    usageIncomplete: rows.some((r) => r.usageIncomplete),
  };
}
