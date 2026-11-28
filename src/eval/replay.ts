// [F142 replay-harness] Offline replay of finished runs through F140's routing gate, with no model call.
//
// For every historical run made by one cheap model alone (Haiku or Sonnet) whose outcome is known, it rebuilds
// what F140 would have sent Laya after the cheap model's first --cutoff model calls: F138's state text (recorded,
// or probed again on the run's base commit, or a few recorded facts when the repository is gone) and F141's
// trajectory digest from the turn's stream log cut at that call. It asks a local laya-serve, puts the answer
// through the same gate (evaluateGate), and compares the route with what happened:
//
//   - a confusion matrix: false-cheap (cheap kept, cheap failed: quality lost) and false-frontier (escalated
//     although cheap resolved it: quota spent for nothing);
//   - Laya's conformal coverage and how often it abstained or said review;
//   - the quota the routed policy would have used against solo-opus, in Opus-equivalent units, from the four
//     token fields of F137 and a weight per model (Haiku 1/6 of Opus, measured; Sonnet assumed).
//
// It also writes a labelled dataset for calibrating Laya offline. It never writes to a run folder, an eval's
// results or the record: everything it reads stays as it was. Snapshots are unpacked into a temporary folder.
// The labels hold the state text only: no code, diff, file name or path (the state text has none, F138/F141).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RunState } from "../engine/types.ts";
import type { EvalReport } from "./eval.ts";
import { readRecord } from "../record/record.ts";
import type { RunLine } from "../record/record.ts";
import { buildTrajectoryDigest, parseTrajectory, temporalStateText } from "../routing/handoff.ts";
import type { CheapTurn } from "../routing/handoff.ts";
import { probeRepo } from "../routing/probe.ts";
import type { ProbeFacts } from "../routing/probe.ts";
import type { LayaDecision, QuestionId } from "../routing/laya-client.ts";
import { ROUTING_QUESTIONS } from "../routing/laya-client.ts";
import { evaluateGate } from "../routing/laya-policy.ts";
import type { GateAction } from "../routing/laya-policy.ts";
import { sumTokenFields, tokenFields } from "../usage/tokens.ts";
import type { TokenFields } from "../usage/tokens.ts";

export type ModelTier = "haiku" | "sonnet" | "opus";

export function tierOf(model: string | undefined): ModelTier | undefined {
  if (!model) return undefined;
  if (/haiku/i.test(model)) return "haiku";
  if (/sonnet/i.test(model)) return "sonnet";
  if (/opus/i.test(model)) return "opus";
  return undefined;
}

// ---- quota ----

/** Quota per model, as a share of Opus's. Haiku's 1/6 is the owner's measurement; Sonnet's 1/2 is an assumption (the list-price ratio). */
export interface QuotaWeights {
  haiku: number;
  sonnet: number;
  opus: number;
}
export const DEFAULT_WEIGHTS: QuotaWeights = { haiku: 1 / 6, sonnet: 0.5, opus: 1 };

/** Each token field in units of one fresh input token, shaped like the list prices (src/usage/prices.ts): cache read 1/20, cache write 2, output 5. */
export const CLASS_WEIGHTS = { inputUncached: 1, cacheRead: 0.05, cacheCreation: 2, output: 5 } as const;

/** Opus-equivalent quota units; undefined when a token field is unknown (never counted as 0). */
export function quotaUnits(fields: TokenFields | undefined, tier: ModelTier, weights: QuotaWeights = DEFAULT_WEIGHTS): number | undefined {
  if (!fields) return undefined;
  let sum = 0;
  for (const key of ["inputUncached", "cacheRead", "cacheCreation", "output"] as const) {
    const v = fields[key];
    if (v === undefined) return undefined;
    sum += v * CLASS_WEIGHTS[key];
  }
  return sum * weights[tier];
}

/** A run's units: each turn at its own model's weight; undefined when any turn's tokens or model are unknown. */
export function runUnits(state: Pick<RunState, "attempts">, weights: QuotaWeights = DEFAULT_WEIGHTS): number | undefined {
  let sum = 0;
  for (const a of state.attempts) {
    const tier = tierOf(a.model);
    const u = tier ? quotaUnits(tokenFields(a.usage), tier, weights) : undefined;
    if (u === undefined) return undefined;
    sum += u;
  }
  return state.attempts.length > 0 ? sum : undefined;
}

// ---- the cheap turn, cut at a model call ----

export interface LogSlice {
  /** The stream log up to (not including) the first event of model call cutoff + 1. */
  text: string;
  /** Model calls kept (message ids). */
  calls: number;
  /** Model calls in the whole log. */
  totalCalls: number;
  /** The kept calls' tokens; a field is left out when a kept call did not report it. */
  tokens?: TokenFields;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Cut a Claude Code stream-json log after its first `cutoff` model calls (an assistant message id is one call). */
export function sliceLog(logText: string, cutoff: number): LogSlice {
  const kept: string[] = [];
  const ids: string[] = [];
  const usage = new Map<string, { input?: number; cacheRead?: number; cacheWrite?: number; output?: number }>();
  let stopped = false;
  let total = 0;
  const seen = new Set<string>();
  for (const line of logText.split("\n")) {
    let event: Record<string, unknown> | undefined;
    try {
      event = line.trim() ? obj(JSON.parse(line)) : undefined;
    } catch {
      event = undefined;
    }
    const message = event?.type === "assistant" ? obj(event.message) : undefined;
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (id && !seen.has(id)) {
      seen.add(id);
      total += 1;
      if (ids.length >= cutoff) stopped = true;
      else ids.push(id);
    }
    if (stopped) continue;
    kept.push(line);
    const u = obj(message?.usage);
    if (id && u) {
      const prev = usage.get(id) ?? {};
      const max = (a: number | undefined, b: unknown): number | undefined => (num(b) === undefined ? a : Math.max(a ?? 0, num(b)!));
      usage.set(id, { input: max(prev.input, u.input_tokens), cacheRead: max(prev.cacheRead, u.cache_read_input_tokens), cacheWrite: max(prev.cacheWrite, u.cache_creation_input_tokens), output: max(prev.output, u.output_tokens) });
    }
  }
  const summed = ids.length > 0 ? sumTokenFields(ids.map((id) => tokenFields(usage.get(id) ?? {}))) : undefined;
  const tokens = summed ? { ...summed, calls: ids.length } : undefined;
  return { text: kept.join("\n"), calls: ids.length, totalCalls: total, ...(tokens ? { tokens } : {}) };
}

// ---- history ----

export interface HistoricalRun {
  runId: string;
  /** The eval it belongs to; for runs known only from the record, the run's own id. */
  source: string;
  /** The task, for pairing with other runs of it; `run:<id>` when it is not an eval task. */
  task: string;
  preset?: string;
  /** The one model tier every turn ran on; "mixed" when turns ran on more than one (a cascade). */
  tier: ModelTier | "mixed";
  /** "hidden": an eval's hidden check; "checks": the run's own checks, from the record (weaker). */
  truth: "hidden" | "checks";
  resolved: boolean;
  state: RunState;
}

function runDirs(home: string): Map<string, string> {
  const out = new Map<string, string>();
  const projects = join(home, "projects");
  if (!existsSync(projects)) return out;
  for (const p of readdirSync(projects)) {
    const runs = join(projects, p, "runs");
    if (!existsSync(runs)) continue;
    for (const id of readdirSync(runs)) if (existsSync(join(runs, id, "run.json"))) out.set(id, join(runs, id));
  }
  return out;
}

function readState(dir: string): RunState | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunState;
  } catch {
    return undefined;
  }
}

function runTier(state: RunState): ModelTier | "mixed" | undefined {
  const tiers = new Set(state.attempts.map((a) => tierOf(a.model)).filter((t): t is ModelTier => t !== undefined));
  if (tiers.size === 0) return undefined;
  return tiers.size === 1 ? [...tiers][0]! : "mixed";
}

/** Every finished run with a known outcome: from the evals' results (hidden check), then from the record (the run's checks). Read only. */
export function loadHistory(home: string): { runs: HistoricalRun[]; skipped: Record<string, number> } {
  const dirs = runDirs(home);
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => void (skipped[why] = (skipped[why] ?? 0) + 1);
  const runs: HistoricalRun[] = [];
  const taken = new Set<string>();
  const evals = join(home, "evals");
  for (const name of existsSync(evals) ? readdirSync(evals).sort() : []) {
    const path = join(evals, name, "results.json");
    if (!existsSync(path)) continue;
    let report: EvalReport;
    try {
      report = JSON.parse(readFileSync(path, "utf8")) as EvalReport;
    } catch {
      skip("unreadable results.json");
      continue;
    }
    for (const r of Object.values(report.results ?? {}).sort((a, b) => a.task.localeCompare(b.task))) {
      if (r.hidden !== "pass" && r.hidden !== "fail") {
        skip(`hidden check ${r.hidden ?? "missing"}`);
        continue;
      }
      const dir = dirs.get(r.runId);
      const state = dir ? readState(dir) : undefined;
      if (!state) {
        skip("run folder gone");
        continue;
      }
      const tier = runTier(state);
      if (!tier) {
        skip("no model recorded");
        continue;
      }
      taken.add(r.runId);
      runs.push({ runId: r.runId, source: name, task: r.task, preset: report.preset, tier, truth: "hidden", resolved: r.hidden === "pass", state });
    }
  }
  // The record's run lines: real runs with no hidden check, judged by their own checks.
  const lines = readRecord(home).filter((l): l is RunLine => l.kind === "run");
  const latest = new Map<string, RunLine>();
  for (const l of lines) if (l.run) latest.set(l.run, l);
  for (const [id, l] of [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (taken.has(id)) continue;
    if (l.checks !== "passed" && l.checks !== "failed") {
      skip("record: no checks to judge by");
      continue;
    }
    if (l.status !== "finished" && l.status !== "failed") {
      skip(`record: run ${l.status ?? "unknown"}`);
      continue;
    }
    const dir = dirs.get(id);
    const state = dir ? readState(dir) : undefined;
    const tier = state ? runTier(state) : undefined;
    if (!state || !tier) {
      skip("run folder gone");
      continue;
    }
    runs.push({ runId: id, source: id, task: `run:${id}`, preset: l.preset, tier, truth: "checks", resolved: l.status === "finished" && l.checks === "passed", state });
  }
  return { runs, skipped };
}

// ---- the state text ----

/** The request as typed (F109): the run's `request` when the brief engine rewrote it, else its prompt, which then is the request. */
export function typedRequest(state: Pick<RunState, "request" | "prompt" | "brief">): string | undefined {
  if (state.request !== undefined) return state.request;
  return state.brief ? undefined : state.prompt;
}

export interface ReplayProbe {
  facts?: ProbeFacts;
  text: string;
  source: "recorded" | "snapshot" | "metadata";
}

/** Facts known before the run started, when the repository cannot be probed: no outcome, nothing after the start. */
function metadataText(state: RunState, request: string | undefined): string {
  const words = request ? request.split(/\s+/).filter(Boolean).length : undefined;
  const size = words === undefined ? "of unknown length" : words < 40 ? "short" : words < 200 ? "of medium length" : "long";
  const checks = (state.checks ?? []).length > 0;
  const before = state.baseline?.some((c) => c.status === "failed" || c.status === "timeout");
  return [
    "The repository could not be probed again; only facts recorded before the run are known.",
    `The request is ${size}.`,
    checks ? `The project has automatic checks${before === undefined ? "" : before ? ", and some were failing before the change" : ", and they passed before the change"}.` : "The project has no automatic checks.",
  ].join(" ");
}

/** F138's probe for a past run: recorded in run.json, else probed on its base commit (git archive into a temporary folder), else recorded facts. */
export function replayProbe(state: RunState, tmpRoot = tmpdir()): ReplayProbe {
  if (state.probe?.layaStateText) return { facts: state.probe.facts, text: state.probe.layaStateText, source: "recorded" };
  const request = typedRequest(state);
  if (request !== undefined && state.repo && state.base && existsSync(state.repo)) {
    const archive = spawnSync("git", ["archive", "--format=tar", state.base], { cwd: state.repo, maxBuffer: 1024 * 1024 * 1024 });
    if (archive.status === 0 && archive.stdout.length > 0) {
      const dir = mkdtempSync(join(tmpRoot, "neuromesh-replay-"));
      try {
        const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
        if (untar.status === 0) {
          const p = probeRepo(dir, request, { deadlineMs: 5000 });
          return { facts: p.facts, text: p.layaStateText, source: "snapshot" };
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return { text: metadataText(state, request), source: "metadata" };
}

/** The cheap model's first build turn: the first turn with a stream log on Haiku or Sonnet that is not planning, testing or review. */
function firstCheapTurn(state: RunState): RunState["attempts"][number] | undefined {
  return state.attempts.find((a) => a.logPath && tierOf(a.model) !== undefined && tierOf(a.model) !== "opus" && !["spec", "plan", "test", "lead-review", "advice", "evidence"].includes(a.kind));
}

export interface Sample {
  runId: string;
  source: string;
  task: string;
  tier: ModelTier;
  truth: "hidden" | "checks";
  resolved: boolean;
  probeSource: ReplayProbe["source"];
  stateText: string;
  facts?: ProbeFacts;
  /** The cheap turn's model calls kept, and its tokens up to the cut. */
  callsKept: number;
  cutTokens?: TokenFields;
  /** The whole run's units, and up to the cut. */
  runUnits?: number;
  cutUnits?: number;
}

/** A sample for every run made by Haiku or Sonnet alone; the reason for every run left out. */
export function buildSamples(history: HistoricalRun[], cutoff: number, options: { tmpRoot?: string; weights?: QuotaWeights } = {}): { samples: Sample[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => void (skipped[why] = (skipped[why] ?? 0) + 1);
  const samples: Sample[] = [];
  for (const h of history) {
    if (h.tier === "mixed" || h.tier === "opus") {
      if (h.tier === "mixed") skip("ran on more than one model (its outcome is not the cheap model's)");
      continue;
    }
    const turn = firstCheapTurn(h.state);
    if (!turn?.logPath || !existsSync(turn.logPath)) {
      skip("no stream log for the cheap turn");
      continue;
    }
    const slice = sliceLog(readFileSync(turn.logPath, "utf8"), cutoff);
    const probe = replayProbe(h.state, options.tmpRoot);
    const tools = parseTrajectory(slice.text);
    const changed = [...new Set(tools.filter((t) => t.path && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t.name)).map((t) => t.path!))];
    // At the cut nothing has been checked yet, and the cap was the cut's own, not the model's.
    const cheap: CheapTurn = { tools, calls: slice.calls, changedFiles: changed };
    const digest = buildTrajectoryDigest(probe.facts, [cheap], h.state.baseline);
    const tier = h.tier;
    samples.push({
      runId: h.runId,
      source: h.source,
      task: h.task,
      tier,
      truth: h.truth,
      resolved: h.resolved,
      probeSource: probe.source,
      stateText: temporalStateText(probe.text, digest),
      ...(probe.facts ? { facts: probe.facts } : {}),
      callsKept: slice.calls,
      ...(slice.tokens ? { cutTokens: slice.tokens } : {}),
      runUnits: runUnits(h.state, options.weights),
      cutUnits: quotaUnits(slice.tokens, tier, options.weights),
    });
  }
  return { samples, skipped };
}

// ---- labels ----

export type Label = boolean | null;
export interface LabelRow {
  stateText: string;
  labels: Record<QuestionId, Label>;
}

/** A change this small is localized: at most 2 files and 60 changed lines. */
const LOCAL = { files: 2, lines: 60 };

/**
 * Labels from what happened, null when it is not known:
 * - cheap_will_resolve: the run's own model resolved it.
 * - has_implied_invariants: no when it resolved; yes when the run's own checks passed and the hidden check
 *   failed (the work met what was written, not what was implied); unknown otherwise.
 * - is_mechanical_or_localized: from the smallest passing change any run made on the task; unknown with none.
 */
export function labelsOf(sample: Sample, history: HistoricalRun[]): Record<QuestionId, Label> {
  const own = history.find((h) => h.runId === sample.runId);
  const ownChecks = own?.state.outcome?.checks;
  const passing = history.filter((h) => h.task === sample.task && h.resolved && h.state.outcome);
  const smallest = passing.map((h) => ({ files: h.state.outcome!.files.length, lines: h.state.outcome!.insertions + h.state.outcome!.deletions })).sort((a, b) => a.files - b.files || a.lines - b.lines)[0];
  return {
    is_mechanical_or_localized: smallest ? smallest.files <= LOCAL.files && smallest.lines <= LOCAL.lines : null,
    has_implied_invariants: sample.resolved ? false : sample.truth === "hidden" && ownChecks === "passed" ? true : null,
    cheap_will_resolve: sample.resolved,
  };
}

// ---- the replay ----

export interface Asked {
  sample: Sample;
  decision: LayaDecision;
  action: GateAction;
  labels: Record<QuestionId, Label>;
}

export interface QuestionFigures {
  /** Answers given (Laya reachable). */
  answers: number;
  /** route review or abstained: the gate did not act on it. */
  abstained: number;
  /** Decisive answers with a known label, and how many were right (the label is in the answer's set). */
  decisiveLabelled: number;
  covered: number;
}

export interface QuotaFigures {
  /** Samples with every number the comparison needs. */
  tasks: number;
  /** Samples left out because a number was unknown (a reference run missing or tokens not reported). */
  unknown: number;
  routedUnits: number;
  soloOpusUnits: number;
  routedResolved: number;
  soloOpusResolved: number;
}

export interface ReplayReport {
  cutoff: number;
  samples: number;
  skipped: Record<string, number>;
  probeSources: Record<string, number>;
  /** Over samples judged by a hidden check (and the record's checks too, with includeChecks). */
  judged: number;
  matrix: { cheapResolvedRoutedCheap: number; cheapResolvedRoutedFrontier: number; cheapFailedRoutedCheap: number; cheapFailedRoutedFrontier: number };
  /** Kept cheap where cheap failed, over the cheap failures; undefined with none. */
  falseCheapRate?: number;
  /** Escalated where cheap resolved, over the cheap successes. */
  falseFrontierRate?: number;
  actions: Record<GateAction, number>;
  laya: { asked: number; unavailable: number; reasons: Record<string, number>; questions: Record<QuestionId, QuestionFigures> };
  quota: QuotaFigures;
  weights: QuotaWeights;
}

/** The reference run of a task on one model alone (first by eval name, then run id): solo-opus for Opus. */
function reference(history: HistoricalRun[], task: string, tier: ModelTier): HistoricalRun | undefined {
  return history.filter((h) => h.task === task && h.tier === tier && h.truth === "hidden").sort((a, b) => a.source.localeCompare(b.source) || a.runId.localeCompare(b.runId))[0];
}

export interface ReplayOptions {
  cutoff: number;
  /** Ask Laya about one state text (LayaClient.decideRouting). */
  ask: (stateText: string) => Promise<LayaDecision>;
  weights?: QuotaWeights;
  /** Judge the matrix by the record's checks too, not only by hidden checks. */
  includeChecks?: boolean;
  tmpRoot?: string;
}

export async function replay(history: HistoricalRun[], loadSkipped: Record<string, number>, options: ReplayOptions): Promise<{ report: ReplayReport; asked: Asked[]; rows: LabelRow[] }> {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const built = buildSamples(history, options.cutoff, { tmpRoot: options.tmpRoot, weights });
  const skipped = { ...loadSkipped };
  for (const [k, v] of Object.entries(built.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
  const asked: Asked[] = [];
  for (const sample of built.samples) {
    const decision = await options.ask(sample.stateText);
    const gate = evaluateGate(sample.facts, decision, { tier: sample.tier });
    asked.push({ sample, decision, action: gate.action, labels: labelsOf(sample, history) });
  }

  const matrix = { cheapResolvedRoutedCheap: 0, cheapResolvedRoutedFrontier: 0, cheapFailedRoutedCheap: 0, cheapFailedRoutedFrontier: 0 };
  const actions: Record<GateAction, number> = { continue_cheap: 0, escalate_sonnet: 0, escalate_opus: 0 };
  const probeSources: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const questions = Object.fromEntries(ROUTING_QUESTIONS.map((q) => [q.id, { answers: 0, abstained: 0, decisiveLabelled: 0, covered: 0 }])) as Record<QuestionId, QuestionFigures>;
  const quota: QuotaFigures = { tasks: 0, unknown: 0, routedUnits: 0, soloOpusUnits: 0, routedResolved: 0, soloOpusResolved: 0 };
  let judged = 0;
  let unavailable = 0;
  for (const a of asked) {
    const s = a.sample;
    actions[a.action] += 1;
    probeSources[s.probeSource] = (probeSources[s.probeSource] ?? 0) + 1;
    if (a.decision.status !== "ok") {
      unavailable += 1;
      const why = a.decision.reason.replace(/\d+/g, "n");
      reasons[why] = (reasons[why] ?? 0) + 1;
    } else {
      for (const q of ROUTING_QUESTIONS) {
        const ans = a.decision.answers[q.id];
        const f = questions[q.id];
        f.answers += 1;
        const decisive = ans.route === "auto" && !ans.abstain && ans.value !== undefined && (ans.predictionSet === undefined || ans.predictionSet.length === 1);
        if (!decisive) f.abstained += 1;
        const label = a.labels[q.id];
        if (decisive && label !== null) {
          f.decisiveLabelled += 1;
          if (ans.value === label) f.covered += 1;
        }
      }
    }
    if (s.truth === "hidden" || options.includeChecks) {
      judged += 1;
      const cheap = a.action === "continue_cheap";
      if (s.resolved) cheap ? matrix.cheapResolvedRoutedCheap++ : matrix.cheapResolvedRoutedFrontier++;
      else cheap ? matrix.cheapFailedRoutedCheap++ : matrix.cheapFailedRoutedFrontier++;
    }
    // The routed policy on this task against Opus alone on it.
    if (s.truth !== "hidden") continue;
    const opus = reference(history, s.task, "opus");
    const opusUnits = opus ? runUnits(opus.state, weights) : undefined;
    let routedUnits: number | undefined;
    let routedResolved: boolean | undefined;
    if (a.action === "continue_cheap") {
      routedUnits = s.runUnits;
      routedResolved = s.resolved;
    } else {
      const solver = reference(history, s.task, a.action === "escalate_sonnet" ? "sonnet" : "opus");
      const solverUnits = solver ? runUnits(solver.state, weights) : undefined;
      routedUnits = s.cutUnits !== undefined && solverUnits !== undefined ? s.cutUnits + solverUnits : undefined;
      routedResolved = solver?.resolved;
    }
    if (opus === undefined || opusUnits === undefined || routedUnits === undefined || routedResolved === undefined) {
      quota.unknown += 1;
      continue;
    }
    quota.tasks += 1;
    quota.routedUnits += routedUnits;
    quota.soloOpusUnits += opusUnits;
    if (routedResolved) quota.routedResolved += 1;
    if (opus.resolved) quota.soloOpusResolved += 1;
  }
  const failed = matrix.cheapFailedRoutedCheap + matrix.cheapFailedRoutedFrontier;
  const resolved = matrix.cheapResolvedRoutedCheap + matrix.cheapResolvedRoutedFrontier;
  const report: ReplayReport = {
    cutoff: options.cutoff,
    samples: asked.length,
    skipped,
    probeSources,
    judged,
    matrix,
    ...(failed > 0 ? { falseCheapRate: matrix.cheapFailedRoutedCheap / failed } : {}),
    ...(resolved > 0 ? { falseFrontierRate: matrix.cheapResolvedRoutedFrontier / resolved } : {}),
    actions,
    laya: { asked: asked.length, unavailable, reasons, questions },
    quota,
    weights,
  };
  const rows: LabelRow[] = asked.map((a) => ({ stateText: a.sample.stateText, labels: a.labels }));
  return { report, asked, rows };
}

/** Write the labelled dataset (one JSON object per line), replacing the last export whole. */
export function writeLabels(path: string, rows: LabelRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : ""));
  renameSync(`${path}.tmp`, path);
}

const pct = (x: number | undefined): string => (x === undefined ? "unknown" : `${(100 * x).toFixed(1)}%`);

export function formatReplay(r: ReplayReport): string {
  const m = r.matrix;
  const lines = [
    `Replay at cutoff ${r.cutoff} model calls: ${r.samples} cheap runs replayed (state text: ${Object.entries(r.probeSources).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}).`,
    `Left out: ${Object.entries(r.skipped).map(([k, v]) => `${k} ${v}`).join("; ") || "none"}.`,
    "",
    `Routing against what happened (${r.judged} judged):`,
    `                      routed cheap   routed frontier`,
    `  cheap resolved      ${String(m.cheapResolvedRoutedCheap).padStart(12)}   ${String(m.cheapResolvedRoutedFrontier).padStart(15)}`,
    `  cheap failed        ${String(m.cheapFailedRoutedCheap).padStart(12)}   ${String(m.cheapFailedRoutedFrontier).padStart(15)}`,
    `  false-cheap rate (quality loss risk): ${pct(r.falseCheapRate)} of the cheap failures`,
    `  false-frontier rate (wasted quota): ${pct(r.falseFrontierRate)} of the cheap successes`,
    `  gate actions: ${Object.entries(r.actions).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    `Laya: asked ${r.laya.asked}, unavailable ${r.laya.unavailable}${r.laya.unavailable > 0 ? ` (${Object.entries(r.laya.reasons).map(([k, v]) => `${k}: ${v}`).join("; ")})` : ""}.`,
  ];
  for (const q of ROUTING_QUESTIONS) {
    const f = r.laya.questions[q.id];
    lines.push(`  ${q.id.padEnd(27)} answers ${f.answers}, review or abstained ${pct(f.answers > 0 ? f.abstained / f.answers : undefined)}, coverage ${f.decisiveLabelled > 0 ? `${pct(f.covered / f.decisiveLabelled)} (${f.covered} of ${f.decisiveLabelled} decisive answers with a known label)` : "unknown (no decisive answer with a known label)"}`);
  }
  const q = r.quota;
  lines.push(
    "",
    `Simulated quota against solo-opus (estimate, Opus-equivalent units; Haiku ${r.weights.haiku.toFixed(3)} of Opus, measured; Sonnet ${r.weights.sonnet} of Opus, assumed):`,
    q.tasks === 0
      ? `  unknown: no replayed task has a solo Opus run with reported tokens to compare against (${q.unknown} left out).`
      : `  on ${q.tasks} tasks (${q.unknown} left out, a number unknown): routed ${Math.round(q.routedUnits).toLocaleString("en")} units, solo-opus ${Math.round(q.soloOpusUnits).toLocaleString("en")} units, ${pct(q.routedUnits / Math.max(1e-9, q.soloOpusUnits))} of Opus's; resolved ${q.routedResolved} against ${q.soloOpusResolved}.`,
  );
  return lines.join("\n");
}
