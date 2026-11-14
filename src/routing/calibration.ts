// [F81 route-calibration] Stage 0C of the cascade router, and what teaches it.
//
// The architecture trains a classifier on pairwise win rates (RouteLLM) and
// picks the cheapest tier i with P(success | tier i, request) >= alpha. There is
// no such data here, so the table starts from a stated prior and learns from
// this machine's own runs: for each cluster the router saw, how often a task
// that ran on each tier passed there. It is a count, so an unknown stays
// visibly small (few tries), never a made-up rate.
//
// Stored in ~/.neuromesh/routing/calibration.json. Shadow grades (F88) feed it
// too: a cheap tier's pass that a stronger reviewer rejects counts as a failure.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CASCADE_TIERS } from "./router.ts";
import type { Calibrated, CascadeTier, Evidence } from "./router.ts";

export interface Cell {
  tries: number;
  passes: number;
}

export interface CalibrationTable {
  version: 1;
  /** Keyed by cluster ("none" when no cluster matched), then by tier. */
  cells: Record<string, Partial<Record<CascadeTier, Cell>>>;
}

/** The quality bar: the cheapest tier at least this likely to succeed is picked. */
export const DEFAULT_ALPHA = 0.8;
/** How many runs the prior is worth. */
const PRIOR_WEIGHT = 2;

/** What a tier is expected to manage on a cluster's work before any run says otherwise. */
export function prior(cluster: CascadeTier | undefined, tier: CascadeTier): number {
  const t = CASCADE_TIERS.indexOf(tier);
  if (cluster === undefined) return [0.4, 0.8, 0.9, 0.95][t]!;
  const k = CASCADE_TIERS.indexOf(cluster);
  if (t >= k) return 0.85 + 0.03 * (t - k);
  if (t === k - 1) return 0.5;
  return 0.2;
}

export function calibrationPath(home: string): string {
  return join(home, "routing", "calibration.json");
}

export function loadCalibration(home: string): CalibrationTable {
  const path = calibrationPath(home);
  if (!existsSync(path)) return { version: 1, cells: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as CalibrationTable;
    return raw && raw.version === 1 && typeof raw.cells === "object" ? raw : { version: 1, cells: {} };
  } catch {
    // A damaged table is started again rather than stopping runs.
    return { version: 1, cells: {} };
  }
}

export function saveCalibration(home: string, table: CalibrationTable): void {
  const path = calibrationPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Estimated chance that a tier succeeds on a cluster's work: the prior, moved by this machine's runs. */
export function successRate(table: CalibrationTable, cluster: CascadeTier | undefined, tier: CascadeTier): { p: number; tries: number } {
  const cell = table.cells[cluster ?? "none"]?.[tier] ?? { tries: 0, passes: 0 };
  return { p: (cell.passes + PRIOR_WEIGHT * prior(cluster, tier)) / (cell.tries + PRIOR_WEIGHT), tries: cell.tries };
}

/** [F103 evidence-override] Runs of a tier on a cluster before its record may overrule a confident match. */
export const MIN_EVIDENCE = 5;

/**
 * [F103 evidence-override] Whether this machine's record overrules the tier
 * the similarity stage picked with confidence. Up: the picked tier has been
 * tried at least MIN_EVIDENCE times on this cluster and its estimate is under
 * the bar, so the request starts on the cheapest tier above that clears it.
 * Down: a cheaper tier has that many tries and clears the bar itself. With less
 * evidence than that, the match stands: a handful of runs is not a rate.
 */
export function evidencePick(table: CalibrationTable, cluster: CascadeTier | undefined, tier: CascadeTier, alpha = DEFAULT_ALPHA, tiers: CascadeTier[] = CASCADE_TIERS): Evidence | undefined {
  const at = tiers.indexOf(tier);
  if (at < 0) return undefined;
  const here = successRate(table, cluster, tier);
  if (here.tries >= MIN_EVIDENCE && here.p < alpha) {
    const up = tiers.slice(at + 1).find((t) => successRate(table, cluster, t).p >= alpha) ?? tiers.at(-1)!;
    if (up !== tier) return { tier: up, direction: "up", p: here.p, tries: here.tries, from: tier };
    return undefined;
  }
  for (const t of tiers.slice(0, at)) {
    const below = successRate(table, cluster, t);
    if (below.tries >= MIN_EVIDENCE && below.p >= alpha) return { tier: t, direction: "down", p: below.p, tries: below.tries, from: tier };
  }
  return undefined;
}

/** Stage 0C: the cheapest tier i with P(success | i, cluster) >= alpha; the expert when none is. */
export function calibrated(table: CalibrationTable, alpha = DEFAULT_ALPHA, tiers: CascadeTier[] = CASCADE_TIERS): Calibrated {
  return {
    pick(cluster) {
      for (const tier of tiers) {
        const { p } = successRate(table, cluster, tier);
        if (p >= alpha) return { tier, p };
      }
      const top = tiers.at(-1);
      return top ? { tier: top, p: successRate(table, cluster, top).p } : undefined;
    },
    // [F103 evidence-override]
    evidence: (cluster, tier) => evidencePick(table, cluster, tier, alpha, tiers),
  };
}

/**
 * One task's way through the tiers: each tier it worked on in order, and
 * whether the last of them passed. Every tier before the last failed there.
 */
export interface TierOutcome {
  cluster: CascadeTier | undefined;
  tiers: CascadeTier[];
  passed: boolean;
}

export function record(table: CalibrationTable, outcome: TierOutcome): CalibrationTable {
  const key = outcome.cluster ?? "none";
  const row = (table.cells[key] ??= {});
  // A tier counts once per task, at its last visit (climbing within a tier is one try).
  const seen = [...new Set(outcome.tiers)];
  seen.forEach((tier, i) => {
    const cell = (row[tier] ??= { tries: 0, passes: 0 });
    cell.tries += 1;
    if (outcome.passed && i === seen.length - 1) cell.passes += 1;
  });
  return table;
}

/** [F88 shadow-eval] A stronger reviewer rejected a pass: that tier's pass becomes a failure. */
export function demote(table: CalibrationTable, cluster: CascadeTier | undefined, tier: CascadeTier): CalibrationTable {
  const cell = table.cells[cluster ?? "none"]?.[tier];
  if (cell && cell.passes > 0) cell.passes -= 1;
  return table;
}

/** The table as lines for the terminal: one row per cluster, the estimate and the evidence per tier. */
export function describeCalibration(table: CalibrationTable, alpha = DEFAULT_ALPHA): string[] {
  const clusters: (CascadeTier | undefined)[] = [undefined, ...CASCADE_TIERS];
  const lines = [`Tier 0C calibration (pick the cheapest tier with an estimated success of at least ${Math.round(alpha * 100)}%):`, ""];
  lines.push(`${"cluster".padEnd(10)}${CASCADE_TIERS.map((t) => t.padStart(16)).join("")}   picks`);
  for (const c of clusters) {
    const cells = CASCADE_TIERS.map((t) => {
      const { p, tries } = successRate(table, c, t);
      const cell = table.cells[c ?? "none"]?.[t];
      return `${Math.round(p * 100)}% (${cell ? `${cell.passes}/${tries}` : "prior"})`.padStart(16);
    });
    lines.push(`${(c ?? "none").padEnd(10)}${cells.join("")}   ${calibrated(table, alpha).pick(c)?.tier ?? "-"}`);
  }
  // [F103 evidence-override] Where the record overrules a confident match, and on what evidence.
  const overrides = CASCADE_TIERS.flatMap((c) => CASCADE_TIERS.flatMap((t) => evidencePick(table, c, t, alpha) ?? []).map((e) => ({ c, e })));
  if (overrides.length > 0) {
    lines.push("", `Overruled by this machine's runs (F103; at least ${MIN_EVIDENCE} tries):`);
    for (const { c, e } of overrides) {
      lines.push(
        e.direction === "up"
          ? `  ${c}-like requests matched to ${e.from} start on ${e.tier}: ${e.from} is at ${Math.round(e.p * 100)}% over ${e.tries} tries`
          : `  ${c}-like requests matched to ${e.from} start on ${e.tier}: it is at ${Math.round(e.p * 100)}% over ${e.tries} tries`,
      );
    }
  }
  return lines;
}
