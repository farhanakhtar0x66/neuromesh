import type { StopReason, Usage } from "../backends/types.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import type { FileChange } from "../workspace/workspace.ts";

export interface RoleConfig {
  backend: string;
  model?: string;
  effort?: string;
}

/**
 * running      the engine is working on it right now
 * interrupted  stopped by the user or a crash; resumable
 * paused       a subscription limit was hit; resume once it resets
 * failed       the agent or the engine failed; resumable to retry
 * finished     done; the diff is ready to review and apply
 * applied      the diff was applied to the user's repository
 * discarded    thrown away by the user
 */
export type RunStatus = "running" | "interrupted" | "paused" | "failed" | "finished" | "applied" | "discarded";

export type RunStep = "setup" | "baseline" | "agent" | "checks" | "done";

export interface AttemptRecord {
  round: number;
  kind: "initial" | "repair" | "continue";
  backend: string;
  model?: string;
  stop: StopReason;
  startedAt: string;
  durationMs: number;
  usage: Usage;
  costUsdEquivalent?: number;
  sessionId?: string;
  detail?: string;
  logPath?: string;
}

export interface WorkerReport {
  status: "done" | "blocked" | "unknown";
  summary: string;
  notes?: string;
}

export interface RunOutcome {
  checks: "passed" | "failed" | "none";
  files: FileChange[];
  insertions: number;
  deletions: number;
}

export interface RunState {
  version: 1;
  id: string;
  dir: string;
  repo: string;
  prompt: string;
  preset: string;
  worker: RoleConfig;
  repairs: number;
  /** Time limit for one agent turn. */
  turnTimeoutMs: number;
  base: string;
  branch: string;
  worktree: string;
  status: RunStatus;
  /** Why the run stopped, when it did not finish. */
  reason?: string;
  /** Whose fault a failure was: the agent's or Neuromesh's own. */
  failure?: "agent" | "engine";
  step: RunStep;
  round: number;
  /** Process running the engine, while status is "running". */
  pid?: number;
  /** Process group of the agent tool, while a turn is in progress. */
  agentPid?: number;
  agentCommand?: string;
  sessionId?: string;
  /** Dependency folders cloned into the worktree; never part of the diff. */
  prepared: string[];
  checks: CheckSpec[];
  baseline?: CheckResult[];
  latest?: CheckResult[];
  attempts: AttemptRecord[];
  report?: WorkerReport;
  outcome?: RunOutcome;
  createdAt: string;
  updatedAt: string;
}
