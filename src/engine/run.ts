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

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend, AgentResult, Usage } from "../backends/types.ts";
import { addUsage, usageSince } from "../backends/types.ts";
import { detectChecks, runChecks } from "../checks/checks.ts";
import { hasTmux, screenCheck, screenText } from "../checks/screen.ts";
import { runAcceptance, verifyFindings } from "../checks/acceptance.ts";
import { ensureEnv, envNote, envVars, environmentTrouble, missingModule } from "./env.ts";
import { observedText } from "./observed.ts";
import type { CheckResult } from "../checks/checks.ts";
import { FeatureError, activeKeys, disable, feature, hint, inFeature, isOn, onlyThese, resetFeatures } from "../features.ts";
import { buildPacket } from "../context/packet.ts";
import { estimateCost } from "../usage/prices.ts";
import { buildBrief, detectRuntimes, renderBrief, repoFacts } from "../intake/brief.ts";
import type { Brief } from "../intake/brief.ts";
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
  ADVICE_SCHEMA,
  climbPrompt,
  advisedFixPrompt,
  advisePrompt,
  continuePrompt,
  freshAdvisedFixPrompt,
  parseAdvice,
  escalationPrompt,
  envRepairPrompt,
  FACTS_SCHEMA,
  fixInPlacePrompt,
  parseFacts,
  scoutPrompt,
  patchPrompt,
  failureSummary,
  freshFollowUpPrompt,
  integrationPrompt,
  parsePlan,
  parseReport,
  parseSpec,
  parseVerdict,
  PLAN_SCHEMA,
  plannerPrompt,
  SPEC_SCHEMA,
  specPrompt,
  redoPrompt,
  repairPrompt,
  REPORT_SCHEMA,
  reviewFixPrompt,
  taskPrompt,
  testerPrompt,
  VERDICT_SCHEMA,
} from "./prompts.ts";
import { currentPatch } from "./apply.ts";
import { EventLog, newRunId, runPaths, runsDir, saveState } from "./store.ts";
import type { NeuromeshEvent } from "./store.ts";
import type { AttemptKind, AttemptRecord, PlannedTask, Role, RoleConfig, RunState, TaskState, Tier, Verdict } from "./types.ts";

export interface EngineContext {
  home: string;
  backends: Record<string, AgentBackend>;
  signal?: AbortSignal;
  onEvent?: (event: NeuromeshEvent) => void;
  /** Overrides the preset's turn time limit (tests use this). */
  turnTimeoutMs?: number;
  checkTimeoutMs?: number;
  /**
   * [F39 ask-first] Ask the person running Neuromesh. Only a caller that can
   * answer (the TUI in Normal mode) gives this; without it the run never stops
   * to ask.
   */
  ask?: (question: Question) => Promise<Answer>;
  /** [F42 compact] Set `compact` to have the next follow-up turn start a fresh session. */
  steer?: { compact?: boolean };
}

/** [F39 ask-first] What the run may stop to ask. */
export type Question =
  | { kind: "plan"; summary: string; tasks: { id: string; title: string; owner: string }[]; model?: string }
  | { kind: "expert"; task: string; title: string; reason: string; step: "advise" | "escalate" };

export interface Answer {
  ok: boolean;
  /** With ok false: what to change (a plan is revised with it); empty means stop. */
  note?: string;
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
  /** Override the preset's expert token budget. */
  expertBudget?: number;
  /** [F38 attachments] Files from anywhere that go with the request; `text` for text files. */
  attachments?: { path: string; text?: string }[];
  /** [F49 follow-up] The run this one follows in the same session: it starts from that run's result. */
  follows?: RunState;
}

/**
 * [F49 follow-up] Where a follow-up starts: the earlier run's changes on top of
 * its base, committed in a scratch checkout. The diff stays measured from the
 * session's base, so applying the follow-up brings the whole session's work;
 * after an applied run (its changes are already in the repository) it is
 * measured from the new start, so only the new work is applied.
 */
function followFrom(repoRoot: string, head: string, prev: RunState, dir: string): { base: string; start: string; session: string; context: string } {
  const patch = prev.status === "discarded" ? "" : currentPatch(prev);
  let start = prev.status === "applied" && head !== prev.base ? head : prev.base;
  if (patch.trim() && start === prev.base) {
    const scratch = join(dir, "start");
    createDetachedWorktree(repoRoot, scratch, prev.base);
    try {
      const file = join(dir, "previous.patch");
      writeFileSync(file, patch.endsWith("\n") ? patch : `${patch}\n`);
      git(scratch, "apply", "--binary", "--whitespace=nowarn", file);
      start = commitAll(scratch, `neuromesh: earlier in session ${prev.session ?? prev.id}`, prev.prepared);
    } finally {
      removeDetachedWorktree(repoRoot, scratch);
    }
  }
  const reports = (prev.tasks ?? []).map((t) => t.report?.summary?.trim()).filter((r): r is string => Boolean(r));
  const asked = (prev.request ?? prev.prompt).trim().slice(0, 1_500);
  const told = reports.join("\n\n").slice(0, 2_500);
  const where = prev.status === "applied" ? "and its changes are in the repository" : prev.status === "discarded" ? "and its changes were thrown away" : "and its changes are already in your working copy";
  const context = [
    "Earlier in this session (this is a follow-up; build on it rather than starting again):",
    `- Asked: ${asked}`,
    `- That run ${prev.status === "finished" ? "finished" : prev.status}, ${where}.`,
    ...(told ? [`- What the agents reported:\n${told}`] : []),
  ].join("\n");
  return { base: prev.status === "applied" ? start : prev.base, start, session: prev.session ?? prev.id, context };
}

/** How a task or a turn ended, when it ends the whole run early. */
type Stop = { status: "paused" | "interrupted" | "failed"; reason: string; failure?: "agent" | "engine" };

const ESCALATION_REPAIRS = 1;
/** [F56 env-blocked] Turns a worker gets to fix an environment problem (declaring a package) before the run stops. */
const ENV_REPAIRS = 2;
/** [F60 no-rebuild] Why an expert turn was stopped part way. */
const BUDGET_CUT = "stopped: the expert budget was reached during this turn";
/** A tool that prints nothing for this long has stalled; the turn is stopped and retried once. */
const IDLE_MS = 10 * 60_000;
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
  let brief: Brief | undefined;
  resetFeatures();
  disable(preset.disable);
  const featureErrors: NonNullable<RunState["featureErrors"]> = [];
  // [F01 brief-engine] Optional: if it fails, the run goes on with the request as typed.
  if (preset.brief && isOn("brief-engine")) {
    try {
      brief = inFeature("brief-engine", () =>
        buildBrief(options.prompt, repoFacts(repo.root), {
          team: preset.mode === "team" && options.mode !== "solo",
          maxParallel: preset.maxParallel,
          canSpec: roles.briefer !== undefined && isOn("spec-step"),
          // [F03 expert-spec]
          expertSpec: roles.briefer?.[0]?.tier === "expert" && isOn("expert-spec"),
        }),
      );
    } catch (error) {
      featureErrors.push(failure(error, "brief-engine"));
      disable("brief-engine");
    }
  }
  // [F49 follow-up] A follow-up starts from the earlier run's result and knows what it did.
  let follow: ReturnType<typeof followFrom> | undefined;
  if (options.follows && isOn("follow-up")) {
    try {
      follow = inFeature("follow-up", () => followFrom(repo.root, repo.head, options.follows!, dir));
    } catch (error) {
      featureErrors.push(failure(error, "follow-up"));
      disable("follow-up");
    }
  }
  // [F38 attachments] Text files are added to the brief like documents the request names; others by path.
  const attachedNote: string[] = [];
  if (options.attachments?.length && isOn("attachments")) {
    try {
      inFeature("attachments", () => {
        for (const a of options.attachments ?? []) {
          if (a.text !== undefined && brief && !brief.attached.some((b) => b.path === a.path)) brief.attached.push({ path: a.path, text: a.text });
          else if (a.text !== undefined && !brief) attachedNote.push(`The file ${a.path}, attached to the request:\n--- ${a.path} ---\n${a.text}\n--- end of ${a.path} ---`);
          else if (a.text === undefined) attachedNote.push(`Attached to the request (read it from there): ${a.path}`);
        }
      });
    } catch (error) {
      featureErrors.push(failure(error, "attachments"));
      disable("attachments");
    }
  }
  if (brief) {
    if (options.mode === "team") brief.staffing.plan = true;
    mode = brief.staffing.plan ? "team" : "solo";
    why = brief.staffing.reasons.join("; ");
  } else if (!options.mode && preset.mode === "team" && preset.intake) {
    const decision = route(options.prompt, preset.routing);
    mode = decision.mode;
    why = decision.reason;
  }

  const state: RunState = {
    version: 2,
    id,
    dir,
    repo: repo.root,
    prompt: [brief ? renderBrief(brief) : options.prompt, ...attachedNote, ...(follow ? [follow.context] : [])].join("\n\n"),
    session: follow?.session,
    follows: follow ? options.follows!.id : undefined,
    start: follow?.start,
    request: brief ? options.prompt : undefined,
    usagePerTurn: true,
    features: activeKeys(),
    featureErrors,
    brief,
    preset: preset.name,
    mode,
    roles,
    repairs: options.repairs ?? preset.repairs,
    maxTasks: preset.maxTasks,
    maxParallel: brief && !brief.staffing.plan ? 1 : preset.maxParallel,
    advise: preset.advise ?? true,
    expertBudget: options.expertBudget ?? preset.expertBudget,
    expertBudgetUsd: preset.expertBudgetUsd,
    test: preset.test ?? "always",
    // An explicitly chosen worker model replaces the ladder.
    workerLadder: Object.keys(override).length > 0 ? undefined : preset.workerLadder,
    turnTimeoutMs: ctx.turnTimeoutMs ?? preset.turnTimeoutMinutes * 60_000,
    base: follow?.base ?? repo.head,
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
  for (const f of featureErrors) log.emit("feature.failed", { feature: f.id, key: f.key, message: f.message, hint: hint(feature(f.key)) });
  if (brief) {
    log.emit("brief", { kind: brief.kind, surface: brief.surface, attached: brief.attached.map((a) => a.path), standards: brief.standards.length, staffing: brief.staffing });
  } else if (why) {
    log.emit("route", { mode, reason: why });
  }
  // A follow-up of an applied run sees those changes already; anything else uncommitted it does not.
  if (repo.dirty && !(follow && options.follows?.status === "applied")) {
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
  // A resumed run keeps the features it started with, less any that failed.
  resetFeatures();
  if (state.features) onlyThese(state.features.filter((k) => !(state.featureErrors ?? []).some((e) => e.key === k)));

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
  // The brief engine may start a task on the strongest worker rung.
  const rung = state.brief?.staffing.rung === "top" && state.workerLadder ? state.workerLadder.length - 1 : undefined;
  return {
    rung,
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
        createWorktree(state.repo, state.worktree, state.branch, state.start ?? state.base);
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
        // [F12 context-packet] Map the repository once, for every prompt of the run.
        if (isOn("context-packet") && !state.contextPacket) {
          state.contextPacket = optional(run, "context-packet", undefined, () => buildPacket(state.worktree, state.request ?? state.prompt));
          if (state.contextPacket) log.emit("context.ready", { feature: "F12", chars: state.contextPacket.length });
        }
        state.step = "spec";
        saveState(state);
        continue;
      }

      if (state.step === "spec") {
        // [F02 spec-step]
        if (state.brief?.staffing.spec && !state.brief.spec && isOn("spec-step")) {
          const outcome = await optionalAsync(run, "spec-step", undefined, () => specStep(run));
          if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
        }
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
        if (outcome?.status === "failed" && outcome.failure === "agent") {
          // Planning is a help, not a requirement: a worker takes the whole request,
          // and the expert is still there if it gets stuck.
          log.emit("note", { message: `Planning failed (${outcome.reason.slice(0, 160)}); a worker takes the whole request.` });
          state.mode = "solo";
          state.tasks = [newTask(state, { id: "main", title: "the request", brief: state.prompt, owned: [], dependsOn: [], owner: "worker" })];
        } else if (outcome) {
          // [F39 ask-first] A stop at the plan keeps its own reason.
          return end(outcome);
        }
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
    if (error instanceof FeatureError) {
      // A core feature failed: say which, and how to run without it.
      state.featureErrors = [...(state.featureErrors ?? []), failure(error, error.feature.key)];
      log.emit("feature.failed", { feature: error.feature.id, key: error.feature.key, message, hint: hint(error.feature) });
      return end({ status: "failed", reason: `engine error in ${error.feature.id} ${error.feature.key}: ${message}. ${hint(error.feature)}`, failure: "engine" });
    }
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
  // [F57 hollow-checks] After the baseline, a check that tests nothing is not a
  // pass, unless it already tested nothing before the work started.
  const strict =
    label !== "baseline" && isOn("hollow-checks")
      ? new Set(run.state.checks.map((c) => c.name).filter((n) => !run.state.baseline?.find((b) => b.name === n)?.hollow))
      : undefined;
  return runChecks({
    dir,
    checks: run.state.checks,
    logDir: runPaths(run.state.dir).checkLogs,
    label,
    timeoutMs: run.ctx.checkTimeoutMs,
    signal: run.signal,
    // [F54 work-env]
    env: isOn("work-env") ? envVars(dir) : undefined,
    strict,
  });
}

/** [F54 work-env] Python is meant even before any Python file exists: the request or its spec says so. */
function meansPython(state: RunState): boolean {
  return /\bpython\b|\bpip\b|requirements\.txt|\.py\b/i.test(`${state.request ?? ""}\n${state.prompt}`);
}

/**
 * [F54 work-env] Make or update the work folder's environment. Returns the
 * install failure, if any; the engine's own folders are added to `prepared`
 * so they never reach the diff.
 */
async function prepareEnv(run: RunCtx, dir: string, prepared: string[], task?: string): Promise<string | undefined> {
  if (!isOn("work-env")) return undefined;
  const outcome = await optionalAsync(run, "work-env", undefined, () => ensureEnv(dir, { python: meansPython(run.state), signal: run.signal }));
  if (!outcome) return undefined;
  for (const f of outcome.folders) if (!prepared.includes(f)) prepared.push(f);
  if (outcome.installed.length > 0 || outcome.failed) {
    run.log.emit("env.ready", { feature: "F54", task, folders: outcome.folders, installed: outcome.installed, failed: outcome.failed?.slice(0, 1_500) });
  }
  return outcome.failed;
}

/**
 * [F56 env-blocked] When the checks failed because of the environment (a
 * package that is not installed, an install that failed), what went wrong;
 * undefined when the code is at fault.
 */
function environmentProblem(task: TaskState, results: CheckResult[], installFailed: string | undefined): string | undefined {
  if (installFailed) return `Installing the declared packages failed:\n${installFailed.slice(-1_200)}`;
  for (const r of results) {
    if (r.status !== "failed") continue;
    if (r.hollow && /package is missing/.test(r.hollow)) return r.tail.slice(0, 1_500);
    const missing = missingModule(r.tail);
    // A missing module of the project's own is a code problem (a wrong import), not the environment.
    if (missing && !existsSync(join(task.worktree, missing)) && !existsSync(join(task.worktree, `${missing}.py`)) && !existsSync(join(task.worktree, "src", missing))) {
      return `Check "${r.name}" failed because the module \`${missing}\` is not installed:\n${r.tail.slice(-1_200)}`;
    }
  }
  const report = task.report;
  if (report?.status === "blocked" && environmentTrouble(`${report.summary} ${report.notes ?? ""}`)) {
    return `You reported being blocked by the environment: ${`${report.summary} ${report.notes ?? ""}`.slice(0, 1_000)}`;
  }
  return undefined;
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
  /** Models to try instead of the role's own list (the worker ladder from the task's rung up). */
  chain?: RoleConfig[];
}

interface TurnResult {
  result: AgentResult;
  config?: RoleConfig;
}

const TRANSIENT = /^stalled: |stream was interrupted|^interrupted$|ECONNRESET|socket hang up|ETIMEDOUT|read tcp|connection reset|request failed: Post|\b50[23]\b|UNAVAILABLE|overloaded|temporarily unavailable|internal server error/i;

const UNAVAILABLE =
  /invalid model|not recognized as a known model|not supported when using|issue with the selected model|model .*(not found|unavailable|does not exist)|no longer (available|supported)|does not have access to (the )?model/i;

export function roleChain(state: RunState, role: Role): RoleConfig[] {
  const chain = state.roles[role] ?? (role === "escalation" ? state.roles.orchestrator : undefined) ?? [];
  return chain.filter((c) => !state.exhausted.includes(modelKey(c)));
}

function tierOf(role: Role, c: RoleConfig): Tier {
  return c.tier ?? (role === "orchestrator" || role === "escalation" ? "expert" : "worker");
}

function budgetLeft(state: RunState): boolean {
  return (state.expertBudget === undefined || expertSpend(state) < state.expertBudget) && dollarsLeft(state);
}

/** [F16 dollar-budget] Estimated expert spending so far, in US dollars at API list prices. */
export function expertDollars(state: RunState): number {
  return state.attempts.filter((a) => a.tier === "expert").reduce((n, a) => n + (estimateCost(a.model, a.usage) ?? 0), 0);
}

function dollarsLeft(state: RunState): boolean {
  return !isOn("dollar-budget") || state.expertBudgetUsd === undefined || expertDollars(state) < state.expertBudgetUsd;
}

/** Expert tokens that count against the budget: fresh input, cache writes and output. */
export function expertSpend(state: RunState): number {
  return state.attempts
    .filter((a) => a.tier === "expert")
    .reduce((n, a) => n + (a.usage.input ?? 0) + (a.usage.cacheWrite ?? 0) + (a.usage.output ?? 0), 0);
}

async function turn(run: RunCtx, req: TurnRequest): Promise<TurnResult> {
  const { state, ctx, log } = run;
  if ((req.role === "orchestrator" || req.role === "escalation") && state.expertBudget !== undefined) {
    const spent = expertSpend(state);
    if (spent >= state.expertBudget) {
      log.emit("note", { message: `Expert budget reached (${spent.toLocaleString("en-US")} of ${state.expertBudget.toLocaleString("en-US")} tokens); no more ${req.role === "orchestrator" ? "planning" : "expert help"} in this run.` });
      return { result: emptyResult("error", "expert budget reached") };
    }
  }
  if ((req.role === "orchestrator" || req.role === "escalation") && !dollarsLeft(state)) {
    log.emit("note", { feature: "F16", message: `Expert budget reached ($${expertDollars(state).toFixed(2)} of $${state.expertBudgetUsd!.toFixed(2)}, estimated); no more ${req.role === "orchestrator" ? "planning" : "expert help"} in this run.` });
    return { result: emptyResult("error", "expert budget reached") };
  }
  let last: AgentResult | undefined;
  let lastConfig: RoleConfig | undefined;
  const candidates = (): RoleConfig[] =>
    req.chain ? req.chain.filter((c) => !state.exhausted.includes(modelKey(c))) : roleChain(state, req.role);
  while (true) {
    const config = candidates()[0];
    if (!config) {
      const detail = last?.detail ?? `no ${req.role} model is configured`;
      return { result: last ?? emptyResult("quota", detail), config: lastConfig };
    }
    const backend = ctx.backends[config.backend];
    if (!backend) throw new Error(`unknown backend "${config.backend}"`);
    let sameSession = req.resume?.sessionId !== undefined && req.resume.model === modelKey(config);
    // [F42 compact] Asked to compact: this follow-up starts a fresh session from the brief and the last report.
    if (sameSession && ctx.steer?.compact && isOn("compact") && req.freshPrompt) {
      ctx.steer.compact = false;
      sameSession = false;
      log.emit("context.compacted", { feature: "F42", role: req.role, task: req.task });
    }
    const prompt = sameSession ? req.prompt : (req.freshPrompt ?? req.prompt);
    let result = await once(run, req, config, backend, prompt, sameSession ? req.resume?.sessionId : undefined);

    // A dropped connection or an overloaded service: try the same turn once more.
    if (result.stop === "error" && result.detail !== BUDGET_CUT && TRANSIENT.test(result.detail ?? "") && !run.signal.aborted) {
      log.emit("note", { message: `The ${req.role}'s connection failed (${(result.detail ?? "").slice(0, 80)}); trying once more.` });
      result = await once(run, req, config, backend, prompt, sameSession ? req.resume?.sessionId : undefined);
    }

    // Resuming a session can fail (an expired or unknown id): one fresh try.
    if (sameSession && result.stop === "error" && result.detail !== BUDGET_CUT && !UNAVAILABLE.test(result.detail ?? "") && !run.signal.aborted) {
      log.emit("note", { message: "Could not continue the agent's session; starting a fresh one." });
      result = await once(run, req, config, backend, req.freshPrompt ?? req.prompt, undefined);
    }

    const unavailable = (result.stop === "error" || result.stop === "auth") && UNAVAILABLE.test(result.detail ?? "");
    if (result.stop === "quota" || unavailable) {
      if (!state.exhausted.includes(modelKey(config))) state.exhausted.push(modelKey(config));
      recordCooldown(ctx.home, modelKey(config), unavailable ? `not available: ${result.detail ?? ""}` : (result.detail ?? "quota"));
      saveState(state);
      const next = candidates()[0];
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
  // [F41 tui-context] What the prompt is made of, for the context view.
  const contextChars = state.contextPacket && prompt.includes(state.contextPacket) ? state.contextPacket.length : 0;
  log.emit("agent.started", { task: req.task, role: req.role, kind: req.kind, tier, backend: backend.id, model: config.model, resumed: Boolean(resumeSessionId), effort: config.effort, promptChars: prompt.length, contextChars });

  // [F60 no-rebuild] An expert turn is stopped once the run's expert spending passes the budget.
  const turnStop = new AbortController();
  let cut = false;
  const watch = tier === "expert" && isOn("no-rebuild") && isOn("dollar-budget") && state.expertBudgetUsd !== undefined;
  const spentBefore = watch ? expertDollars(state) : 0;
  let result = await backend.run({
    cwd: req.cwd,
    prompt,
    model: config.model,
    effort: config.effort,
    access: req.access,
    // [F54 work-env]
    env: isOn("work-env") && req.access === "write" ? envVars(req.cwd) : undefined,
    // [F55 worker-network] New programs (their packages, their real data), and the scout.
    network: req.access === "write" && ((isOn("worker-network") && state.brief?.kind === "greenfield") || (req.kind === "scout" && isOn("scout-facts"))),
    onUsage: watch
      ? (u) => {
          if (cut || spentBefore + (estimateCost(config.model, u) ?? 0) < state.expertBudgetUsd!) return;
          cut = true;
          log.emit("note", { feature: "F60", message: `Expert budget reached during the ${req.role}'s turn (about $${(spentBefore + (estimateCost(config.model, u) ?? 0)).toFixed(2)} of $${state.expertBudgetUsd!.toFixed(2)}, estimated); stopping it.` });
          turnStop.abort();
        }
      : undefined,
    // [F53 write-sandbox] A writing turn may write in its own copy and git's shared objects; a reading turn nowhere of ours.
    writable: isOn("write-sandbox") ? (req.access === "write" ? [req.cwd, join(state.repo, ".git", "worktrees"), join(state.repo, ".git", "objects")] : []) : undefined,
    outputSchema: req.schema,
    resumeSessionId,
    timeoutMs: state.turnTimeoutMs,
    idleMs: IDLE_MS,
    logPath,
    signal: AbortSignal.any([run.signal, turnStop.signal]),
    onActivity: (a) => log.emit("agent.activity", { task: req.task, role: req.role, activity: a.kind, summary: a.summary }),
    onSpawn: (pid) => {
      const f = state.inFlight[req.key];
      if (f) f.pid = pid;
      saveState(state);
    },
  });

  if (cut && !run.signal.aborted) result = { ...result, stop: "error", detail: BUDGET_CUT };
  delete state.inFlight[req.key];
  const usage =
    // [F09 codex-session-totals]
    backend.sessionTotals && isOn("codex-session-totals") && resumeSessionId !== undefined && result.sessionId === resumeSessionId
      ? usageSince(
          result.usage,
          state.attempts.filter((a) => a.sessionId === resumeSessionId && a.backend === backend.id).map((a) => a.usage),
        )
      : result.usage;
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
    usage,
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
    usage,
    // [F17 live-cost]
    // An estimate at list prices; for models without one (opencode's), what the tool reported.
    cost: isOn("live-cost") ? (estimateCost(record.model, usage) ?? (backend.id === "opencode" ? result.costUsdEquivalent : undefined)) : undefined,
    tier,
    detail: result.detail,
    quotaUsed: result.quotaUsed,
    // [F43 quota-windows]
    quotaResets: isOn("quota-windows") ? result.quotaResets : undefined,
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

/**
 * A request too thin to build from gets a product spec from a cheap model. The
 * spec is a help, not a requirement: when the turn fails, the work goes on from
 * the brief as it is. Only a pause or an interruption stops the run.
 */
async function specStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const brief = state.brief!;
  // [F63 scout-facts] Only where an expert writes the spec: its judgement is worth grounding.
  if (isOn("scout-facts") && state.facts === undefined && brief.kind === "greenfield" && state.roles.briefer?.[0]?.tier === "expert") {
    state.facts = await optionalAsync(run, "scout-facts", [] as string[], () => scoutStep(run));
    saveState(state);
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped by the user" };
  }
  const { result, config } = await turn(run, {
    key: "spec",
    role: "briefer",
    kind: "spec",
    round: 0,
    cwd: state.worktree,
    prompt: specPrompt(brief.request, renderBrief(brief), state.facts),
    access: "read-only",
    schema: SPEC_SCHEMA,
  });
  if (result.stop === "quota" || result.stop === "cancelled") return stopFor(result, "briefer");
  const spec = result.stop === "done" ? parseSpec(result) : undefined;
  if (!spec) {
    log.emit("note", { message: "No usable product spec came back; the work goes on from the request as it is." });
    brief.staffing.spec = false;
    saveState(state);
    return undefined;
  }
  brief.spec = spec;
  state.prompt = renderBrief(brief);
  saveState(state);
  log.emit("spec.ready", { model: config ? modelKey(config) : undefined, name: spec.name, features: spec.features.length, behaviour: spec.behaviour.length });
  return undefined;
}

/**
 * For a full-screen terminal program: run it in tmux and record its screens for
 * the tester. Skipped when tmux is missing or there is no way to start it.
 */
function screensFor(run: RunCtx, task: TaskState, dir: string): string | undefined {
  // [F04 screen-check]
  if (!isOn("screen-check") || !hasTmux()) return undefined;
  return optional(run, "screen-check", undefined, () => screensNow(run, task, dir));
}

function screensNow(run: RunCtx, task: TaskState, dir: string): string | undefined {
  const command = task.report?.run ?? startScript(dir);
  if (!command) {
    run.log.emit("note", { message: `Task ${task.id}: no command to start the program, so its screens were not checked.` });
    return undefined;
  }
  const check = screenCheck(dir, command);
  run.log.emit("screens.checked", { feature: "F04", task: task.id, command, screens: check.screens.length, stuck: check.stuck });
  return screenText(check);
}

function startScript(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    return pkg.scripts?.start ? "npm start --silent" : undefined;
  } catch {
    return undefined;
  }
}

/** [F61 advice-facts] What the task's worker saw fail, for the expert. */
function observedFor(state: RunState, task: TaskState): string | undefined {
  if (!isOn("advice-facts")) return undefined;
  const logs = state.attempts.filter((a) => a.task === task.id && a.role === "worker" && a.logPath).slice(-3).map((a) => a.logPath!);
  return inFeature("advice-facts", () => observedText(logs, task.report)) || undefined;
}

/** [F58 acceptance-runs] Run the spec's acceptance runs in the reviewer's copy; the evidence for its prompt. */
async function acceptanceFor(run: RunCtx, task: TaskState, dir: string): Promise<string | undefined> {
  const runs = run.state.brief?.spec?.acceptance ?? [];
  if (!isOn("acceptance-runs") || runs.length === 0) return undefined;
  return optionalAsync(run, "acceptance-runs", undefined, async () => {
    const outcome = await runAcceptance(dir, runs, { env: isOn("work-env") ? envVars(dir) : undefined, signal: run.signal });
    run.log.emit("acceptance.ran", {
      feature: "F58",
      task: task.id,
      runs: outcome.results.map((r) => ({ command: r.command, exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs })),
      files: outcome.files.length,
    });
    return outcome.text;
  });
}

/**
 * [F59 reproduced-findings] Keep the blockers the engine can show. A blocker
 * whose check exits 0 is dropped; one without a check is kept as minor (it can
 * be fixed, but it never calls the expert in), except for a terminal program,
 * whose findings rest on the recorded screens.
 */
async function checkFindings(run: RunCtx, task: TaskState, dir: string, verdict: Verdict, screens: boolean): Promise<Verdict> {
  return optionalAsync(run, "reproduced-findings", verdict, async () => {
    // The tester's edits to the project's files are undone; files it or the acceptance runs created stay.
    spawnSync("git", ["checkout", "-q", "--", "."], { cwd: dir });
    const { kept, dropped } = await verifyFindings(dir, verdict.findings, { env: isOn("work-env") ? envVars(dir) : undefined, signal: run.signal });
    const findings = kept.map((f) => (f.severity !== "minor" && !f.verified && !screens ? { ...f, severity: "minor" as const } : f));
    run.log.emit("findings.checked", {
      feature: "F59",
      task: task.id,
      shown: kept.filter((f) => f.verified).length,
      unchecked: kept.filter((f) => f.severity !== "minor" && !f.verified).length + findings.filter((f, i) => f.severity === "minor" && kept[i]!.severity !== "minor").length,
      dropped: dropped.map((d) => ({ problem: d.problem.slice(0, 200), check: d.check })),
    });
    if (findings.length === 0) return { verdict: "pass", summary: `${verdict.summary} (no finding could be shown)`, findings };
    return { ...verdict, findings };
  });
}

/** [F63 scout-facts] A cheap turn checks the machine and the real data before the expert writes the spec. */
async function scoutStep(run: RunCtx): Promise<string[]> {
  const { state, log } = run;
  const dir = join(state.dir, "scout");
  mkdirSync(dir, { recursive: true });
  const machine = [
    ...detectRuntimes().map((r) => `installed: ${r}`),
    spawnSync("uv", ["--version"]).status === 0 ? "uv is installed" : "uv is not installed",
    isOn("work-env") ? "Neuromesh installs the packages a project declares into an environment it manages, so the system Python's restrictions on pip do not matter" : "",
  ].filter(Boolean);
  const first = state.workerLadder?.[0] ?? state.roles.worker?.[0];
  const { result } = await turn(run, {
    key: "scout",
    role: "worker",
    kind: "scout",
    round: 0,
    cwd: dir,
    prompt: scoutPrompt(state.brief!.request, machine),
    access: "write",
    schema: FACTS_SCHEMA,
    chain: first ? [first] : undefined,
  });
  const facts = result.stop === "done" ? parseFacts(result) : [];
  log.emit("facts.ready", { feature: "F63", facts });
  return facts;
}

async function planStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const files = git(state.worktree, "ls-files").split("\n").filter(Boolean);
  const first = plannerPrompt(state, files);
  let prompt = first;
  let resume: TurnRequest["resume"];
  let revisions = 0;
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
      // [F39 ask-first] The person approves the plan, asks for changes, or stops here.
      const answer = await askUser(run, { kind: "plan", summary: plan.summary, tasks: plan.tasks.map((t) => ({ id: t.id, title: t.title, owner: t.owner })), model: config ? modelKey(config) : undefined });
      if (answer.ok) return undefined;
      if (!answer.note?.trim() || revisions >= 3) return { status: "interrupted", reason: "stopped at the plan, as asked" };
      revisions += 1;
      prompt = `The person running this asked for changes to your plan: ${answer.note.trim()}\nGive the revised plan in the same JSON format.`;
      resume = { sessionId: result.sessionId, model: config ? modelKey(config) : undefined };
      attempt = -1;
      continue;
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

/** The tester costs a full agent session; with test "no-checks" it only runs where nothing else verifies the work. */
function wantsTester(state: RunState, task: TaskState): boolean {
  if (!state.roles.tester || task.escalated) return false;
  if (state.brief && !state.brief.staffing.tester) return false;
  return state.test !== "no-checks" || state.checks.length === 0;
}

function failure(error: unknown, key: string): { id: string; key: string; message: string; at: string } {
  const f = error instanceof FeatureError ? error.feature : feature(key);
  const message = error instanceof Error ? error.message : String(error);
  return { id: f.id, key: f.key, message, at: new Date().toISOString() };
}

/**
 * Run an optional feature. If it throws, the failure is recorded on the run,
 * the feature is switched off for the rest of the run, and `fallback` is used.
 */
function optional<T>(run: RunCtx, key: string, fallback: T, fn: () => T): T {
  try {
    return inFeature(key, fn);
  } catch (error) {
    featureFailed(run, error, key);
    return fallback;
  }
}

/** [F39 ask-first] Ask the person, when the caller can answer; otherwise go ahead. */
async function askUser(run: RunCtx, question: Question): Promise<Answer> {
  const ask = run.ctx.ask;
  if (!ask || !isOn("ask-first") || run.signal.aborted) return { ok: true };
  run.log.emit("ask", { feature: "F39", question });
  const answer = await optionalAsync(run, "ask-first", { ok: true } as Answer, () =>
    new Promise<Answer>((resolve, reject) => {
      const stop = (): void => resolve({ ok: false });
      run.signal.addEventListener("abort", stop, { once: true });
      ask(question).then(
        (a) => (run.signal.removeEventListener("abort", stop), resolve(a)),
        (e: unknown) => (run.signal.removeEventListener("abort", stop), reject(e)),
      );
    }),
  );
  run.log.emit("answer", { feature: "F39", kind: question.kind, ok: answer.ok, note: answer.note });
  return answer;
}

async function optionalAsync<T>(run: RunCtx, key: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await inFeature(key, fn);
  } catch (error) {
    featureFailed(run, error, key);
    return fallback;
  }
}

function featureFailed(run: RunCtx, error: unknown, key: string): void {
  const f = failure(error, key);
  run.state.featureErrors = [...(run.state.featureErrors ?? []), f];
  disable(key);
  run.log.emit("feature.failed", { feature: f.id, key: f.key, message: f.message, hint: hint(feature(key)) });
  saveState(run.state);
}

/** The task's latest checks all passed (or the project has none). */
function checksPass(task: TaskState): boolean {
  return (task.latest ?? []).every((r) => r.status !== "failed" && r.status !== "timeout");
}

function canClimb(state: RunState, task: TaskState): boolean {
  return state.workerLadder !== undefined && !task.escalated && !task.advised && task.owner !== "expert" && (task.rung ?? 0) < state.workerLadder.length - 1;
}

/**
 * A stuck worker climbs the ladder first (same work, a stronger rung, a fresh
 * session told exactly what went wrong). Only from the top rung does the
 * expert get involved: advice first, takeover second.
 */
function onStuck(run: RunCtx, task: TaskState, reason: string): void {
  const { state, log } = run;
  if (canClimb(state, task)) {
    const ladder = state.workerLadder!;
    const from = ladder[task.rung ?? 0]!;
    task.rung = (task.rung ?? 0) + 1;
    const to = ladder[task.rung]!;
    task.round = 0;
    task.progress = newHistory();
    task.next = "climb";
    task.sessionId = undefined;
    task.sessionModel = undefined;
    task.step = "agent";
    saveState(state);
    log.emit("task.climbed", { task: task.id, from: modelKey(from), to: modelKey(to), reason });
    return;
  }
  task.escalationReason = reason;
  task.step = nextEscalation(state, task);
  saveState(state);
}

/** Advice first, takeover second. */
function nextEscalation(state: RunState, task: TaskState): "advise" | "escalate" {
  return state.advise && !task.advised && task.owner !== "expert" ? "advise" : "escalate";
}

/** Worker turns allowed after the first: the repairs, plus one for following the expert's advice. */
function repairLimit(state: RunState, task: TaskState): number {
  return state.repairs + (task.advised ? 1 : 0);
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
      // [F54 work-env] Before the first turn, so the worker can run what it writes.
      await prepareEnv(run, task.worktree, task.prepared, task.id);
      task.step = "agent";
      saveState(state);
      log.emit("task.started", { task: task.id, title: task.title, owner: task.owner, owned: task.owned });
      continue;
    }

    if (task.step === "agent") {
      const role = roleFor(state, task);
      const kind: AttemptKind = task.escalated && task.next === "initial" ? "escalation" : task.next;
      const followUp = task.next === "repair" || task.next === "review-fix" || task.next === "advised-fix";
      // [F54 work-env] Every first prompt of a session says how to use the environment.
      const env = isOn("work-env") ? envNote(task.worktree) : "";
      const prompt =
        task.next === "climb" ? climbPrompt(state, task) + env
        : task.next === "advised-fix" ? advisedFixPrompt(task)
        // [F56 env-blocked]
        : task.next === "repair" && task.envProblem ? envRepairPrompt(task)
        : task.next === "repair" ? repairPrompt(state, task)
        : task.next === "review-fix" ? reviewFixPrompt(task)
        : task.next === "redo" ? redoPrompt(state, task) + env
        : task.next === "continue" ? continuePrompt(state, task) + env
        : task.escalated ? (task.patch ? patchPrompt(state, task) : isOn("no-rebuild") ? fixInPlacePrompt(state, task, observedFor(state, task)) : escalationPrompt(state, task)) + env
        : taskPrompt(state, task) + env;
      const { result, config } = await turn(run, {
        key: task.id,
        role,
        kind,
        task: task.id,
        round: task.round,
        cwd: task.worktree,
        prompt,
        freshPrompt: (task.next === "advised-fix" ? freshAdvisedFixPrompt(state, task) : followUp ? freshFollowUpPrompt(state, task) : prompt) + (followUp ? env : ""),
        access: "write",
        schema: REPORT_SCHEMA,
        resume: followUp ? { sessionId: task.sessionId, model: task.sessionModel } : undefined,
        chain: role === "worker" && state.workerLadder ? state.workerLadder.slice(task.rung ?? 0) : undefined,
      });
      task.envProblem = undefined;
      // [F60 no-rebuild] The expert's turn was stopped at the budget: its work so far stays, and the checks decide.
      if (result.detail === BUDGET_CUT && task.escalated) {
        log.emit("note", { feature: "F60", message: `Task ${task.id}: the expert's turn was stopped at the expert budget; its changes are kept and checked.` });
        task.step = "checks";
        saveState(state);
        continue;
      }
      if (result.stop === "done") {
        task.report = parseReport(result);
        // [F44 task-report]
        if (isOn("task-report")) log.emit("task.report", { feature: "F44", task: task.id, role, status: task.report.status, summary: task.report.summary.slice(0, 8_000), notes: task.report.notes?.slice(0, 4_000) });
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
      // [F60 no-rebuild] No expert budget left for this task: keep the work, without failing the run.
      if (task.escalated && isOn("no-rebuild") && result.detail === "expert budget reached") {
        return failTask(run, task, "the expert budget is spent");
      }
      // The agent failed outright (refused, timed out, crashed): the expert takes over.
      task.history.push({ diff: diffOf(task), failures: `The ${role} stopped: ${result.stop}: ${result.detail ?? ""}` });
      if (!task.escalated && (canClimb(state, task) || canEscalate(state))) {
        onStuck(run, task, `the worker ${result.stop}`);
        continue;
      }
      return failTask(run, task, `${role} ${result.stop}: ${result.detail ?? "no detail"}`, { stop: true });
    }

    if (task.step === "checks") {
      // A project that had no checks may get some from the work itself (a new
      // program with its own tests). From then on they gate the task.
      // [F10 work-created-checks]
      if (state.checks.length === 0 && isOn("work-created-checks")) {
        const found = optional(run, "work-created-checks", [], () => detectChecks(task.worktree));
        if (found.length > 0) {
          state.checks = found;
          log.emit("note", { feature: "F10", message: `The work added checks, which now gate it: ${found.map((c) => c.name).join(", ")}` });
        }
      }
      // [F54 work-env] Install what the work declares now, before its checks.
      const installFailed = await prepareEnv(run, task.worktree, task.prepared, task.id);
      let results = await check(run, task.worktree, `${task.id}-${task.escalated ? "x" : ""}${task.round}`);
      const cannotRun = results.filter((r) => r.status === "unavailable").map((r) => r.name);
      if (cannotRun.length > 0) {
        state.checks = state.checks.filter((c) => !cannotRun.includes(c.name));
        results = results.filter((r) => r.status !== "unavailable");
      }
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
      // [F56 env-blocked] An environment problem is not the worker's failure and never goes to the expert.
      if (!ok && isOn("env-blocked")) {
        const problem = environmentProblem(task, results, installFailed);
        if (problem) {
          task.latest = results;
          if ((task.envRepairs ?? 0) < ENV_REPAIRS) {
            task.envRepairs = (task.envRepairs ?? 0) + 1;
            task.envProblem = problem;
            task.next = "repair";
            task.step = "agent";
            saveState(state);
            log.emit("env.problem", { feature: "F56", task: task.id, problem: problem.slice(0, 600), turn: task.envRepairs });
            continue;
          }
          return failTask(run, task, `environment: ${problem.split("\n")[0]}`, { stop: true, failure: "engine" });
        }
      }
      const decision = observe(task.progress, attemptFrom(failing, diff), ok);
      if (ok) {
        task.step = wantsTester(state, task) ? "test" : "merge";
        saveState(state);
        continue;
      }
      task.history.push({ diff, failures: failureSummary(results, state.baseline) });
      if (task.escalated) {
        if (task.round < ESCALATION_REPAIRS) nextRound(run, task, "repair");
        continue;
        return failTask(run, task, "checks still fail after the expert's attempt");
      }
      if (decision === "oscillated" || decision === "no-progress" || task.round >= repairLimit(state, task)) {
        const why = decision === "oscillated" ? "the worker repeated an earlier failed state" : decision === "no-progress" ? "two attempts without progress" : "out of repair rounds";
        if (canClimb(state, task) || canEscalate(state)) {
          onStuck(run, task, why);
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
      const testerPrepared = prepareWorktree(state.repo, testerDir);
      // [F54 work-env] The copy gets the same environment, for the tester and the runs below.
      await prepareEnv(run, testerDir, testerPrepared, task.id);
      const diff = git(task.worktree, "diff", "--binary", task.base!, candidate);
      const screens = state.brief?.surface === "tui" ? screensFor(run, task, testerDir) : undefined;
      // [F58 acceptance-runs] The program used for real, before the tester looks.
      const acceptance = await acceptanceFor(run, task, testerDir);
      let outcome: TurnResult;
      let verdict: ReturnType<typeof parseVerdict>;
      try {
        outcome = await turn(run, {
          key: `${task.id}-test`,
          role: "tester",
          kind: "test",
          task: task.id,
          round: task.testRounds,
          cwd: testerDir,
          prompt: testerPrompt(state, task, diff, screens, acceptance),
          access: "write",
          schema: VERDICT_SCHEMA,
        });
        verdict = outcome.result.stop === "done" ? parseVerdict(outcome.result) : undefined;
        // [F59 reproduced-findings] Each blocker's check is run before the copy goes.
        if (verdict?.verdict === "fail" && isOn("reproduced-findings")) verdict = await checkFindings(run, task, testerDir, verdict, Boolean(screens));
      } finally {
        removeDetachedWorktree(state.repo, testerDir);
      }
      const { result } = outcome;
      if (result.stop === "cancelled") return stopFor(result, "tester");
      task.testRounds += 1;
      if (!verdict) {
        log.emit("note", { message: `The tester gave no usable verdict for task ${task.id} (${result.stop}); relying on the checks.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      task.verdict = verdict;
      log.emit("tester.verdict", { task: task.id, verdict: verdict.verdict, summary: verdict.summary, findings: verdict.findings });
      // Minor findings never hold a task up: they are recorded and the work merges.
      // A reviewer can always find something more; only blockers are worth rounds.
      // [F05 tester-severity]
      if (isOn("tester-severity") && verdict.verdict === "fail" && verdict.findings.every((f) => f.severity === "minor")) {
        log.emit("note", { message: `Task ${task.id}: the reviewer found only minor problems; merging with them recorded.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      if (verdict.verdict === "pass") {
        task.step = "merge";
        saveState(state);
        continue;
      }
      task.history.push({ diff, failures: "", findings: verdict.findings });
      // [F07 review-only-merge]
      if (isOn("review-only-merge") && task.round >= repairLimit(state, task) && task.advised && checksPass(task)) {
        // The project's checks pass, the expert's advice has been tried, and only the
        // reviewer still objects. An expert rebuild costs more than that is worth.
        log.emit("note", { message: `Task ${task.id}: the checks pass and the expert's advice was applied; merging with the reviewer's remaining findings recorded.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      if (task.round >= repairLimit(state, task)) {
        if (canClimb(state, task) || canEscalate(state)) {
          onStuck(run, task, "the reviewer still found problems after the repair rounds");
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

    if ((task.step === "advise" || task.step === "escalate") && !budgetLeft(state)) {
      // [F16 dollar-budget] Work whose checks pass is kept, with the open findings recorded.
      if (isOn("dollar-budget") && checksPass(task) && (task.history.at(-1)?.findings?.length ?? 0) > 0) {
        log.emit("note", { feature: "F16", message: `Expert budget reached; task ${task.id} keeps its work (the checks pass) with the reviewer's findings recorded.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      log.emit("note", { message: `Expert budget reached; task ${task.id} ends without expert help.` });
      return failTask(run, task, `${task.escalationReason ?? "the worker is stuck"}, and the expert budget is spent`);
    }

    // [F39 ask-first] The expert costs the most: the person says whether to call it in.
    if ((task.step === "advise" || task.step === "escalate") && !task.expertApproved) {
      const answer = await askUser(run, { kind: "expert", task: task.id, title: task.title, reason: task.escalationReason ?? "the worker is stuck", step: task.step });
      if (!answer.ok) {
        if (checksPass(task)) {
          log.emit("note", { message: `Task ${task.id} keeps its work without the expert (the checks pass); the reviewer's findings are recorded.` });
          task.step = "merge";
          saveState(state);
          continue;
        }
        return failTask(run, task, `${task.escalationReason ?? "the worker is stuck"}, and the expert was not called in`);
      }
      task.expertApproved = true;
      saveState(state);
    }

    if (task.step === "advise") {
      const { result } = await turn(run, {
        key: `${task.id}-advice`,
        role: "escalation",
        kind: "advice",
        task: task.id,
        round: task.round,
        cwd: task.worktree,
        prompt: advisePrompt(state, task, observedFor(state, task)),
        access: "read-only",
        schema: ADVICE_SCHEMA,
      });
      if (result.stop === "cancelled" || result.stop === "quota") return stopFor(result, "escalation");
      task.advised = true;
      const advice = result.stop === "done" ? parseAdvice(result) : undefined;
      if (!advice) {
        log.emit("note", { message: `The expert gave no usable advice for task ${task.id}; it takes the task over instead.` });
        task.step = "escalate";
        saveState(state);
        continue;
      }
      task.advice = advice;
      log.emit("task.advised", { task: task.id, reason: task.escalationReason, diagnosis: advice.diagnosis, steps: advice.steps });
      task.round += 1;
      task.next = "advised-fix";
      task.progress = newHistory();
      task.step = "agent";
      saveState(state);
      continue;
    }

    if (task.step === "escalate") {
      // [F14 expert-patch] When the checks pass and only the reviewer's findings
      // remain, the expert fixes those in the worker's code: far cheaper than
      // rebuilding from the start, which is what every expensive build was.
      const lastFindings = task.history.at(-1)?.findings ?? [];
      task.patch = isOn("expert-patch") && checksPass(task) && lastFindings.length > 0;
      // [F60 no-rebuild] The worker's code stays; the expert fixes it in place.
      if (!task.patch && !isOn("no-rebuild")) resetTo(task.worktree, task.base!);
      task.escalated = true;
      task.round = 0;
      task.next = "initial";
      task.sessionId = undefined;
      task.sessionModel = undefined;
      task.progress = newHistory();
      task.step = "agent";
      saveState(state);
      log.emit("task.escalated", { task: task.id, reason: task.escalationReason, patch: task.patch, feature: task.patch ? "F14" : undefined });
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
function failTask(run: RunCtx, task: TaskState, reason: string, options: { keepWork?: boolean; stop?: boolean; failure?: "agent" | "engine" } = {}): Stop | undefined {
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
  return options.stop ? { status: "failed", reason, failure: options.failure ?? "agent" } : undefined;
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

/**
 * A run's attempts with usage per turn. Runs recorded before usagePerTurn hold
 * Codex's running session totals for resumed turns; those are turned into the
 * change since the session's previous turn.
 */
export function perTurnAttempts(state: RunState, sessionTotals: (backend: string) => boolean): AttemptRecord[] {
  if (state.usagePerTurn) return state.attempts;
  const seen = new Map<string, AttemptRecord[]>();
  return state.attempts.map((a) => {
    if (!a.sessionId || !sessionTotals(a.backend)) return a;
    const key = `${a.backend}/${a.sessionId}`;
    const earlier = seen.get(key);
    // Earlier turns as recorded: running totals. The previous total is the latest one.
    const fixed = earlier && earlier.length > 0 ? { ...a, usage: usageSince(a.usage, [earlier[earlier.length - 1]!.usage]) } : a;
    seen.set(key, [...(earlier ?? []), a]);
    return fixed;
  });
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
