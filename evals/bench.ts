// Compare saved eval results on the measures the benchmark is judged by:
// hidden checks passed, time, estimated API cost, tokens written, and the
// subscription quota used. No model calls.
//
//   node evals/bench.ts bench-solo-opus-1 bench-opus-haiku-1 ...
//   node evals/bench.ts --turns bench-opus-haiku-1      every turn of every task
//   node evals/bench.ts --fit bench-solo-opus-1 ...     quota points per token, fitted over the tasks
//
// Costs are estimates at API list prices (src/usage/prices.ts). Quota is what
// `neuromesh eval --quota` read before and after each task, in points of the
// 5-hour window (whole points only, so small tasks often read 0).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { costOf, loadReport } from "../src/eval/eval.ts";
import type { EvalReport, TaskResult } from "../src/eval/eval.ts";
import { defaultHome, loadState } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { estimateCost } from "../src/usage/prices.ts";

const home = defaultHome();
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const names = args.filter((a) => !a.startsWith("--"));

function runOf(result: TaskResult): RunState | undefined {
  const projects = join(home, "projects");
  if (!existsSync(projects)) return undefined;
  const dir = readdirSync(projects).map((p) => join(projects, p, "runs", result.runId)).find((d) => existsSync(join(d, "run.json")));
  return dir ? loadState(dir) : undefined;
}

interface Row {
  task: string;
  hidden: string;
  score: string;
  minutes: number;
  cost: number;
  expertCost: number;
  expertOut: number;
  workerOut: number;
  /** Everything read back from cache, in thousands: what an agent re-reads on every call. */
  cacheReadK: number;
  turns: number;
  quota: number | undefined;
}

function rowOf(r: TaskResult): Row {
  const out = (tier: string): number => r.usage.filter((u) => (tier === "expert") === (u.tier === "expert")).reduce((n, u) => n + (u.usage.output ?? 0), 0);
  const before = r.quota?.before?.five_hour;
  const after = r.quota?.after?.five_hour;
  const cost = costOf(r);
  return {
    task: r.task,
    hidden: r.hidden === "pass" ? "pass" : r.status === "finished" ? "FAIL" : r.status,
    score: r.score ? `${r.score.passed}/${r.score.total}` : "",
    minutes: r.wallMs / 60_000,
    cost: cost.total,
    expertCost: cost.expert,
    expertOut: out("expert"),
    workerOut: out("worker"),
    cacheReadK: r.usage.reduce((n, u) => n + (u.usage.cacheRead ?? 0), 0) / 1000,
    turns: r.turns,
    // A window that reset in between reads lower afterwards: unknown, not negative.
    quota: before !== undefined && after !== undefined && after >= before ? Math.round((after - before) * 100) : undefined,
  };
}

const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pad = (s: string, n: number): string => s.padEnd(n);
const lpad = (s: string, n: number): string => s.padStart(n);

function table(report: EvalReport): string {
  const rows = Object.values(report.results).map(rowOf);
  const lines = [`${report.name}  (preset ${report.preset})`, `  ${pad("task", 18)} ${pad("hidden", 7)} ${pad("score", 6)} ${lpad("min", 5)} ${lpad("est $", 7)} ${lpad("expert$", 8)} ${lpad("exp out", 8)} ${lpad("wrk out", 8)} ${lpad("cache rd", 9)} ${lpad("turns", 5)} ${lpad("5h pts", 6)}`];
  for (const r of rows) {
    lines.push(`  ${pad(r.task, 18)} ${pad(r.hidden, 7)} ${pad(r.score, 6)} ${lpad(r.minutes.toFixed(1), 5)} ${lpad(r.cost.toFixed(3), 7)} ${lpad(r.expertCost.toFixed(3), 8)} ${lpad(k(r.expertOut), 8)} ${lpad(k(r.workerOut), 8)} ${lpad(`${Math.round(r.cacheReadK)}k`, 9)} ${lpad(String(r.turns), 5)} ${lpad(r.quota === undefined ? "?" : String(r.quota), 6)}`);
  }
  const sum = (f: (r: Row) => number): number => rows.reduce((n, r) => n + f(r), 0);
  const known = rows.filter((r) => r.quota !== undefined);
  const scored = Object.values(report.results).filter((r) => r.score);
  lines.push(
    `  ${pad("TOTAL", 18)} ${pad(`${rows.filter((r) => r.hidden === "pass").length}/${rows.length}`, 7)} ${pad(scored.length > 0 ? `${scored.reduce((n, r) => n + r.score!.passed, 0)}/${scored.reduce((n, r) => n + r.score!.total, 0)}` : "", 6)} ${lpad(sum((r) => r.minutes).toFixed(1), 5)} ${lpad(sum((r) => r.cost).toFixed(3), 7)} ${lpad(sum((r) => r.expertCost).toFixed(3), 8)} ${lpad(k(sum((r) => r.expertOut)), 8)} ${lpad(k(sum((r) => r.workerOut)), 8)} ${lpad(`${Math.round(sum((r) => r.cacheReadK))}k`, 9)} ${lpad(String(sum((r) => r.turns)), 5)} ${lpad(known.length === rows.length ? String(sum((r) => r.quota ?? 0)) : `${known.reduce((n, r) => n + (r.quota ?? 0), 0)}+?`, 6)}`,
  );
  return lines.join("\n");
}

function turns(report: EvalReport): string {
  const lines = [`${report.name}: every turn`];
  for (const r of Object.values(report.results)) {
    const state = runOf(r);
    lines.push(`  ${r.task}  (${r.hidden}${r.score ? ` ${r.score.passed}/${r.score.total}` : ""}, ${(r.wallMs / 60_000).toFixed(1)} min)`);
    for (const a of state?.attempts ?? []) {
      const cost = estimateCost(a.model, a.usage);
      lines.push(`    ${pad(a.task ?? "-", 8)} ${pad(a.kind, 11)} ${pad((a.model ?? "").replace("claude-", ""), 12)} ${pad(a.stop, 9)} ${lpad(`${Math.round(a.durationMs / 1000)}s`, 5)}  out ${lpad(k(a.usage.output ?? 0), 6)}  cache rd ${lpad(k(a.usage.cacheRead ?? 0), 7)}  cache wr ${lpad(k(a.usage.cacheWrite ?? 0), 6)}  ${cost === undefined ? "?" : `$${cost.toFixed(3)}`}`);
    }
  }
  return lines.join("\n");
}

/**
 * Least-squares fit of quota points against tokens, over every task of the
 * named evals: points ≈ a·expert output + b·worker output (in thousands). Rough:
 * readings are whole points and the fit ignores input. For orientation only.
 */
function fit(reports: EvalReport[]): string {
  const rows = reports.flatMap((r) => Object.values(r.results).map(rowOf)).filter((r) => r.quota !== undefined);
  let sxx = 0, sxy = 0, syy = 0, sxq = 0, syq = 0;
  for (const r of rows) {
    const x = r.expertOut / 1000, y = r.workerOut / 1000, q = r.quota!;
    sxx += x * x; sxy += x * y; syy += y * y; sxq += x * q; syq += y * q;
  }
  const det = sxx * syy - sxy * sxy;
  const total = rows.reduce((n, r) => n + r.quota!, 0);
  if (Math.abs(det) < 1e-9) {
    const one = sxx > 0 ? `expert: ${(sxq / sxx).toFixed(3)} points per 1k output (${(sxx > 0 ? 1 / (sxq / sxx) : 0).toFixed(1)}k per point)` : syy > 0 ? `worker: ${(syq / syy).toFixed(3)} points per 1k output (${(1 / (syq / syy)).toFixed(1)}k per point)` : "nothing to fit";
    return `Fit over ${rows.length} tasks, ${total} points: ${one}`;
  }
  const a = (sxq * syy - syq * sxy) / det;
  const b = (syq * sxx - sxq * sxy) / det;
  return `Fit over ${rows.length} tasks, ${total} points: expert ${a.toFixed(3)} points per 1k output (${(1 / a).toFixed(1)}k per point), worker ${b.toFixed(3)} per 1k (${(1 / b).toFixed(1)}k per point)`;
}

const reports = names.map((n) => {
  const r = loadReport(home, n);
  if (!r) throw new Error(`No eval results named "${n}"`);
  return r;
});
if (flag("fit")) console.log(fit(reports));
else if (flag("turns")) console.log(reports.map(turns).join("\n\n"));
else console.log(reports.map(table).join("\n\n"));
