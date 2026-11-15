// Score the routing benchmark: the suite's four metrics from the records two
// runs committed (no model calls).
//
//   node evals/routing-bench/score.ts <cascade-name> <frontier-name>
//
// Works on either prompt set, or both in one run: ids 1.1 to 5.3 are the original
// 15, H1.1 to H5.3 the held-out 15. The trap rules for each set are scored when
// that set is present (5.1, 5.2, 5.3 and H5.1, H5.2, H5.3). The second name can be
// any solo run (Opus alone, Haiku alone).
//
// Writes results/<cascade-name>/REPORT.md and prints it. Every dollar figure
// is an estimate at API list prices; quota figures are the Claude windows'
// own percentages, read before and after each prompt.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Turn { role: string; kind: string; model?: string; cascadeTier?: string; earlyExit?: boolean; tokens: number; costUsd?: number; discarded: boolean; usage: { output?: number } }
interface Rec {
  id: string; slug: string; status: string; reason?: string; expectedTier: string; expectedPath: string; routedTier?: string; tierPath: string[]; finalTier?: string;
  score?: { passed: number; total: number }; quality: number; wallMs: number; turns: Turn[]; tokens: number; discardedTokens: number; costUsd: number; discardedCostUsd: number; unpricedTurns: number;
  quota: { before?: Record<string, number>; after?: Record<string, number> };
}

const isUpper = (t: Turn): boolean => t.cascadeTier === "senior" || t.cascadeTier === "expert" || t.role === "orchestrator" || t.role === "escalation";

function load(name: string): Map<string, Rec> {
  const dir = join(HERE, "results", name);
  if (!existsSync(dir)) throw new Error(`no results named ${name} in ${join(HERE, "results")}`);
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Rec).map((r) => [r.id, r]));
}

/** The suite's realistic traffic: 50% Tier 1, 30% Tier 2, 16% Tier 3, 4% Tier 4, shared out over each category's prompts (traps left out). */
const TRAFFIC: Record<string, number> = { "1": 0.5, "2": 0.3, "3": 0.16, "4": 0.04 };

function quotaDelta(recs: Rec[]): Record<string, number | undefined> {
  const windows = new Set(recs.flatMap((r) => [...Object.keys(r.quota.before ?? {}), ...Object.keys(r.quota.after ?? {})]));
  const out: Record<string, number | undefined> = {};
  for (const w of windows) {
    let sum = 0;
    let known = true;
    for (const r of recs) {
      const a = r.quota.before?.[w];
      const b = r.quota.after?.[w];
      if (a === undefined || b === undefined) known = false;
      // A window that reset during the prompt reads lower afterwards: that prompt's share is unknown.
      else if (b >= a) sum += b - a;
      else known = false;
    }
    out[w] = known ? sum : undefined;
  }
  return out;
}

function main(): number {
  const [cName, fName] = process.argv.slice(2);
  if (!cName || !fName) {
    process.stderr.write("usage: node evals/routing-bench/score.ts <cascade-name> <frontier-name>\n");
    return 2;
  }
  const c = load(cName);
  const f = load(fName);
  const held = (id: string): boolean => id.startsWith("H");
  const order = (id: string): number => Number(id.replace(/^H/, ""));
  const ids = [...c.keys()].filter((id) => f.has(id)).sort((a, b) => Number(held(a)) - Number(held(b)) || order(a) - order(b));
  const pct = (x: number | undefined): string => (x === undefined || !Number.isFinite(x) ? "unknown" : `${(x * 100).toFixed(1)}%`);
  const usd = (x: number): string => `$${x.toFixed(4)}`;

  // 1. CostSave (cascade waste is already inside the cascade's cost).
  const cCost = ids.reduce((n, id) => n + c.get(id)!.costUsd, 0);
  const fCost = ids.reduce((n, id) => n + f.get(id)!.costUsd, 0);
  const costSave = fCost > 0 ? 1 - cCost / fCost : undefined;
  const cat = (id: string): string => id.replace(/^H/, "").split(".")[0]!;
  const weighted = (recs: Map<string, Rec>): number => {
    let total = 0;
    for (const [k, w] of Object.entries(TRAFFIC)) {
      const inCat = ids.filter((id) => cat(id) === k);
      if (inCat.length > 0) total += (w * inCat.reduce((n, id) => n + recs.get(id)!.costUsd, 0)) / inCat.length;
    }
    return total;
  };
  const wC = weighted(c);
  const wF = weighted(f);
  const costSaveWeighted = wF > 0 ? 1 - wC / wF : undefined;

  // 2. Gap@Oracle, over prompts where the frontier scored above zero.
  const gapRows = ids.filter((id) => f.get(id)!.quality > 0);
  const gap = gapRows.length > 0 ? gapRows.reduce((n, id) => n + (f.get(id)!.quality - c.get(id)!.quality) / f.get(id)!.quality, 0) / gapRows.length : undefined;

  // 3. WCTR.
  const cTokens = ids.reduce((n, id) => n + c.get(id)!.tokens, 0);
  const cWaste = ids.reduce((n, id) => n + c.get(id)!.discardedTokens, 0);
  const wctr = cTokens > 0 ? cWaste / cTokens : undefined;

  // 4. Traps.
  const upperSpend = (r: Rec | undefined): number => (r ? r.turns.filter(isUpper).reduce((n, t) => n + (t.costUsd ?? 0), 0) : Number.NaN);
  const upperTurns = (r: Rec | undefined): number => (r ? r.turns.filter(isUpper).length : Number.NaN);
  const full = (r: Rec | undefined): boolean => r?.score !== undefined && r.score.passed === r.score.total;
  const hidden = (r: Rec | undefined): string => (r ? (r.score ? `${r.score.passed}/${r.score.total}` : "not run") : "not run");
  const stopped = (r: Rec | undefined) => r?.turns.find((t) => t.earlyExit && t.cascadeTier === "worker");
  const stoppedText = (r: Rec | undefined): string => {
    const a = stopped(r);
    return a ? `stopped by the gate (about ${a.usage.output ?? "unknown"} output tokens, estimated)` : "not stopped";
  };
  const traps: (readonly [string, boolean, string])[] = [];
  const holds = (want: boolean): boolean => ids.some((id) => held(id) === want);
  if (holds(false)) {
    const t51 = c.get("5.1");
    const t52 = c.get("5.2");
    const t53 = c.get("5.3");
    traps.push(
      ["5.1 regex bomb", full(t51), t51 ? `hidden ${hidden(t51)}, path ${t51.tierPath.join(">")}` : "not run"],
      ["5.2 jargon wall", t52 ? t52.tierPath.every((t) => t === "grunt") && upperSpend(t52) === 0 : false, t52 ? `path ${t52.tierPath.join(">")}, Tier 3/4 spend ${usd(upperSpend(t52))}` : "not run"],
      ["5.3 impossible sort", t53 ? Boolean(stopped(t53)) && (t53.score?.passed ?? 0) >= 3 : false, t53 ? `Tier 2 ${stoppedText(t53)}, hidden ${hidden(t53)}` : "not run"],
    );
  }
  if (holds(true)) {
    const h51 = c.get("H5.1");
    const h52 = c.get("H5.2");
    const h53 = c.get("H5.3");
    // H5.2: seven subsystem words, but the work is a three-row table. No turn and no dollar on the senior or the expert.
    const h52ok = h52 ? h52.status === "finished" && h52.tierPath.every((t) => t === "grunt" || t === "worker") && upperSpend(h52) === 0 && upperTurns(h52) === 0 : false;
    traps.push(
      ["H5.1 prose-wrapped numeric spec", full(h51), h51 ? `hidden ${hidden(h51)}, path ${h51.tierPath.join(">")}` : "not run"],
      ["H5.2 multi-buzzword decoy", h52ok, h52 ? `path ${h52.tierPath.join(">")}, Tier 3/4 turns ${upperTurns(h52)}, spend ${usd(upperSpend(h52))}, hidden ${hidden(h52)}` : "not run"],
      ["H5.3 impossible lock upgrade", h53 ? Boolean(stopped(h53)) && (h53.score?.passed ?? 0) >= 3 : false, h53 ? `Tier 2 ${stoppedText(h53)}, hidden ${hidden(h53)}` : "not run"],
    );
  }

  // "grunt", "cascade 1>2>3" (starts on the grunt), "worker|senior" (either): the tiers a prompt may start on.
  const starts = (e: string): string[] => e.split("|").map((x) => (x.startsWith("cascade") ? ({ "1": "grunt", "2": "worker", "3": "senior" } as Record<string, string>)[x.split(" ")[1]![0]!] ?? x : x));
  const routedRight = ids.filter((id) => starts(c.get(id)!.expectedTier).includes(c.get(id)!.routedTier ?? "")).length;

  const qC = quotaDelta(ids.map((id) => c.get(id)!));
  const qF = quotaDelta(ids.map((id) => f.get(id)!));
  const pass = (ok: boolean | undefined): string => (ok === undefined ? "unknown" : ok ? "PASS" : "FAIL");

  const lines: string[] = [];
  lines.push(`# Routing benchmark: ${cName} against ${fName}`, "");
  lines.push(`${ids.length} prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.`, "");
  lines.push("## Metrics", "", "| Metric | Value | Target | Result |", "| --- | --- | --- | --- |");
  lines.push(`| CostSave, unweighted | ${pct(costSave)} (${usd(cCost)} against ${usd(fCost)}) | >= 65% | ${pass(costSave === undefined ? undefined : costSave >= 0.65)} |`);
  lines.push(`| CostSave, weighted 50/30/16/4 | ${pct(costSaveWeighted)} | >= 80% | ${pass(costSaveWeighted === undefined ? undefined : costSaveWeighted >= 0.8)} |`);
  lines.push(`| Gap@Oracle | ${pct(gap)} over ${gapRows.length} prompts | <= 3.0% | ${pass(gap === undefined ? undefined : gap <= 0.03)} |`);
  lines.push(`| WCTR | ${pct(wctr)} (${cWaste.toLocaleString("en-US")} of ${cTokens.toLocaleString("en-US")} tokens) | <= 8.0% | ${pass(wctr === undefined ? undefined : wctr <= 0.08)} |`);
  for (const [name, ok, detail] of traps) lines.push(`| Trap ${name} | ${detail} | survive | ${pass(ok)} |`);
  lines.push(`| Tier 0 routed to the expected starting tier | ${routedRight}/${ids.length} | | |`, "");
  lines.push("## Claude subscription quota", "", "Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.", "");
  lines.push("| Window | Cascade | Frontier |", "| --- | --- | --- |");
  for (const w of new Set([...Object.keys(qC), ...Object.keys(qF)])) lines.push(`| ${w} | ${pct(qC[w])} | ${pct(qF[w])} |`);
  lines.push("", "## Per prompt", "", "| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) {
    const a = c.get(id)!;
    const b = f.get(id)!;
    lines.push(`| ${id} | ${a.expectedTier.replaceAll("|", " or ")} | ${a.routedTier ?? "-"} | ${a.tierPath.join(" > ") || "-"} | ${a.quality.toFixed(1)} | ${b.quality.toFixed(1)} | ${usd(a.costUsd)} | ${usd(b.costUsd)} | ${a.discardedTokens.toLocaleString("en-US")} | ${a.status}/${b.status} |`);
  }
  const unpriced = ids.reduce((n, id) => n + c.get(id)!.unpricedTurns + f.get(id)!.unpricedTurns, 0);
  if (unpriced > 0) lines.push("", `${unpriced} turn(s) had no price and are not in the dollar totals.`);
  const report = `${lines.join("\n")}\n`;
  writeFileSync(join(HERE, "results", cName, "REPORT.md"), report);
  process.stdout.write(report);
  return 0;
}

process.exitCode = main();
