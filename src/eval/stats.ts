// [F107 paired-bootstrap] A paired bootstrap over tasks, with no dependency.
// Plan item M2 (docs/22-path-to-the-goal.md, phase 1, step 7).
//
// Each configuration gives, per task, a score between 0 and 1: the share of
// that task's runs that passed. Two configurations are compared by the mean
// of the per-task differences; the interval comes from drawing the tasks
// again, with replacement, many times and taking the mean difference of each
// draw. "Not worse than the baseline by more than d" is shown when the lower
// end of the 90% interval is above -d.

export interface Interval {
  /** Tasks compared (those both configurations ran). */
  tasks: number;
  meanA: number;
  meanB: number;
  /** Mean of (A - B) over the tasks. */
  diff: number;
  /** Lower and upper end of the interval for the difference. */
  low: number;
  high: number;
  level: number;
  resamples: number;
  seed: number;
}

export interface BootstrapOptions {
  resamples?: number;
  /** Two-sided: 0.9 gives the 5th to the 95th percentile. */
  level?: number;
  seed?: number;
}

/** A small seeded generator (mulberry32), so the same data always gives the same interval. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]): number => xs.reduce((n, x) => n + x, 0) / xs.length;

/** The interval for mean(a - b) over paired tasks. `a[i]` and `b[i]` are one task's scores. */
export function pairedBootstrap(a: number[], b: number[], options: BootstrapOptions = {}): Interval | undefined {
  if (a.length !== b.length) throw new Error("paired scores must have the same length");
  const n = a.length;
  if (n < 2) return undefined;
  const resamples = options.resamples ?? 10_000;
  const level = options.level ?? 0.9;
  const seed = options.seed ?? 1;
  const d = a.map((x, i) => x - b[i]!);
  const next = rng(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[Math.floor(next() * n)]!;
    means[r] = sum / n;
  }
  means.sort();
  const tail = (1 - level) / 2;
  return {
    tasks: n,
    meanA: mean(a),
    meanB: mean(b),
    diff: mean(d),
    low: means[Math.min(resamples - 1, Math.floor(tail * resamples))]!,
    high: means[Math.max(0, Math.ceil((1 - tail) * resamples) - 1)]!,
    level,
    resamples,
    seed,
  };
}

/** Is A "not worse than B by more than `margin`" (a share, 0.1 = 10 points)? Shown when the interval's low end is above -margin. */
export function notWorseThan(interval: Interval, margin: number): boolean {
  return interval.low > -margin;
}

/** The smallest margin the data can show: how far below zero the interval's low end is. */
export function showableMargin(interval: Interval): number {
  return Math.max(0, -interval.low);
}

/** One configuration's per-task scores from several runs: tasks[task] = list of pass (1) or fail (0), one per run. */
export function taskScores(runs: Record<string, number>[]): Record<string, number> {
  const per = new Map<string, number[]>();
  for (const run of runs) for (const [task, v] of Object.entries(run)) per.set(task, [...(per.get(task) ?? []), v]);
  return Object.fromEntries([...per.entries()].map(([t, vs]) => [t, mean(vs)]));
}

/** Pair two configurations' per-task scores on the tasks both have, in task order. */
export function pair(a: Record<string, number>, b: Record<string, number>): { tasks: string[]; a: number[]; b: number[] } {
  const tasks = Object.keys(a).filter((t) => t in b).sort();
  return { tasks, a: tasks.map((t) => a[t]!), b: tasks.map((t) => b[t]!) };
}

const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;

/** The comparison as the plan asks for it, as lines of text. */
export function describeComparison(nameA: string, nameB: string, interval: Interval | undefined, margin: number, runsPerTask?: { a: number; b: number }): string[] {
  if (!interval) return [`${nameA} against ${nameB}: fewer than 2 tasks in common; no interval.`];
  const shown = notWorseThan(interval, margin);
  const lines = [
    `${nameA} against ${nameB}, paired over ${interval.tasks} tasks${runsPerTask ? ` (runs per task: ${runsPerTask.a} and ${runsPerTask.b})` : ""}`,
    `  resolved: ${(interval.meanA * 100).toFixed(1)}% and ${(interval.meanB * 100).toFixed(1)}%; mean difference ${pct(interval.diff)} points`,
    `  ${(interval.level * 100).toFixed(0)}% interval for the difference: ${pct(interval.low)} to ${pct(interval.high)} points (${interval.resamples.toLocaleString("en-US")} task resamples, seed ${interval.seed})`,
    `  not worse than ${nameB} by more than ${(margin * 100).toFixed(0)} points: ${shown ? "shown" : "not shown"}`,
  ];
  if (interval.low === interval.high) {
    lines.push("  every paired task differs by the same amount, so the interval has no width: a ceiling (both pass everything) or too few runs. It says nothing about a margin.");
    return lines;
  }
  if (interval.low > 0) lines.push(`  ${nameA} is better: the whole interval is above zero.`);
  else if (interval.high < 0) lines.push(`  ${nameA} is worse: the whole interval is below zero.`);
  else lines.push("  the interval holds zero: the two cannot be told apart on these tasks.");
  lines.push(`  with these tasks the data can show a margin of about ${(showableMargin(interval) * 100).toFixed(1)} points, no tighter.`);
  return lines;
}
