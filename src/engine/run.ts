// The run engine for M1: one agent, from prompt to a checked diff.
//
// A run is a small state machine saved to run.json after every step, so it can
// be stopped at any point (Ctrl-C, a crash, a subscription limit) and resumed:
//
//   setup ─> baseline ─> agent ─> checks ─┬─> done
//                          ^              │
//                          └── repair ────┘   (while checks fail and repairs remain)

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AgentBackend, AgentResult, Usage } from "../backends/types.ts";
import { addUsage } from "../backends/types.ts";
import { detectChecks, runChecks } from "../checks/checks.ts";
import type { CheckResult } from "../checks/checks.ts";
import type { Preset } from "../presets/presets.ts";
import { createWorktree, findRepo, prepareWorktree, snapshot, writePatch } from "../workspace/workspace.ts";
import {
  continuePrompt,
  initialPrompt,
  parseReport,
  REPORT_SCHEMA,
  repairPrompt,
  standaloneRepairPrompt,
} from "./prompts.ts";
import { EventLog, newRunId, runPaths, runsDir, saveState } from "./store.ts";
import type { NeuromeshEvent } from "./store.ts";
import type { AttemptRecord, RoleConfig, RunState } from "./types.ts";

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
  /** Replace the preset's worker model or backend for this run. */
  worker?: Partial<RoleConfig>;
  repairs?: number;
}

export async function startRun(options: StartOptions, ctx: EngineContext): Promise<RunState> {
  const repo = findRepo(options.cwd);
  const id = newRunId();
  const dir = join(runsDir(ctx.home, repo.root), id);
  const paths = runPaths(dir);
  const now = new Date().toISOString();
  const worker: RoleConfig = { ...options.preset.worker, ...stripUndefined(options.worker ?? {}) };
  const turnTimeoutMs = ctx.turnTimeoutMs ?? options.preset.turnTimeoutMinutes * 60_000;

  const state: RunState = {
    version: 1,
    id,
    dir,
    repo: repo.root,
    prompt: options.prompt,
    preset: options.preset.name,
    worker,
    repairs: options.repairs ?? options.preset.repairs,
    turnTimeoutMs,
    base: repo.head,
    branch: `neuromesh/${id}`,
    worktree: paths.worktree,
    status: "running",
    step: "setup",
    round: 0,
    pid: process.pid,
    prepared: [],
    checks: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
  };
  saveState(state);

  const log = new EventLog(paths.events, id, ctx.onEvent);
  log.emit("run.started", { repo: repo.root, preset: state.preset, worker, base: repo.head, prompt: options.prompt });
  if (repo.dirty) {
    log.emit("note", {
      message: "The repository has uncommitted changes. The run starts from the last commit and does not see them.",
    });
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
  // An engine that was killed outright leaves its agent tool running on its own.
  if (state.agentPid !== undefined) {
    if (stopOrphan(state.agentPid, state.agentCommand)) {
      log.emit("note", { message: `Stopped an agent process (${state.agentPid}) left over from the interrupted run.` });
    }
    state.agentPid = undefined;
    state.agentCommand = undefined;
  }
  // A turn the dead engine never finished: record it, with its usage unknown.
  if (state.inFlight) {
    const f = state.inFlight;
    state.attempts.push({
      ...f,
      stop: "cancelled",
      durationMs: Date.now() - Date.parse(f.startedAt),
      usage: {},
      detail: "the engine stopped during this turn",
    });
    state.inFlight = undefined;
  }
  const from = state.status;
  state.status = "running";
  state.pid = process.pid;
  state.reason = undefined;
  state.failure = undefined;
  saveState(state);
  log.emit("run.resumed", { from, step: state.step, round: state.round });
  return drive(state, ctx, log);
}

async function drive(state: RunState, ctx: EngineContext, log: EventLog): Promise<RunState> {
  const turnTimeoutMs = ctx.turnTimeoutMs ?? state.turnTimeoutMs;
  const paths = runPaths(state.dir);
  const stop = (status: "interrupted" | "paused" | "failed", reason: string, failure?: "agent" | "engine"): RunState => {
    state.status = status;
    state.reason = reason;
    state.failure = failure;
    state.pid = undefined;
    state.agentPid = undefined;
    state.agentCommand = undefined;
    saveState(state);
    log.emit(`run.${status}`, { reason, failure, step: state.step, round: state.round });
    return state;
  };
  const interrupted = (): RunState => stop("interrupted", "stopped by the user");

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
        const results = await check(state, ctx, "baseline");
        if (ctx.signal?.aborted) return interrupted();
        state.baseline = results;
        // A check whose tool is missing here can never pass; leave it out.
        const missing = results.filter((r) => r.status === "unavailable").map((r) => r.name);
        if (missing.length > 0) {
          state.checks = state.checks.filter((c) => !missing.includes(c.name));
          log.emit("note", { message: `Skipping checks that cannot run here: ${missing.join(", ")}` });
        }
        state.step = "agent";
        saveState(state);
        log.emit("checks.finished", { phase: "baseline", round: state.round, results: brief(results) });
        continue;
      }

      if (state.step === "agent") {
        const outcome = await agentTurn(state, ctx, log, turnTimeoutMs);
        if (outcome.stop === "done") {
          state.report = parseReport(outcome);
          state.step = "checks";
          saveState(state);
          continue;
        }
        if (outcome.stop === "cancelled" || ctx.signal?.aborted) return interrupted();
        if (outcome.stop === "quota") {
          return stop("paused", `subscription limit reached: ${outcome.detail ?? "no detail"}`.trim());
        }
        return stop("failed", `agent ${outcome.stop}: ${outcome.detail ?? "no detail"}`, "agent");
      }

      if (state.step === "checks") {
        const results = await check(state, ctx, `round-${state.round}`);
        if (ctx.signal?.aborted) return interrupted();
        state.latest = results;
        log.emit("checks.finished", { phase: "after", round: state.round, results: brief(results) });
        const failing = results.filter((r) => r.status === "failed" || r.status === "timeout");
        if (failing.length > 0 && state.round < state.repairs) {
          state.round += 1;
          state.step = "agent";
          saveState(state);
          log.emit("repair.started", { round: state.round, failing: failing.map((r) => r.name) });
          continue;
        }
        const diff = snapshot(state.worktree, state.base, state.prepared);
        writePatch(paths.patch, diff.patch);
        state.outcome = {
          checks: results.length === 0 ? "none" : failing.length === 0 ? "passed" : "failed",
          files: diff.files,
          insertions: diff.insertions,
          deletions: diff.deletions,
        };
        state.step = "done";
        state.status = "finished";
        state.pid = undefined;
        saveState(state);
        log.emit("run.finished", {
          outcome: state.outcome,
          report: state.report,
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
    return stop("failed", `engine error: ${message}`, "engine");
  }
}

async function check(state: RunState, ctx: EngineContext, label: string): Promise<CheckResult[]> {
  if (state.checks.length === 0) return [];
  return runChecks({
    dir: state.worktree,
    checks: state.checks,
    logDir: runPaths(state.dir).checkLogs,
    label,
    timeoutMs: ctx.checkTimeoutMs,
    signal: ctx.signal,
  });
}

async function agentTurn(state: RunState, ctx: EngineContext, log: EventLog, timeoutMs: number): Promise<AgentResult> {
  const role = state.worker;
  const backend = ctx.backends[role.backend];
  if (!backend) throw new Error(`unknown backend "${role.backend}"`);

  // A turn that already started in this round and did not finish was
  // interrupted, paused or failed. Its session is not trusted; start fresh.
  const earlier = state.attempts.filter((a) => a.round === state.round);
  let kind: AttemptRecord["kind"];
  let prompt: string;
  let resumeSessionId: string | undefined;
  if (earlier.length > 0) {
    kind = "continue";
    prompt = continuePrompt(state);
  } else if (state.round === 0) {
    kind = "initial";
    prompt = initialPrompt(state);
  } else {
    kind = "repair";
    prompt = repairPrompt(state);
    resumeSessionId = state.sessionId;
    if (!resumeSessionId) prompt = standaloneRepairPrompt(state);
  }

  const run = async (text: string, resume: string | undefined): Promise<AgentResult> => {
    const n = state.attempts.length + 1;
    log.emit("agent.started", { round: state.round, kind, backend: backend.id, model: role.model, resumed: Boolean(resume) });
    const startedAt = new Date().toISOString();
    state.inFlight = { role: "worker", tier: role.tier ?? "worker", kind, round: state.round, backend: backend.id, model: role.model, startedAt };
    saveState(state);
    const result = await backend.run({
      cwd: state.worktree,
      prompt: text,
      model: role.model,
      effort: role.effort,
      access: "write",
      outputSchema: REPORT_SCHEMA,
      resumeSessionId: resume,
      timeoutMs,
      logPath: join(runPaths(state.dir).agentLogs, `${n}-round${state.round}-${kind}.jsonl`),
      signal: ctx.signal,
      onActivity: (a) => log.emit("agent.activity", { activity: a.kind, summary: a.summary }),
      onSpawn: (pid) => {
        state.agentPid = pid;
        state.agentCommand = backend.id;
        saveState(state);
      },
    });
    state.agentPid = undefined;
    state.agentCommand = undefined;
    state.inFlight = undefined;
    state.attempts.push({
      role: "worker",
      tier: role.tier ?? "worker",
      round: state.round,
      kind,
      backend: backend.id,
      model: result.model ?? role.model,
      stop: result.stop,
      startedAt,
      durationMs: result.durationMs,
      usage: result.usage,
      costUsdEquivalent: result.costUsdEquivalent,
      sessionId: result.sessionId,
      detail: result.detail,
      logPath: result.logPath,
    });
    if (result.stop === "done" && result.sessionId) state.sessionId = result.sessionId;
    saveState(state);
    log.emit("agent.finished", {
      round: state.round,
      kind,
      stop: result.stop,
      model: result.model ?? role.model,
      durationMs: result.durationMs,
      usage: result.usage,
      detail: result.detail,
      quotaUsed: result.quotaUsed,
    });
    return result;
  };

  let result = await run(prompt, resumeSessionId);
  // Resuming a session can fail (an expired or unknown session id). One fresh try.
  if (kind === "repair" && resumeSessionId && result.stop === "error" && !ctx.signal?.aborted) {
    log.emit("note", { message: "Could not continue the agent's session; starting a fresh one for the repair." });
    result = await run(standaloneRepairPrompt(state), undefined);
  }
  return result;
}

function brief(results: CheckResult[]): { name: string; status: string; durationMs: number }[] {
  return results.map((r) => ({ name: r.name, status: r.status, durationMs: r.durationMs }));
}

export interface ModelUsage {
  backend: string;
  model: string;
  turns: number;
  durationMs: number;
  usage: Usage;
  costUsdEquivalent?: number;
}

export function usageByModel(attempts: AttemptRecord[]): ModelUsage[] {
  const byKey = new Map<string, ModelUsage>();
  for (const a of attempts) {
    const model = a.model ?? "default";
    const key = `${a.backend}/${model}`;
    const entry = byKey.get(key) ?? { backend: a.backend, model, turns: 0, durationMs: 0, usage: {} };
    entry.turns += 1;
    entry.durationMs += a.durationMs;
    entry.usage = addUsage(entry.usage, a.usage);
    if (a.costUsdEquivalent !== undefined) entry.costUsdEquivalent = (entry.costUsdEquivalent ?? 0) + a.costUsdEquivalent;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

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
