import type { StopReason, Usage } from "../backends/types.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import type { FileChange } from "../workspace/workspace.ts";
import type { ProgressHistory } from "./progress.ts";
import type { Brief } from "../intake/brief.ts";
import type { CascadeTier, TierRoute } from "../routing/router.ts";
import type { QuotaShift } from "./quota.ts";

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
  | "split"
  // [F84 bottleneck-diagnostic]
  | "diagnose"
  // [F102 repair-race] One of two fresh repair attempts made side by side.
  | "race"
  // [F101 blind-tests] Tests written from the task and the signatures alone.
  | "blind";

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
  /** [F72 quota-log] The tool's subscription quota readings (fraction used per window), when it reports them. */
  quotaUsed?: Record<string, number>;
  /** [F87 routing-summary] The cascade tier a build turn ran on (grunt, worker, senior, or expert for a takeover). */
  cascadeTier?: CascadeTier;
  /** [F83 early-exit] The early-exit gate stopped this turn after the agent's preamble. */
  earlyExit?: boolean;
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
  /**
   * "expert" for work the orchestrator judged too hard to hand out.
   * [F78 three-tier] "senior" for a moderately hard part: it starts on the
   * first senior rung of the ladder (a mid-priced model) instead of the cheapest.
   */
  owner: "grunt" | "worker" | "senior" | "expert";
}

export interface Plan {
  summary: string;
  tasks: PlannedTask[];
}

export type TaskStep = "start" | "agent" | "checks" | "test" | "advise" | "escalate" | "split" | "merge" | "done" | "race" | "blind";

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
  /** [F77 direct-build] One-answer turns taken on this task, and whether they are given up for it. */
  directTurns?: number;
  directOff?: boolean;
  /** [F68 split-ask] Nobody can divide this task now (no lead engineer, or no budget for one): the worker is not offered a split. */
  noSplit?: boolean;
  /** [F56 env-blocked] Turns spent on environment problems (not counted as repair rounds). */
  envRepairs?: number;
  /** [F56 env-blocked] What the environment problem was, for the next worker turn. */
  envProblem?: string;
  outOfScope?: string[];
  files?: FileChange[];
  error?: string;
  /** [F80 tier-router] This task's first rung came from Tier 0 (its outcome teaches the calibration, F81). */
  routed?: boolean;
  /** [F84 bottleneck-diagnostic] The developer's own account of the one sub-problem it is stuck on, for the expert. */
  bottleneck?: string;
  /** [F83 early-exit] Nowhere higher to go: the preamble is no longer asked for on this task. */
  noPreamble?: boolean;
  /** [F100 start-here] Where this task most likely begins, found by name before its first turn. */
  startHere?: string;
  /** [F102 repair-race] The two side-by-side repair attempts were made (once per task). */
  raced?: boolean;
  /** [F101 blind-tests] The blind tests were asked for (once per task). */
  blindDone?: boolean;
  /**
   * [F101 blind-tests] Blind test files that failed and were put into the task's
   * folder for the developer's one fix turn; `dropped` once the engine took
   * them out again because the checks still failed with them.
   */
  blind?: { files: string[]; dropped?: boolean };
}

/** The cascade's settings for one run (the routing architecture; F80 to F88). */
export interface CascadeState {
  /** [F80 tier-router] Where Tier 0 sent the request. */
  route?: TierRoute;
  /** [F83 early-exit] Below this self-reported confidence, a worker or senior turn is stopped and climbs. */
  thresholds: { worker: number; senior: number };
  /** [F85 blueprint-expert] The expert writes the blueprint and builds nothing. */
  blueprint: boolean;
  /** [F86 escalation-breaker] Most tasks per run that may go to the expert. */
  maxEscalations?: number;
  /** [F88 shadow-eval] Share of cheap-tier passes kept for grading later. */
  shadowRate: number;
  /** [F81 route-calibration] The quality bar for stage 0C. */
  alpha: number;
  /** [F81 route-calibration] This run's outcomes are already in the table. */
  recorded?: boolean;
  /** [F103 evidence-override] Share of confident senior matches started on the worker, to learn its rate. */
  probe?: number;
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
  /** [F65 spec-plan] The tasks are the spec's build plan for a new program. */
  planFromSpec?: boolean;
  /** [F77 direct-build] The preset asks for one-answer workers. */
  direct?: boolean;
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
  /** [F78 three-tier] The first senior rung of workerLadder (the preset's seniorLadder follows its worker rungs). */
  seniorRung?: number;
  /** [F82 grunt-tier] The first worker rung of workerLadder, when grunt rungs come before it. */
  workerRung?: number;
  /** The routing cascade (F80 to F88), for presets that set "cascade". */
  cascade?: CascadeState;
  /** [F104 quota-shift] Where the cheap turns move when a subscription window runs low. */
  quotaShift?: QuotaShift;
  /** [F104 quota-shift] The move has been reported in this run. */
  quotaShifted?: boolean;
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
