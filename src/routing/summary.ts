// [F87 routing-summary] The cascade's unit economics for one run, measured
// rather than assumed: the architecture's E[cost] = (1 + eps) * sum(p_i * C_i)
// with p_i (the share of tasks finished on tier i), C_i (what a task finishing
// there cost) and eps (the cascade's overhead: turns on tiers a task later
// left, and turns the early-exit gate stopped) all taken from the run.
//
// Every dollar figure is an estimate at API list prices (src/usage/prices.ts);
// a turn with no price is counted as unpriced, never as $0.

import type { Usage } from "../backends/types.ts";
import { estimateCost } from "../usage/prices.ts";
import { CASCADE_TIERS } from "./router.ts";
import type { CascadeTier } from "./router.ts";

export interface SummaryAttempt {
  task?: string;
  /** The cascade tier the turn ran on; "other" for turns outside the ladder (spec, plan, review). */
  tier: CascadeTier | "other";
  model?: string;
  usage: Usage;
  /** Stopped by the early-exit gate (F83). */
  earlyExit?: boolean;
}

export interface SummaryTask {
  id: string;
  passed: boolean;
  /** The tier it finished on (passed or not). */
  tier: CascadeTier;
}

export interface TierLine {
  tier: CascadeTier;
  /** p_i: share of the run's tasks that passed on this tier. */
  share: number;
  tasks: number;
  turns: number;
  /** Estimated cost of every turn on this tier, priced turns only. */
  costUsd: number;
}

export interface RoutingSummary {
  tiers: TierLine[];
  failedTasks: number;
  /** Estimated total of priced turns, ladder and other. */
  totalUsd: number;
  /** Estimated cost of turns outside the ladder (spec, plan, review, advice). */
  otherUsd: number;
  /** Estimated cost of turns a task later climbed away from, or the gate stopped. */
  overheadUsd: number;
  /** eps: overhead over the rest of the ladder's cost. Undefined when the ladder cost nothing priced. */
  overhead?: number;
  earlyExits: number;
  /** The same tokens priced at the expert model: what sending everything to the top would have cost, roughly. */
  allExpertUsd?: number;
  expertModel?: string;
  unpricedTurns: number;
  /** Always true: these are API list prices, not money spent. */
  estimate: true;
}

export function routingSummary(attempts: SummaryAttempt[], tasks: SummaryTask[], expertModel?: string): RoutingSummary {
  const finalTier = new Map(tasks.map((t) => [t.id, t.tier]));
  const rank = (t: CascadeTier): number => CASCADE_TIERS.indexOf(t);
  let totalUsd = 0;
  let otherUsd = 0;
  let overheadUsd = 0;
  let unpricedTurns = 0;
  let allExpert: number | undefined = expertModel ? 0 : undefined;
  const byTier = new Map<CascadeTier, { turns: number; cost: number }>();
  for (const a of attempts) {
    const cost = estimateCost(a.model, a.usage);
    if (cost === undefined) unpricedTurns += 1;
    const c = cost ?? 0;
    totalUsd += c;
    if (allExpert !== undefined) {
      const repriced = estimateCost(expertModel, a.usage);
      allExpert = repriced === undefined ? undefined : allExpert + repriced;
    }
    if (a.tier === "other") {
      otherUsd += c;
      continue;
    }
    const line = byTier.get(a.tier) ?? { turns: 0, cost: 0 };
    line.turns += 1;
    line.cost += c;
    byTier.set(a.tier, line);
    const last = a.task ? finalTier.get(a.task) : undefined;
    if (a.earlyExit || (last !== undefined && rank(a.tier) < rank(last))) overheadUsd += c;
  }
  const passed = tasks.filter((t) => t.passed);
  const n = tasks.length;
  const tiers: TierLine[] = CASCADE_TIERS.map((tier) => {
    const finished = passed.filter((t) => t.tier === tier).length;
    const line = byTier.get(tier) ?? { turns: 0, cost: 0 };
    return { tier, share: n > 0 ? finished / n : 0, tasks: finished, turns: line.turns, costUsd: line.cost };
  });
  const ladderUsd = totalUsd - otherUsd;
  return {
    tiers,
    failedTasks: n - passed.length,
    totalUsd,
    otherUsd,
    overheadUsd,
    overhead: ladderUsd - overheadUsd > 0 ? overheadUsd / (ladderUsd - overheadUsd) : undefined,
    earlyExits: attempts.filter((a) => a.earlyExit).length,
    allExpertUsd: allExpert,
    expertModel,
    unpricedTurns,
    estimate: true,
  };
}

/** For the terminal and the final report. */
export function describeSummary(s: RoutingSummary): string[] {
  const usd = (x: number): string => `$${x.toFixed(x < 0.1 ? 4 : 2)}`;
  const lines = ["Cascade (estimates at API list prices):"];
  for (const t of s.tiers) {
    if (t.turns === 0 && t.tasks === 0) continue;
    lines.push(`  ${t.tier.padEnd(7)} ${String(Math.round(t.share * 100)).padStart(3)}% of tasks finished here, ${t.turns} turn(s), ${usd(t.costUsd)}`);
  }
  if (s.failedTasks > 0) lines.push(`  ${s.failedTasks} task(s) failed`);
  lines.push(`  outside the ladder (spec, plan, review, advice): ${usd(s.otherUsd)}`);
  lines.push(`  cascade overhead: ${usd(s.overheadUsd)}${s.overhead !== undefined ? ` (eps = ${(s.overhead * 100).toFixed(0)}%)` : ""}, ${s.earlyExits} early exit(s)`);
  lines.push(`  total: ${usd(s.totalUsd)}${s.allExpertUsd !== undefined && s.allExpertUsd > 0 ? `; the same tokens at ${s.expertModel}: ${usd(s.allExpertUsd)} (${(s.allExpertUsd / Math.max(s.totalUsd, 1e-9)).toFixed(1)}x)` : ""}`);
  if (s.unpricedTurns > 0) lines.push(`  ${s.unpricedTurns} turn(s) have no price and are not in these totals`);
  return lines;
}
