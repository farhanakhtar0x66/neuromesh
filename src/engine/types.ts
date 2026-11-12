import type { StopReason, Usage } from "../backends/types.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import type { FileChange } from "../workspace/workspace.ts";
import type { ProgressHistory } from "./progress.ts";
import type { Brief } from "../intake/brief.ts";

/**
 * "expert" is the heavy, expensive model (the factory's expert); "worker" is a
 * cheap, fast one. Used to measure expert share: how much of a run the expert did.
 */
export type Tier = "expert" | "worker";

export interface RoleConfig {
  backend: string;
  model?: string;
  effort?: string;
  tier?: Tier;
}

export type Role = "worker" | "orchestrator" | "tester" | "escalation" | "briefer";

/** Models to try for each role, in order. A later one is used when an earlier one runs out of quota. */
export type RoleChain = Partial<Record<Role, RoleConfig[]>>;

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

export type RunStep = "setup" | "baseline" | "spec" | "plan" | "tasks" | "final" | "done";

export type AttemptKind =
  | "spec"
  | "plan"
  | "initial"
  | "repair"
  | "review-fix"
  | "redo"
  | "continue"
  | "test"
  | "escalation"
  | "advice"
  | "advised-fix"
  | "climb"
  | "integration"
  | "scout"
  | "split";

export interface AttemptRecord {
  role: Role;
  tier: Tier;
  task?: string;
  round: number;
  kind: AttemptKind;
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
  /** [F67 session-cap] The largest prompt of the turn, when the tool reports it per call. */
  peakPrompt?: number;
}

export type InFlight = Omit<AttemptRecord, "stop" | "durationMs" | "usage" | "costUsdEquivalent" | "sessionId" | "detail"> & {
  pid?: number;
};

export interface WorkerReport {
  /** [F68 split-ask] "split": too big or too hard for one worker session; the expert divides it. */
  status: "done" | "blocked" | "split" | "unknown";
  summary: string;
  notes?: string;
  /** How to start the program, when the worker built one. */
  run?: string;
}

export interface Finding {
  problem: string;
  file?: string;
  reproduce?: string;
  /**
   * "blocker": a stated requirement is not met, or it crashes or loses data.
   * "minor": everything else. Unset (older testers) counts as a blocker.
   */
  severity?: "blocker" | "minor";
  /**
   * [F59 reproduced-findings] A command that exits non-zero while the problem
   * is there. The engine runs it; a finding whose check passes is dropped.
   */
  check?: string;
  /** [F59 reproduced-findings] Shown by its check (true), or not checkable (undefined). */
  verified?: boolean;
}

export interface Verdict {
  verdict: "pass" | "fail";
  summary: string;
  findings: Finding[];
}

export interface Advice {
  diagnosis: string;
  steps: string[];
}

export interface PlannedTask {
  id: string;
  title: string;
  brief: string;
  owned: string[];
  dependsOn: string[];
  /** "expert" for work the orchestrator judged too hard to hand out. */
  owner: "worker" | "expert";
}

export interface Plan {
  summary: string;
  tasks: PlannedTask[];
}

export type TaskStep = "start" | "agent" | "checks" | "test" | "advise" | "escalate" | "split" | "merge" | "done";

export interface TaskState extends PlannedTask {
  status: "pending" | "active" | "passed" | "failed";
  step: TaskStep;
  /** Worker turns taken after the first one (repairs, review fixes, redos). */
  round: number;
  /** The integration commit this task started from. */
  base?: string;
  branch: string;
  worktree: string;
  /** [F39 ask-first] The person agreed to call the expert in for this task. */
  expertApproved?: boolean;
  prepared: string[];
  sessionId?: string;
  /** Which model the session belongs to; a session cannot move to another model. */
  sessionModel?: string;
  /** Why the next agent turn is happening. */
  next: "initial" | "repair" | "review-fix" | "redo" | "continue" | "advised-fix" | "climb";
  /** [F14 expert-patch] The expert fixes named problems in the worker's code instead of starting over. */
  patch?: boolean;
  /** Position on the worker ladder (0 = the cheapest, lowest-effort rung). */
  rung?: number;
  /** The expert's diagnosis for a stuck worker (the first, cheaper step of escalation). */
  advice?: Advice;
  advised?: boolean;
  latest?: CheckResult[];
  verdict?: Verdict;
  testRounds: number;
  report?: WorkerReport;
  escalated: boolean;
  escalationReason?: string;
  /** Diffs and failures of earlier attempts, for the autopsy. */
  history: { diff: string; failures: string; findings?: Finding[] }[];
  progress: ProgressHistory;
  conflicts: number;
  previousDiff?: string;
  /** [F68 split-ask] Made by the expert dividing a bigger task; it cannot be split again. */
  fromSplit?: boolean;
  /** [F68 split-ask] The worker asked for a split and the expert answered. */
  splitAsked?: boolean;
  /** [F56 env-blocked] Turns spent on environment problems (not counted as repair rounds). */
  envRepairs?: number;
  /** [F56 env-blocked] What the environment problem was, for the next worker turn. */
  envProblem?: string;
  outOfScope?: string[];
  files?: FileChange[];
  error?: string;
}

export interface RunOutcome {
  checks: "passed" | "failed" | "none";
  files: FileChange[];
  insertions: number;
  deletions: number;
}

export interface RunState {
  version: 2;
  id: string;
  dir: string;
  repo: string;
  /** What the agents work from: the brief when the brief engine ran, else the request as typed. */
  prompt: string;
  /**
   * Usage of resumed sessions is recorded per turn. Runs made before 2026-11-11
   * 14:45 IST lack this and hold Codex's running session totals instead; see
   * perTurnAttempts.
   */
  usagePerTurn?: boolean;
  /** [F12 context-packet] Repository map and relevant signatures, made at the start of the run. */
  contextPacket?: string;
  /** Features switched on for this run (src/features.ts). */
  features?: string[];
  /** Features that failed during the run; optional ones were switched off and the run went on. */
  featureErrors?: { id: string; key: string; message: string; at: string }[];
  /** The request as typed, when the brief engine rewrote it. */
  request?: string;
  /** [F49 follow-up] The session this run belongs to (the first run's id), the run it follows, and the commit it starts from. */
  session?: string;
  follows?: string;
  start?: string;
  /** What the brief engine made of the request, and the staffing it chose. */
  brief?: Brief;
  /** [F63 scout-facts] Facts a cheap scout checked on this machine before the spec was written. */
  facts?: string[];
  preset: string;
  mode: "solo" | "team";
  roles: RoleChain;
  repairs: number;
  maxTasks: number;
  maxParallel: number;
  /** The preset's limit on tasks at once; maxParallel is 1 until a plan exists. */
  parallelLimit?: number;
  /** Escalate in two steps: the expert advises first, and takes over only if that fails. */
  advise: boolean;
  /** Most expert tokens (fresh input + output) one run may spend; no limit when unset. */
  expertBudget?: number;
  /** [F16 dollar-budget] Most estimated expert spending (US dollars, API list prices) one run may have. */
  expertBudgetUsd?: number;
  /** When the tester runs: always, or only when the project has no automatic checks. */
  test?: "always" | "no-checks";
  /** Worker rungs, cheapest first: a stuck worker climbs before the expert is asked. */
  workerLadder?: RoleConfig[];
  /** Time limit for one agent turn. */
  turnTimeoutMs: number;
  base: string;
  branch: string;
  /** The integration worktree: every finished task is merged here. */
  worktree: string;
  status: RunStatus;
  reason?: string;
  failure?: "agent" | "engine";
  step: RunStep;
  pid?: number;
  /** Agent turns in progress, keyed by task id (or "plan", "integration"). */
  inFlight: Record<string, InFlight>;
  /** Models that ran out of quota or are no longer offered during this run. */
  exhausted: string[];
  prepared: string[];
  checks: CheckSpec[];
  baseline?: CheckResult[];
  latest?: CheckResult[];
  plan?: Plan;
  planSession?: string;
  tasks: TaskState[];
  integrationFixes: number;
  attempts: AttemptRecord[];
  outcome?: RunOutcome;
  /** Why the intake chose solo or team. */
  route?: string;
  createdAt: string;
  updatedAt: string;
}
