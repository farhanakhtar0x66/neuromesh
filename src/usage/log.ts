// The usage log: what real runs used and how they went, with the owner's own
// verdict. Synthetic evals say what a preset can do; this says what it is like
// to use, on real work. Data stays on this machine:
//   ~/.neuromesh/usage/runs.jsonl   one line per run (and per later rating)
//   ~/.neuromesh/usage/USAGE.md     the same as a readable report, rewritten each time

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { perTurnAttempts, usageByModel } from "../engine/run.ts";
import type { RunState } from "../engine/types.ts";
import { estimateCost } from "./prices.ts";

export interface UsageEntry {
  run: string;
  at: string;
  repo: string;
  preset: string;
  /** What the brief engine made of the request, when it ran. */
  kind?: string;
  surface?: string;
  staffing?: string;
  request: string;
  status: RunState["status"];
  checks: string;
  minutes: number;
  turns: number;
  escalated: boolean;
  models: { model: string; tier: string; roles: string[]; turns: number; tokens: number; cost?: number }[];
  tokens: { expert: number; worker: number };
  /** Estimated cost at API list prices; not money spent. */
  cost?: number;
  expertCost?: number;
  files: number;
  insertions: number;
  deletions: number;
  /** Features on for the run, and those that failed (src/features.ts). */
  features?: string[];
  featureErrors?: string[];
}

export interface Rating {
  run: string;
  at: string;
  /** 1 (much worse) to 5 (much better) than the owner's usual way of working. */
  score: number;
  /** What the owner usually uses, for the comparison. */
  usual?: string;
  note?: string;
}

type Line = ({ type: "run" } & UsageEntry) | ({ type: "rating" } & Rating);

export function usageDir(home: string): string {
  return join(home, "usage");
}

function total(u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): number {
  return (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
}

export function entryFor(state: RunState, sessionTotals: (backend: string) => boolean): UsageEntry {
  const attempts = perTurnAttempts(state, sessionTotals);
  const models = usageByModel(attempts).map((m) => ({
    model: m.model,
    tier: m.tier,
    roles: m.roles,
    turns: m.turns,
    tokens: total(m.usage),
    cost: estimateCost(m.model, m.usage),
  }));
  const priced = models.every((m) => m.cost !== undefined || m.tokens === 0);
  const sum = (list: typeof models): number => list.reduce((n, m) => n + (m.cost ?? 0), 0);
  return {
    run: state.id,
    at: state.updatedAt,
    repo: basename(state.repo),
    preset: state.preset,
    kind: state.brief?.kind,
    surface: state.brief?.surface,
    staffing: state.brief?.staffing.reasons.join("; ") ?? state.route,
    request: (state.request ?? state.prompt).slice(0, 300),
    status: state.status,
    checks: state.outcome?.checks ?? "-",
    minutes: Math.round(((Date.parse(state.updatedAt) - Date.parse(state.createdAt)) / 60_000) * 10) / 10,
    turns: attempts.length,
    escalated: state.tasks.some((t) => t.escalated || t.advised),
    features: state.features,
    featureErrors: (state.featureErrors ?? []).map((f) => `${f.id} ${f.key}: ${f.message.slice(0, 160)}`),
    models,
    tokens: {
      expert: models.filter((m) => m.tier === "expert").reduce((n, m) => n + m.tokens, 0),
      worker: models.filter((m) => m.tier !== "expert").reduce((n, m) => n + m.tokens, 0),
    },
    cost: priced ? sum(models) : undefined,
    expertCost: priced ? sum(models.filter((m) => m.tier === "expert")) : undefined,
    files: state.outcome?.files.length ?? 0,
    insertions: state.outcome?.insertions ?? 0,
    deletions: state.outcome?.deletions ?? 0,
  };
}

function append(home: string, line: Line): void {
  const dir = usageDir(home);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "runs.jsonl"), JSON.stringify(line) + "\n");
  writeFileSync(join(dir, "USAGE.md"), report(readLog(home)));
}

export function recordRun(home: string, entry: UsageEntry): void {
  append(home, { type: "run", ...entry });
}

export function recordRating(home: string, rating: Rating): void {
  append(home, { type: "rating", ...rating });
}

export function readLog(home: string): { runs: UsageEntry[]; ratings: Map<string, Rating> } {
  const path = join(usageDir(home), "runs.jsonl");
  const runs = new Map<string, UsageEntry>();
  const ratings = new Map<string, Rating>();
  if (!existsSync(path)) return { runs: [], ratings };
  for (const text of readFileSync(path, "utf8").split("\n")) {
    if (!text.trim()) continue;
    try {
      const line = JSON.parse(text) as Line;
      // A resumed run is recorded again; the latest record wins.
      if (line.type === "run") runs.set(line.run, line);
      else if (line.type === "rating") ratings.set(line.run, line);
    } catch {
      // A damaged line is skipped, never fatal.
    }
  }
  return { runs: [...runs.values()], ratings };
}

const money = (n: number | undefined): string => (n === undefined ? "unknown" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
const k = (n: number): string => `${Math.round(n / 1000)}k`;
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The Markdown report: per-preset summary first, then every run. */
export function report(log: { runs: UsageEntry[]; ratings: Map<string, Rating> }): string {
  const lines = [
    "# Neuromesh usage",
    "",
    "Real runs on this machine, recorded by `neuromesh run`. Costs are estimates at API list prices (`src/usage/prices.ts`); nothing is paid per token. Ratings compare a run with the owner's usual way of working: 1 much worse, 3 about the same, 5 much better.",
    "",
    "## By preset and kind of work",
    "",
    "| Preset | Kind | Runs | Finished with passing checks | Avg minutes | Avg cost | Avg expert cost | Avg rating |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const groups = new Map<string, UsageEntry[]>();
  for (const r of log.runs) {
    const key = `${r.preset}\u0000${r.kind ?? "-"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, runs] of [...groups.entries()].sort()) {
    const [preset, kind] = key.split("\u0000");
    const ok = runs.filter((r) => (r.status === "finished" || r.status === "applied") && r.checks !== "failed").length;
    const avg = (f: (r: UsageEntry) => number | undefined): number | undefined => {
      const values = runs.map(f).filter((v): v is number => v !== undefined);
      return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
    };
    const rating = avg((r) => log.ratings.get(r.run)?.score);
    lines.push(
      `| ${preset} | ${kind} | ${runs.length} | ${ok} | ${avg((r) => r.minutes)?.toFixed(1)} | ${money(avg((r) => r.cost))} | ${money(avg((r) => r.expertCost))} | ${rating === undefined ? "-" : rating.toFixed(1)} |`,
    );
  }
  const failures = new Map<string, number>();
  for (const r of log.runs) for (const f of r.featureErrors ?? []) failures.set(f.split(":")[0]!, (failures.get(f.split(":")[0]!) ?? 0) + 1);
  if (failures.size > 0) {
    lines.push("", "## Features that failed", "", "Ids from `neuromesh features`. Switch one off with `--disable <key>` while it is being fixed.", "", "| Feature | Runs where it failed |", "| --- | --- |");
    for (const [f, n] of [...failures.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${f} | ${n} |`);
  }
  lines.push("", "## Runs", "", "| When | Repo | Preset | Kind | Status | Checks | Minutes | Tokens (expert / worker) | Cost | Rating | Request | Note | Features that failed |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of [...log.runs].sort((a, b) => b.at.localeCompare(a.at))) {
    const rating = log.ratings.get(r.run);
    lines.push(
      `| ${r.at.slice(0, 16).replace("T", " ")} | ${cell(r.repo)} | ${r.preset} | ${r.kind ?? "-"} | ${r.status} | ${r.checks} | ${r.minutes} | ${k(r.tokens.expert)} / ${k(r.tokens.worker)} | ${money(r.cost)} | ${rating ? `${rating.score}${rating.usual ? ` vs ${cell(rating.usual)}` : ""}` : "-"} | ${cell(r.request.slice(0, 80))} | ${cell(rating?.note ?? "")} | ${cell((r.featureErrors ?? []).join("; ") || "-")} |`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Ask the owner how the run compared with their usual way of working. */
export async function askRating(run: string): Promise<Rating | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("\nHow did this go, compared with how you usually do this kind of work? (Enter to skip; rate later with `neuromesh rate`)\n");
    const answer = (await rl.question("  1 much worse · 2 worse · 3 about the same · 4 better · 5 much better: ")).trim();
    const score = Number.parseInt(answer, 10);
    if (!(score >= 1 && score <= 5)) return undefined;
    const usual = (await rl.question("  What do you usually use for this? (e.g. Claude Code with Opus; Enter to skip): ")).trim();
    const note = (await rl.question("  Anything worth noting? (Enter to skip): ")).trim();
    return { run, at: new Date().toISOString(), score, usual: usual || undefined, note: note || undefined };
  } finally {
    rl.close();
  }
}
