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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { AgentBackend, AgentResult, Usage } from "../backends/types.ts";
import { addUsage, usageSince } from "../backends/types.ts";
import { detectChecks, runChecks } from "../checks/checks.ts";
import { hasTmux, screenCheck, screenText } from "../checks/screen.ts";
import { runAcceptance, runCommand, verifyFindings } from "../checks/acceptance.ts";
import { BYTECODE, ensureEnv, envNote, envVars, environmentTrouble, missingModule } from "./env.ts";
import { observedText } from "./observed.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import { FeatureError, activeKeys, disable, enable, feature, hint, inFeature, isOn, onlyThese, resetFeatures } from "../features.ts";
import { TEST_PATH, buildPacket, startHere, trackedFiles } from "../context/packet.ts";
import { blindPathOk, brokenTest, signaturesOf, wantsBlindTests } from "../checks/blind.ts";
import { REPRODUCE_SCHEMA, failedForTheBug, parseReproduce, reproduceCommand, reproducePathOk, reproducePrompt } from "./reproduce.ts";
import { loadQuota, recordQuota, shiftNow } from "./quota.ts";
import { estimateCost } from "../usage/prices.ts";
import { splitFromLog } from "../usage/split.ts";
import type { InputSplit } from "../usage/split.ts";
import { buildBrief, detectRuntimes, renderBrief, repoFacts } from "../intake/brief.ts";
import type { Brief, Spec } from "../intake/brief.ts";
import { route } from "../intake/intake.ts";
import type { Preset } from "../presets/presets.ts";
import { git, tryGit } from "../workspace/git.ts";
import {
  commitAll,
  createDetachedWorktree,
  createWorktree,
  findRepo,
  headCommit,
  healWorktree,
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
  blindSchema,
  blindFinding,
  blindPrompt,
  parseBlind,
  RACE_HINTS,
  racePrompt,
  climbPrompt,
  advisedFixPrompt,
  advisePrompt,
  directAnswerPrompt,
  DIAGNOSE_SCHEMA,
  diagnosePrompt,
  parseDiagnosis,
  continuePrompt,
  freshAdvisedFixPrompt,
  parseAdvice,
  escalationPrompt,
  envRepairPrompt,
  directSchema,
  FACTS_SCHEMA,
  directPrompt,
  parseDirect,
  fixInPlacePrompt,
  parseFacts,
  scoutPrompt,
  splitPrompt,
  patchPrompt,
  failureSummary,
  freshFollowUpPrompt,
  integrationPrompt,
  parsePlan,
  parseReport,
  rescueStructured,
  parseSpec,
  parseVerdict,
  PLAN_SCHEMA,
  plannerPrompt,
  LEAD_SCHEMA,
  LEAD_PLAN_SCHEMA,
  REPORT_SCHEMA,
  EVIDENCE_SCHEMA,
  leadReviewPrompt,
  leadReportPrompt,
  leadEvidencePrompt,
  parseLead,
  parseCases,
  parseLeadTest,
  SCOUT_SCHEMA,
  PATCH_SCHEMA,
  scoutPromptK1,
  leadPatchPrompt,
  parsePatch,
  type Edit,
  parseRepoReport,
  parseEvidence,
  type CaseResult,
  SPEC_SCHEMA,
  specPrompt,
  redoPrompt,
  repairPrompt,
  reportSchema,
  reviewFixPrompt,
  taskPrompt,
  testerPrompt,
  VERDICT_SCHEMA,
} from "./prompts.ts";
import { currentPatch } from "./apply.ts";
import { EventLog, newRunId, runPaths, runsDir, saveState } from "./store.ts";
import type { NeuromeshEvent } from "./store.ts";
import type { AttemptKind, AttemptRecord, BlindTest, CascadeState, Finding, Plan, PlannedTask, Role, RoleConfig, RunState, TaskState, Tier, Verdict } from "./types.ts";
import { DEFAULT_ALPHA, calibrated, loadCalibration, record as recordOutcome, saveCalibration } from "../routing/calibration.ts";
import { describeStubs, findStubs } from "../checks/stubs.ts";
import { DEFAULT_THRESHOLDS, GATE_FLOOR, parsePreamble, preambleInstruction, shouldExit } from "../routing/preamble.ts";
import type { Preamble } from "../routing/preamble.ts";
import { selfContained } from "../routing/selfcontained.ts";
import { routeTier } from "../routing/router.ts";
import type { CascadeTier } from "../routing/router.ts";
import { DEFAULT_SHADOW_RATE, maybeEnqueue } from "../routing/shadow.ts";
import { describeSummary, routingSummary } from "../routing/summary.ts";

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
  /**
   * A spec to build from instead of having one written (the eval's frozen
   * specs: the roles after the spec are then tested on the same input, with
   * no expert turn). Needs the brief engine.
   */
  spec?: Spec;
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
/**
 * [F67 session-cap] Prompt size above which a session is not resumed. Haiku 5.5
 * charges five times as much for a call whose prompt is over 100K tokens.
 */
const SESSION_CAP = 90_000;
/** [F60 no-rebuild] Why an expert turn was stopped part way. */
const BUDGET_CUT = "stopped: the expert budget was reached during this turn";
/** [F83 early-exit] The detail of a turn the early-exit gate stopped. */
const EARLY_EXIT = "stopped: the developer judged the task beyond it";
/** A tool that prints nothing for this long has stalled; the turn is stopped and retried once. */
const IDLE_MS = 10 * 60_000;
const MAX_CONFLICTS = 2;
/** [F63 scout-facts] The scout's own time limit. */
const SCOUT_MS = 4 * 60_000;

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
  enable(preset.enable);
  // [F78 three-tier] The preset's senior rungs follow its worker rungs on one ladder.
  const workerRungs = preset.workerLadder ?? roles.worker ?? [];
  const senior = isOn("three-tier") && Object.keys(override).length === 0 && workerRungs.length > 0 && (preset.seniorLadder?.length ?? 0) > 0 ? preset.seniorLadder : undefined;
  // [F82 grunt-tier] The preset's grunt rungs come before its worker rungs, on the same ladder.
  const grunt = isOn("grunt-tier") && Object.keys(override).length === 0 && (preset.gruntLadder?.length ?? 0) > 0 ? preset.gruntLadder! : [];
  const upper = senior ? [...workerRungs, ...senior] : (preset.workerLadder ?? (grunt.length > 0 && workerRungs.length > 0 ? workerRungs : undefined));
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
  if (brief && options.spec) brief.spec = options.spec;
  // The routing cascade (F80 to F88): only for presets that ask for it, and only with the preset's own ladder.
  let cascade: CascadeState | undefined;
  if (preset.cascade && Object.keys(override).length === 0) {
    const c = preset.cascade;
    cascade = {
      // [F91 gate-floor] The preset's thresholds, else the floor; with the feature off, the architecture's tau_2 and tau_3.
      thresholds: isOn("gate-floor")
        ? { worker: c.thresholds?.worker ?? GATE_FLOOR, senior: c.thresholds?.senior ?? GATE_FLOOR }
        : DEFAULT_THRESHOLDS,
      blueprint: c.blueprint ?? true,
      maxEscalations: c.maxEscalations ?? 2,
      shadowRate: c.shadowRate ?? DEFAULT_SHADOW_RATE,
      alpha: c.alpha ?? DEFAULT_ALPHA,
      // [F103 evidence-override]
      ...(c.probe ? { probe: c.probe } : {}),
    };
    // [F80 tier-router] Tier 0: which tier the request starts on, with no model call.
    if (brief && isOn("tier-router")) {
      try {
        const b = brief;
        const learned = isOn("route-calibration") ? calibrated(loadCalibration(ctx.home), cascade.alpha) : undefined;
        // [F103 evidence-override] Its lookup is its own feature: if it fails, Tier 0 goes on with the match alone.
        const table = learned && {
          ...learned,
          evidence: (cluster: CascadeTier | undefined, tier: CascadeTier) => {
            try {
              return inFeature("evidence-override", () => learned.evidence?.(cluster, tier));
            } catch (error) {
              featureErrors.push(failure(error, "evidence-override"));
              disable("evidence-override");
              return undefined;
            }
          },
        };
        cascade.route = inFeature("tier-router", () =>
          routeTier(
            {
              request: b.request,
              kind: b.kind,
              totalWords: [b.request, ...b.attached.map((a) => a.text)].join(" ").split(/\s+/).filter(Boolean).length,
              namedFiles: new Set(b.request.match(/[\w./-]+\.(?:[jt]sx?|py|rs|go|md|json|toml|ya?ml|css|html)\b/g) ?? []).size,
            },
            table,
            // [F89 instruction-scoring]
            // [F103 evidence-override] The table may overrule a confident match; a preset may also ask for probes.
            { instructionOnly: isOn("instruction-scoring"), breadth: isOn("subsystem-breadth"), evidence: isOn("evidence-override"), probe: isOn("evidence-override") ? c.probe : undefined },
          ),
        );
        b.staffing.reasons.push(`Tier 0: ${cascade.route.tier} (${cascade.route.reasons.join("; ")})`);
        // A request that needs the expert from the start gets the sandwich: the expert plans and blueprints, the tiers below build.
        // [F93 senior-first-expert] Only a large, many-part request (Tier 0's size rule). A smaller expert request starts on
        // the senior, and the expert advises only when the senior escalates.
        const sandwich = cascade.route.tier === "expert" && (!isOn("senior-first-expert") || cascade.route.stage === "rules");
        if (sandwich && preset.mode === "team" && options.mode !== "solo" && (roles.orchestrator?.length ?? 0) > 0) b.staffing.plan = true;
      } catch (error) {
        featureErrors.push(failure(error, "tier-router"));
        disable("tier-router");
      }
    }
  }
  // [F128 lead-auto] Whether the brief itself wanted a plan (a large or many-part request), before the lead's own rule.
  let bigRequest = false;
  if (brief) {
    bigRequest = brief.staffing.plan || brief.kind === "greenfield";
    if (options.mode === "team") brief.staffing.plan = true;
    // [F120 lead] The lead plans every request but the small ones: a cheap model deciding first on a hard one is what it replaces.
    if (preset.lead && isOn("lead") && preset.mode === "team" && options.mode !== "solo" && (roles.orchestrator?.length ?? 0) > 0 && !brief.staffing.plan) {
      // [F121 lead-triage] A trivial or small self-contained request goes to a worker alone, with no model call to decide.
      let small: string | undefined;
      if (isOn("lead-triage")) {
        try {
          small = inFeature("lead-triage", () => {
            if (brief!.kind === "trivial") return "a small change: a worker does it alone";
            const count = git(repo.root, "ls-files").split("\n").filter(Boolean).length;
            return count <= 60 && selfContained(options.prompt, projectFiles(repo.root, [])).ok ? "small and self-contained: a worker does it alone" : undefined;
          });
        } catch (error) {
          featureErrors.push(failure(error, "lead-triage"));
          disable("lead-triage");
        }
      }
      if (small) brief.staffing.reasons.push(small);
      else {
        brief.staffing.plan = true;
        // The brief's wording was for a worker-first team; with the lead, the lead plans and reviews instead.
        brief.staffing.reasons = brief.staffing.reasons.filter((r) => !/^one worker starts|^the cheapest worker rung starts|^a tester reviews/.test(r));
        brief.staffing.reasons.push("the lead plans it, picks a developer per task and checks the result");
      }
    }
    mode = brief.staffing.plan ? "team" : "solo";
    why = brief.staffing.reasons.join("; ");
  } else if (!options.mode && preset.mode === "team" && preset.intake && !(preset.lead && isOn("lead"))) {
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
    parallelLimit: preset.maxParallel,
    advise: preset.advise ?? true,
    expertBudget: options.expertBudget ?? preset.expertBudget,
    expertBudgetUsd: preset.expertBudgetUsd,
    test: preset.test ?? "always",
    // [F120 lead] Only in team mode: the lead's plan and reviews need the orchestrator.
    lead: preset.lead && isOn("lead") && mode === "team" ? { reviews: preset.lead.reviews ?? 2, ...((preset.lead.mode === "patch" || (preset.lead.mode === "auto" && isOn("lead-auto") && !bigRequest)) && isOn("patch-lead") && !(cascade?.blueprint && isOn("blueprint-expert")) ? { mode: "patch" as const } : {}),
            // [F129 lead-dossier] K6: the scout's dossier, then the expert's own session.
            ...(preset.lead.mode === "dossier" && isOn("lead-dossier") && !(cascade?.blueprint && isOn("blueprint-expert")) ? { mode: "dossier" as const, ...(preset.lead.dossierMinFiles !== undefined ? { dossierMinFiles: preset.lead.dossierMinFiles } : {}) } : {}) } : undefined,
    // An explicitly chosen worker model replaces the ladder.
    workerLadder: Object.keys(override).length > 0 ? undefined : upper ? [...grunt, ...upper] : undefined,
    seniorRung: senior ? grunt.length + workerRungs.length : undefined,
    workerRung: grunt.length > 0 && upper ? grunt.length : undefined,
    cascade,
    // [F104 quota-shift] Not with a worker chosen by hand: the person picked that model.
    quotaShift: Object.keys(override).length === 0 ? preset.quotaShift : undefined,
    direct: preset.direct,
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

  const log = new EventLog(paths.events, id, ctx.onEvent, ctx.home);
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
  if (cascade?.route) log.emit("route.tier", { feature: cascade.route.domains ? "F94" : "F80", tier: cascade.route.tier, stage: cascade.route.stage, cluster: cascade.route.cluster, confidence: cascade.route.confidence, stripped: cascade.route.stripped, reasons: cascade.route.reasons, ...(cascade.route.domains ? { domains: cascade.route.domains } : {}) });
  // [F103 evidence-override]
  if (cascade?.route?.evidence || cascade?.route?.probe) {
    const r = cascade.route;
    log.emit("route.evidence", { feature: "F103", tier: r.tier, cluster: r.cluster, ...(r.evidence ? { direction: r.evidence.direction, from: r.evidence.from, p: r.evidence.p, tries: r.evidence.tries } : { probe: true }) });
  }
  // [F93 senior-first-expert]
  if (cascade?.route?.tier === "expert" && cascade.route.stage !== "rules" && isOn("senior-first-expert")) {
    log.emit("note", { feature: "F93", message: "Tier 0 chose the expert for a request that is not large: the senior builds it, and the expert advises if it escalates." });
  }
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
  const log = new EventLog(runPaths(state.dir).events, state.id, ctx.onEvent, ctx.home);
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
    if (task && task.step === "agent" && (task.next !== "initial" || leftChanges(task))) task.next = "continue";
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

/** [F78 three-tier] A senior part starts on the first senior rung; any other part on the cheapest. */
function startRung(state: RunState, owner: PlannedTask["owner"]): number | undefined {
  if (owner === "senior" && state.seniorRung !== undefined) return state.seniorRung;
  // [F82 grunt-tier] With grunt rungs below them, worker parts start on the first worker rung; grunt parts on the cheapest.
  if (owner === "worker" && state.workerRung !== undefined) return state.workerRung;
  return undefined;
}

/** [F82 grunt-tier] The cascade tier a rung of the ladder belongs to. */
export function tierAtRung(state: RunState, rung: number | undefined): CascadeTier {
  const r = rung ?? 0;
  if (state.workerRung !== undefined && r < state.workerRung) return "grunt";
  if (state.seniorRung !== undefined && r >= state.seniorRung) return "senior";
  return "worker";
}

/** [F83 early-exit] The first rung of the next tier up, or nothing at the top of the ladder. */
function nextTierRung(state: RunState, rung: number | undefined): number | undefined {
  const tier = tierAtRung(state, rung);
  if (tier === "grunt") return state.workerRung;
  if (tier === "worker") return state.seniorRung;
  return undefined;
}

/** [F80 tier-router] The first rung of the tier Tier 0 chose. An expert request that is not planned starts on the strongest rung. */
function rungForTier(state: RunState, tier: CascadeTier): number {
  const top = (state.workerLadder?.length ?? 1) - 1;
  if (tier === "grunt") return 0;
  if (tier === "worker") return state.workerRung ?? 0;
  return state.seniorRung ?? top;
}

/** The tier a task is on now: the expert's once it took over or owned the part. */
function taskTier(state: RunState, task: TaskState): CascadeTier {
  return task.owner === "expert" || task.escalated ? "expert" : tierAtRung(state, task.rung);
}

function newTask(state: RunState, planned: PlannedTask): TaskState {
  const dir = join(state.dir, "tasks", planned.id);
  // The brief engine may start a task on the strongest worker rung (below the senior rungs).
  const top = state.workerLadder ? (state.seniorRung ?? state.workerLadder.length) - 1 : -1;
  // [F80 tier-router] The run's one task, when it was not planned, starts where Tier 0 sent the request.
  const routed = isOn("tier-router") && planned.id === "main" && !state.plan && state.cascade?.route !== undefined && state.workerLadder !== undefined;
  const rung = routed ? rungForTier(state, state.cascade!.route!.tier) : (startRung(state, planned.owner) ?? (state.brief?.staffing.rung === "top" && top >= 0 ? top : undefined));
  return {
    ...(routed ? { routed: true } : {}),
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
        // A spec that was given, not written here, still carries its build plan.
        if (state.brief?.spec && state.tasks.length === 0 && state.attempts.every((a) => a.kind !== "spec")) planFromSpec(run, state.brief.spec, undefined);
        if (state.tasks.length > 0) {
          // [F65 spec-plan] Planned already, by the spec writer.
          state.step = "tasks";
        } else if (state.mode === "team") {
          state.step = "plan";
        } else {
          state.tasks = [newTask(state, { id: "main", title: "the request", brief: state.prompt, owned: [], dependsOn: [], owner: "worker" })];
          state.step = "tasks";
        }
        saveState(state);
        continue;
      }

      if (state.step === "plan") {
        // [F127 patch-lead] K1: no plan. The scout explores and reproduces; the expert's one task is the patch.
        const patchLead = (state.lead?.mode === "patch" && isOn("patch-lead")) || (state.lead?.mode === "dossier" && isOn("lead-dossier"));
        // [F130 dossier-gate] K6: the dossier only where there is a search to save.
        if (patchLead && !state.lead!.scouted && state.lead!.mode === "dossier" && isOn("dossier-gate")) {
          const why = optional(run, "dossier-gate", undefined, () => dossierSkip(state));
          if (why) {
            state.lead!.scouted = true;
            saveState(state);
            log.emit("note", { feature: "F130", message: `No dossier: ${why}. The expert works from the request.` });
          }
        }
        if (patchLead && !state.lead!.scouted) {
          const stop = await optionalAsync(run, "patch-lead", undefined, () => patchScout(run));
          if (stop) return stop.status === "interrupted" ? interrupted() : end(stop);
        }
        if (patchLead && state.tasks.length === 0) {
          state.tasks = [newTask(state, { id: "main", title: "the request", brief: state.prompt, owned: [], dependsOn: [], owner: "expert" })];
          saveState(state);
          log.emit("plan.ready", { feature: "F127", summary: "the expert writes the patch in one call", tasks: [{ id: "main", title: "the request", brief: state.prompt.slice(0, 400), owned: [], dependsOn: [], owner: "expert" }] });
        }
        // [F122 lead-scout] On a big repository a cheap developer reads it first, so the lead plans from a report.
        if (!patchLead && state.lead && !state.lead.scouted && isOn("lead-scout")) {
          const stop = await optionalAsync(run, "lead-scout", undefined, () => leadScout(run));
          if (stop) return stop.status === "interrupted" ? interrupted() : end(stop);
        }
        const outcome = patchLead ? undefined : await planStep(run);
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
        // [F124 lead-tests] The lead's test file is run on the code as it is before anyone builds against it.
        if (state.lead?.test?.stage === "judging") {
          const stop = await optionalAsync(run, "lead-tests", undefined, () => leadTestStep(run));
          if (stop) return stop.status === "interrupted" ? interrupted() : end(stop);
        }
        state.step = "tasks";
        saveState(state);
        continue;
      }

      if (state.step === "tasks") {
        const outcome = await schedule(run);
        if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
        // [F120 lead] The lead reviews the merged work before the final step.
        state.step = state.lead ? "lead" : "final";
        saveState(state);
        continue;
      }

      if (state.step === "lead") {
        const outcome = await leadStep(run);
        if (outcome) return outcome.status === "interrupted" ? interrupted() : end(outcome);
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
        // [F87 routing-summary] [F81 route-calibration]
        if (state.cascade) cascadeEnd(run);
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
    // Where it happened, for whoever reads the log (swl-k1-probe failed with only a message).
    log.emit("engine.error", { message, stack: error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 12).join("\n") : undefined });
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

async function check(run: RunCtx, dir: string, label: string, only?: CheckSpec[]): Promise<CheckResult[]> {
  const checks = only ?? run.state.checks;
  if (checks.length === 0) return [];
  // [F57 hollow-checks] After the baseline, a check that tests nothing is not a
  // pass, unless it already tested nothing before the work started.
  const strict =
    label !== "baseline" && isOn("hollow-checks")
      ? new Set(checks.map((c) => c.name).filter((n) => !run.state.baseline?.find((b) => b.name === n)?.hollow))
      : undefined;
  return runChecks({
    dir,
    checks,
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
  // Bytecode is left out of the run's final diff as well as each task's.
  if (outcome.folders.includes(BYTECODE) && !run.state.prepared.includes(BYTECODE)) run.state.prepared.push(BYTECODE);
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

/** [F118 keep-checks] What a check that ran before the work and cannot run now is told as. */
const LOST_CHECK =
  "This check ran before the work started; now its command cannot run (command or file not found). The work removed or broke something the check needs (for example a virtual environment, an installed tool or a script). Restore it so the check runs again; do not change the check.";

/** [F118 keep-checks] A check that ran at the baseline and is unavailable now failed: the work broke what it needs. */
function keepLostChecks(run: RunCtx, results: CheckResult[]): CheckResult[] {
  if (!isOn("keep-checks")) return results;
  const ran = new Set((run.state.baseline ?? []).filter((b) => b.status === "passed" || b.status === "failed").map((b) => b.name));
  return optional(run, "keep-checks", results, () =>
    results.map((r) => (r.status === "unavailable" && ran.has(r.name) ? { ...r, status: "failed" as const, tail: `${LOST_CHECK}\n${r.tail}` } : r)),
  );
}

/** [F117 empty-done] What a task that said it was done and changed nothing is told, once. */
const EMPTY_DONE =
  "Your turn ended, but the workspace has no change at all: git shows no edited, added or deleted file. If you made edits, they did not land (a command that hung or went to the background, a script whose search text matched nothing, a write to another folder). Check with `git status` and `git diff`, make the change, and confirm it is there before reporting. If the request really needs no change, report done again and say why in your notes.";

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
  /** A shorter time limit than the run's, for a turn that is only a help. */
  timeoutMs?: number;
  /** [F77 direct-build] One answer, no tools. */
  direct?: boolean;
  /** [F83 early-exit] The agent's first message is its preamble; below this confidence (or asked to escalate) the turn stops. */
  preamble?: number;
  /** [F83 early-exit] Set when the gate stopped the turn. */
  exited?: Preamble;
  /** [F87 routing-summary] The task's rung, to tell which tier a ladder model ran on. */
  rungBase?: number;
}

interface TurnResult {
  result: AgentResult;
  config?: RoleConfig;
}

const TRANSIENT = /^stalled: |stream was interrupted|^interrupted$|ECONNRESET|socket hang up|ETIMEDOUT|read tcp|connection reset|request failed: Post|\b50[23]\b|UNAVAILABLE|overloaded|temporarily unavailable|internal server error|ECONNREFUSED|connection refused|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed/i;

/** [F116 network-pause] The machine cannot reach the service at all. Not a stall or a 5xx: those can be the model's own trouble. */
const OFFLINE = /ECONNREFUSED|connection refused|ENOTFOUND|getaddrinfo|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|network is unreachable|fetch failed|firewall or proxy|ECONNRESET|socket hang up|ETIMEDOUT|connection reset/i;

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

/**
 * [F69 budget-handoff] Whether the expert budget left can pay for one more
 * expert turn: this run's average expert turn so far, and at least $0.15 (the
 * cache write of a fresh Opus prompt alone is about that).
 */
export function expertCanTake(state: RunState): boolean {
  if (!budgetLeft(state)) return false;
  if (!isOn("dollar-budget") || state.expertBudgetUsd === undefined) return true;
  const costs = state.attempts.filter((a) => a.tier === "expert").flatMap((a) => estimateCost(a.model, a.usage) ?? []);
  const turnCost = Math.max(0.15, costs.length > 0 ? costs.reduce((n, c) => n + c, 0) / costs.length : 0);
  return state.expertBudgetUsd - expertDollars(state) >= turnCost;
}

/** [F69 budget-handoff] The expert cannot pay for this task's part: it goes to the top worker rung. */
function handToWorker(run: RunCtx, task: TaskState, why: string): void {
  task.owner = "worker";
  task.rung = run.state.workerLadder ? run.state.workerLadder.length - 1 : undefined;
  run.log.emit("note", { feature: "F69", message: `Task ${task.id}: ${why}; a worker builds it instead.` });
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

/**
 * [F70 cut-usage] A turn that stopped before reporting its usage keeps what its
 * stream reported: input and cache counts are exact, output is an estimate.
 */
export function keptUsage(reported: Usage, streamed: Usage | undefined): Usage {
  if (!isOn("cut-usage") || !streamed || reported.input !== undefined || reported.output !== undefined) return reported;
  if ((streamed.input ?? 0) + (streamed.cacheRead ?? 0) + (streamed.cacheWrite ?? 0) + (streamed.output ?? 0) === 0) return reported;
  return { ...streamed, estimated: true };
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
  const candidates = (): RoleConfig[] => {
    const own = req.chain ? req.chain.filter((c) => !state.exhausted.includes(modelKey(c))) : roleChain(state, req.role);
    // [F104 quota-shift] The plan is running low: this cheap turn goes to another plan's model first.
    const moved = quotaShiftFor(run, req, own);
    return moved ? [...moved.to, ...own] : own;
  };
  while (true) {
    const config = candidates()[0];
    // [F104 quota-shift] Said once per run, when the first turn moves.
    if (config && state.quotaShift && !state.quotaShifted && state.quotaShift.to.some((c) => modelKey(c) === modelKey(config))) {
      const moved = quotaShiftFor(run, req, req.chain ?? roleChain(state, req.role));
      if (moved) {
        state.quotaShifted = true;
        saveState(state);
        log.emit("quota.shifted", { feature: "F104", backend: state.quotaShift.backend, window: state.quotaShift.window, used: moved.used, above: state.quotaShift.above, to: modelKey(config), role: req.role });
      }
    }
    if (!config) {
      // A role the preset never gave a model is not a quota limit: the caller goes on without it.
      const configured = (req.chain ?? state.roles[req.role] ?? (req.role === "escalation" ? state.roles.orchestrator : undefined) ?? []).length > 0;
      if (!last && !configured) return { result: emptyResult("error", `no ${req.role} model is configured`) };
      const detail = last?.detail ?? `no ${req.role} model is configured`;
      return { result: last ?? emptyResult("quota", detail), config: lastConfig };
    }
    const backend = ctx.backends[config.backend];
    if (!backend) throw new Error(`unknown backend "${config.backend}"`);
    let sameSession = req.resume?.sessionId !== undefined && req.resume.model === modelKey(config);
    // [F67 session-cap] A session already this large costs more per call than a fresh start from the brief.
    const peak = sameSession && isOn("session-cap") ? Math.max(0, ...state.attempts.filter((a) => a.sessionId === req.resume!.sessionId).map((a) => a.peakPrompt ?? 0)) : 0;
    if (sameSession && peak > SESSION_CAP && req.freshPrompt) {
      sameSession = false;
      log.emit("context.compacted", { feature: "F67", role: req.role, task: req.task, peakPrompt: peak });
    }
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

/** [F106 input-split] The start-up a fresh session of each kind was seen to cost per call, for the first call of a resumed one. */
const STARTUP_SEEN = new Map<string, number>();

function inputSplitOf(logPath: string, promptChars: number, resumed: boolean, kind: string): InputSplit | undefined {
  if (!existsSync(logPath)) return undefined;
  const split = splitFromLog(readFileSync(logPath, "utf8"), { promptChars, resumed, startupHint: STARTUP_SEEN.get(kind) });
  if (split && !resumed && split.startup !== undefined && split.calls > 0) STARTUP_SEEN.set(kind, split.startup / split.calls);
  return split;
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
  let streamed: Usage | undefined;
  // [F83 early-exit] Only the agent's first text message counts.
  let firstText = true;
  const gate = req.preamble;
  let result: AgentResult;
  try {
    result = await backend.run({
    cwd: req.cwd,
    prompt,
    direct: req.direct,
    model: config.model,
    effort: config.effort,
    access: req.access,
    // [F54 work-env]
    env: isOn("work-env") && req.access === "write" ? envVars(req.cwd) : undefined,
    // [F55 worker-network] New programs (their packages, their real data), and the scout.
    network: req.access === "write" && ((isOn("worker-network") && state.brief?.kind === "greenfield") || (req.kind === "scout" && isOn("scout-facts"))),
    onUsage: (u) => {
      // [F70 cut-usage] Kept in case the turn stops before its final usage report.
      streamed = u;
      if (!watch || cut || spentBefore + (estimateCost(config.model, u) ?? 0) < state.expertBudgetUsd!) return;
      cut = true;
      log.emit("note", { feature: "F60", message: `Expert budget reached during the ${req.role}'s turn (about $${(spentBefore + (estimateCost(config.model, u) ?? 0)).toFixed(2)} of $${state.expertBudgetUsd!.toFixed(2)}, estimated); stopping it.` });
      turnStop.abort();
    },
    // [F53 write-sandbox] A writing turn may write in its own copy and git's shared objects; a reading turn nowhere of ours.
    writable: isOn("write-sandbox") ? (req.access === "write" ? [req.cwd, join(state.repo, ".git", "worktrees"), join(state.repo, ".git", "objects")] : []) : undefined,
    outputSchema: req.schema,
    resumeSessionId,
    timeoutMs: Math.min(state.turnTimeoutMs, req.timeoutMs ?? Number.POSITIVE_INFINITY),
    idleMs: IDLE_MS,
    logPath,
    signal: AbortSignal.any([run.signal, turnStop.signal]),
    onActivity: (a) => log.emit("agent.activity", { task: req.task, role: req.role, activity: a.kind, summary: a.summary }),
    onText:
      gate === undefined
        ? undefined
        : (text) => {
            if (!firstText) return;
            firstText = false;
            const p = optional(run, "early-exit", undefined, () => parsePreamble(text));
            if (!p) return;
            log.emit("agent.preamble", { feature: "F83", task: req.task, confidence: p.confidence, escalate: p.escalate, reason: p.reason });
            if (shouldExit(p, gate)) {
              req.exited = p;
              turnStop.abort();
            }
          },
    onSpawn: (pid) => {
      const f = state.inFlight[req.key];
      if (f) f.pid = pid;
      saveState(state);
    },
    });
  } catch (error) {
    // [F74 adapter-guard]
    if (!isOn("adapter-guard")) throw error;
    // The tool's adapter itself failed (it could not start the tool, or broke on its output):
    // a failed turn like any other, never a crashed run.
    result = { stop: "error", finalText: "", usage: {}, durationMs: Date.now() - Date.parse(startedAt), exitCode: null, detail: `the ${backend.id} adapter failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  // [F110 structured-rescue] The tool gave up on the answer's format after the work was done: take the last attempt, if the parser would.
  if (result.stop === "error" && isOn("structured-rescue") && result.lastStructured !== undefined) {
    const rescued = optional(run, "structured-rescue", undefined, () => rescueStructured(req.schema, result));
    if (rescued) {
      log.emit("structured.rescued", { feature: "F110", task: req.task, role: req.role, kind: req.kind, missing: rescued.missing });
      result = { ...result, stop: "done", structured: rescued.structured, exitCode: 0, detail: `the last attempt at the answer was used (left out: ${rescued.missing.join(", ") || "nothing"})` };
    }
  }

  // [F104 quota-shift] The tool's latest reading of its subscription windows, kept for this run's next turn and the next run.
  if (result.quotaUsed && isOn("quota-shift")) {
    const used = result.quotaUsed;
    optional(run, "quota-shift", undefined, () => recordQuota(run.ctx.home, config.backend, used, result.quotaResets));
  }
  if (cut && !run.signal.aborted) result = { ...result, stop: "error", detail: BUDGET_CUT };
  // [F83 early-exit]
  if (req.exited && !cut && !run.signal.aborted) result = { ...result, stop: "error", detail: `${EARLY_EXIT}: ${req.exited.reason}` };
  delete state.inFlight[req.key];
  const usageBase =
    // [F09 codex-session-totals]
    backend.sessionTotals && isOn("codex-session-totals") && resumeSessionId !== undefined && result.sessionId === resumeSessionId
      ? usageSince(
          result.usage,
          state.attempts.filter((a) => a.sessionId === resumeSessionId && a.backend === backend.id).map((a) => a.usage),
        )
      : keptUsage(result.usage, streamed);
  // [F106 input-split] Where this turn's input went, from the turn's kept log.
  const split = backend.id === "claude" && isOn("input-split") ? optional(run, "input-split", undefined, () => inputSplitOf(logPath, prompt.length, resumeSessionId !== undefined, `${config.model}|${req.access}|${req.direct ?? false}`)) : undefined;
  const usage: Usage = split ? { ...usageBase, split } : usageBase;
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
    peakPrompt: result.peakPrompt,
    // [F72 quota-log]
    quotaUsed: isOn("quota-log") ? result.quotaUsed : undefined,
    // [F87 routing-summary]
    cascadeTier: cascadeTierOf(state, req, config),
    earlyExit: result.detail?.startsWith(EARLY_EXIT) ? true : undefined,
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
    // [F108 run-record] For the record, which has no run.json to ask per turn.
    cascadeTier: record.cascadeTier,
    peakPrompt: record.peakPrompt,
    earlyExit: record.earlyExit,
    quotaUsed: result.quotaUsed,
    // [F43 quota-windows]
    quotaResets: isOn("quota-windows") ? result.quotaResets : undefined,
  });
  return result;
}

/** [F87 routing-summary] The cascade tier of a task's build turn; nothing for turns outside the ladder (spec, plan, review, advice). */
function cascadeTierOf(state: RunState, req: TurnRequest, config: RoleConfig): CascadeTier | undefined {
  if (!state.cascade || !req.task) return undefined;
  if (req.role === "worker" && state.workerLadder) {
    const base = req.rungBase ?? 0;
    const i = state.workerLadder.findIndex((c, n) => n >= base && modelKey(c) === modelKey(config));
    return tierAtRung(state, i >= 0 ? i : base);
  }
  if ((req.role === "escalation" || req.role === "orchestrator") && req.kind !== "advice") return "expert";
  return undefined;
}

/**
 * [F64 auth-pause] A login the tool's server rejected (expired or revoked).
 * Every model on the same tool shares that login, so no fallback or expert can
 * help: the run pauses until the person signs in again.
 */
function signedOut(result: AgentResult): boolean {
  return isOn("auth-pause") && result.stop === "auth" && !UNAVAILABLE.test(result.detail ?? "");
}

/**
 * [F116 network-pause] The machine cannot reach the service (after the one retry): no model can do anything, so the
 * run pauses instead of failing the task or sending it up the ladder (seen 2026-11-17: eight eval tasks recorded as
 * failed overnight, and in the fault harness an expert called on a dead network).
 */
function offline(result: AgentResult): boolean {
  return isOn("network-pause") && result.stop === "error" && OFFLINE.test(result.detail ?? "");
}

/** A stop no model can get past: a lost login or a lost network. The run pauses. */
function held(result: AgentResult): boolean {
  return signedOut(result) || offline(result);
}

/** Turn a non-finished agent result into how the run should stop. */
function stopFor(result: AgentResult, what: string): Stop {
  if (result.stop === "cancelled") return { status: "interrupted", reason: "stopped by the user" };
  // [F64 auth-pause]
  if (signedOut(result)) {
    return { status: "paused", reason: `the ${what}'s tool is no longer signed in (${(result.detail ?? "").replace(/^success\s+/, "").slice(0, 160)}). Sign in again (/connect in the TUI, or \`claude auth login\` for Claude Code), then resume the run.` };
  }
  // [F116 network-pause]
  if (offline(result)) {
    return { status: "paused", reason: `the ${what}'s tool cannot reach its service (${(result.detail ?? "").replace(/^success\s+/, "").slice(0, 160)}). Check the network, then resume the run.` };
  }
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
    prompt: specPrompt(brief.request, renderBrief(brief), state.facts, { tiers: state.seniorRung !== undefined, maxTasks: state.maxTasks, grunt: state.workerRung !== undefined, blueprint: blueprintOn(state) }),
    access: "read-only",
    schema: SPEC_SCHEMA,
  });
  if (result.stop === "quota" || result.stop === "cancelled" || held(result)) return stopFor(result, "briefer");
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
  planFromSpec(run, spec, config);
  return undefined;
}

/** [F85 blueprint-expert] The expert writes the plan and the hardest part's design, and builds nothing. */
function blueprintOn(state: RunState): boolean {
  return state.cascade?.blueprint === true && isOn("blueprint-expert");
}

/** [F65 spec-plan] The spec writer split the build: those tasks are the plan, with no planning turn. */
/**
 * The most tasks a spec's build plan may have. The spec writer is asked to keep
 * to the preset's task limit, but a plan that is already paid for is not thrown
 * away for going a task or two over it (the first hard-task run lost a good
 * five-task plan to a limit of four, and Haiku then built everything alone).
 */
const SPEC_PLAN_MOST = 12;

function planFromSpec(run: RunCtx, spec: Spec, config: RoleConfig | undefined): void {
  const { state, log } = run;
  if (!isOn("spec-plan") || (spec.tasks?.length ?? 0) < 2) return;
  optional(run, "spec-plan", undefined, () => {
    const plan = parsePlan({ stop: "done", finalText: "", usage: {}, durationMs: 0, exitCode: 0, structured: { summary: `${spec.name}: the spec's build plan`, tasks: spec.tasks } }, Math.max(state.maxTasks, SPEC_PLAN_MOST), state.seniorRung !== undefined, { grunt: state.workerRung !== undefined, blueprint: blueprintOn(state) });
    state.plan = plan;
    // Small tasks start on the first worker rung (a senior part on the first senior rung); the ladder still climbs when one is stuck.
    state.tasks = plan.tasks.map((t) => ({ ...newTask(state, t), rung: startRung(state, t.owner) }));
    state.mode = "team";
    state.maxParallel = state.parallelLimit ?? 1;
    state.planFromSpec = true;
    saveState(state);
    log.emit("plan.ready", { feature: "F65", summary: plan.summary, model: config ? modelKey(config) : undefined, tasks: plan.tasks });
  });
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
  // With several tasks the program is only whole at the last one.
  if (run.state.tasks.length > 1 && !isLastOpen(run.state, task)) return undefined;
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
    // A quick look, not a study: past this the spec is written without it.
    timeoutMs: SCOUT_MS,
  });
  if (result.stop === "timeout") log.emit("note", { feature: "F63", message: `The fact check took over ${SCOUT_MS / 60_000} minutes and was stopped; the spec is written without it.` });
  const facts = result.stop === "done" ? parseFacts(result) : [];
  log.emit("facts.ready", { feature: "F63", facts });
  return facts;
}

/** [F124 lead-tests] Marks the reproduction that is the lead's test file, so an expert may correct it. */
const LEAD_TESTS = "the lead's acceptance tests";

/**
 * [F124 lead-tests] The command for the lead's test file: the lead's own when it runs through the same runner as one of the
 * project's checks (a container runner, a virtual environment), else the one F115 picks from the project's files.
 */
function leadTestCommand(state: RunState, path: string, offered: string): string | undefined {
  if (!reproducePathOk(path)) return undefined;
  const prefixes = state.checks.map((c) => c.command.trim().split(/\s+/)[0]!).filter((p) => p.length > 0);
  if (offered && offered.includes(path) && !/[;&|`$<>(){}\n\\]/.test(offered) && prefixes.some((p) => offered === p || offered.startsWith(`${p} `))) return offered;
  return reproduceCommand(state.worktree, path, offered);
}

/**
 * [F124 lead-tests] The lead's plan came with its cases as a test file. It is written into the run's folder and run on the
 * code as it is: it is kept only if it fails there with a failed test or assertion (not a load error), as F115 keeps a
 * reproduction. Kept, it is committed, so every task starts with it; a one-task plan gets it as a check, guarded like a
 * reproduction (put back if a worker edits it; an expert may correct it). A larger plan's tasks build parts, so there the
 * file is run once all of them are merged (leadStep). Not kept, it is deleted and the run goes on with the prose cases.
 */
async function leadTestStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const t = state.lead!.test!;
  const full = join(state.worktree, t.path);
  const reject = (outcome: string, extra: Record<string, unknown> = {}): undefined => {
    t.stage = "rejected";
    t.outcome = outcome;
    if (extra.written) rmSync(full, { force: true });
    log.emit("lead.tests", { feature: "F124", outcome, path: t.path.slice(0, 200), ...extra, written: undefined });
    saveState(state);
    return undefined;
  };
  if (!reproducePathOk(t.path) || existsSync(full)) return reject("bad path");
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, t.content);
  const command = leadTestCommand(state, t.path, t.command);
  if (!command) return reject("no way to run it", { written: true });
  const [first] = await check(run, state.worktree, "lead-tests", [{ name: "lead-tests", command }]);
  if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
  const verdict = first ? failedForTheBug(first) : { ok: false as const, why: "the run gave no result" };
  if (!verdict.ok) return reject(verdict.why, { written: true, tail: first?.tail.slice(-400) });
  commitAll(state.worktree, "neuromesh: the lead's acceptance tests", state.prepared);
  t.stage = "accepted";
  t.command = command;
  t.outcome = "fails on the code as it was";
  t.tail = first?.tail.slice(-3_000);
  if (state.tasks.length === 1) {
    state.checks = [...state.checks.filter((c) => c.name !== "lead-tests"), { name: "lead-tests", command }];
    state.tasks[0]!.reproduce = { stage: "accepted", path: t.path, content: t.content, command, outcome: LEAD_TESTS };
  }
  log.emit("lead.tests", { feature: "F124", outcome: "accepted", path: t.path, command, tasks: state.tasks.length });
  saveState(state);
  return undefined;
}

/** [F130 dossier-gate] Names in a request that may point at code: backticked, paths, dotted, CamelCase, snake_case. */
export function requestNames(request: string): string[] {
  const found = new Set<string>();
  for (const m of request.matchAll(/`([^`\n]{3,80})`/g)) found.add(m[1]!.trim());
  for (const m of request.matchAll(/\b[\w-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g)) found.add(m[0]);
  for (const m of request.matchAll(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*){1,4}\b/g)) if (/[A-Z_]/.test(m[0]) || m[0].split(".").length > 2) found.add(m[0]);
  for (const m of request.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) found.add(m[0]);
  for (const m of request.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)) if (m[0].length >= 6) found.add(m[0]);
  return [...found].filter((n) => /^[\w./()-]+$/.test(n)).slice(0, 20);
}

/**
 * [F130 dossier-gate] Why K6 needs no dossier here, or undefined when it does. No model call. The dossier saves the
 * expert a search: a small repository, or a request whose names already lead to two files or fewer, has none to save
 * (swl-k6-pair: on a2a-443 the dossier added cost; on black, a large formatter, it cut Opus's re-reading by 43%).
 */
export function dossierSkip(state: Pick<RunState, "worktree" | "prompt" | "lead">): string | undefined {
  const files = git(state.worktree, "ls-files").split("\n").filter(Boolean);
  const min = state.lead?.dossierMinFiles ?? SCOUT_FILES;
  if (files.length <= min) return `a repository of ${files.length} files`;
  const hits = new Set<string>();
  let specific = 0;
  for (const name of requestNames(state.prompt)) {
    const bare = name.replace(/\(\)$/, "");
    if (files.includes(bare) && /\.(py|pyi|js|mjs|cjs|ts|tsx|jsx|rs|go|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala)$/.test(bare)) {
      hits.add(bare);
      specific += 1;
      continue;
    }
    const last = bare.split(".").pop()!;
    if (!/^[A-Za-z_]\w*$/.test(last)) continue;
    // Where the name is defined, not merely used: a builtin or a common word is defined nowhere in the project.
    const defined = `(def|class|function|fn|const|let|var|struct|enum|interface|type|trait)[[:space:]]+${last}([^A-Za-z0-9_]|$)|^[[:space:]]*${last}[[:space:]]*(:[^=]*)?=[^=]`;
    const r = spawnSync("git", ["grep", "-l", "-E", "-e", defined], { cwd: state.worktree, encoding: "utf8", timeout: 10_000 });
    // Source files only: a name in a test, a data file or the docs says nothing about where the change goes.
    const where = (r.stdout ?? "").split("\n").filter((f) => f && /\.(py|pyi|js|mjs|cjs|ts|tsx|jsx|rs|go|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala)$/.test(f) && !/(^|\/)(tests?|testing|hidden)\/|test_|_test\.|\.test\./.test(f));
    // A name found in many files says nothing about where the change goes.
    if (where.length === 0 || where.length > 3) continue;
    specific += 1;
    for (const f of where) hits.add(f);
  }
  if (specific > 0 && hits.size <= 2) return `the request names code in ${[...hits].join(", ")}`;
  return undefined;
}

/** [F127 patch-lead] Most patch calls per task: the first and two repairs. */
const PATCH_TURNS = 3;

/**
 * [F127 patch-lead] K1's scout: on the first worker rung, with tools, in a disposable copy of the repository. It
 * writes the dossier (the code the change touches, quoted; how a test file is run here) and one test that reproduces
 * the request. The test is then judged like the lead's test file (F124): kept only if it fails on the code as it is.
 */
async function patchScout(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  state.lead!.scouted = true;
  saveState(state);
  const chain = leadHelper(state);
  if (chain.length === 0) return undefined;
  const dir = join(state.dir, "scout");
  dropCopy(state.repo, dir);
  try {
    createDetachedWorktree(state.repo, dir, headCommit(state.worktree));
    const prepared = prepareWorktree(state.repo, dir);
    await prepareEnv(run, dir, prepared);
    const { result } = await turn(run, {
      key: "patch-scout",
      role: "worker",
      kind: "scout",
      round: 0,
      cwd: dir,
      prompt: scoutPromptK1(state, state.checks.map((c) => c.command)),
      access: "write",
      schema: SCOUT_SCHEMA,
      chain,
      timeoutMs: Math.min(state.turnTimeoutMs, 12 * 60_000),
    });
    if (result.stop === "cancelled" || held(result)) return stopFor(result, "worker");
    const raw = (result.stop === "done" ? (result.structured ?? {}) : {}) as { test_path?: unknown; test_command?: unknown };
    const report = result.stop === "done" ? parseRepoReport(result) : undefined;
    if (report) state.lead!.report = report;
    const path = typeof raw.test_path === "string" ? raw.test_path.trim().replace(/^\.\//, "") : "";
    let test = false;
    if (path && isOn("lead-tests") && reproducePathOk(path) && existsSync(join(dir, path)) && !existsSync(join(state.worktree, path))) {
      const content = readFileSync(join(dir, path), "utf8");
      if (content.trim().length >= 20) {
        state.lead!.test = { path, content, command: typeof raw.test_command === "string" ? raw.test_command.trim() : "", stage: "judging" };
        test = true;
      }
    }
    log.emit("lead.report", { feature: "F127", chars: report?.length ?? 0, ok: report !== undefined, test });
    saveState(state);
    return undefined;
  } finally {
    removeDetachedWorktree(state.repo, dir);
  }
}

/** [F127 patch-lead] The expert's task on a patch-lead run, while it has patch calls left, writes its work in one call. */
function patchApplies(state: RunState, task: TaskState): boolean {
  return state.lead?.mode === "patch" && isOn("patch-lead") && task.owner === "expert" && !task.escalated && (task.patchTurns ?? 0) < PATCH_TURNS && ["initial", "repair", "review-fix"].includes(task.next);
}

/** [F127 patch-lead] Files the expert asked to see: inside the repository, at most 40,000 characters each. */
function neededFiles(dir: string, paths: string[]): { path: string; content: string }[] {
  return paths.flatMap((p) => {
    if (isAbsolute(p) || p.split("/").includes("..") || p.startsWith(".git")) return [];
    try {
      const text = readFileSync(join(dir, p), "utf8");
      return [{ path: p, content: text.length > 40_000 ? `${text.slice(0, 40_000)}\n[... cut at 40,000 characters]` : text }];
    } catch {
      return [{ path: p, content: "(no such file)" }];
    }
  });
}

/**
 * [F127 patch-lead] Apply search-and-replace edits in order. A search must occur exactly once in its file; an empty
 * search creates a new file. Paths outside the repository, into git or a prepared folder are refused.
 */
export function applyEdits(dir: string, edits: Edit[], exclude: string[]): { applied: string[]; errors: string[] } {
  const applied: string[] = [];
  const errors: string[] = [];
  for (const e of edits) {
    if (isAbsolute(e.path) || e.path.split("/").includes("..") || e.path.startsWith(".git") || exclude.some((x) => e.path === x || e.path.startsWith(`${x}/`))) {
      errors.push(`${e.path}: not a path in the repository that may be edited`);
      continue;
    }
    const full = join(dir, e.path);
    if (e.search === "") {
      if (existsSync(full)) {
        errors.push(`${e.path}: the file exists; an edit to it needs a search text`);
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, e.replace);
      applied.push(e.path);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      errors.push(`${e.path}: no such file`);
      continue;
    }
    const count = text.split(e.search).length - 1;
    if (count !== 1) {
      errors.push(`${e.path}: the search text occurs ${count} times (it must occur exactly once): ${JSON.stringify(e.search.slice(0, 120))}`);
      continue;
    }
    const at = text.indexOf(e.search);
    writeFileSync(full, text.slice(0, at) + e.replace + text.slice(at + e.search.length));
    applied.push(e.path);
  }
  return { applied, errors };
}

/**
 * [F127 patch-lead] One patch round: the expert, in one call with no tools, from the request, the scout's dossier, the
 * kept reproduction and (on a repair) the failing checks and the change so far, gives search-and-replace edits; it may
 * ask once to read up to four files, which Neuromesh reads for it. Neuromesh applies the edits and hands over to the
 * checks; a failing check comes back here as a repair, at most PATCH_TURNS calls in all.
 */
async function patchTurn(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const mode = task.next;
  const t = state.lead?.test?.stage === "accepted" ? state.lead.test : undefined;
  const repro = t ? { path: t.path, content: t.content, command: t.command, tail: t.tail ?? "" } : undefined;
  const failing = (task.latest ?? []).filter((r) => r.status !== "passed");
  let failures = mode === "initial" ? undefined : failing.map((r) => `${r.name} (\`${r.command}\`) ${r.status}:\n${r.tail.slice(-2_500)}`).join("\n\n") || "The checks did not pass.";
  let applyErrors: string[] | undefined;
  let files: { path: string; content: string }[] | undefined;
  // A small project with no dossier is shown whole, as F77 shows it.
  if (!state.lead?.report) files = projectFiles(task.worktree, task.prepared);
  for (let call = 0; call < 3; call++) {
    const diff = mode === "initial" && !applyErrors ? undefined : git(task.worktree, "diff", task.base!);
    const { result } = await turn(run, {
      key: `${task.id}-patch`,
      role: roleFor(state, task),
      kind: mode,
      task: task.id,
      round: task.round,
      cwd: task.worktree,
      prompt: leadPatchPrompt(state, { dossier: state.lead?.report, repro, files, failures, diff, applyErrors, canAsk: !task.patchAsked }),
      access: "read-only",
      schema: PATCH_SCHEMA,
      direct: true,
    });
    if (result.stop === "cancelled" || result.stop === "quota" || held(result)) {
      saveState(state);
      return stopFor(result, roleFor(state, task) === "worker" ? "worker" : "expert");
    }
    const answer = result.stop === "done" ? optional(run, "patch-lead", undefined, () => parsePatch(result)) : undefined;
    if (answer && answer.need.length > 0 && !task.patchAsked) {
      task.patchAsked = true;
      files = [...(files ?? []), ...neededFiles(task.worktree, answer.need.slice(0, 4))];
      log.emit("note", { feature: "F127", message: `Task ${task.id}: the expert asked to read ${answer.need.slice(0, 4).join(", ")}; Neuromesh reads them for it.` });
      saveState(state);
      continue;
    }
    task.patchTurns = (task.patchTurns ?? 0) + 1;
    if (!answer || answer.edits.length === 0) {
      saveState(state);
      return failTask(run, task, `the expert's patch call gave no usable edits (${result.stop}${result.detail ? `: ${result.detail.slice(0, 120)}` : ""})`);
    }
    const outcome = applyEdits(task.worktree, answer.edits, task.prepared);
    log.emit("task.patch", { feature: "F127", task: task.id, mode, applied: outcome.applied, errors: outcome.errors.slice(0, 8), call: task.patchTurns });
    if (outcome.applied.length === 0) {
      if (task.patchTurns >= PATCH_TURNS) return failTask(run, task, `none of the expert's edits could be applied: ${outcome.errors.slice(0, 3).join("; ")}`);
      applyErrors = outcome.errors;
      failures = failures ?? "None of the edits could be applied.";
      continue;
    }
    task.report = { status: "done", summary: answer.summary || "the expert's patch", notes: outcome.errors.length > 0 ? `Edits not applied: ${outcome.errors.join("; ")}` : undefined };
    task.sessionId = undefined;
    task.sessionModel = undefined;
    task.step = "checks";
    saveState(state);
    return undefined;
  }
  return failTask(run, task, "the expert's patch calls ran out");
}

/** [F126 lead-direct] The lead's tool can answer in one call with no tools. */
function leadCanDirect(run: RunCtx): boolean {
  const first = roleChain(run.state, "orchestrator")[0];
  return first !== undefined && run.ctx.backends[first.backend]?.direct === true;
}

/** [F122 lead-scout] A repository with more files than this gets a cheap developer's report before the lead plans. */
const SCOUT_FILES = 150;

/** [F122 lead-scout] [F123 lead-evidence] The cheap developer who reads and probes for the lead: the first worker rung. */
function leadHelper(state: RunState): RoleConfig[] {
  const first = state.workerLadder?.[state.workerRung ?? 0] ?? state.roles.worker?.[0];
  return first && !state.exhausted.includes(modelKey(first)) ? [first] : [];
}

/**
 * [F122 lead-scout] On a big repository, a cheap developer reads it first and writes a report for this request, so the
 * lead plans from the report and opens files only to confirm a detail. Asked once per run; no report, no harm.
 */
async function leadScout(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  state.lead!.scouted = true;
  saveState(state);
  const files = git(state.worktree, "ls-files").split("\n").filter(Boolean).length;
  const chain = leadHelper(state);
  if (files <= SCOUT_FILES || chain.length === 0) return undefined;
  const { result } = await turn(run, {
    key: "lead-report",
    role: "worker",
    kind: "scout",
    round: 0,
    cwd: state.worktree,
    prompt: leadReportPrompt(state),
    access: "read-only",
    schema: REPORT_SCHEMA,
    chain,
    timeoutMs: SCOUT_MS * 2,
  });
  if (result.stop === "cancelled" || held(result)) return stopFor(result, "worker");
  const report = result.stop === "done" ? parseRepoReport(result) : undefined;
  if (report) state.lead!.report = report;
  log.emit("lead.report", { feature: "F122", files, chars: report?.length ?? 0, ok: report !== undefined });
  saveState(state);
  return undefined;
}

/**
 * [F123 lead-evidence] A cheap developer writes a probe for each acceptance case in a disposable copy of the merged work
 * and runs it; then Neuromesh runs every probe again in its sandbox, and its exit status is the result. A probe that
 * cannot run (no command, not found, timed out) is "unconfirmed".
 */
async function leadEvidence(run: RunCtx, round: number, head: string, cases: string[]): Promise<CaseResult[] | Stop | undefined> {
  const { state, log } = run;
  const chain = leadHelper(state);
  if (chain.length === 0) return undefined;
  const dir = join(state.dir, "lead");
  dropCopy(state.repo, dir);
  const found: CaseResult[] = [];
  try {
    createDetachedWorktree(state.repo, dir, head);
    const prepared = prepareWorktree(state.repo, dir);
    await prepareEnv(run, dir, prepared);
    const { result } = await turn(run, {
      key: `lead-evidence-${round}`,
      role: "worker",
      kind: "evidence",
      round,
      cwd: dir,
      prompt: leadEvidencePrompt(state, cases),
      access: "write",
      schema: EVIDENCE_SCHEMA,
      chain,
      // A few short probes, not a session: one ran to the 30-minute turn limit in swl-lead-3c (mcp-1154).
      timeoutMs: Math.min(state.turnTimeoutMs, 8 * 60_000),
    });
    if (result.stop === "cancelled" || held(result)) return stopFor(result, "worker");
    const probes = result.stop === "done" ? parseEvidence(result) : [];
    for (let i = 0; i < cases.length; i++) {
      const probe = probes[i];
      if (!probe?.command || run.signal.aborted) {
        found.push({ case: cases[i]!, command: probe?.command ?? "", result: "unconfirmed", output: "no probe was given" });
        continue;
      }
      const r = await runCommand(dir, probe.command, { timeoutMs: 120_000, env: isOn("work-env") ? envVars(dir) : undefined, signal: run.signal });
      const outcome = r.timedOut || r.exitCode === null || r.exitCode === 126 || r.exitCode === 127 ? "unconfirmed" : r.exitCode === 0 ? "holds" : "fails";
      found.push({ case: cases[i]!, command: probe.command, result: outcome, output: r.output.slice(-1_500) });
    }
  } finally {
    removeDetachedWorktree(state.repo, dir);
  }
  const count = (k: CaseResult["result"]): number => found.filter((f) => f.result === k).length;
  log.emit("lead.evidence", { feature: "F123", round, cases: cases.length, holds: count("holds"), fails: count("fails"), unconfirmed: count("unconfirmed") });
  return found;
}

/**
 * [F120 lead] After the tasks: the evidence first (F123), and only when a case fails or cannot be shown, the lead's own
 * review, read-only, from that evidence and the change: it accepts or adds follow-up tasks (each with the developer it
 * chose, itself included), which the scheduler runs like any task, and the next round checks again. At most
 * `lead.reviews` rounds; a failed task, a spent expert budget, a preset with no orchestrator or an unusable answer ends
 * them and the run goes on to its final step as it stands.
 */
async function leadStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const round = (state.leadRounds ?? 0) + 1;
  const toFinal = (why?: string): undefined => {
    if (why) log.emit("note", { feature: "F120", message: why });
    state.step = "final";
    saveState(state);
    return undefined;
  };
  if (!state.lead || !isOn("lead") || round > state.lead.reviews) return toFinal();
  if (roleChain(state, "orchestrator").length === 0) return toFinal("No model leads this preset (no orchestrator), so nobody reviews.");
  if (state.tasks.some((t) => t.status !== "passed")) return toFinal("A task did not pass, so the lead does not review; the run ends as it stands.");
  const head = git(state.worktree, "rev-parse", "HEAD").trim();
  const latest = [...state.tasks].reverse().find((t) => t.latest)?.latest;
  const checksOk = !(latest ?? []).some((r) => r.status === "failed" || r.status === "timeout");
  const cases = state.lead.cases ?? [];
  let evidence: CaseResult[] | undefined;
  // [F124 lead-tests] With the lead's test file kept, it is the evidence: run once more on the merged work, no model turn.
  const test = state.lead.test?.stage === "accepted" && isOn("lead-tests") ? state.lead.test : undefined;
  if (test) {
    const own = state.tasks.find((t) => t.reproduce?.outcome === LEAD_TESTS && t.reproduce.content !== undefined);
    if (own && own.reproduce!.content !== test.content) test.content = own.reproduce!.content!;
    const [r] = await check(run, state.worktree, `lead-tests-${round}`, [{ name: "lead-tests", command: test.command }]);
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    const passed = r?.status === "passed";
    log.emit("lead.evidence", { feature: "F124", round, cases: 1, holds: passed ? 1 : 0, fails: passed ? 0 : 1, unconfirmed: 0, by: "tests" });
    if (passed && checksOk) {
      state.leadRounds = round;
      log.emit("lead.review", { feature: "F124", round, decision: "accept", by: "evidence", summary: "the lead's acceptance tests pass", followups: [] });
      return toFinal();
    }
    evidence = [{ case: `the lead's acceptance tests (${test.path})`, command: test.command, result: passed ? "holds" : "fails", output: r?.tail.slice(-3_000) ?? "" }];
  }
  // [F123 lead-evidence]
  if (!test && cases.length > 0 && isOn("lead-evidence")) {
    if (state.lead.evidence?.round === round) evidence = state.lead.evidence.results;
    else {
      const got = await optionalAsync(run, "lead-evidence", undefined, () => leadEvidence(run, round, head, cases));
      if (got && !Array.isArray(got)) return got;
      evidence = got;
      if (evidence) {
        state.lead.evidence = { round, results: evidence };
        saveState(state);
      }
    }
    if (evidence && evidence.every((e) => e.result === "holds") && checksOk) {
      state.leadRounds = round;
      log.emit("lead.review", { feature: "F123", round, decision: "accept", by: "evidence", summary: `all ${cases.length} acceptance cases hold`, followups: [] });
      return toFinal();
    }
  }
  if (!budgetLeft(state)) return toFinal("The expert budget is spent, so the lead does not review.");
  const diff = git(state.worktree, "diff", "--binary", state.base, head);
  const directReview = isOn("lead-direct") && leadCanDirect(run);
  const senior = state.seniorRung !== undefined;
  const grunt = state.workerRung !== undefined;
  const { result } = await turn(run, {
    key: `lead-review-${round}`,
    role: "orchestrator",
    kind: "lead-review",
    round,
    cwd: state.worktree,
    // [F126 lead-direct] The review's prompt holds the change and the evidence: one call, no tools.
    prompt: leadReviewPrompt(state, diff, latest, evidence, round, state.lead.reviews, senior, grunt, directReview),
    access: "read-only",
    schema: LEAD_SCHEMA,
    direct: directReview || undefined,
  });
  if (result.stop === "cancelled" || held(result)) return stopFor(result, "orchestrator");
  state.leadRounds = round;
  if (result.stop !== "done") return toFinal(`The lead's review ended without an answer (${result.stop}); the work goes on as the checks left it.`);
  // [F125 lead-no-takeover] A follow-up is a takeover too: it goes to the strongest developer below the expert.
  const review = optional(run, "lead", undefined, () => parseLead(result, senior, grunt, blueprintOn(state) || isOn("lead-no-takeover")));
  if (!review) return toFinal("The lead's review was not usable; the work goes on as the checks left it.");
  log.emit("lead.review", { feature: "F120", round, decision: review.decision, by: "lead", summary: review.summary, followups: review.followups.map((f) => ({ id: f.id, title: f.title, owner: f.owner })) });
  if (review.decision === "accept") return toFinal();
  // Follow-ups run one after another: they have no owned files, so side by side they could edit the same ones.
  let previous: string | undefined;
  for (const f of review.followups) {
    let id = `r${round}-${f.id}`;
    while (state.tasks.some((t) => t.id === id)) id += "x";
    state.tasks.push(newTask(state, { ...f, id, dependsOn: previous ? [previous] : [] }));
    previous = id;
  }
  state.step = "tasks";
  saveState(state);
  return undefined;
}

async function planStep(run: RunCtx): Promise<Stop | undefined> {
  const { state, log } = run;
  const files = git(state.worktree, "ls-files").split("\n").filter(Boolean);
  // [F126 lead-direct] With a report that quotes the code, the lead plans in one call with no tools; a plan that is not
  // usable is asked for again as a normal turn with tools.
  let directPlan = Boolean(state.lead && isOn("lead") && isOn("lead-direct") && state.lead.report) && leadCanDirect(run);
  let first = plannerPrompt(state, files, directPlan);
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
      // [F120 lead] The lead's plan also lists the request's acceptance cases.
      schema: state.lead && isOn("lead") ? LEAD_PLAN_SCHEMA : PLAN_SCHEMA,
      resume,
      direct: directPlan || undefined,
    });
    // [F126 lead-direct] A one-call plan that did not finish is asked for again with tools (not for a stop the person must see to).
    if (directPlan && result.stop !== "done" && result.stop !== "cancelled" && result.stop !== "quota" && !held(result)) {
      log.emit("note", { feature: "F126", message: `The lead's one-call plan ended ${result.stop}; it plans again with tools.` });
      directPlan = false;
      first = plannerPrompt(state, files, false);
      prompt = first;
      resume = undefined;
      continue;
    }
    if (result.stop !== "done") return stopFor(result, "orchestrator");
    state.planSession = result.sessionId;
    try {
      const plan = parsePlan(result, state.maxTasks, state.seniorRung !== undefined, { grunt: state.workerRung !== undefined, blueprint: blueprintOn(state) });
      state.plan = plan;
      if (state.lead && isOn("lead")) {
        state.lead.cases = optional(run, "lead", [], () => parseCases(result));
        // [F124 lead-tests]
        const test = isOn("lead-tests") ? optional(run, "lead-tests", undefined, () => parseLeadTest(result)) : undefined;
        state.lead.test = test ? { ...test, stage: "judging" } : undefined;
      }
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
      // [F126 lead-direct] The corrected plan comes from a normal turn with tools.
      if (directPlan) {
        directPlan = false;
        first = plannerPrompt(state, files, false);
        prompt = first;
        resume = undefined;
        continue;
      }
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
function wantsTester(run: RunCtx, task: TaskState): boolean {
  const { state } = run;
  if (!state.roles.tester || task.escalated) return false;
  // [F82 grunt-tier] A grunt's work that no check verifies is reviewed, whatever the staffing says.
  const uncheckedGrunt = state.checks.length === 0 && isOn("grunt-tier") && state.workerRung !== undefined && tierAtRung(state, task.rung) === "grunt";
  if (state.brief && !state.brief.staffing.tester && !uncheckedGrunt) return false;
  // [F71 one-review] A new program built in parts is reviewed once, when it is whole.
  if (reviewsWhole(state) && task !== state.tasks.at(-1) && !isLastOpen(state, task)) return false;
  if (uncheckedGrunt) return true;
  return state.test !== "no-checks" || state.checks.length === 0 || greenChecks(run, task);
}

/**
 * [F119 green-checks] Every check passed before the work started, and no reproduction of the request joined them: they
 * cannot tell whether a fix or a feature was done (a real repository's suite, green at the start). A refactor is the
 * exception: green checks that stay green are its proof. Read only; a failure inside is treated as "not green".
 */
function greenChecks(run: RunCtx, task: TaskState): boolean {
  const { state } = run;
  if (!isOn("green-checks") || state.checks.length === 0) return false;
  if (state.brief?.kind === "refactor" || state.brief?.kind === "trivial") return false;
  if (task.reproduce?.stage === "accepted") return false;
  const test = (): boolean => {
    const base = state.baseline ?? [];
    return base.length > 0 && base.every((b) => b.status === "passed");
  };
  return optional(run, "green-checks", false, test);
}

/** [F71 one-review] The spec split a new program into parts: one review, of the whole, at the end. */
function reviewsWhole(state: RunState): boolean {
  if (!isOn("one-review") || state.tasks.length <= 1) return false;
  if (state.planFromSpec === true) return true;
  // [F98 cascade-one-review] So is one the cascade's expert planned or split: its parts' briefs share one design.
  return isOn("cascade-one-review") && state.cascade !== undefined && (state.plan !== undefined || state.tasks.some((t) => t.fromSplit));
}

/** [F71 one-review] What the final reviewer sees: every file of the program, then the last part's change. */
function wholeProgramDiff(state: RunState, task: TaskState, candidate: string): string {
  const stat = git(task.worktree, "diff", "--stat=120", state.base, candidate);
  const last = git(task.worktree, "diff", "--binary", task.base!, candidate);
  return `# The whole program, against the start of the run\n${stat}\n# The last part's change (${task.title})\n${last}`;
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
  // [F118 keep-checks] Work that never reached its checks has not passed them (a failed turn kept as "the checks pass").
  if (task.latest === undefined && isOn("keep-checks")) return false;
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
    // [F82 grunt-tier] A stuck grunt is not tried on another grunt rung.
    climbTo(run, task, gruntGate(state, task) ? state.workerRung! : (task.rung ?? 0) + 1, reason, gruntGate(state, task) ? "F82" : undefined);
    return;
  }
  task.escalationReason = reason;
  task.step = nextEscalation(state, task);
  saveState(state);
}

/** Move a task to a stronger rung of the ladder: a fresh session there, told exactly what went wrong. */
function climbTo(run: RunCtx, task: TaskState, rung: number, reason: string, feature?: string): void {
  const { state, log } = run;
  const ladder = state.workerLadder!;
  const from = ladder[task.rung ?? 0]!;
  task.rung = rung;
  const to = ladder[rung]!;
  task.round = 0;
  task.progress = newHistory();
  task.next = "climb";
  task.sessionId = undefined;
  task.sessionModel = undefined;
  task.step = "agent";
  saveState(state);
  log.emit("task.climbed", { ...(feature ? { feature } : {}), task: task.id, from: modelKey(from), to: modelKey(to), reason });
}

/**
 * [F79 finding-owner] A reviewer's finding names a file that another task
 * built on a stronger rung (or the expert built): the fix needs at least that
 * rung. Returns the rung and the file, or nothing when this task's own rung is
 * enough. (The first three-tier run gave a flaw in the senior tier's number
 * formatting to the cheapest worker, which documented it instead of fixing it,
 * then spent 19 minutes on it.)
 */
function strongerOwner(state: RunState, task: TaskState, findings: Finding[]): { rung: number; file: string } | undefined {
  const ladder = state.workerLadder;
  if (!ladder || task.owner === "expert" || task.escalated || task.advised) return undefined;
  const clean = (p: string): string => p.trim().replace(/^\.\//, "");
  let best: { rung: number; file: string } | undefined;
  for (const f of findings) {
    if (!f.file) continue;
    const file = clean(f.file);
    for (const other of state.tasks) {
      if (other.id === task.id || !other.owned.some((o) => clean(o) === file)) continue;
      const rung = other.owner === "expert" || other.escalated ? ladder.length - 1 : Math.min(other.rung ?? 0, ladder.length - 1);
      if (rung > (task.rung ?? 0) && (!best || rung > best.rung)) best = { rung, file };
    }
  }
  return best;
}

/**
 * [F82 grunt-tier] Gate 1: a grunt's work is checked only by deterministic
 * checks, and a grunt is never asked to repair it or to judge itself; a
 * failure goes to the first worker rung with the errors.
 */
function gruntGate(state: RunState, task: TaskState): boolean {
  return isOn("grunt-tier") && state.workerRung !== undefined && !task.escalated && !task.advised && task.owner !== "expert" && tierAtRung(state, task.rung) === "grunt";
}

/**
 * [F86 escalation-breaker] Escalation is acyclic and capped: once this many
 * tasks of the run have gone to the expert, another stuck task does not.
 */
function breakerTripped(state: RunState, task: TaskState): boolean {
  const max = state.cascade?.maxEscalations;
  if (max === undefined || !isOn("escalation-breaker") || task.advised || task.escalated) return false;
  return state.tasks.filter((t) => t !== task && (t.advised || t.escalated)).length >= max;
}

/** [F83 early-exit] The confidence threshold for this turn's preamble, or nothing when the turn gets none. */
function preambleGate(state: RunState, task: TaskState, role: Role): number | undefined {
  if (!state.cascade || !isOn("early-exit") || role !== "worker" || !state.workerLadder) return undefined;
  if (task.noPreamble || task.escalated || task.advised || task.owner === "expert" || (task.next !== "initial" && task.next !== "climb")) return undefined;
  const tier = tierAtRung(state, task.rung);
  // The grunt never judges itself: its gate is the deterministic checks (F82).
  if (tier === "grunt") return undefined;
  // Nowhere to send it (no higher tier, no expert, or the breaker is open): asking would only risk a stopped turn.
  if (nextTierRung(state, task.rung) === undefined && (!canEscalate(state) || breakerTripped(state, task))) return undefined;
  return tier === "senior" ? state.cascade.thresholds.senior : state.cascade.thresholds.worker;
}

/** [F96 scope-escalate] Whether this task's preamble may ask for a design first: the run's one unplanned, unsplit task. */
function scopeAsked(state: RunState, task: TaskState): boolean {
  return isOn("scope-escalate") && task.routed === true && !task.fromSplit && !state.plan && canSplit(state, task);
}

/** [F84 bottleneck-diagnostic] Gate 3: in its own session, the stuck developer isolates the one sub-problem for the expert. */
async function diagnoseStep(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const config = state.workerLadder?.[task.rung ?? 0];
  if (!config || modelKey(config) !== task.sessionModel || !task.sessionId) return undefined;
  const { result } = await turn(run, {
    key: `${task.id}-diagnose`,
    role: "worker",
    kind: "diagnose",
    task: task.id,
    round: task.round,
    cwd: task.worktree,
    prompt: diagnosePrompt(),
    access: "read-only",
    schema: DIAGNOSE_SCHEMA,
    resume: { sessionId: task.sessionId, model: task.sessionModel },
    chain: [config],
    timeoutMs: 5 * 60_000,
    rungBase: task.rung,
  });
  if (result.stop === "cancelled" || held(result)) return stopFor(result, "worker");
  const text = result.stop === "done" ? parseDiagnosis(result) : undefined;
  if (text) {
    task.bottleneck = text;
    saveState(state);
    log.emit("task.diagnosed", { feature: "F84", task: task.id, bottleneck: text });
  }
  return undefined;
}

/** [F88 shadow-eval] Keep a share of the cheap tiers' passes for a stronger model to grade later. */
function shadowSample(run: RunCtx, task: TaskState): void {
  const { state, ctx, log } = run;
  const tier = taskTier(state, task);
  if (!state.cascade || (tier !== "grunt" && tier !== "worker")) return;
  const model = state.attempts.filter((a) => a.task === task.id && a.cascadeTier === tier).at(-1)?.model;
  const path = maybeEnqueue(ctx.home, { run: state.id, task: task.id, title: task.title, brief: task.brief, cluster: task.routed ? state.cascade.route?.cluster : undefined, tier, model, diff: diffOf(task) }, state.cascade.shadowRate);
  if (path) log.emit("shadow.sampled", { feature: "F88", task: task.id, tier });
}

/** At the end of a finished run: the cascade's measured economics (F87) and what Tier 0 learns from it (F81). */
function cascadeEnd(run: RunCtx): void {
  const { state, ctx, log } = run;
  if (!state.cascade) return;
  if (isOn("routing-summary")) {
    optional(run, "routing-summary", undefined, () => {
      const summary = routingSummary(
        state.attempts.map((a) => ({ task: a.task, tier: a.cascadeTier ?? "other", model: a.model, usage: a.usage, earlyExit: a.earlyExit })),
        state.tasks.map((t) => ({ id: t.id, passed: t.status === "passed", tier: taskTier(state, t) })),
        (roleChain(state, "escalation")[0] ?? roleChain(state, "orchestrator")[0])?.model,
      );
      log.emit("routing.summary", { feature: "F87", ...summary, lines: describeSummary(summary) });
    });
  }
  // [F81 route-calibration] Recorded once: a resumed run does not count its tasks again.
  if (isOn("route-calibration") && state.cascade.route && !state.cascade.recorded) {
    state.cascade.recorded = true;
    saveState(state);
    optional(run, "route-calibration", undefined, () => {
      const table = loadCalibration(ctx.home);
      let n = 0;
      for (const t of state.tasks.filter((x) => x.routed)) {
        const visited = state.attempts.filter((a) => a.task === t.id && a.cascadeTier).map((a) => a.cascadeTier!);
        recordOutcome(table, { cluster: state.cascade!.route!.cluster, tiers: [...visited, taskTier(state, t)], passed: t.status === "passed" });
        n += 1;
      }
      if (n > 0) {
        saveCalibration(ctx.home, table);
        log.emit("routing.calibrated", { feature: "F81", tasks: n, cluster: state.cascade!.route!.cluster ?? "none" });
      }
    });
  }
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

/** [F77 direct-build] One-answer turns a task gets (the build and one repair) before a worker with tools takes over. */
const DIRECT_TURNS = 2;
/** [F77 direct-build] Most characters of project files shown to a one-answer worker. */
const DIRECT_PROJECT_CHARS = 120_000;

/** [F77 direct-build] The worker models this task would use now, first choice first. */
function workerChain(state: RunState, task: TaskState): RoleConfig[] {
  const chain = state.workerLadder ? state.workerLadder.slice(task.rung ?? 0) : (state.roles.worker ?? []);
  return chain.filter((c) => !state.exhausted.includes(modelKey(c)));
}

/**
 * [F77 direct-build] A worker's part of a program that has a spec, on a tool
 * that can answer with no tools, for the build and one repair. After that, or
 * when an answer cannot be used, the worker gets its tools as before.
 */
function directApplies(run: RunCtx, task: TaskState): boolean {
  const { state, ctx } = run;
  // [F90 direct-grunt] A transform of text the request contains: the grunt answers once, with no tools.
  if (directGrunt(state, task)) {
    const first = workerChain(state, task)[0];
    return first !== undefined && ctx.backends[first.backend]?.direct === true;
  }
  // [F109 direct-worker] A cascade worker's small self-contained request, or its part of a planned program that has a spec.
  if (directWorker(run, task) !== undefined) {
    const first = workerChain(state, task)[0];
    return first !== undefined && ctx.backends[first.backend]?.direct === true;
  }
  if (!isOn("direct-build") || !state.direct || !state.brief?.spec) return false;
  if (task.owner !== "worker" || task.escalated || task.advised || task.directOff || task.envProblem) return false;
  if ((task.directTurns ?? 0) >= DIRECT_TURNS || !["initial", "repair", "review-fix"].includes(task.next)) return false;
  const first = workerChain(state, task)[0];
  return first !== undefined && ctx.backends[first.backend]?.direct === true;
}

/**
 * [F90 direct-grunt] Tier 0 found a mechanical transform of text the request
 * contains, and the task is on a grunt rung: one answer, no tools, so the
 * grunt does not load Claude Code's tool definitions to format a few lines.
 * One try; after that (or an unusable answer) the usual path takes over.
 */
function directGrunt(state: RunState, task: TaskState): boolean {
  return isOn("direct-grunt") && state.cascade?.route?.transform === true && task.routed === true && !task.escalated && !task.advised && !task.directOff && (task.directTurns ?? 0) < 1 && task.next === "initial" && tierAtRung(state, task.rung) === "grunt";
}

/**
 * [F109 direct-worker] The cascade's worker turns that need nothing the tools would
 * fetch. "request": the task is the whole request and a one-line check says it is a
 * small, self-contained piece of work (selfContained): one no-tools answer (the build
 * only; failing checks hand it to a worker with tools). "part": the expert's plan gave
 * the task a spec: as F77 does, a build and one repair with no tools. Never above the
 * worker tier, never after an escalation or advice, never when the answer was unusable.
 */
function directWorker(run: RunCtx, task: TaskState): "request" | "part" | undefined {
  const { state } = run;
  if (!isOn("direct-worker") || !state.cascade || task.escalated || task.advised || task.directOff || task.envProblem) return undefined;
  if (tierAtRung(state, task.rung) !== "worker" || task.owner !== "worker") return undefined;
  if (wholeRequest(state, task)) {
    if (!state.cascade.route || task.routed !== true || (task.directTurns ?? 0) >= 1 || task.next !== "initial") return undefined;
    // The user's own words: state.prompt also carries the brief's working standards, which are not part of what was asked.
    const verdict = selfContained(state.request ?? state.prompt, projectFiles(task.worktree, task.prepared));
    return verdict.ok ? "request" : undefined;
  }
  if (state.brief?.spec && (task.directTurns ?? 0) < DIRECT_TURNS && ["initial", "repair", "review-fix"].includes(task.next)) return "part";
  return undefined;
}

/** [F77 direct-build] The project's text files, smallest first up to a size limit, for a worker that cannot read. */
function projectFiles(dir: string, exclude: string[]): { path: string; content: string }[] {
  const listed = git(dir, "ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
  const files: { path: string; content: string }[] = [];
  for (const path of listed) {
    if (exclude.some((e) => path === e || path.startsWith(`${e}/`)) || /(^|\/)(node_modules|\.venv|__pycache__)\//.test(path) || /\.(lock|png|jpg|jpeg|gif|ico|pdf|zip|gz|bin|joblib|db|sqlite)$/i.test(path)) continue;
    try {
      const text = readFileSync(join(dir, path), "utf8");
      if (text.length > 40_000 || text.includes("\u0000")) continue;
      files.push({ path, content: text });
    } catch {
      // Deleted, or not a regular file.
    }
  }
  files.sort((a, b) => a.content.length - b.content.length);
  let total = 0;
  return files.filter((f) => (total += f.content.length) <= DIRECT_PROJECT_CHARS).sort((a, b) => a.path.localeCompare(b.path));
}

/** [F77 direct-build] Write a worker's files into its folder; paths that leave it, or point into git or a prepared folder, are refused. */
export function writeDirect(dir: string, files: { path: string; content: string }[], exclude: string[]): { written: string[]; refused: string[] } {
  const root = realpathSync(dir);
  const written: string[] = [];
  const refused: string[] = [];
  for (const f of files) {
    // A model sometimes gives the whole path of the folder it was started in.
    const given = isAbsolute(f.path) ? relative(root, f.path.startsWith(root) ? f.path : resolve(root, relative(dir, f.path))) : f.path;
    const path = normalize(given).replace(/^(\.\/)+/, "");
    const first = path.split("/")[0] ?? "";
    if (path === "" || path === "." || path.startsWith("..") || isAbsolute(path) || first === ".git" || exclude.includes(first) || written.length >= 60) {
      refused.push(f.path);
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), f.content);
    written.push(path);
  }
  return { written, refused };
}

/** [F77 direct-build] One turn: ask for the part's files, write them, and hand over to the checks. */
async function directTurn(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const mode = task.next;
  // [F109 direct-worker] Which rule let this turn be a one-answer turn, for the events.
  const kind = directGrunt(state, task) ? undefined : directWorker(run, task);
  const feature = kind ? "F109" : "F77";
  const { result } = await turn(run, {
    key: task.id,
    role: "worker",
    kind: mode,
    task: task.id,
    round: task.round,
    cwd: task.worktree,
    prompt: directGrunt(state, task) || kind === "request" ? directAnswerPrompt(state, projectFiles(task.worktree, task.prepared)) : directPrompt(state, task, projectFiles(task.worktree, task.prepared)),
    access: "read-only",
    schema: directSchema(),
    direct: true,
    chain: workerChain(state, task),
    rungBase: task.rung,
  });
  task.directTurns = (task.directTurns ?? 0) + 1;
  if (result.stop === "cancelled" || result.stop === "quota" || held(result)) {
    saveState(state);
    return stopFor(result, "worker");
  }
  const answer = result.stop === "done" ? optional(run, "direct-build", undefined, () => parseDirect(result)) : undefined;
  const outcome = answer ? optional(run, "direct-build", undefined, () => writeDirect(task.worktree, answer.files, task.prepared)) : undefined;
  if (!answer || !outcome || outcome.written.length === 0) {
    task.directOff = true;
    saveState(state);
    log.emit("note", { feature, message: `Task ${task.id}: the one-answer turn gave nothing usable (${result.stop}${result.detail ? `: ${result.detail.slice(0, 120)}` : ""}); the worker gets its tools.` });
    return undefined;
  }
  task.report = answer.report;
  task.sessionId = undefined;
  task.sessionModel = undefined;
  task.step = "checks";
  saveState(state);
  log.emit("task.direct", { feature, task: task.id, mode, files: outcome.written, refused: outcome.refused, ...(kind ? { rule: kind } : {}) });
  if (isOn("task-report")) log.emit("task.report", { feature: "F44", task: task.id, role: "worker", status: answer.report.status, summary: answer.report.summary.slice(0, 8_000), notes: answer.report.notes?.slice(0, 4_000), choices: answer.report.choices?.slice(0, 8_000), open: answer.report.open?.slice(0, 8_000) });
  return undefined;
}

/**
 * [F75 sync-before-checks] Bring a task's folder up to date with the work other
 * tasks have merged since it started, so its checks test the program as it is
 * now. Without this, the later of two tasks built at the same time was tested
 * without the other's work, failed through no fault of its own, and went to
 * repair rounds and the expert. A conflict is left for the merge step.
 */
function syncTask(run: RunCtx, task: TaskState): void {
  const { state, log } = run;
  const head = headCommit(state.worktree);
  if (!task.base || head === task.base) return;
  commitAll(task.worktree, `neuromesh: ${task.title} (work so far)`, task.prepared);
  if (mergeBranch(task.worktree, head, `neuromesh: bring task ${task.id} up to date`) === "conflict") {
    log.emit("note", { feature: "F75", message: `Task ${task.id}: its work conflicts with what other tasks merged; its checks run without their work.` });
    return;
  }
  task.base = head;
  saveState(state);
  log.emit("task.synced", { feature: "F75", task: task.id, head });
}

/**
 * [F73 heal-worktree] Put a task's work folder right after an agent has been in
 * it. When the folder had to be made again, the turn's uncommitted work is
 * gone: the next turn starts a fresh session and is told so by the checks.
 */
function healTask(run: RunCtx, task: TaskState): void {
  if (!isOn("heal-worktree") || !task.base) return;
  const { state, log } = run;
  const healed = optional(run, "heal-worktree", undefined, () => healWorktree(state.repo, task.worktree, task.branch, task.base!));
  if (!healed || healed.fixed.length === 0) return;
  if (healed.restored) {
    task.prepared = prepareWorktree(state.repo, task.worktree);
    task.sessionId = undefined;
    task.sessionModel = undefined;
  }
  saveState(state);
  log.emit("worktree.healed", { feature: "F73", task: task.id, restored: healed.restored, fixed: healed.fixed });
}

/** The run's one task is the request itself (no plan divided it). */
function wholeRequest(state: RunState, task: TaskState): boolean {
  return state.tasks.length === 1 && task.brief === state.prompt;
}

/**
 * [F104 quota-shift] The models this cheap turn goes to first, when the
 * subscription it would spend is at or past the preset's threshold. Senior and
 * expert turns stay where they are: they are what the plan is being kept for.
 * An unknown reading moves nothing.
 */
function quotaShiftFor(run: RunCtx, req: TurnRequest, own: RoleConfig[]): { to: RoleConfig[]; used: number } | undefined {
  const { state, ctx } = run;
  const shift = state.quotaShift;
  if (!shift || !isOn("quota-shift")) return undefined;
  if (req.role !== "worker" && req.role !== "tester") return undefined;
  // A turn that only makes sense inside its own session (the stuck developer's diagnosis) cannot move.
  if (req.resume?.sessionId && !req.freshPrompt) return undefined;
  const first = own[0];
  if (!first || first.backend !== shift.backend || tierOf(req.role, first) === "expert") return undefined;
  if (req.role === "worker" && state.workerLadder && state.seniorRung !== undefined) {
    const at = state.workerLadder.findIndex((c, n) => n >= (req.rungBase ?? 0) && modelKey(c) === modelKey(first));
    if (tierAtRung(state, at >= 0 ? at : req.rungBase) === "senior") return undefined;
  }
  const now = optional(run, "quota-shift", undefined, () => shiftNow(shift, loadQuota(ctx.home)[shift.backend]));
  if (!now) return undefined;
  const to = shift.to.filter((c) => ctx.backends[c.backend] !== undefined && !state.exhausted.includes(modelKey(c)) && (!req.direct || ctx.backends[c.backend]?.direct === true));
  return to.length > 0 ? { to, used: now.used } : undefined;
}

/** [F102 repair-race] The models of the task's own tier, from its rung up: a racer never runs on a dearer tier. */
function raceChain(state: RunState, task: TaskState): RoleConfig[] {
  const ladder = state.workerLadder;
  const own = ladder ? ladder.slice(task.rung ?? 0, nextTierRung(state, task.rung) ?? ladder.length) : (state.roles.worker ?? []);
  return own.filter((c) => !state.exhausted.includes(modelKey(c)));
}

/**
 * [F102 repair-race] Whether a task that is out of repairs gets two fresh
 * attempts side by side before it costs more. Only where the project's checks
 * can say which attempt is right, once per task, and only at the point where
 * the next step is a dearer tier or the expert.
 */
function raceApplies(state: RunState, task: TaskState): boolean {
  if (!isOn("repair-race") || task.raced || task.escalated || task.advised || task.owner === "expert") return false;
  if (state.checks.length === 0 || gruntGate(state, task)) return false;
  if (!canClimb(state, task) && !canEscalate(state)) return false;
  if (canClimb(state, task) && tierAtRung(state, (task.rung ?? 0) + 1) === tierAtRung(state, task.rung)) return false;
  return raceChain(state, task).length > 0;
}

/** A throwaway copy is removed whatever was done to it. */
function dropCopy(repo: string, dir: string): void {
  removeDetachedWorktree(repo, dir);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    tryGit(repo, "worktree", "prune");
  }
}

/**
 * [F102 repair-race] Two fresh developers of the task's own tier repair the
 * stuck work side by side, each in its own copy and each told to go about it
 * differently. The project's checks pick the winner; with one, its change
 * becomes the task's and the escalation does not happen. With none, the task
 * goes on to where it was headed, and nothing of the copies is kept.
 *
 * A stopped race (a limit, Ctrl-C, a crash) is run again from the start on
 * resume: nothing of it is the task's until a winner is chosen.
 */
async function raceStep(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const why = task.escalationReason ?? "out of repair rounds";
  const onward = (): Stop | undefined => {
    task.raced = true;
    saveState(state);
    if (canClimb(state, task) || canEscalate(state)) {
      onStuck(run, task, why);
      return undefined;
    }
    return failTask(run, task, `checks still fail (${why})`);
  };
  const lanes = RACE_HINTS.map((hint, i) => ({ id: "ab"[i]!, hint, dir: join(state.dir, "tasks", task.id, `race-${"ab"[i]!}`), prepared: [] as string[], ok: false, size: 0, failures: "" }));
  if (!isOn("repair-race")) {
    // Copies an engine that died mid-race left behind still go.
    for (const lane of lanes) dropCopy(state.repo, lane.dir);
    return onward();
  }
  try {
    return await inFeature("repair-race", async (): Promise<Stop | undefined> => {
    const chain = raceChain(state, task);
    const candidate = commitAll(task.worktree, `neuromesh candidate (before the race): ${task.title}`, task.prepared);
    const env = isOn("work-env") ? envNote(task.worktree) : "";
    for (const lane of lanes) {
      createDetachedWorktree(state.repo, lane.dir, candidate);
      lane.prepared = prepareWorktree(state.repo, lane.dir);
      await prepareEnv(run, lane.dir, lane.prepared, task.id);
    }
    log.emit("race.started", { feature: "F102", task: task.id, lanes: lanes.length, model: chain[0] ? modelKey(chain[0]) : undefined, reason: why });
    const turns = await Promise.all(
      lanes.map((lane) =>
        turn(run, { key: `${task.id}-race-${lane.id}`, role: "worker", kind: "race", task: task.id, round: task.round, cwd: lane.dir, prompt: racePrompt(state, task, lane.hint) + env, access: "write", schema: reportSchema(), chain, rungBase: task.rung }),
      ),
    );
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    const stopped = turns.find(({ result }) => result.stop === "cancelled" || result.stop === "quota" || held(result));
    if (stopped) return stopFor(stopped.result, "worker");
    // The checks, one copy at a time: two test suites at once would slow and disturb each other.
    for (const [i, lane] of lanes.entries()) {
      if (turns[i]!.result.stop !== "done") {
        lane.failures = `the developer stopped: ${turns[i]!.result.stop}`;
        continue;
      }
      try {
        await prepareEnv(run, lane.dir, lane.prepared, task.id);
        const results = (await check(run, lane.dir, `${task.id}-race-${lane.id}`)).filter((r) => r.status !== "unavailable");
        if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
        const diff = snapshot(lane.dir, task.base!, lane.prepared).patch;
        // [F95 stub-gate] A stand-in for an implementation does not win a race either.
        const stubs = isOn("stub-gate") ? findStubs(diff) : [];
        const failing = results.filter((r) => r.status === "failed" || r.status === "timeout" || r.status === "cancelled");
        const regressions = failing.filter((r) => state.baseline?.find((b) => b.name === r.name)?.status !== "failed");
        lane.ok = results.length > 0 && stubs.length === 0 && regressions.length === 0 && (!isLastOpen(state, task) || failing.length === 0);
        lane.size = diff.length;
        lane.failures = stubs.length > 0 ? describeStubs(stubs) : failureSummary(results, state.baseline);
      } catch (error) {
        // The copy was left unusable (deleted, a lock, a broken checkout): that attempt is lost, the other may still win.
        lane.failures = `its copy could not be checked: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      }
    }
    // The smaller change wins when both pass: it is the one more likely to have touched only what was wrong.
    for (const lane of lanes.filter((l) => l.ok).sort((a, b) => a.size - b.size)) {
      try {
        const sha = commitAll(lane.dir, `neuromesh race ${lane.id}: ${task.title}`, lane.prepared);
        git(task.worktree, "merge", "-q", "--ff-only", sha);
      } catch {
        continue;
      }
      task.raced = true;
      task.sessionId = undefined;
      task.sessionModel = undefined;
      task.progress = newHistory();
      // The task's own checks decide as for any other change (the stub gate, the other tasks' work, the review).
      task.step = "checks";
      saveState(state);
      log.emit("race.finished", { feature: "F102", task: task.id, winner: lane.id, passed: lanes.filter((l) => l.ok).length, lanes: lanes.length });
      return undefined;
    }
    log.emit("race.finished", { feature: "F102", task: task.id, passed: 0, lanes: lanes.length });
    task.history.push({ diff: diffOf(task), failures: `Two fresh attempts at the repair, made side by side, also failed.\n${lanes.map((l) => `Attempt ${l.id}: ${l.failures.slice(0, 1_500)}`).join("\n")}` });
    return onward();
    });
  } catch (error) {
    // The race itself broke (a copy could not be made): the task goes on as it would have without it.
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    featureFailed(run, error, "repair-race");
    return onward();
  } finally {
    for (const lane of lanes) dropCopy(state.repo, lane.dir);
  }
}

/** [F115 reproduce-first] The cheapest worker-tier model, at low effort: who writes the reproducing test. */
function reproduceChain(state: RunState): RoleConfig[] {
  const first = state.workerLadder?.[state.workerRung ?? 0] ?? state.roles.worker?.[0];
  return first && !state.exhausted.includes(modelKey(first)) ? [{ ...first, effort: "low" }] : [];
}

/**
 * [F115 reproduce-first] Whether this task starts with a reproduction: a bug fix (the brief's own kind), the whole
 * request as one task, on a worker or senior rung (not the grunt's, not the expert's), not a no-tools direct answer.
 * A task that already has one (a redo into a fresh folder, a resumed run) goes through the step again to put it back.
 */
function reproduceApplies(run: RunCtx, task: TaskState): boolean {
  const { state } = run;
  if (!isOn("reproduce-first")) return false;
  if (task.reproduce) return task.reproduce.stage !== "rejected";
  if (state.brief?.kind !== "bug" || !wholeRequest(state, task)) return false;
  if (task.owner === "expert" || task.escalated || task.advised || task.next !== "initial") return false;
  if (gruntGate(state, task) || directApplies(run, task)) return false;
  return reproduceChain(state).length > 0;
}

/** Files a test run leaves behind that are not the model's work. */
const RUN_LEFTOVERS = /(^|\/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|node_modules|target|\.venv|venv)\/|\.pyc$/;

/** [F115 reproduce-first] Take the reproduction out: its check and its file, and remember that it was discarded. */
function reproduceDrop(run: RunCtx, task: TaskState, outcome: string): void {
  const r = task.reproduce;
  if (r?.path) rmSync(join(task.worktree, r.path), { force: true });
  run.state.checks = run.state.checks.filter((c) => c.name !== "reproduce");
  task.reproduce = { stage: "rejected", outcome, path: r?.path };
  saveState(run.state);
}

/**
 * [F115 reproduce-first] One cheap turn, before the first build turn, writes a test that reproduces the reported bug.
 * The engine runs only that file on the code as it is. It is kept only if it fails there for a reason other than a
 * syntax or import error: then it stays in the work, its command joins the task's checks, and the build must make
 * it pass. Anything else (it passes, cannot load, came with a changed source file, no runner, an unusable answer) is
 * discarded and the task goes on as if the feature were off. At most one turn per task.
 */
async function reproduceStep(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const next = (outcome: string, extra: Record<string, unknown> = {}): undefined => {
    task.step = "agent";
    saveState(state);
    log.emit("reproduce.tests", { feature: "F115", task: task.id, outcome, ...extra });
    return undefined;
  };
  if (!isOn("reproduce-first")) return next("skipped");
  try {
    return await inFeature("reproduce-first", () => reproduceBody(run, task, next));
  } catch (error) {
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    featureFailed(run, error, "reproduce-first");
    // Whatever the step had put into the folder goes out again: the task starts as if it had never been asked.
    resetTo(task.worktree, task.base!);
    reproduceDrop(run, task, "feature failed");
    return next("skipped");
  }
}

async function reproduceBody(run: RunCtx, task: TaskState, next: (outcome: string, extra?: Record<string, unknown>) => undefined): Promise<Stop | undefined> {
  const { state } = run;
  const kept = task.reproduce;
  const reject = (outcome: string, extra: Record<string, unknown> = {}): undefined => {
    resetTo(task.worktree, task.base!);
    reproduceDrop(run, task, outcome);
    return next(outcome, extra);
  };
  const keep = (r: NonNullable<TaskState["reproduce"]>): void => {
    if (r.path && r.content !== undefined && r.command && !existsSync(join(task.worktree, r.path))) {
      mkdirSync(dirname(join(task.worktree, r.path)), { recursive: true });
      writeFileSync(join(task.worktree, r.path), r.content);
    }
  };
  // Settled before (a redo in a fresh folder, a resumed run): the test is put back and no turn is paid for twice.
  if (kept?.stage === "accepted" && kept.path && kept.content !== undefined && kept.command) {
    keep(kept);
    if (!state.checks.some((c) => c.name === "reproduce")) state.checks = [...state.checks, { name: "reproduce", command: kept.command }];
    return next("kept", { path: kept.path, again: true });
  }
  let path: string;
  let offered: string | undefined;
  if (kept?.stage === "judging" && kept.path && kept.content !== undefined) {
    // The engine died after the turn and before the verdict: the answer is used as it is.
    path = kept.path;
    offered = kept.command;
    if (!existsSync(join(task.worktree, path))) {
      mkdirSync(dirname(join(task.worktree, path)), { recursive: true });
      writeFileSync(join(task.worktree, path), kept.content);
    }
  } else {
    // What an earlier, cut-short pass left in the folder is gone before anything else.
    resetTo(task.worktree, task.base!);
    const chain = reproduceChain(state);
    if (chain.length === 0) return next("skipped");
    const { result } = await turn(run, {
      key: `${task.id}-reproduce`,
      role: "worker",
      kind: "reproduce",
      task: task.id,
      round: task.round,
      cwd: task.worktree,
      prompt: reproducePrompt(state.request ?? state.prompt, trackedFiles(task.worktree).filter((f) => TEST_PATH.test(f)).slice(0, 12), state.checks),
      access: "write",
      schema: REPRODUCE_SCHEMA,
      chain,
      rungBase: state.workerRung ?? 0,
      timeoutMs: 10 * 60_000,
    });
    if (result.stop === "cancelled" || held(result)) return stopFor(result, "worker");
    // [F73 heal-worktree] The writer may have left the folder unusable.
    healTask(run, task);
    if (result.stop !== "done") return reject("turn-failed", { stop: result.stop, detail: result.detail?.slice(0, 200) });
    const answer = parseReproduce(result);
    if (!answer) return reject("none");
    if (!reproducePathOk(answer.path) || !existsSync(join(task.worktree, answer.path))) return reject("bad-path", { path: answer.path.slice(0, 200) });
    // The writer changes no file but its test: a changed source file could be what makes the test fail.
    const changed = snapshot(task.worktree, task.base!, task.prepared).files.map((f) => f.path).filter((f) => !RUN_LEFTOVERS.test(f));
    const stray = changed.filter((f) => f !== answer.path);
    const existed = tryGit(task.worktree, "cat-file", "-e", `${task.base}:${answer.path}`) !== undefined;
    if (stray.length > 0 || existed || !changed.includes(answer.path)) return reject("touched-code", { path: answer.path, files: (existed ? [answer.path] : stray).slice(0, 6) });
    const content = readFileSync(join(task.worktree, answer.path), "utf8");
    if (content.trim() === "" || content.length > 60_000) return reject("bad-path", { path: answer.path });
    path = answer.path;
    offered = answer.command;
    task.reproduce = { stage: "judging", path, content, command: offered };
    saveState(state);
  }
  const command = reproduceCommand(task.worktree, path, offered);
  if (!command) return reject("no-runner", { path });
  const [first] = await check(run, task.worktree, `${task.id}-reproduce`, [{ name: "reproduce", command }]);
  if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
  const verdict = first ? failedForTheBug(first) : { ok: false as const, why: "the run gave no result" };
  if (!verdict.ok) return reject(verdict.why.startsWith("passes") ? "passed-on-seed" : verdict.why.startsWith("cannot load") ? "load-error" : "not-a-failure", { path, why: verdict.why, tail: first?.tail.slice(-400) });
  task.reproduce = { stage: "accepted", path, content: task.reproduce?.content ?? readFileSync(join(task.worktree, path), "utf8"), command, outcome: "fails on the seed" };
  state.checks = [...state.checks.filter((c) => c.name !== "reproduce"), { name: "reproduce", command }];
  return next("accepted", { path, command, tail: first!.tail.slice(-400) });
}

/**
 * [F115 reproduce-first] A build turn that edited (or deleted) the reproducing test has weakened its own oracle:
 * the engine puts the file back as it was accepted. A failure here drops the reproduction and the task goes on.
 */
function reproduceGuard(run: RunCtx, task: TaskState): void {
  const r = task.reproduce;
  if (r?.stage !== "accepted" || !r.path || r.content === undefined) return;
  try {
    inFeature("reproduce-first", () => {
      const full = join(task.worktree, r.path!);
      let now: string | undefined;
      try {
        now = readFileSync(full, "utf8");
      } catch {
        now = undefined;
      }
      if (now === r.content) return;
      // [F124 lead-tests] The lead's own test may be wrong; an expert working on the task may correct it, not delete it.
      if (r.outcome === LEAD_TESTS && now !== undefined && (task.escalated || task.owner === "expert")) {
        r.content = now;
        saveState(run.state);
        run.log.emit("note", { feature: "F124", message: `Task ${task.id}: the expert changed the lead's test file (${r.path}); the new version is kept.` });
        return;
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, r.content!);
      r.restored = (r.restored ?? 0) + 1;
      saveState(run.state);
      run.log.emit("reproduce.restored", { feature: "F115", task: task.id, path: r.path, deleted: now === undefined, times: r.restored });
      run.log.emit("note", { feature: "F115", message: `Task ${task.id}: the build ${now === undefined ? "deleted" : "edited"} the test that reproduces the bug (${r.path}); it was put back as it was.` });
    });
  } catch (error) {
    featureFailed(run, error, "reproduce-first");
    reproduceDrop(run, task, "feature failed");
  }
}

/** [F101 blind-tests] The blind test files now in the task's folder. */
function blindFiles(task: TaskState): string[] {
  return task.blind?.files ?? [];
}

/** [F101 blind-tests] The cheapest developers that are not grunts or seniors: who writes the blind tests. */
function blindChain(state: RunState): RoleConfig[] {
  const ladder = state.workerLadder;
  const own = ladder ? ladder.slice(state.workerRung ?? 0, state.seniorRung ?? ladder.length) : (state.roles.worker ?? []);
  return own.filter((c) => !state.exhausted.includes(modelKey(c)));
}

/**
 * [F101 blind-tests] Whether work that has just passed the project's checks is
 * also probed by tests written without seeing it: once per task, for work on
 * state, parsing, limits or an algorithm, where there is a check command to run
 * the tests and code (not only tests) was changed. Not for the expert's own
 * work: its fix turn would be an expert turn.
 */
function blindApplies(run: RunCtx, task: TaskState, changed: string[]): boolean {
  const { state } = run;
  if (!isOn("blind-tests") || task.blindDone || state.checks.length === 0) return false;
  if (task.escalated || task.owner === "expert" || gruntGate(state, task)) return false;
  if (!(task.latest ?? []).some((r) => r.status === "passed") || !changed.some((f) => !TEST_PATH.test(f))) return false;
  if (blindChain(state).length === 0) return false;
  return wantsBlindTests(wholeRequest(state, task) ? (state.request ?? state.prompt) : `${task.title} ${task.brief}`);
}

/**
 * [F101 blind-tests] A cheap developer writes tests from the task and the
 * signatures of what was built, in a folder that holds nothing of the code.
 * The engine runs them on a copy of the work:
 *   all pass       nothing changes, and the tests are not kept;
 *   cannot load    the test guessed a name that is not there: dropped;
 *   some fail      the tests go into the task's folder and the developer gets
 *                  one turn to judge each (fix the code, or correct the test).
 * After that one turn the checks decide; blind tests that still fail are taken
 * out again (the checks step), so a wrong test costs one cheap turn at most.
 */
async function blindStep(run: RunCtx, task: TaskState): Promise<Stop | undefined> {
  const { state, log } = run;
  const next = (outcome: string, extra: Record<string, unknown> = {}): undefined => {
    task.blindDone = true;
    task.blindAnswer = undefined;
    task.step = wantsTester(run, task) ? "test" : "merge";
    saveState(state);
    log.emit("blind.tests", { feature: "F101", task: task.id, outcome, ...extra });
    return undefined;
  };
  // The copy an engine that died during this step left behind: gone before anything else, because this pass may
  // end before it would make (and remove) its own. Found by the fault harness (kill seed 398).
  dropCopy(state.repo, join(state.dir, "tasks", task.id, "tester"));
  // Blind tests an earlier, cut-short pass through this step put into the folder: out, before anything is committed or checked.
  if (task.blind) {
    for (const f of task.blind.files) rmSync(join(task.worktree, f), { force: true });
    task.blind = undefined;
    saveState(state);
  }
  if (!isOn("blind-tests")) return next("skipped");
  try {
    return await inFeature("blind-tests", () => blindBody(run, task, next));
  } catch (error) {
    if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
    featureFailed(run, error, "blind-tests");
    // Whatever it had put into the folder goes out again: the work passed its checks without it.
    for (const f of blindFiles(task)) rmSync(join(task.worktree, f), { force: true });
    task.blind = undefined;
    return next("skipped");
  }
}

async function blindBody(run: RunCtx, task: TaskState, next: (outcome: string, extra?: Record<string, unknown>) => undefined): Promise<Stop | undefined> {
  const { state } = run;
  const chain = blindChain(state);
  const signatures = signaturesOf(task.worktree, (task.files ?? []).map((f) => f.path));
  if (signatures.files.length === 0 || chain.length === 0) return next("skipped");
  // The answer of a pass the engine died in is used as it is: the turn is not paid for twice (kill seeds 136, 137, 198, 280).
  const answer = task.blindAnswer ?? (await blindAsk(run, task, chain, signatures.text));
  if (!answer) return next("none");
  // The turn was stopped (Ctrl-C, a rejected login): the run stops as for any other turn.
  if ("status" in answer) return answer;
  const tests = answer.tests.filter((t) => blindPathOk(task.worktree, t.path));
  if (tests.length === 0) return next("none");
  if (!task.blindAnswer) {
    task.blindAnswer = answer;
    saveState(state);
  }
  return blindJudge(run, task, next, tests, answer.summary);
}

/** [F101 blind-tests] The blind tester's turn: its tests, nothing usable (undefined), or a stop the run must make. */
async function blindAsk(run: RunCtx, task: TaskState, chain: RoleConfig[], signatures: string): Promise<{ tests: BlindTest[]; summary: string } | Stop | undefined> {
  const { state, ctx } = run;
  // An empty folder of its own, away from the project and from the run's folders (the task's code is in one of
  // those): a writer that has tools finds nothing of the code beside it, and is not told where it is.
  const scratch = mkdtempSync(join(tmpdir(), "neuromesh-blind-"));
  let result: AgentResult;
  try {
    const all = trackedFiles(task.worktree).filter((f) => TEST_PATH.test(f));
    const existing = all.slice(0, 12);
    const usage = blindUsage(task, all);
    ({ result } = await turn(run, {
      key: `${task.id}-blind`,
      role: "tester",
      kind: "blind",
      task: task.id,
      round: task.round,
      cwd: scratch,
      prompt: blindPrompt(state, task, signatures, existing, usage),
      access: "read-only",
      schema: blindSchema(),
      direct: ctx.backends[chain[0]!.backend]?.direct === true ? true : undefined,
      chain,
      timeoutMs: 10 * 60_000,
    }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (result.stop === "cancelled" || held(result)) return stopFor(result, "tester");
  return result.stop === "done" ? parseBlind(result) : undefined;
}

/**
 * [F101 blind-tests] How the changed code is called: the start of the tests
 * that were already there for the changed files, as they were before this work.
 * Tests the work itself added or changed are left out (they share its reading
 * of the task), and so is every line of the code.
 */
function blindUsage(task: TaskState, tests: string[]): { path: string; text: string }[] {
  if (!task.base) return [];
  const stems = (task.files ?? []).map((f) => f.path).filter((p) => !TEST_PATH.test(p)).map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").toLowerCase()).filter((s) => s.length >= 3);
  const out: { path: string; text: string }[] = [];
  let used = 0;
  for (const path of tests) {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    if (!stems.some((s) => name.includes(s))) continue;
    const before = tryGit(task.worktree, "show", `${task.base}:${path}`);
    if (!before) continue;
    const text = before.split("\n").slice(0, 100).join("\n").slice(0, 4_000);
    if (used + text.length > 6_000) break;
    out.push({ path, text });
    used += text.length;
    if (out.length >= 2) break;
  }
  return out;
}

/** [F101 blind-tests] Run the blind tests on a copy of the work, and act on what they show. */
async function blindJudge(run: RunCtx, task: TaskState, next: (outcome: string, extra?: Record<string, unknown>) => undefined, all: BlindTest[], summary: string): Promise<Stop | undefined> {
  const { state, log } = run;
  const tests = all.filter((t) => !t.open);
  const open = all.filter((t) => t.open);
  const candidate = commitAll(task.worktree, `neuromesh candidate: ${task.title}`, task.prepared);
  const copy = join(state.dir, "tasks", task.id, "tester");
  let written: string[] = [];
  let results: CheckResult[] = [];
  let openWritten: string[] = [];
  let openResults: CheckResult[] = [];
  try {
    createDetachedWorktree(state.repo, copy, candidate);
    const prepared = prepareWorktree(state.repo, copy);
    await prepareEnv(run, copy, prepared, task.id);
    written = writeDirect(copy, tests, prepared).written;
    if (written.length > 0) results = await check(run, copy, `${task.id}-blind`);
    // The open probe is run by itself, so its failure is never confused with a failing ordinary test.
    if (open.length > 0 && !run.signal.aborted) {
      for (const f of written) rmSync(join(copy, f), { force: true });
      openWritten = writeDirect(copy, open, prepared).written;
      if (openWritten.length > 0) openResults = await check(run, copy, `${task.id}-blind-open`);
    }
  } finally {
    dropCopy(state.repo, copy);
  }
  if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
  // Only a check that passed on the work as it was can be failing because of the new tests.
  const brokeIt = (list: CheckResult[]): CheckResult[] => list.filter((r) => (r.status === "failed" || r.status === "timeout") && task.latest?.find((b) => b.name === r.name)?.status === "passed");
  // An open probe that fails is a question for the person: recorded, shown with the result, and nothing else. No
  // developer sees it and no turn is spent on it, because the task does not say what the answer is.
  const openFailing = brokeIt(openResults);
  const openOutput = openFailing.map((r) => r.tail).join("\n");
  if (openFailing.length > 0 && !brokenTest(openOutput)) {
    const questions = open.filter((t) => openWritten.some((w) => t.path.endsWith(w))).map((t) => ({ question: t.question ?? "", file: t.path, tail: openOutput.slice(-800) }));
    task.openQuestions = [...(task.openQuestions ?? []), ...questions];
    saveState(state);
    log.emit("blind.open", { feature: "F101", task: task.id, questions: questions.map((q) => q.question), files: questions.map((q) => q.file), tail: openOutput.slice(-600) });
    for (const q of questions) log.emit("note", { feature: "F101", message: `Task ${task.id}: a question the request leaves open, from a blind probe that failed: ${q.question} Nothing was changed for it; it is yours to decide.` });
  }
  if (written.length === 0) return next("none");
  const failing = brokeIt(results);
  if (failing.length === 0) return next("passed", { files: written });
  const output = failing.map((r) => r.tail).join("\n");
  if (brokenTest(output)) return next("broken", { files: written, tail: output.slice(-600) });
  if (task.round >= repairLimit(state, task)) {
    log.emit("note", { feature: "F101", message: `Task ${task.id}: blind tests fail (${written.join(", ")}), and no repair round is left to judge them; recorded, not gating.` });
    return next("recorded", { files: written, tail: output.slice(-600) });
  }
  // Into the task's own folder, for the developer's one turn with them. Recorded first: if the engine stops between
  // the writing and the turn, the next pass through this step knows what to take out.
  task.blind = { files: written };
  saveState(state);
  const put = writeDirect(task.worktree, tests, task.prepared).written;
  const finding = blindFinding(put, failing[0]!.command, output);
  task.blind = { files: put };
  task.blindDone = true;
  task.blindAnswer = undefined;
  task.verdict = { verdict: "fail", summary: `Blind tests fail: ${summary}`.trim(), findings: [finding] };
  task.history.push({ diff: diffOf(task), failures: "", findings: [finding] });
  log.emit("blind.tests", { feature: "F101", task: task.id, outcome: "failed", files: put, checks: failing.map((r) => r.name), tail: output.slice(-600) });
  nextRound(run, task, "review-fix");
  return undefined;
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
      // [F115 reproduce-first] A bug fix first gets a test that fails on the code as it is.
      task.step = reproduceApplies(run, task) ? "reproduce" : "agent";
      // [F100 start-here] Where this task most likely begins, from its own words; nothing when nothing matches by name.
      if (isOn("start-here") && task.startHere === undefined) {
        const lead = optional(run, "start-here", undefined, () => startHere(task.worktree, wholeRequest(state, task) ? (state.request ?? state.prompt) : `${task.title}\n${task.brief}`));
        if (lead) {
          task.startHere = lead.text;
          log.emit("context.start-here", { feature: "F100", task: task.id, files: lead.files, chars: lead.text.length });
        }
      }
      // [F69 budget-handoff]
      if (task.owner === "expert" && isOn("budget-handoff")) {
        // A plan may give the expert a part in a preset that has no expert at all.
        if ((state.roles.escalation ?? state.roles.orchestrator ?? []).length === 0) handToWorker(run, task, "the plan gives this part to the expert, and this preset has none");
        else if (!expertCanTake(state)) handToWorker(run, task, "the expert budget left cannot pay for an expert turn");
      }
      saveState(state);
      log.emit("task.started", { task: task.id, title: task.title, owner: task.owner, owned: task.owned });
      continue;
    }

    if (task.step === "reproduce") {
      const stop = await reproduceStep(run, task);
      if (stop) return stop;
      continue;
    }

    if (task.step === "agent") {
      // [F73 heal-worktree] An interrupted turn may have left the folder unusable for the next one.
      healTask(run, task);
      const role = roleFor(state, task);
      // [F127 patch-lead] The expert's patch, in one call with no tools; the checks run by the engine.
      if (patchApplies(state, task)) {
        const stop = await patchTurn(run, task);
        if (stop) return stop;
        continue;
      }
      // [F77 direct-build] A planned part in one answer, the checks run by the engine.
      if (directApplies(run, task)) {
        const stop = await directTurn(run, task);
        if (stop) return stop;
        continue;
      }
      // [F68 split-ask] Offered only while someone can do the dividing.
      task.noSplit = !canSplit(state, task);
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
      // [F83 early-exit] A worker or senior judges the task first; the grunt and the expert do not.
      const gate = preambleGate(state, task, role);
      // [F96 scope-escalate] The one unplanned task may also say it needs a design first.
      const asked = gate !== undefined ? prompt + preambleInstruction({ scope: scopeAsked(state, task) }) : prompt;
      const request: TurnRequest = {
        key: task.id,
        role,
        kind,
        task: task.id,
        round: task.round,
        cwd: task.worktree,
        prompt: asked,
        freshPrompt: (task.next === "advised-fix" ? freshAdvisedFixPrompt(state, task) : followUp ? freshFollowUpPrompt(state, task) : asked) + (followUp ? env : ""),
        access: "write",
        schema: reportSchema(),
        resume: followUp ? { sessionId: task.sessionId, model: task.sessionModel } : undefined,
        chain: role === "worker" && state.workerLadder ? state.workerLadder.slice(task.rung ?? 0) : undefined,
        preamble: gate,
        rungBase: task.rung,
      };
      const { result, config } = await turn(run, request);
      task.envProblem = undefined;
      // [F73 heal-worktree] Before the engine uses the folder the agent has just left.
      healTask(run, task);
      // [F60 no-rebuild] The expert's turn was stopped at the budget: its work so far stays, and the checks decide.
      if (result.detail === BUDGET_CUT && task.escalated) {
        log.emit("note", { feature: "F60", message: `Task ${task.id}: the expert's turn was stopped at the expert budget; its changes are kept and checked.` });
        task.step = "checks";
        saveState(state);
        continue;
      }
      // [F69 budget-handoff] The expert's own part was stopped at the budget: its work stays,
      // the checks decide, and any more turns are the worker's (never a second expert turn).
      if (result.detail === BUDGET_CUT && task.owner === "expert" && isOn("budget-handoff")) {
        handToWorker(run, task, "the expert's turn was stopped at the expert budget (its changes are kept and checked)");
        task.next = "continue";
        task.step = "checks";
        saveState(state);
        continue;
      }
      if (result.detail === "expert budget reached" && task.owner === "expert" && !task.escalated && isOn("budget-handoff")) {
        handToWorker(run, task, "no expert budget is left");
        saveState(state);
        continue;
      }
      // [F83 early-exit] Gate 2: before starting, the developer said the task is beyond it. A whole tier up, now.
      if (request.exited && result.detail?.startsWith(EARLY_EXIT)) {
        const p = request.exited;
        const from = tierAtRung(state, task.rung);
        task.history.push({ diff: diffOf(task), failures: `Before starting, the ${from} developer judged the task beyond it (confidence ${p.confidence}): ${p.reason}` });
        // [F84 bottleneck-diagnostic] Its account of the sub-problem is what the expert will see.
        if (p.bottleneck && isOn("bottleneck-diagnostic")) task.bottleneck = p.bottleneck;
        log.emit("task.early-exit", { feature: p.scope ? "F96" : "F83", task: task.id, tier: from, confidence: p.confidence, reason: p.reason, ...(p.scope ? { scope: true } : {}) });
        // [F96 scope-escalate] It needs a design, not a stronger builder: the expert divides it (F68, blueprint-only with F85).
        if (p.scope && scopeAsked(state, task) && canSplit(state, task) && !breakerTripped(state, task)) {
          task.report = { status: "split", summary: p.reason || "it needs a design first", notes: [p.reason, p.bottleneck].filter(Boolean).join(" ") || undefined };
          task.step = "split";
          saveState(state);
          continue;
        }
        const target = nextTierRung(state, task.rung);
        if (target !== undefined && target > (task.rung ?? 0)) {
          climbTo(run, task, target, `early exit: ${p.reason || `beyond the ${from} tier`}`, "F83");
          continue;
        }
        if (canEscalate(state) && !breakerTripped(state, task)) {
          task.escalationReason = `the ${from} developer judged the task beyond it: ${p.reason}`;
          task.step = nextEscalation(state, task);
          saveState(state);
          continue;
        }
        // Nowhere higher to go: the same developer works on, without being asked again.
        task.noPreamble = true;
        saveState(state);
        continue;
      }
      if (result.stop === "done") {
        task.report = parseReport(result);
        // [F44 task-report]
        if (isOn("task-report")) log.emit("task.report", { feature: "F44", task: task.id, role, status: task.report.status, summary: task.report.summary.slice(0, 8_000), notes: task.report.notes?.slice(0, 4_000), choices: task.report.choices?.slice(0, 8_000), open: task.report.open?.slice(0, 8_000) });
        task.sessionId = result.sessionId;
        task.sessionModel = config ? modelKey(config) : undefined;
        task.step = "checks";
        // [F68 split-ask] The worker judged the task too big or too hard for one session.
        if (task.report.status === "split" && canSplit(state, task)) {
          log.emit("note", { feature: "F68", message: `Task ${task.id}: the worker asks the lead engineer to split it (${(task.report.notes ?? task.report.summary).slice(0, 200)}).` });
          task.step = "split";
        }
        saveState(state);
        continue;
      }
      if (result.stop === "cancelled" || result.stop === "quota" || held(result)) {
        // The turn may have changed files before it stopped; the next one checks first. One that changed
        // nothing is tried again as a first turn, with its preamble and one-answer mode. [F97 retry-first-turn]
        if (task.next === "initial" && !task.escalated && leftChanges(task)) task.next = "continue";
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
      // [F115 reproduce-first] A build turn that edited the reproducing test gets it put back before anything is checked.
      reproduceGuard(run, task);
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
      // [F75 sync-before-checks] Tested with what the other tasks have merged since this one started.
      if (isOn("sync-before-checks") && state.tasks.length > 1) optional(run, "sync-before-checks", undefined, () => syncTask(run, task));
      const testedAt = state.tasks.length > 1 ? headCommit(state.worktree) : undefined;
      // [F54 work-env] Install what the work declares now, before its checks.
      const installFailed = await prepareEnv(run, task.worktree, task.prepared, task.id);
      let results = keepLostChecks(run, await check(run, task.worktree, `${task.id}-${task.escalated ? "x" : ""}${task.round}`));
      const cannotRun = results.filter((r) => r.status === "unavailable").map((r) => r.name);
      if (cannotRun.length > 0) {
        state.checks = state.checks.filter((c) => !cannotRun.includes(c.name));
        results = results.filter((r) => r.status !== "unavailable");
      }
      if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
      const diff = diffOf(task);
      // [F95 stub-gate] Stand-ins for an implementation fail the task like a failing check.
      if (isOn("stub-gate")) {
        const stubs = optional(run, "stub-gate", [], () => findStubs(diff));
        if (stubs.length > 0) {
          results = [...results, { name: "stub-gate", command: "neuromesh stub gate (F95)", status: "failed", exitCode: 1, durationMs: 0, tail: describeStubs(stubs), logPath: "" }];
          log.emit("note", { feature: "F95", message: `Task ${task.id} left ${stubs.length} stand-in(s) for an implementation: ${stubs.slice(0, 3).map((x) => `${x.file}:${x.line}`).join(", ")}` });
        }
      }
      // [F117 empty-done] Done (or blocked, or no answer) with no change at all, and nothing else failing: asked once
      // whether the edits landed. Still blocked with no change after that: the task fails rather than passing empty.
      const status = task.report?.status;
      if (isOn("empty-done") && diff.trim() === "" && status !== "split" && state.tasks.every((t) => t === task || (t.files ?? []).length === 0)) {
        const failingNow = results.some((r) => r.status === "failed" || r.status === "timeout");
        if (!failingNow && !task.emptyAsked && optional(run, "empty-done", false, () => true)) {
          task.emptyAsked = true;
          results = [...results, { name: "empty-done", command: "neuromesh empty-change gate (F117)", status: "failed", exitCode: 1, durationMs: 0, tail: EMPTY_DONE, logPath: "" }];
          log.emit("note", { feature: "F117", message: `Task ${task.id} reported ${status ?? "nothing"} but changed nothing; it is asked once whether its edits landed.` });
        } else if (!failingNow && task.emptyAsked && status === "blocked") {
          return failTask(run, task, `blocked with no change: ${task.report?.summary ?? ""} ${task.report?.notes ?? ""}`.trim().slice(0, 400));
        }
      }
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
      // [F75 sync-before-checks] Another task merged while these checks ran: a failure may be
      // only its missing work, so the checks run again on the program as it is now.
      if (!ok && testedAt !== undefined && isOn("sync-before-checks") && headCommit(state.worktree) !== testedAt) continue;
      // [F101 blind-tests] The developer had its one turn with the blind tests and the checks still fail with them in
      // the folder. The work passed the project's own checks before they came, and a blind test may be the one that is
      // wrong, so they are taken out and recorded; they never cost more than that one turn.
      if (!ok && task.blind && !task.blind.dropped) {
        const left = task.blind.files.filter((f) => existsSync(join(task.worktree, f)));
        task.blind.dropped = true;
        if (left.length > 0) {
          for (const f of left) rmSync(join(task.worktree, f), { force: true });
          saveState(state);
          log.emit("blind.dropped", { feature: "F101", task: task.id, files: left, failing: failing.map((r) => ({ name: r.name, tail: r.tail.slice(-600) })) });
          log.emit("note", { feature: "F101", message: `Task ${task.id}: the blind tests still fail after the developer's turn with them (${left.join(", ")}); they are removed and recorded, and do not gate the task.` });
          continue;
        }
        saveState(state);
      }
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
        // [F101 blind-tests] Work on state, parsing, limits or an algorithm is first probed by tests written without seeing it.
        task.step = blindApplies(run, task, files.map((f) => f.path)) ? "blind" : wantsTester(run, task) ? "test" : "merge";
        saveState(state);
        continue;
      }
      task.history.push({ diff, failures: failureSummary(results, state.baseline) });
      // [F82 grunt-tier] Gate 1: the grunt is not repaired; the task goes up a tier with the checks' errors.
      if (gruntGate(state, task) && canClimb(state, task)) {
        climbTo(run, task, state.workerRung!, `the grunt's work failed the checks (${failing.map((r) => r.name).join(", ") || "a regression"})`, "F82");
        continue;
      }
      if (task.escalated) {
        if (task.round < ESCALATION_REPAIRS) {
          nextRound(run, task, "repair");
          continue;
        }
        return failTask(run, task, "checks still fail after the expert's attempt");
      }
      // [F127 patch-lead] The expert's patch calls have their own limit (PATCH_TURNS): the breaker, made for tool
      // sessions, does not cut them short (swl-k1-probe: it stopped pint one call before a missing import was fixed).
      if (patchApplies(state, task)) {
        nextRound(run, task, "repair");
        continue;
      }
      if (decision === "oscillated" || decision === "no-progress" || task.round >= repairLimit(state, task)) {
        const why = decision === "oscillated" ? "the worker repeated an earlier failed state" : decision === "no-progress" ? "two attempts without progress" : "out of repair rounds";
        // [F102 repair-race] Before a dearer tier or the expert: two fresh attempts side by side.
        if (raceApplies(state, task)) {
          task.escalationReason = why;
          task.step = "race";
          saveState(state);
          continue;
        }
        if (canClimb(state, task) || canEscalate(state)) {
          onStuck(run, task, why);
          continue;
        }
        return failTask(run, task, `checks still fail (${why})`);
      }
      nextRound(run, task, "repair");
      continue;
    }

    // [F102 repair-race]
    if (task.step === "race") {
      const stop = await raceStep(run, task);
      if (stop) return stop;
      continue;
    }

    // [F101 blind-tests]
    if (task.step === "blind") {
      const stop = await blindStep(run, task);
      if (stop) return stop;
      continue;
    }

    if (task.step === "test") {
      const candidate = commitAll(task.worktree, `neuromesh candidate: ${task.title}`, task.prepared);
      const testerDir = join(state.dir, "tasks", task.id, "tester");
      createDetachedWorktree(state.repo, testerDir, candidate);
      const testerPrepared = prepareWorktree(state.repo, testerDir);
      // [F54 work-env] The copy gets the same environment, for the tester and the runs below.
      await prepareEnv(run, testerDir, testerPrepared, task.id);
      // [F71 one-review]
      const whole = reviewsWhole(state);
      const diff = whole ? wholeProgramDiff(state, task, candidate) : git(task.worktree, "diff", "--binary", task.base!, candidate);
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
          prompt: testerPrompt(state, task, diff, screens, acceptance, whole),
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
      if (result.stop === "cancelled" || held(result)) return stopFor(result, "tester");
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
      // [F79 finding-owner]
      const owner = isOn("finding-owner") ? optional(run, "finding-owner", undefined, () => strongerOwner(state, task, verdict.findings)) : undefined;
      if (owner) {
        climbTo(run, task, owner.rung, `the reviewer's findings are in ${owner.file}, which a stronger developer built`, "F79");
        continue;
      }
      // [F82 grunt-tier] Nor is a grunt asked to fix what the reviewer rejected.
      if (gruntGate(state, task) && canClimb(state, task)) {
        climbTo(run, task, state.workerRung!, "the reviewer rejected the grunt's work", "F82");
        continue;
      }
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

    if (task.step === "split") {
      const outcome = await splitStep(run, task);
      if (outcome === "split") return undefined;
      if (outcome) return outcome;
      continue;
    }

    // [F86 escalation-breaker]
    // [F125 lead-no-takeover] Under the lead the expert advises a stuck developer's task but never builds it: on
    // SWE-bench-Live (swl-lead-3) every takeover cost $0.90 to $1.36 and saved nothing Opus alone could not do either.
    // Work whose project checks pass and that fails only the lead's tests is kept for the lead's review; else the task ends.
    // [F127 patch-lead] Nor does a patch-lead run end in an expert tool session: its expert works only in one-call patches.
    if (task.step === "escalate" && state.lead && isOn("lead-no-takeover") && (task.owner !== "expert" || state.lead.mode === "patch" || state.lead.mode === "dossier")) {
      const latest = task.latest ?? [];
      const own = latest.filter((r) => r.name !== "lead-tests");
      if (latest.some((r) => r.name === "lead-tests") && own.every((r) => r.status === "passed")) {
        log.emit("note", { feature: "F125", message: `Task ${task.id}: the project's checks pass and only the lead's tests fail; the work is kept for the lead's review instead of an expert takeover.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      log.emit("note", { feature: "F125", message: `Task ${task.id}: under the lead the expert advises but does not take over a developer's task; it ends here.` });
      return failTask(run, task, `${task.escalationReason ?? "the developers are stuck"}, and under the lead the expert does not take over a developer's task`);
    }

    if ((task.step === "advise" || task.step === "escalate") && breakerTripped(state, task)) {
      const max = state.cascade!.maxEscalations!;
      if (state.checks.length > 0 && checksPass(task)) {
        log.emit("note", { feature: "F86", message: `Task ${task.id}: ${max} task(s) already went to the expert in this run; it keeps its work (the checks pass) with the open findings recorded.` });
        task.step = "merge";
        saveState(state);
        continue;
      }
      log.emit("note", { feature: "F86", message: `Task ${task.id}: ${max} task(s) already went to the expert in this run; the circuit breaker stops it here.` });
      return failTask(run, task, `${task.escalationReason ?? "the worker is stuck"}, and the escalation circuit breaker is open (${max} per run)`);
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
      // [F84 bottleneck-diagnostic]
      if (state.cascade && isOn("bottleneck-diagnostic") && !task.bottleneck && task.owner !== "expert") {
        const stop = await optionalAsync(run, "bottleneck-diagnostic", undefined, () => diagnoseStep(run, task));
        if (stop) return stop;
      }
      const { result } = await turn(run, {
        key: `${task.id}-advice`,
        role: "escalation",
        kind: "advice",
        task: task.id,
        round: task.round,
        cwd: task.worktree,
        prompt: advisePrompt(state, task, observedFor(state, task), state.cascade && isOn("bottleneck-diagnostic") ? task.bottleneck : undefined),
        access: "read-only",
        schema: ADVICE_SCHEMA,
      });
      if (result.stop === "cancelled" || result.stop === "quota" || held(result)) return stopFor(result, "escalation");
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
      // [F88 shadow-eval]
      if (state.cascade && isOn("shadow-eval")) optional(run, "shadow-eval", undefined, () => shadowSample(run, task));
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

/** [F68 split-ask] A worker task the expert may still divide. */
function canSplit(state: RunState, task: TaskState): boolean {
  return isOn("split-ask") && task.owner !== "expert" && !task.fromSplit && !task.splitAsked && !task.escalated && roleChain(state, "orchestrator").length > 0 && (isOn("budget-handoff") ? expertCanTake(state) : budgetLeft(state));
}

/**
 * [F68 split-ask] The expert divides a task the worker found too big. The
 * worker's work so far is merged; the parts become new tasks (expert-owned ones
 * are built by the expert, first where others depend on them), and whatever
 * depended on the original task now depends on all of them. When the expert
 * does not split it, its answer goes back to the worker as advice.
 */
async function splitStep(run: RunCtx, task: TaskState): Promise<Stop | "split" | undefined> {
  const { state, log } = run;
  task.splitAsked = true;
  const files = snapshot(task.worktree, task.base!, task.prepared).files.map((f) => f.path);
  const { result, config } = await turn(run, {
    key: `${task.id}-split`,
    role: "orchestrator",
    kind: "split",
    task: task.id,
    round: task.round,
    cwd: task.worktree,
    prompt: splitPrompt(state, task, files),
    access: "read-only",
    schema: PLAN_SCHEMA,
  });
  if (result.stop === "cancelled" || result.stop === "quota" || held(result)) return stopFor(result, "orchestrator");
  let plan: Plan | undefined;
  if (result.stop === "done") {
    try {
      // [F85 blueprint-expert] A split gives the expert no part either.
      plan = parsePlan(result, state.maxTasks, false, { blueprint: blueprintOn(state) });
    } catch (error) {
      log.emit("note", { feature: "F68", message: `The split for task ${task.id} was not usable (${error instanceof Error ? error.message : String(error)}).` });
    }
  }
  if (!plan || plan.tasks.length < 2) {
    // Not divided: the worker finishes, with the expert's brief as advice when there is one.
    const only = plan?.tasks[0];
    if (only) {
      task.advice = { diagnosis: plan!.summary || "The lead engineer kept the task whole.", steps: [only.brief] };
      task.next = "advised-fix";
    } else {
      // [F96 scope-escalate] A developer that stopped before starting has no session to continue.
      task.next = task.sessionId ? "continue" : "initial";
    }
    task.step = "agent";
    saveState(state);
    log.emit("note", { feature: "F68", message: `Task ${task.id} stays whole; the worker carries on${only ? " with the lead engineer's brief" : ""}.` });
    return undefined;
  }
  commitAll(task.worktree, `neuromesh: ${task.title} (started, then split)`, task.prepared);
  if (mergeBranch(state.worktree, task.branch, `neuromesh: merge the start of task ${task.id} before its split`) === "conflict") {
    task.next = task.sessionId ? "continue" : "initial";
    task.step = "agent";
    saveState(state);
    log.emit("note", { feature: "F68", message: `Task ${task.id}: its work so far does not merge, so it is not split; the worker carries on.` });
    return undefined;
  }
  removeWorktree(state.repo, task.worktree, task.branch);
  const id = (sub: string): string => `${task.id}.${sub}`;
  const parts = plan.tasks.map((t) => ({
    // [F78 three-tier] The parts of a senior task stay with the senior tier.
    ...newTask(state, { ...t, id: id(t.id), dependsOn: [...t.dependsOn.map(id), ...task.dependsOn], owner: t.owner === "worker" && task.owner === "senior" ? "senior" : t.owner }),
    rung: startRung(state, task.owner),
    fromSplit: true,
  }));
  for (const other of state.tasks) {
    if (other.dependsOn.includes(task.id)) other.dependsOn = [...other.dependsOn.filter((d) => d !== task.id), ...parts.map((p) => p.id)];
  }
  state.tasks.splice(state.tasks.indexOf(task) + 1, 0, ...parts);
  task.status = "passed";
  task.step = "done";
  task.report = { status: "split", summary: `Split by the lead engineer into ${parts.map((p) => p.id).join(", ")}.`, notes: task.report?.notes };
  state.mode = "team";
  state.maxParallel = state.parallelLimit ?? state.maxParallel;
  saveState(state);
  log.emit("task.split", { feature: "F68", task: task.id, model: config ? modelKey(config) : undefined, summary: plan.summary, tasks: parts.map((p) => ({ id: p.id, title: p.title, owner: p.owner, dependsOn: p.dependsOn })) });
  return "split";
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

/** Whether the task's folder holds work since it started (a stopped turn left something to continue from). */
function leftChanges(task: TaskState): boolean {
  // [F97 retry-first-turn] Off, every stopped first turn is continued, as before.
  return !isOn("retry-first-turn") || diffOf(task) !== "";
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
  // [F54 work-env] The merged work needs its environment too.
  await prepareEnv(run, state.worktree, state.prepared);
  let results = keepLostChecks(run, await check(run, state.worktree, "final"));
  if (run.signal.aborted) return { status: "interrupted", reason: "stopped" };
  log.emit("checks.finished", { phase: "final", results: brief(results) });
  const failing = (): CheckResult[] => results.filter((r) => r.status === "failed" || r.status === "timeout");
  const allPassed = state.tasks.every((t) => t.status === "passed");
  // [F125 lead-no-takeover] Nor does it build the integration fix: under the lead, failing final checks end the run as they stand.
  if (failing().length > 0 && allPassed && state.integrationFixes < 1 && canEscalate(state) && !(state.lead && isOn("lead-no-takeover"))) {
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
      schema: reportSchema(),
    });
    if (result.stop === "cancelled" || result.stop === "quota" || held(result)) return stopFor(result, "escalation");
    // [F73 heal-worktree]
    if (isOn("heal-worktree")) {
      const healed = optional(run, "heal-worktree", undefined, () => healWorktree(state.repo, state.worktree, state.branch, state.base));
      if (healed && healed.fixed.length > 0) log.emit("worktree.healed", { feature: "F73", restored: healed.restored, fixed: healed.fixed });
    }
    commitAll(state.worktree, "neuromesh: integration fix", state.prepared);
    results = keepLostChecks(run, await check(run, state.worktree, "final-fixed"));
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
