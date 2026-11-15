// Ask the record: node src/record/cli.ts <command> [options]
//
//   backfill [--roots a,b] [--bench dir,dir] [--dry]   read run folders, benchmark results, evals and ratings already on disk
//   summary                                            lines by kind, turns by tier and model, decisions by name
//   turns [--model m] [--tier t] [--run id] [--since iso]
//   decisions [--name n] [--feature F82] [--run id]    each with what happened to its task and run
//   runs                                               one line per run: preset, status, turns, estimated cost
//   results [--name rb-cascade-2] [--all]              benchmark and eval results (newest line per result; --all shows rescored history)
//   index                                              rebuild ~/.neuromesh/record/index.json
//
// --home overrides ~/.neuromesh (or NEUROMESH_HOME). No model calls.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultHome } from "../engine/store.ts";
import { backfill } from "./backfill.ts";
import type { DecisionLine, ResultLine, RunLine, TurnLine } from "./record.ts";
import { outcomeOf, readRecord, recordPath, select, summarize, writeIndex } from "./record.ts";

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const home = opt("home") ?? defaultHome();
const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const tokens = (u: TurnLine["usage"]): number => (u ? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0);

switch (command) {
  case "backfill": {
    const repoResults = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "routing-bench", "results");
    const roots = opt("roots")?.split(",") ?? [join(home, "projects"), join(homedir(), ".neuromesh-bench")];
    const bench = opt("bench")?.split(",") ?? [repoResults];
    const r = backfill({ roots, benchResults: bench, home, dryRun: args.includes("--dry") });
    console.log(`${args.includes("--dry") ? "Would add" : "Added"}: ${r.runsAdded} runs (${r.runsSkipped} already in the record, ${r.runsBroken} unreadable, ${r.runsFound} found), ${r.resultsAdded} results, ${r.ratingsAdded} ratings; ${r.linesAdded} lines. Record: ${recordPath(home)}`);
    break;
  }
  case "summary": {
    const s = summarize(readRecord(home));
    console.log(`${s.lines} lines, ${s.runs} runs, ${s.firstAt ?? "-"} to ${s.lastAt ?? "-"}`);
    console.log(`by kind: ${Object.entries(s.byKind).map(([a, b]) => `${a} ${b}`).join(", ")}`);
    console.log(`turns: ${s.turns.count}`);
    for (const [t, e] of Object.entries(s.turns.byTier).sort((a, b) => b[1].tokens - a[1].tokens)) console.log(`  tier ${t.padEnd(10)} ${String(e.turns).padStart(5)} turns ${k(e.tokens).padStart(8)} tokens`);
    for (const [m, e] of Object.entries(s.turns.byModel).sort((a, b) => b[1].tokens - a[1].tokens)) console.log(`  model ${m.padEnd(24)} ${String(e.turns).padStart(5)} turns ${k(e.tokens).padStart(8)} tokens`);
    console.log(`decisions: ${Object.entries(s.decisions).sort((a, b) => b[1] - a[1]).map(([a, b]) => `${a} ${b}`).join(", ")}`);
    break;
  }
  case "turns": {
    for (const l of select<TurnLine>(readRecord(home), { kind: "turn", model: opt("model"), tier: opt("tier"), run: opt("run"), since: opt("since") })) {
      console.log(`${l.at.slice(0, 19)} ${(l.run ?? "").padEnd(21)} ${(l.task ?? "-").padEnd(6)} ${(l.role ?? "").padEnd(10)} ${(l.cascadeTier ?? l.tier ?? "").padEnd(7)} ${(l.model ?? "").replace("claude-", "").padEnd(14)} ${(l.stop ?? "").padEnd(8)} ${k(tokens(l.usage)).padStart(7)} tokens${l.costEstimateUsd !== undefined ? ` ≈$${l.costEstimateUsd.toFixed(3)}` : ""}`);
    }
    break;
  }
  case "decisions": {
    const lines = readRecord(home);
    for (const l of select<DecisionLine>(lines, { kind: "decision", name: opt("name"), feature: opt("feature"), run: opt("run") })) {
      const o = outcomeOf(lines, l);
      console.log(`${l.at.slice(0, 19)} ${(l.run ?? "").padEnd(21)} ${l.name.padEnd(16)} ${(l.feature ?? "").padEnd(5)} ${(l.task ?? "-").padEnd(5)} then: task ${o.task?.status ?? "?"}, run ${o.run?.status ?? "?"}  inputs ${JSON.stringify(l.inputs).slice(0, 110)}`);
    }
    break;
  }
  case "runs": {
    for (const l of select<RunLine>(readRecord(home), { kind: "run" })) console.log(`${l.at.slice(0, 19)} ${(l.run ?? "").padEnd(21)} ${(l.preset ?? "").padEnd(18)} ${(l.status ?? "").padEnd(9)} checks ${(l.checks ?? "-").padEnd(7)} ${String(l.turns ?? "?").padStart(3)} turns${l.costEstimateUsd !== undefined ? ` ≈$${l.costEstimateUsd.toFixed(3)} (estimate)` : ""}`);
    break;
  }
  case "results": {
    // The newest line per result wins (a rescore adds a line and keeps the old one); --all shows every line.
    const all = select<ResultLine>(readRecord(home), { kind: "result" }).filter((r) => opt("name") === undefined || r.name === opt("name"));
    const latest = new Map(all.map((r) => [`${r.source}|${r.name}|${r.task}`, r]));
    for (const l of args.includes("--all") ? all : [...latest.values()]) {
      console.log(`${l.source.padEnd(13)} ${l.name.padEnd(24)} ${l.task.padEnd(18)} ${l.passed !== undefined ? `${l.passed}/${l.total}` : (l.hidden ?? "-")}${l.quality !== undefined ? ` q ${l.quality.toFixed(1)}` : ""}${l.costEstimateUsd !== undefined ? ` ≈$${l.costEstimateUsd.toFixed(3)}` : ""}`);
    }
    break;
  }
  case "index": {
    const s = writeIndex(home);
    console.log(`Rebuilt the index: ${s.lines} lines, ${s.runs} runs.`);
    break;
  }
  default:
    console.log("Commands: backfill, summary, turns, decisions, runs, results, index. See the top of src/record/cli.ts.");
}
