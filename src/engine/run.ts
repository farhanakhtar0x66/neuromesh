// The run engine: the factory floor.
//
//   setup ─> baseline ─> [plan] ─> tasks ─> final ─> done
//
// "plan" is the expert (orchestrator) splitting the request into tasks; a solo
// run skips it and has one task, the whole request. Each task runs in its own
// worktree, branched from the integration worktree with earlier tasks merged:
//
//   start ─> agent ─> checks ─┬─> test ─┬─> merge ─> done
//              ^              │         │
//              ├── repair ────┘         │   (checks failed; same session)
//              ├── review-fix ──────────┘   (the tester found problems)
//              └── escalate: the expert takes over from a clean slate when the
//                  worker is stuck (stagnation breaker) or out of repairs
//
// Every step is saved to run.json, so a run stopped by Ctrl-C, a crash or a
// subscription limit resumes where it was. When a model runs out of quota the
// next model in the role's list takes over; when none is left the run pauses.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AgentBackend, AgentResult, Usage } from "../backends/types.ts";
import { addUsage } from "../backends/types.ts";
import { detectChecks, runChecks } from "../checks/checks.ts";
import type { CheckResult } from "../checks/checks.ts";
import { route } from "../intake/intake.ts";
import type { Preset } from "../presets/presets.ts";
import { git } from "../workspace/git.ts";
import {
  commitAll,
  createDetachedWorktree,
  createWorktree,
  findRepo,
  headCommit,
  mergeBranch,
  outsideOwned,
  ownedOverlap,
  prepareWorktree,
  removeDetachedWorktree,
  removeWorktree,
  resetTo,
  snapshot,
  writePatch,
} from "../workspace/workspace.ts";
import { coolingModels, recordCooldown } from "./cooldown.ts";
import { attemptFrom, newHistory, observe } from "./progress.ts";
import {
  continuePrompt,
  escalationPrompt,
  failureSummary,
  freshFollowUpPrompt,
  integrationPrompt,
  parsePlan,
  parseReport,
  parseVerdict,
  PLAN_SCHEMA,
  plannerPrompt,
  redoPrompt,
  repairPrompt,
  REPORT_SCHEMA,
  reviewFixPrompt,
  taskPrompt,
  testerPrompt,
  VERDICT_SCHEMA,
} from "./prompts.ts";
import { EventLog, newRunId, runPaths, runsDir, saveState } from "./store.ts";
import type { NeuromeshEvent } from "./store.ts";
import type { AttemptKind, AttemptRecord, PlannedTask, Role, RoleConfig, RunState, TaskState, Tier } from "./types.ts";

export interface EngineContext {
  home: string;
  backends: Record<string, AgentBackend>;
  signal?: AbortSignal;
  onEvent?: (event: NeuromeshEvent) => void;
  /** Overrides the preset's turn time limit (tests use this). */
  turnTimeoutMs?: number;
  checkTimeoutMs?: number;
}

export interface StartOptions {
  cwd: string;
  prompt: string;
  preset: Preset;
  /** Replace the first worker model or backend for this run. */
  worker?: Partial<RoleConfig>;
  repairs?: number;
  /** Force solo or team; by default a team preset lets the intake decide. */
  mode?: "solo" | "team";
}

/** How a task or a turn ended, when it ends the whole run early. */
type Stop = { status: "paused" | "interrupted" | "failed"; reason: string; failure?: "agent" | "engine" };

const ESCALATION_REPAIRS = 1;
const MAX_CONFLICTS = 2;

export function modelKey(c: RoleConfig): string {
  return `${c.backend}/${c.model ?? "default"}`;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function startRun(options: StartOptions, ctx: EngineContext): Promise<RunState> {
  const repo = findRepo(options.cwd);
  const id = newRunId();
  const dir = join(runsDir(ctx.home, repo.root), id);
  const paths = runPaths(dir);
  const now = new Date().toISOString();
  const preset = options.preset;

  const roles = structuredClone(preset.roles);
  const override = stripUndefined(options.worker ?? {});
  if (Object.keys(override).length > 0 && roles.worker?.[0]) {
    // Choosing another backend means its model too; a model id rarely carries across.
    const base = override.backend && override.backend !== roles.worker[0].backend ? { backend: override.backend, tier: roles.worker[0].tier } : roles.worker[0];
    roles.worker = [{ ...base, ...override }];
  }

  let mode: "solo" | "team" = options.mode ?? preset.mode;
  let why: string | undefined;
  if (!options.mode && preset.mode === "team" && preset.intake) {
    const decision = route(options.prompt);
    mode = decision.mode;
    why = decision.reason;
  }

  const state: RunState = {
    version: 2,
    id,
    dir,
    repo: repo.root,
    prompt: options.prompt,
    preset: preset.name,
    mode,
    roles,
    repairs: options.repairs ?? preset.repairs,
    maxTasks: preset.maxTasks,
    maxParallel: preset.maxParallel,
    turnTimeoutMs: ctx.turnTimeoutMs ?? preset.turnTimeoutMinutes * 60_000,
    base: repo.head,
    branch: `neuromesh/${id}`,
    worktree: paths.worktree,
    status: "running",
    step: "setup",
    pid: process.pid,
    inFlight: {},
    exhausted: [],
    prepared: [],
    checks: [],
    tasks: [],
    integrationFixes: 0,
    attempts: [],
    route: why,
    createdAt: now,
    updatedAt: now,
  };
  saveState(state);

  const log = new EventLog(paths.events, id, ctx.onEvent);
  log.emit("run.started", {
    repo: repo.root,
    preset: state.preset,
    mode,
    worker: roles.worker?.[0],
    orchestrator: mode === "team" ? roles.orchestrator?.[0] : undefined,
    base: repo.head,
    prompt: options.prompt,
  });
  if (why) log.emit("route", { mode, reason: why });
  if (repo.dirty) {
    log.emit("note", { message: "The repository has uncommitted changes. The run starts from the last commit and does not see them." });
  }
  return drive(state, ctx, log);
}

export async function resumeRun(state: RunState, ctx: EngineContext): Promise<RunState> {
  if (state.status === "finished" || state.status === "applied" || state.status === "discarded") {
    throw new Error(`Run ${state.id} is ${state.status}; there is nothing to resume.`);
  }
  if (state.status === "running" && state.pid !== undefined && state.pid !== process.pid && engineAlive(state.pid)) {
    throw new Error(`Run ${state.id} is still running in process ${state.pid}.`);
  }
  const log = new EventLog(runPaths(state.dir).events, state.id, ctx.onEvent);

  // Turns the engine never finished: stop any agent tool still running on its
  // own, and record the turn with its usage unknown.
  for (const [key, f] of Object.entries(state.inFlight)) {
    if (f.pid !== undefined && stopOrphan(f.pid, f.backend)) {
      log.emit("note", { message: `Stopped an agent process (${f.pid}) left over from the interrupted run.` });
    }
    const { pid: _pid, ...rest } = f;
    void _pid;
    state.attempts.push({ ...rest, stop: "cancelled", durationMs: Date.now() - Date.parse(f.startedAt), usage: {}, detail: "the engine stopped during this turn" });
    const task = state.tasks.find((t) => t.id === key);
    if (task && task.step === "agent") task.next = "continue";
  }
  state.inFlight = {};

  // A paused run may have exhausted models whose limits have reset since.
  if (state.status === "paused") state.exhausted = [];

  const from = state.status;
  state.status = "running";
  state.pid = process.pid;
  state.reason = undefined;
  state.failure = undefined;
  saveState(state);
  log.emit("run.resumed", { from, step: state.step });
  return drive(state, ctx, log);
}

function newTask(state: RunState, planned: PlannedTask): TaskState {
  const dir = join(state.dir, "tasks", planned.id);
  return {
    id: planned.id,
    title: planned.title,
    brief: planned.brief,
    owned: planned.owned,
    dependsOn: planned.dependsOn,
    owner: planned.owner,
    status: "pending",
    step: "start",
    round: 0,
    branch: `neuromesh-task/${state.id}/${planned.id}`,
    worktree: join(dir, "worktree"),
    prepared: [],
    next: "initial",
    testRounds: 0,
    escalated: false,
    history: [],
    progress: newHistory(),
    conflicts: 0,
  };
}

async function drive(state: RunState, ctx: EngineContext, log: EventLog): Promise<RunState> {
  const paths = runPaths(state.dir);
  // Models another run found out of quota stay out until they reset.
  const cooling = coolingModels(ctx.home);
  const skipped = Object.keys(cooling).filter((m) => !state.exhausted.includes(m) && usesModel(state, m));
  if (skipped.length > 0) {
    state.exhausted.push(...skipped);
    log.emit("note", { message: `Skipping models still out of quota: ${skipped.map((m) => `${m} (until ${new Date(cooling[m]!.until).toLocaleTimeString()})`).join(", ")}` });
  }
  // Stops every task when one of them hits a quota limit with no fallback left.
  const inner = new AbortController();
  const onOuterAbort = (): void => inner.abort();
  ctx.signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (ctx.signal?.aborted) inner.abort();
  const run: RunCtx = { state, ctx, log, signal: inner.signal, abortAll: () => inner.abort() };

  const end = (stop: Stop): RunState => {
    state.status = stop.status;
    state.reason = stop.reason;
    state.failure = stop.failure;
    state.pid = undefined;
    for (const f of Object.values(state.inFlight)) {
      const { pid: _pid, ...rest } = f;
      void _pid;
      state.attempts.push({ ...rest, stop: "cancelled", durationMs: Date.now() - Date.parse(f.startedAt), usage: {} });
    }
    state.inFlight = {};
    saveState(state);
    log.emit(`run.${stop.status}`, { reason: stop.reason, failure: stop.failure, step: state.step });
    return state;
  };
  const interrupted = (): RunState => end({ status: "interrupted", reason: "stopped by the user" });

  try {
    while (true) {
      if (ctx.signal?.aborted) return interrupted();

      if (state.step === "setup") {
        createWorktree(state.repo, state.worktree, state.branch, state.base);
        state.prepared = prepareWorktree(state.repo, state.worktree);
        state.checks = detectChecks(state.worktree);
        state.step = "baseline";
        saveState(state);
        log.emit("workspace.ready", { worktree: state.worktree, branch: state.branch, prepared: state.prepared });
        log.emit("checks.detected", { checks: state.checks });
        continue;
      }

      if (state.step === "baseline") {
        const results = await check(run, state.worktree, "baseline");
        if (ctx.signal?.aborted) return interrupted();
        state.baseline = results;
        const missing = results.filter((r) => r.status === "unavailable").map((r) => r.name);
        if (missing.length > 0) {
          state.checks = state.checks.filter((c) => !missing.includes(c.name));
          log.emit("note", { message: `Skipping checks that cannot run here: ${missing.join(", ")}` });
        }
        log.emit("checks.finished", { phase: "baseline", results: brief(results) });
        if (state.mode === "team") {
          state.step = "plan";
        } else {
          state.tasks = [newTask(state, { id: "main", title: "the request", brief: state.prompt, owned: [], dependsOn: [], owner: "worker" })];
          state.step = "tasks";
        }
        saveState(state);
        continue;
      }

      if (state.step === "plan") {
        const outcome = await planStep(run);
        if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
        state.step = "tasks";
        saveState(state);
        continue;
      }

      if (state.step === "tasks") {
        const outcome = await schedule(run);
        if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
        state.step = "final";
        saveState(state);
        continue;
      }

      if (state.step === "final") {
        const outcome = await finalStep(run);
        if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
        const diff = snapshot(state.worktree, state.base, state.prepared);
        writePatch(paths.patch, diff.patch);
        const latest = state.latest ?? [];
        const failing = latest.filter((r) => r.status === "failed" || r.status === "timeout");
        state.outcome = {
          checks: latest.length === 0 ? "none" : failing.length === 0 ? "passed" : "failed",
          files: diff.files,
          insertions: diff.insertions,
          deletions: diff.deletions,
        };
        const notStarted = state.tasks.filter((t) => t.status === "pending");
        const failedTasks = state.tasks.filter((t) => t.status === "failed");
        state.step = "done";
        if (notStarted.length > 0) {
          return end({
            status: "failed",
            reason: `task ${failedTasks.map((t) => t.id).join(", ")} failed, so ${notStarted.map((t) => t.id).join(", ")} never started`,
            failure: "agent",
          });
        }
        state.status = "finished";
        state.pid = undefined;
        saveState(state);
        log.emit("run.finished", {
          outcome: state.outcome,
          tasks: state.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, escalated: t.escalated, report: t.report })),
          usage: usageByModel(state.attempts),
        });
        return state;
      }

      if (state.step === "done") {
        state.status = "finished";
        state.pid = undefined;
        saveState(state);
        return state;
      }
    }
  } catch (error) {
    if (ctx.signal?.aborted) return interrupted();
    const message = error instanceof Error ? error.message : String(error);
    return end({ status: "failed", reason: `engine error: ${message}`, failure: "engine" });
  } finally {
    ctx.signal?.removeEventListener("abort", onOuterAbort);
  }
}

interface RunCtx {
  state: RunState;
  ctx: EngineContext;
  log: EventLog;
  /** Aborted by the user, or by a task that ran out of models. */
  signal: AbortSignal;
  abortAll: () => void;
}

async function check(run: RunCtx, dir: string, label: string): Promise<CheckResult[]> {
  if (run.state.checks.length === 0) return [];
  return runChecks({
    dir,
    checks: run.state.checks,
    logDir: runPaths(run.state.dir).checkLogs,
    label,
    timeoutMs: run.ctx.checkTimeoutMs,
    signal: run.signal,
  });
}

function brief(results: CheckResult[]): { name: string; status: string; durationMs: number }[] {
  return results.map((r) => ({ name: r.name, status: r.status, durationMs: r.durationMs }));
}

// ---------------------------------------------------------------------------
// Agent turns, with the role's fallback chain.

interface TurnRequest {
  key: string;
  role: Role;
  kind: AttemptKind;
  task?: string;
  round: number;
  cwd: string;
  prompt: string;
  /** Used instead of `prompt` when the session cannot be continued. */
  freshPrompt?: string;
  access: "read-only" | "write";
  schema: Record<string, unknown>;
  resume?: { sessionId?: string; model?: string };
}

interface TurnResult {
  result: AgentResult;
  config?: RoleConfig;
}

const TRANSIENT = /stream was interrupted|ECONNRESET|socket hang up|ETIMEDOUT|\b50[23]\b|overloaded|temporarily unavailable|internal server error/i;

const UNAVAILABLE =
  /invalid model|not recognized as a known model|not supported when using|issue with the selected model|model .*(not found|unavailable|does not exist)|no longer (available|supported)|does not have access to (the )?model/i;

export function roleChain(state: RunState, role: Role): RoleConfig[] {
  const chain = state.roles[role] ?? (role === "escalation" ? state.roles.orchestrator : undefined) ?? [];
  return chain.filter((c) => !state.exhausted.includes(modelKey(c)));
}

function tierOf(role: Role, c: RoleConfig): Tier {
  return c.tier ?? (role === "orchestrator" || role === "escalation" ? "expert" : "worker");
}

async function turn(run: RunCtx, req: TurnRequest): Promise<TurnResult> {
  const { state, ctx, log } = run;
  let last: AgentResult | undefined;
  let lastConfig: RoleConfig | undefined;
  while (true) {
    const config = roleChain(state, req.role)[0];
    if (!config) {
      const detail = last?.detail ?? `no ${req.role} model is configured`;
      return { result: last ?? emptyResult("quota", detail), config: lastConfig };
    }
    const backend = ctx.backends[config.backend];
    if (!backend) throw new Error(`unknown backend "${config.backend}"`);
    const sameSession = req.resume?.sessionId !== undefined && req.resume.model === modelKey(config);
    const prompt = sameSession ? req.prompt : (req.freshPrompt ?? req.prompt);
    let result = await once(run, req, config, backend, prompt, sameSession ? req.resume?.sessionId : undefined);

    // A dropped connection or an overloaded service: try the same turn once more.
    if (result.stop === "error" && TRANSIENT.test(result.detail ?? "") && !run.signal.aborted) {
      log.emit("note", { message: `The ${req.role}'s connection failed (${(result.detail ?? "").slice(0, 80)}); trying once more.` });
      result = await once(run, req, config, backend, prompt, sameSession ? req.resume?.sessionId : undefined);
    }

    // Resuming a session can fail (an expired or unknown id): one fresh try.
    if (sameSession && result.stop === "error" && !UNAVAILABLE.test(result.detail ?? "") && !run.signal.aborted) {
      log.emit("note", { message: "Could not continue the agent's session; starting a fresh one." });
      result = await once(run, req, config, backend, req.freshPrompt ?? req.prompt, undefined);
    }

    const unavailable = (result.stop === "error" || result.stop === "auth") && UNAVAILABLE.test(result.detail ?? "");
    if (result.stop === "quota" || unavailable) {
      if (!state.exhausted.includes(modelKey(config))) state.exhausted.push(modelKey(config));
      recordCooldown(ctx.home, modelKey(config), unavailable ? `not available: ${result.detail ?? ""}` : (result.detail ?? "quota"));
      saveState(state);
      const next = roleChain(state, req.role)[0];
      log.emit("model.exhausted", {
        role: req.role,
        model: modelKey(config),
        reason: unavailable ? "not available" : "quota",
        detail: result.detail,
        next: next ? modelKey(next) : undefined,
      });
      last = result;
      lastConfig = config;
      if (run.signal.aborted) return { result, config };
      continue;
    }
    return { result, config };
  }
}

function usesModel(state: RunState, key: string): boolean {
  return Object.values(state.roles).some((chain) => chain?.some((c) => modelKey(c) === key));
}

function emptyResult(stop: AgentResult["stop"], detail: string): AgentResult {
  return { stop, finalText: "", usage: {}, durationMs: 0, exitCode: null, detail };
}

async function once(run: RunCtx, req: TurnRequest, config: RoleConfig, backend: AgentBackend, prompt: string, resumeSessionId: string | undefined): Promise<AgentResult> {
  const { state, log } = run;
  const startedAt = new Date().toISOString();
  const tier = tierOf(req.role, config);
  const n = state.attempts.length + Object.keys(state.inFlight).length + 1;
  const logPath = join(runPaths(state.dir).agentLogs, `${String(n).padStart(3, "0")}-${req.key}-${req.kind}.jsonl`);
  state.inFlight[req.key] = { role: req.role, tier, task: req.task, round: req.round, kind: req.kind, backend: backend.id, model: config.model, startedAt, logPath };
  saveState(state);
  log.emit("agent.started", { task: req.task, role: req.role, kind: req.kind, backend: backend.id, model: config.model, resumed: Boolean(resumeSessionId) });

  const result = await backend.run({
    cwd: req.cwd,
    prompt,
    model: config.model,
    effort: config.effort,
    access: req.access,
    outputSchema: req.schema,
    resumeSessionId,
    timeoutMs: state.turnTimeoutMs,
    logPath,
    signal: run.signal,
    onActivity: (a) => log.emit("agent.activity", { task: req.task, role: req.role, activity: a.kind, summary: a.summary }),
    onSpawn: (pid) => {
      const f = state.inFlight[req.key];
      if (f) f.pid = pid;
      saveState(state);
    },
  });

  delete state.inFlight[req.key];
  const record: AttemptRecord = {
    role: req.role,
    tier,
    task: req.task,
    round: req.round,
    kind: req.kind,
    backend: backend.id,
    model: result.model ?? config.model,
    stop: result.stop,
    startedAt,
    durationMs: result.durationMs,
    usage: result.usage,
    costUsdEquivalent: result.costUsdEquivalent,
    sessionId: result.sessionId,
    detail: result.detail,
    logPath,
  };
  state.attempts.push(record);
  saveState(state);
  log.emit("agent.finished", {
    task: req.task,
    role: req.role,
    kind: req.kind,
    stop: result.stop,
    model: record.model,
    durationMs: result.durationMs,
    usage: result.usage,
    detail: result.detail,
    quotaUsed: result.quotaUsed,
  });
  return result;
}

/** Turn a non-finished agent result into how the run should stop. */
function stopFor(result: AgentResult, what: string): Stop {
  if (result.stop === "cancelled") return { status: "interrupted", reason: "stopped by the user" };
  if (result.stop === "quota") {
    return { status: "paused", reason: `subscription limits reached for every ${what} model: ${result.detail ?? ""} (see "neuromesh cooldowns" for when they reset)`.trim() };
  }
  return { status: "failed", reason: `${what} ${result.stop}: ${result.detail ?? "no detail"}`, failure: "agent" };
}

// ---------------------------------------------------------------------------
// The expert plans.

async function planStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const files = git(state.worktree, "ls-files").split("\n").filter(Boolean);
  const first = plannerPrompt(state, files);
  let prompt = first;
  let resume: TurnRequest["resume"];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { result, config } = await turn(run, {
      key: "plan",
      role: "orchestrator",
      kind: "plan",
      round: attempt,
      cwd: state.worktree,
      prompt,
      freshPrompt: first,
      access: "read-only",
      schema: PLAN_SCHEMA,
      resume,
    });
    if (result.stop !== "done") return stopFor(result, "orchestrator");
    state.planSession = result.sessionId;
    try {
      const plan = parsePlan(result, state.maxTasks);
      state.plan = plan;
      state.tasks = plan.tasks.map((t) => newTask(state, t));
      saveState(state);
      log.emit("plan.ready", { summary: plan.summary, model: config ? modelKey(config) : undefined, tasks: plan.tasks });
      return undefined;
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      log.emit("note", { message: `The plan was not usable (${problem}); asking for a corrected one.` });
      prompt = `Your plan could not be used: ${problem}. Give a corrected plan in the same JSON format.`;
      resume = { sessionId: result.sessionId, model: config ? modelKey(config) : undefined };
    }
  }
  return { status: "failed", reason: "the orchestrator did not produce a usable plan", failure: "agent" };
}

// ---------------------------------------------------------------------------
// The scheduler: runs ready tasks, several at once when their files do not overlap.

async function schedule(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const running = new Map<string, Promise<void>>();
  let stop: Stop | undefined;

  const launch = (task: TaskState): void => {
    const p = driveTask(run, task)
      .then((outcome) => {
        if (outcome && !stop) {
          stop = outcome;
          if (outcome.status !== "failed") run.abortAll();
        }
      })
      .catch((error: unknown) => {
        stop ??= { status: "failed", reason: `engine error: ${error instanceof Error ? error.message : String(error)}`, failure: "engine" };
        run.abortAll();
      })
      .finally(() => running.delete(task.id));
    running.set(task.id, p);
  };

  // A resumed run continues the tasks it was working on.
  for (const task of state.tasks) if (task.status === "active") launch(task);

  while (true) {
    if (!stop && !run.signal.aborted) {
      const passed = new Set(state.tasks.filter((t) => t.status === "passed").map((t) => t.id));
      const anyFailed = state.tasks.some((t) => t.status === "failed");
      for (const task of state.tasks) {
        if (anyFailed) break; // finish what is running, start nothing new
        if (running.size >= state.maxParallel) break;
        if (task.status !== "pending") continue;
        if (!task.dependsOn.every((d) => passed.has(d))) continue;
        const active = state.tasks.filter((t) => t.status === "active");
        if (active.some((a) => ownedOverlap(a.owned, task.owned))) continue;
        task.status = "active";
        task.step = "start";
        saveState(state);
        launch(task);
      }
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  if (run.ctx.signal?.aborted) return { status: "interrupted", reason: "stopped by the user" };
  if (stop) return stop;
  const stuck = state.tasks.filter((t) => t.status === "active");
  if (stuck.length > 0) {
    log.emit("note", { message: `tasks ${stuck.map((t) => t.id).join(", ")} did not finish` });
    return { status: "failed", reason: `tasks ${stuck.map((t) => t.id).join(", ")} did not finish`, failure: "engine" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// One task, step by step.

function isLastOpen(state: RunState, task: TaskState): boolean {
  return state.tasks.every((t) => t === task || t.status === "passed" || t.status === "failed");
}

function canEscalate(state: RunState): boolean {
  return roleChain(state, "escalation").length > 0;
}

function roleFor(state: RunState, task: TaskState): Role {
  if (task.owner === "expert" || task.escalated) return state.roles.escalation ? "escalation" : "orchestrator";
  return "worker";
}

async function driveTask(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  while (task.status === "active") {
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };

    if (task.step === "start") {
      task.base = headCommit(state.worktree);
      createWorktree(state.repo, task.worktree, task.branch, task.base);
      task.prepared = prepareWorktree(state.repo, task.worktree);
      task.step = "agent";
      saveState(state);
      log.emit("task.started", { task: task.id, title: task.title, owner: task.owner, owned: task.owned });
      continue;
    }

    if (task.step === "agent") {
      const role = roleFor(state, task);
      const kind: AttemptKind = task.escalated && task.next === "initial" ? "escalation" : task.next;
      const followUp = task.next === "repair" || task.next === "review-fix";
      const prompt =
        task.next === "repair" ? repairPrompt(state, task)
        : task.next === "review-fix" ? reviewFixPrompt(task)
        : task.next === "redo" ? redoPrompt(state, task)
        : task.next === "continue" ? continuePrompt(state, task)
        : task.escalated ? escalationPrompt(state, task)
        : taskPrompt(state, task);
      const { result, config } = await turn(run, {
        key: task.id,
        role,
        kind,
        task: task.id,
        round: task.round,
        cwd: task.worktree,
        prompt,
        freshPrompt: followUp ? freshFollowUpPrompt(state, task) : prompt,
        access: "write",
        schema: REPORT_SCHEMA,
        resume: followUp ? { sessionId: task.sessionId, model: task.sessionModel } : undefined,
      });
      if (result.stop === "done") {
        task.report = parseReport(result);
        task.sessionId = result.sessionId;
        task.sessionModel = config ? modelKey(config) : undefined;
        task.step = "checks";
        saveState(state);
        continue;
      }
      if (result.stop === "cancelled" || result.stop === "quota") {
        // The turn may have changed files before it stopped; the next one checks first.
        if (task.next === "initial" && !task.escalated) task.next = "continue";
        saveState(state);
        return stopFor(result, role);
      }
      // The agent failed outright (refused, timed out, crashed): the expert takes over.
      task.history.push({ diff: diffOf(task), failures: `The ${role} stopped: ${result.stop}: ${result.detail ?? ""}` });
      if (!task.escalated && canEscalate(state)) {
        task.escalationReason = `the worker ${result.stop}`;
        task.step = "escalate";
        saveState(state);
        continue;
      }
      return failTask(run, task, `${role} ${result.stop}: ${result.detail ?? "no detail"}`, { stop: true });
    }

    if (task.step === "checks") {
      const results = await check(run, task.worktree, `${task.id}-${task.escalated ? "x" : ""}${task.round}`);
      if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
      const diff = diffOf(task);
      task.latest = results;
      const files = snapshot(task.worktree, task.base!, task.prepared).files;
      task.files = files;
      const outside = outsideOwned(files.map((f) => f.path), task.owned);
      if (outside.length > 0 && JSON.stringify(outside) !== JSON.stringify(task.outOfScope)) {
        task.outOfScope = outside;
        log.emit("note", { message: `Task ${task.id} changed files outside what it owns: ${outside.join(", ")}` });
      }
      const failing = results.filter((r) => r.status === "failed" || r.status === "timeout");
      const regressions = failing.filter((r) => state.baseline?.find((b) => b.name === r.name)?.status !== "failed");
      const ok = regressions.length === 0 && (!isLastOpen(state, task) || failing.length === 0);
      log.emit("checks.finished", { phase: "task", task: task.id, round: task.round, results: brief(results), ok });
      const decision = observe(task.progress, attemptFrom(failing, diff), ok);
      if (ok) {
        task.step = state.roles.tester && !task.escalated ? "test" : "merge";
        saveState(state);
        continue;
      }
      task.history.push({ diff, failures: failureSummary(results, state.baseline) });
      if (task.escalated) {
        if (task.round < ESCALATION_REPAIRS) nextRound(run, task, "repair");
        continue;
        return failTask(run, task, "checks still fail after the expert's attempt");
      }
      if (decision === "oscillated" || decision === "no-progress" || task.round >= state.repairs) {
        const why = decision === "oscillated" ? "the worker repeated an earlier failed state" : decision === "no-progress" ? "two attempts without progress" : "out of repair rounds";
        if (canEscalate(state)) {
          task.escalationReason = why;
          task.step = "escalate";
          saveState(state);
          continue;
        }
        return failTask(run, task, `checks still fail (${why})`);
      }
      nextRound(run, task, "repair");
        continue;
    }

    if (task.step === "test") {
      const candidate = commitAll(task.worktree, `neuromesh candidate: ${task.title}`, task.prepared);
      const testerDir = join(state.dir, "tasks", task.id, "tester");
      createDetachedWorktree(state.repo, testerDir, candidate);
      prepareWorktree(state.repo, testerDir);
      const diff = git(task.worktree, "diff", "--binary", task.base!, candidate);
      let outcome: TurnResult;
      try {
        outcome = await turn(run, {
          key: `${task.id}-test`,
          role: "tester",
          kind: "test",
          task: task.id,
          round: task.testRounds,
          cwd: testerDir,
          prompt: testerPrompt(state, task, diff),
          access: "write",
          schema: VERDICT_SCHEMA,
        });
      } finally {
        removeDetachedWorktree(state.repo, testerDir);
      }
      const { result } = outcome;
      if (result.stop === "cancelled") return stopFor(result, "tester");
      task.testRounds += 1;
      const verdict = result.stop === "done" ? parseVerdict(result) : undefined;
      if (!verdict) {
        log.emit("note", { message: `The tester gave no usable verdict for task ${task.id} (${result.stop}); relying on the checks.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      task.verdict = verdict;
      log.emit("tester.verdict", { task: task.id, verdict: verdict.verdict, summary: verdict.summary, findings: verdict.findings });
      if (verdict.verdict === "pass") {
        task.step = "merge";
        saveState(state);
        continue;
      }
      task.history.push({ diff, failures: "", findings: verdict.findings });
      if (task.round >= state.repairs) {
        if (canEscalate(state)) {
          task.escalationReason = "the reviewer still found problems after the repair rounds";
          task.step = "escalate";
          saveState(state);
          continue;
        }
        log.emit("note", { message: `Task ${task.id}: out of repair rounds; accepting it with the reviewer's findings open.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      nextRound(run, task, "review-fix");
        continue;
    }

    if (task.step === "escalate") {
      resetTo(task.worktree, task.base!);
      task.escalated = true;
      task.round = 0;
      task.next = "initial";
      task.sessionId = undefined;
      task.sessionModel = undefined;
      task.progress = newHistory();
      task.step = "agent";
      saveState(state);
      log.emit("task.escalated", { task: task.id, reason: task.escalationReason });
      continue;
    }

    if (task.step === "merge") {
      commitAll(task.worktree, `neuromesh: ${task.title}`, task.prepared);
      const merged = mergeBranch(state.worktree, task.branch, `neuromesh: merge task ${task.id} (${task.title})`);
      if (merged === "conflict") {
        task.conflicts += 1;
        task.previousDiff = diffOf(task);
        log.emit("task.conflict", { task: task.id, conflicts: task.conflicts });
        removeWorktree(state.repo, task.worktree, task.branch);
        if (task.conflicts > MAX_CONFLICTS) return failTask(run, task, "its change kept conflicting with other tasks", { keepWork: false });
        task.step = "start";
        task.next = "redo";
        task.sessionId = undefined;
        task.round += 1;
        saveState(state);
        continue;
      }
      removeWorktree(state.repo, task.worktree, task.branch);
      task.status = "passed";
      task.step = "done";
      saveState(state);
      log.emit("task.merged", { task: task.id, title: task.title, escalated: task.escalated });
      return undefined;
    }

    if (task.step === "done") return undefined;
  }
  return undefined;
}

function nextRound(run: RunCtx, task: TaskState, next: "repair" | "review-fix"): void {
  task.round += 1;
  task.next = next;
  task.step = "agent";
  saveState(run.state);
  run.log.emit("repair.started", { task: task.id, round: task.round, kind: next });
}

/**
 * Give up on a task. Its work so far is still merged when possible, so the
 * user can look at it; the run reports the task as failed. With `stop`, the
 * agent itself failed and the run ends as failed rather than finished.
 */
function failTask(run: RunCtx, task: TaskState, reason: string, options: { keepWork?: boolean; stop?: boolean } = {}): Stop | undefined {
  const { state, log } = run;
  task.error = reason;
  if (options.keepWork !== false && task.base) {
    try {
      commitAll(task.worktree, `neuromesh (failed): ${task.title}`, task.prepared);
      mergeBranch(state.worktree, task.branch, `neuromesh: merge failed task ${task.id}`);
    } catch {
      // Keeping the work is a courtesy; failing to do so changes nothing else.
    }
  }
  removeWorktree(state.repo, task.worktree, task.branch);
  task.status = "failed";
  task.step = "done";
  saveState(state);
  log.emit("task.failed", { task: task.id, reason });
  return options.stop ? { status: "failed", reason, failure: "agent" } : undefined;
}

function diffOf(task: TaskState): string {
  if (!task.base) return "";
  try {
    return snapshot(task.worktree, task.base, task.prepared).patch;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// After the last task: check everything together, and let the expert fix the seams.

async function finalStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  if (state.tasks.length === 1) {
    state.latest = state.tasks[0]?.latest ?? [];
    return undefined;
  }
  let results = await check(run, state.worktree, "final");
  if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
  log.emit("checks.finished", { phase: "final", results: brief(results) });
  const failing = (): CheckResult[] => results.filter((r) => r.status === "failed" || r.status === "timeout");
  const allPassed = state.tasks.every((t) => t.status === "passed");
  if (failing().length > 0 && allPassed && state.integrationFixes < 1 && canEscalate(state)) {
    state.integrationFixes += 1;
    saveState(state);
    log.emit("integration.fix", { failing: failing().map((r) => r.name) });
    const { result } = await turn(run, {
      key: "integration",
      role: "escalation",
      kind: "integration",
      round: 0,
      cwd: state.worktree,
      prompt: integrationPrompt(state, failing()),
      access: "write",
      schema: REPORT_SCHEMA,
    });
    if (result.stop === "cancelled" || result.stop === "quota") return stopFor(result, "escalation");
    commitAll(state.worktree, "neuromesh: integration fix", state.prepared);
    results = await check(run, state.worktree, "final-fixed");
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    log.emit("checks.finished", { phase: "final", results: brief(results) });
  }
  state.latest = results;
  saveState(state);
  return undefined;
}

// ---------------------------------------------------------------------------
// Usage accounting.

export interface ModelUsage {
  backend: string;
  model: string;
  tier: Tier;
  roles: Role[];
  turns: number;
  durationMs: number;
  usage: Usage;
  costUsdEquivalent?: number;
}

export function usageByModel(attempts: AttemptRecord[]): ModelUsage[] {
  const byKey = new Map<string, ModelUsage>();
  for (const a of attempts) {
    const model = a.model ?? "default";
    const tier = a.tier ?? "worker";
    const key = `${a.backend}/${model}/${tier}`;
    const entry = byKey.get(key) ?? { backend: a.backend, model, tier, roles: [], turns: 0, durationMs: 0, usage: {} };
    entry.turns += 1;
    entry.durationMs += a.durationMs;
    entry.usage = addUsage(entry.usage, a.usage);
    const role = a.role ?? "worker";
    if (!entry.roles.includes(role)) entry.roles.push(role);
    if (a.costUsdEquivalent !== undefined) entry.costUsdEquivalent = (entry.costUsdEquivalent ?? 0) + a.costUsdEquivalent;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Process helpers.

function commandOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Is this process still a Neuromesh engine (and not some unrelated process that reused the id)? */
function engineAlive(pid: number): boolean {
  return /neuromesh|main\.ts/.test(commandOf(pid) ?? "");
}

const BACKEND_COMMANDS: Record<string, RegExp> = {
  agy: /\bagy\b|antigravity|jetski/i,
  claude: /\bclaude\b/i,
  codex: /\bcodex\b/i,
};

/** Stop an agent tool's process group, but only if that process is still the tool. */
function stopOrphan(pid: number, backend: string | undefined): boolean {
  const command = commandOf(pid);
  const pattern = backend ? BACKEND_COMMANDS[backend] : undefined;
  if (!command || (pattern && !pattern.test(command))) return false;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  }
  return true;
}
