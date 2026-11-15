// [F108 run-record] Read what is already on disk into the record: run folders
// (events.jsonl and run.json), benchmark results, eval reports, and the owner's
// ratings. Runs and results already in the record are skipped, so it can be run
// again at any time. No model calls.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../engine/types.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RatingLine, RecordLine, ResultLine } from "./record.ts";
import { RECORD_VERSION, appendRecord, linesFromEvent, linesFromState, readRecord, recordedRuns } from "./record.ts";

const SKIP = new Set(["worktree", "node_modules", "agent", "checks", ".git", "tasks", "repos", "repo"]);

/** Folders holding run.json and events.jsonl, anywhere under `root` (a few levels down; the big folders of a run are not entered). */
export function findRunDirs(root: string, depth = 7): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number): void => {
    if (!existsSync(dir)) return;
    if (existsSync(join(dir, "run.json")) && existsSync(join(dir, "events.jsonl"))) {
      out.push(dir);
      return;
    }
    if (d <= 0) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const p = join(dir, name);
      try {
        if (statSync(p).isDirectory()) walk(p, d - 1);
      } catch {
        // gone
      }
    }
  };
  walk(root, depth);
  return out.sort();
}

export interface BackfillResult {
  runsFound: number;
  runsAdded: number;
  runsSkipped: number;
  runsBroken: number;
  resultsAdded: number;
  ratingsAdded: number;
  linesAdded: number;
}

function runLines(dir: string): RecordLine[] | undefined {
  try {
    const state = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunState;
    const lines: RecordLine[] = [];
    for (const raw of readFileSync(join(dir, "events.jsonl"), "utf8").split("\n")) {
      if (!raw.startsWith("{")) continue;
      try {
        lines.push(...linesFromEvent(JSON.parse(raw) as NeuromeshEvent, "backfill:events"));
      } catch {
        // half a line
      }
    }
    lines.push(...linesFromState(state, "backfill:run.json"));
    return lines;
  } catch {
    return undefined;
  }
}

/** routing-bench results/<name>/<slug>.json, one result line each. */
function benchResults(dir: string): ResultLine[] {
  const out: ResultLine[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const folder = join(dir, name);
    if (!statSync(folder).isDirectory()) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".json"))) {
      try {
        const r = JSON.parse(readFileSync(join(folder, file), "utf8")) as Record<string, unknown> & { score?: { passed: number; total: number } };
        const quota = r.quota as { before?: Record<string, number>; after?: Record<string, number> } | undefined;
        out.push({
          v: RECORD_VERSION,
          kind: "result",
          source: "routing-bench",
          run: typeof r.runId === "string" ? r.runId : undefined,
          at: typeof r.finishedAt === "string" ? r.finishedAt : new Date(0).toISOString(),
          src: "backfill:routing-bench",
          name: String(r.name ?? name),
          task: String(r.id ?? file),
          config: typeof r.config === "string" ? r.config : undefined,
          set: typeof r.set === "string" ? r.set : String(r.id ?? "").startsWith("H") ? "held-out" : "original",
          passed: r.score?.passed,
          total: r.score?.total,
          quality: typeof r.quality === "number" ? r.quality : undefined,
          costEstimateUsd: typeof r.costUsd === "number" ? r.costUsd : undefined,
          tokens: typeof r.tokens === "number" ? r.tokens : undefined,
          wallMs: typeof r.wallMs === "number" ? r.wallMs : undefined,
          quota: quota ? { before: quota.before, after: quota.after } : undefined,
          finalTier: typeof r.finalTier === "string" ? r.finalTier : undefined,
          routedTier: typeof r.routedTier === "string" ? r.routedTier : undefined,
        } as ResultLine);
      } catch {
        // not a result
      }
    }
  }
  return out;
}

/** ~/.neuromesh/evals/<name>/results.json: the older evals, one result line per task. */
function evalResults(home: string): ResultLine[] {
  const out: ResultLine[] = [];
  const dir = join(home, "evals");
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "results.json");
    if (!existsSync(file)) continue;
    try {
      const report = JSON.parse(readFileSync(file, "utf8")) as { name?: string; preset?: string; results?: Record<string, Record<string, unknown>> };
      for (const [task, r] of Object.entries(report.results ?? {})) {
        const score = r.score as { passed: number; total: number } | undefined;
        out.push({
          v: RECORD_VERSION,
          kind: "result",
          source: "eval",
          at: typeof r.finishedAt === "string" ? r.finishedAt : new Date(0).toISOString(),
          src: "backfill:eval",
          name: report.name ?? name,
          task,
          config: report.preset,
          passed: score?.passed,
          total: score?.total,
          hidden: typeof r.hidden === "string" ? r.hidden : undefined,
          tokens: typeof r.expertTokens === "number" && typeof r.workerTokens === "number" ? r.expertTokens + r.workerTokens : undefined,
          wallMs: typeof r.wallMs === "number" ? r.wallMs : undefined,
          quota: (r.quota as Record<string, unknown> | undefined) ?? undefined,
        } as ResultLine);
      }
    } catch {
      // not a report
    }
  }
  return out;
}

function ratings(home: string): RatingLine[] {
  const file = join(home, "usage", "runs.jsonl");
  if (!existsSync(file)) return [];
  const out: RatingLine[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.startsWith("{")) continue;
    try {
      const l = JSON.parse(raw) as { type?: string; run?: string; at?: string; score?: number; usual?: string };
      if (l.type === "rating" && typeof l.score === "number" && l.run) out.push({ v: RECORD_VERSION, kind: "rating", run: l.run, at: l.at ?? new Date(0).toISOString(), src: "backfill:usage-log", score: l.score, usual: l.usual });
    } catch {
      // half a line
    }
  }
  return out;
}

export interface BackfillOptions {
  /** Folders to search for runs. */
  roots: string[];
  /** routing-bench results folders. */
  benchResults?: string[];
  /** Where the record, the evals and the usage log live. */
  home: string;
  dryRun?: boolean;
}

export function backfill(options: BackfillOptions): BackfillResult {
  const result: BackfillResult = { runsFound: 0, runsAdded: 0, runsSkipped: 0, runsBroken: 0, resultsAdded: 0, ratingsAdded: 0, linesAdded: 0 };
  const have = recordedRuns(options.home);
  const existing = readRecord(options.home);
  const haveResult = new Set(existing.filter((l): l is ResultLine => l.kind === "result").map((l) => `${l.source}|${l.name}|${l.task}`));
  const haveRating = new Set(existing.filter((l): l is RatingLine => l.kind === "rating").map((l) => `${l.run}|${l.at}`));
  const add = (lines: RecordLine[]): void => {
    result.linesAdded += lines.length;
    if (!options.dryRun) appendRecord(options.home, lines);
  };
  const seen = new Set<string>();
  for (const root of options.roots) {
    for (const dir of findRunDirs(root)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      result.runsFound += 1;
      const lines = runLines(dir);
      if (!lines) {
        result.runsBroken += 1;
        continue;
      }
      const id = lines.find((l) => l.run)?.run;
      if (!id || have.has(id)) {
        result.runsSkipped += 1;
        continue;
      }
      have.add(id);
      add(lines);
      result.runsAdded += 1;
    }
  }
  const results = [...(options.benchResults ?? []).flatMap(benchResults), ...evalResults(options.home)].filter((r) => {
    const key = `${r.source}|${r.name}|${r.task}`;
    if (haveResult.has(key)) return false;
    haveResult.add(key);
    return true;
  });
  add(results);
  result.resultsAdded = results.length;
  const rated = ratings(options.home).filter((r) => !haveRating.has(`${r.run}|${r.at}`));
  add(rated);
  result.ratingsAdded = rated.length;
  return result;
}
