// [F142 replay-harness] SWE-bench-Live subsets side by side. "all21" is the frontier subset: the issues an Opus-alone
// run (preset solo-opus) has a final result on, which is what the trials compared. "all27" is every issue of the
// suite, easy ones included, where routing earns its keep: a cheap model resolving an easy issue is a saving the
// frontier-only subset never shows. Both are always printed together. The names follow the counts in the data
// (all27 and all21 on the current suite); a figure that is not known is "unknown", never 0.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { costOf, loadReport } from "./eval.ts";
import type { EvalReport, TaskResult } from "./eval.ts";

const UNFINISHED = new Set(["paused", "interrupted", "running"]);
const final = (r: TaskResult | undefined): r is TaskResult => r !== undefined && !UNFINISHED.has(r.status);

export interface SubsetFigures {
  /** Tasks in the subset. */
  size: number;
  /** Tasks the run has a final result on. */
  final: number;
  resolved: number;
  /** Estimated API cost over the final results; incomplete when some usage had no listed price. */
  costEstimate: number;
  costIncomplete: boolean;
}

export interface RollupRow {
  name: string;
  preset: string;
  all: SubsetFigures;
  frontier: SubsetFigures;
}

/** Every eval report in a home whose name starts with the prefix (swl- for SWE-bench-Live). */
export function reportsWithPrefix(home: string, prefix: string): EvalReport[] {
  const dir = join(home, "evals");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith(prefix)).sort().map((n) => loadReport(home, n)).filter((r): r is EvalReport => r !== undefined);
}

/** The frontier subset: tasks with a final result in any Opus-alone report. */
export function frontierSubset(reports: EvalReport[]): Set<string> {
  const out = new Set<string>();
  for (const r of reports) if (r.preset === "solo-opus") for (const t of Object.values(r.results)) if (final(t)) out.add(t.task);
  return out;
}

function figures(report: EvalReport, tasks: string[]): SubsetFigures {
  const results = tasks.map((t) => report.results[t]).filter(final);
  let cost = 0;
  let incomplete = false;
  for (const r of results) {
    const c = costOf(r);
    cost += c.total;
    incomplete ||= c.incomplete;
  }
  return { size: tasks.length, final: results.length, resolved: results.filter((r) => r.hidden === "pass").length, costEstimate: cost, costIncomplete: incomplete };
}

export function sweRollup(reports: EvalReport[], allTasks: string[], frontier: Set<string>): RollupRow[] {
  const sub = allTasks.filter((t) => frontier.has(t));
  return reports.map((r) => ({ name: r.name, preset: r.preset, all: figures(r, allTasks), frontier: figures(r, sub) }));
}

function cell(f: SubsetFigures): string {
  if (f.size === 0) return "unknown (empty subset)";
  if (f.final === 0) return "unknown (not run)";
  return `${f.resolved} of ${f.final}${f.final < f.size ? ` run (${f.size - f.final} not run)` : ""}`;
}
const cost = (f: SubsetFigures): string => (f.final === 0 ? "unknown" : `${f.costIncomplete ? "at least " : ""}$${f.costEstimate.toFixed(2)} (estimate)`);

/** A markdown table: each run on allN and on the frontier subset, resolved and estimated cost. */
export function rollupTable(rows: RollupRow[], sizes: { all: number; frontier: number }): string {
  const a = `all${sizes.all}`;
  const f = sizes.frontier > 0 ? `all${sizes.frontier}` : "frontier subset";
  const lines = [
    `| Run | Preset | ${a} resolved | ${a} est. cost | ${f} resolved (frontier) | ${f} est. cost |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.name} | ${r.preset} | ${cell(r.all)} | ${cost(r.all)} | ${sizes.frontier > 0 ? cell(r.frontier) : "unknown (no solo-opus run)"} | ${sizes.frontier > 0 ? cost(r.frontier) : "unknown"} |`),
  ];
  return lines.join("\n");
}
