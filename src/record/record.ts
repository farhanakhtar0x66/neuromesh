// [F108 run-record] One append-only record of what the engine did, in one place.
// Plan item L1 (docs/22-path-to-the-goal.md, track L; phase 4, step 1).
//
//   ~/.neuromesh/record/record.jsonl   one JSON object per line, never rewritten
//   ~/.neuromesh/record/index.json     a summary rebuilt on demand (`neuromesh-record index`)
//
// Lines, by `kind`:
//   turn      one model turn: role, tier, model, stop, duration, usage (with the
//             five-part input split when known), cost estimate, quota readings
//   decision  one thing the engine decided (started on a tier, climbed, asked for
//             a review, raced, split, skipped...) with the inputs it had then
//             (the event's own fields); the outcome is the task and run lines
//             that follow, joined by run and task
//   run       a run's end state: status, checks, tasks, cost, features on, failed
//   task      one task's end state: status, escalated, advised, rounds, verdict
//   result    a benchmark or eval result for a run or a task: score, cost, quota
//   rating    the owner's rating of a real run (from the usage log)
//
// The same lines are written live (EventLog) and by the backfill from run
// folders already on disk, so the record does not depend on when it started.
// Nothing here holds the request's text, code, diffs or file paths: only counts,
// names of models and tiers, and what was decided. An unknown number is left
// out, never written as 0. A cost is always an estimate at API list prices.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "../backends/types.ts";
import { existsSync as exists, readFileSync as readFile } from "node:fs";
import { dirname } from "node:path";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";

export const RECORD_VERSION = 1;

export interface Base {
  v: number;
  kind: string;
  /** The run this is about, when it is about one. */
  run?: string;
  /** When it happened (ISO). */
  at: string;
  /** Where the line came from: "live", or "backfill:<what was read>". */
  src: string;
}

export interface TurnLine extends Base {
  kind: "turn";
  task?: string;
  role?: string;
  turn?: string;
  tier?: string;
  cascadeTier?: string;
  model?: string;
  stop?: string;
  durationMs?: number;
  usage?: Usage;
  /** Estimated at API list prices; not money spent. Absent when the model has no listed price. */
  costEstimateUsd?: number;
  quotaUsed?: Record<string, number>;
  earlyExit?: boolean;
  detail?: string;
}

export interface DecisionLine extends Base {
  kind: "decision";
  /** The event's name: route.tier, task.climbed, race.started, blind.tests... */
  name: string;
  /** The feature (F82...) the decision belongs to, when the event says. */
  feature?: string;
  task?: string;
  /** What the engine knew when it decided: the event's own fields. */
  inputs: Record<string, unknown>;
}

export interface RunLine extends Base {
  kind: "run";
  preset?: string;
  project?: string;
  status?: string;
  checks?: string;
  minutes?: number;
  turns?: number;
  tasks?: number;
  escalated?: boolean;
  costEstimateUsd?: number;
  features?: string[];
  featureErrors?: string[];
  files?: number;
  insertions?: number;
  deletions?: number;
}

export interface TaskLine extends Base {
  kind: "task";
  task: string;
  status?: string;
  tier?: string;
  escalated?: boolean;
  advised?: boolean;
  rounds?: number;
  verdict?: string;
  openQuestions?: number;
}

export interface ResultLine extends Base {
  kind: "result";
  source: string;
  /** Eval or benchmark name, e.g. rb-cascade-2. */
  name: string;
  task: string;
  config?: string;
  passed?: number;
  total?: number;
  /** 0 to 10, from the hidden check. */
  quality?: number;
  hidden?: string;
  costEstimateUsd?: number;
  tokens?: number;
  wallMs?: number;
  quota?: Record<string, unknown>;
  finalTier?: string;
  routedTier?: string;
}

export interface RatingLine extends Base {
  kind: "rating";
  score: number;
  usual?: string;
}

export type RecordLine = TurnLine | DecisionLine | RunLine | TaskLine | ResultLine | RatingLine;

/** The events that end a run (or a stretch of it): the run line and the task lines come from run.json, which is saved just before. */
export const RUN_END = new Set(["run.finished", "run.failed", "run.paused", "run.interrupted"]);

/** The engine's decisions, by event name. Anything else the engine emits is narration or a turn. */
export const DECISION_EVENTS = new Set([
  "route", "route.tier", "route.evidence", "routing.calibrated", "routing.summary", "brief", "plan.ready", "spec.ready",
  "task.direct", "task.split", "task.climbed", "task.escalated", "task.advised", "task.diagnosed", "task.conflict", "task.failed",
  "quota.shifted", "model.exhausted", "race.started", "race.finished", "blind.tests", "blind.open", "blind.dropped",
  "shadow.sampled", "findings.checked", "repair.started", "integration.fix", "context.compacted", "screens.checked",
  "tester.verdict", "env.problem", "feature.failed", "ask", "answer", "agent.preamble",
]);

const SKIP_INPUT = new Set(["t", "run", "type", "feature", "task"]);

/** Fields too long or too private to keep: the request, code, diffs, summaries. */
function keep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return depth > 3 ? undefined : value.slice(0, 40).map((v) => keep(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 3) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "prompt" || k === "diff" || k === "content" || k === "files" || k === "cwd" || k === "repo") continue;
      const kept = keep(v, depth + 1);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return value;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** The lines one engine event stands for (none for narration). */
export function linesFromEvent(event: NeuromeshEvent, src = "live"): RecordLine[] {
  const base = { v: RECORD_VERSION, run: event.run, at: event.t, src };
  if (event.type === "agent.finished") {
    const line: TurnLine = {
      ...base,
      kind: "turn",
      task: str(event.task),
      role: str(event.role),
      turn: str(event.kind),
      tier: str(event.tier),
      cascadeTier: str(event.cascadeTier),
      model: str(event.model),
      stop: str(event.stop),
      durationMs: num(event.durationMs),
      usage: event.usage as Usage | undefined,
      costEstimateUsd: num(event.cost),
      quotaUsed: event.quotaUsed as Record<string, number> | undefined,
      earlyExit: event.earlyExit === true ? true : undefined,
      detail: str(event.detail)?.slice(0, 200),
    };
    return [dropUndefined(line)];
  }
  if (RUN_END.has(event.type)) return [];
  if (event.type === "run.started") {
    const prompt = typeof event.prompt === "string" ? event.prompt.length : undefined;
    return [dropUndefined({ ...base, kind: "decision", name: "run.started", task: undefined, inputs: keep({ preset: event.preset, mode: event.mode, worker: event.worker, expert: event.expert, promptChars: prompt }) as Record<string, unknown> } as DecisionLine)];
  }
  if (DECISION_EVENTS.has(event.type)) {
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event)) if (!SKIP_INPUT.has(k)) inputs[k] = v;
    return [dropUndefined({ ...base, kind: "decision", name: event.type, feature: str(event.feature), task: str(event.task), inputs: keep(inputs) as Record<string, unknown> } as DecisionLine)];
  }
  return [];
}

/** A run's end state, as one run line and one line per task. */
export function linesFromState(state: RunState, src = "live"): RecordLine[] {
  const at = state.updatedAt;
  const costs = state.attempts.map((a) => a.costUsdEquivalent).filter((c): c is number => c !== undefined);
  const run: RunLine = dropUndefined({
    v: RECORD_VERSION,
    kind: "run" as const,
    run: state.id,
    at,
    src,
    preset: state.preset,
    project: state.repo ? state.repo.split("/").filter(Boolean).at(-1) : undefined,
    status: state.status,
    checks: state.outcome?.checks,
    minutes: Math.round(((Date.parse(state.updatedAt) - Date.parse(state.createdAt)) / 60_000) * 10) / 10,
    turns: state.attempts.length,
    tasks: state.tasks.length,
    escalated: state.tasks.some((t) => t.escalated || t.advised),
    // The tool's own figure, in the owner's currency of record: kept as an estimate, and only when every turn reported one.
    costEstimateUsd: costs.length > 0 && costs.length === state.attempts.length ? costs.reduce((n, c) => n + c, 0) : undefined,
    features: state.features,
    featureErrors: (state.featureErrors ?? []).map((f) => `${f.id} ${f.key}`),
    files: state.outcome?.files.length,
    insertions: state.outcome?.insertions,
    deletions: state.outcome?.deletions,
  });
  const tasks = state.tasks.map((t): TaskLine => {
    const last = [...state.attempts].reverse().find((a) => a.task === t.id);
    return dropUndefined({
      v: RECORD_VERSION,
      kind: "task" as const,
      run: state.id,
      at,
      src,
      task: t.id,
      status: t.status,
      tier: last?.cascadeTier ?? last?.tier,
      escalated: t.escalated || undefined,
      advised: t.advised || undefined,
      rounds: state.attempts.filter((a) => a.task === t.id).length || undefined,
      verdict: t.verdict?.verdict,
      openQuestions: t.openQuestions?.length || undefined,
    });
  });
  return [run, ...tasks];
}

function dropUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
}

/** What an event adds to the record, with the run's end state read from run.json beside the event log when the event ends a run. */
export function recordLinesFor(event: NeuromeshEvent, eventsPath: string): RecordLine[] {
  const lines = linesFromEvent(event);
  if (RUN_END.has(event.type)) {
    const statePath = `${dirname(eventsPath)}/run.json`;
    if (exists(statePath)) lines.push(...linesFromState(JSON.parse(readFile(statePath, "utf8")) as RunState));
  }
  return lines;
}

export function recordDir(home: string): string {
  return join(home, "record");
}

export function recordPath(home: string): string {
  return join(recordDir(home), "record.jsonl");
}

/** Append lines. One write, so concurrent runs interleave whole lines. */
export function appendRecord(home: string, lines: RecordLine[]): void {
  if (lines.length === 0) return;
  mkdirSync(recordDir(home), { recursive: true });
  appendFileSync(recordPath(home), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** Every line, in order. A half-written last line (a killed process) is skipped. */
export function readRecord(home: string): RecordLine[] {
  const path = recordPath(home);
  if (!existsSync(path)) return [];
  const out: RecordLine[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line) as RecordLine);
    } catch {
      // half a line
    }
  }
  return out;
}

export interface Filter {
  kind?: string;
  run?: string;
  model?: string;
  tier?: string;
  name?: string;
  feature?: string;
  task?: string;
  since?: string;
  src?: string;
}

export function select<T extends RecordLine = RecordLine>(lines: RecordLine[], f: Filter): T[] {
  return lines.filter((l) => {
    const a = l as unknown as Record<string, unknown>;
    return (
      (f.kind === undefined || l.kind === f.kind) &&
      (f.run === undefined || l.run === f.run || (l.run ?? "").startsWith(f.run)) &&
      (f.model === undefined || String(a.model ?? "").includes(f.model)) &&
      (f.tier === undefined || a.tier === f.tier || a.cascadeTier === f.tier) &&
      (f.name === undefined || a.name === f.name) &&
      (f.feature === undefined || a.feature === f.feature) &&
      (f.task === undefined || a.task === f.task) &&
      (f.since === undefined || l.at >= f.since) &&
      (f.src === undefined || l.src.startsWith(f.src))
    );
  }) as T[];
}

/** For a decision: the task line and run line that followed it (the last of each), so "what happened after" is one call. */
export function outcomeOf(lines: RecordLine[], d: DecisionLine): { task?: TaskLine; run?: RunLine } {
  let task: TaskLine | undefined;
  let run: RunLine | undefined;
  for (const l of lines) {
    if (l.run !== d.run) continue;
    if (l.kind === "task" && l.task === d.task) task = l;
    if (l.kind === "run") run = l;
  }
  return { task, run };
}

export interface Summary {
  lines: number;
  byKind: Record<string, number>;
  runs: number;
  turns: { count: number; byTier: Record<string, { turns: number; tokens: number }>; byModel: Record<string, { turns: number; tokens: number }> };
  decisions: Record<string, number>;
  features: Record<string, number>;
  firstAt?: string;
  lastAt?: string;
}

const tokensOf = (u: Usage | undefined): number => (u ? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0);

export function summarize(lines: RecordLine[]): Summary {
  const s: Summary = { lines: lines.length, byKind: {}, runs: 0, turns: { count: 0, byTier: {}, byModel: {} }, decisions: {}, features: {} };
  const runs = new Set<string>();
  for (const l of lines) {
    s.byKind[l.kind] = (s.byKind[l.kind] ?? 0) + 1;
    if (l.run) runs.add(l.run);
    if (!s.firstAt || l.at < s.firstAt) s.firstAt = l.at;
    if (!s.lastAt || l.at > s.lastAt) s.lastAt = l.at;
    if (l.kind === "turn") {
      s.turns.count += 1;
      const tier = l.cascadeTier ?? l.tier ?? "unknown";
      const model = l.model ?? "unknown";
      for (const [map, key] of [[s.turns.byTier, tier], [s.turns.byModel, model]] as const) {
        const e = (map[key] ??= { turns: 0, tokens: 0 });
        e.turns += 1;
        e.tokens += tokensOf(l.usage);
      }
    }
    if (l.kind === "decision") {
      s.decisions[l.name] = (s.decisions[l.name] ?? 0) + 1;
      if (l.feature) s.features[l.feature] = (s.features[l.feature] ?? 0) + 1;
    }
  }
  s.runs = runs.size;
  return s;
}

/** The ids of the runs already in the record, for the backfill to skip. */
export function recordedRuns(home: string): Set<string> {
  const ids = new Set<string>();
  const path = recordPath(home);
  if (!existsSync(path)) return ids;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /"run":"([^"]+)"/.exec(line);
    if (m && line.startsWith("{") && /"kind":"(turn|decision|run|task)"/.test(line)) ids.add(m[1]!);
  }
  return ids;
}

export function writeIndex(home: string): Summary {
  const summary = summarize(readRecord(home));
  mkdirSync(recordDir(home), { recursive: true });
  writeFileSync(join(recordDir(home), "index.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}
