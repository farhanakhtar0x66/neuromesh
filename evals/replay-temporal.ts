// [F142 replay-harness] Replay finished Haiku and Sonnet runs through F140's routing gate, offline: a local
// laya-serve is asked about each one; no Claude call is made. See src/eval/replay.ts.
//
//   node evals/replay-temporal.ts [--cutoff 3|4|5] [--home ~/.neuromesh] [--out <labels.jsonl>] [--no-export]
//                                 [--include-checks] [--haiku-weight 0.1667] [--sonnet-weight 0.5] [--timeout 5000]
//
// Reads <home>/projects (run folders), <home>/evals/*/results.json and <home>/record/record.jsonl, and changes none of
// them. Writes the labelled dataset to <home>/routing/laya-labels.jsonl unless --no-export (local only; never commit it).
// Laya's address and paths come from NEUROMESH_LAYA_URL and friends (docs/29-laya-sidecar.md); Laya down is reported,
// and every run then routes by the probe alone, as F140 would.

import { join } from "node:path";
import { defaultHome } from "../src/engine/store.ts";
import { formatReplay, loadHistory, replay, writeLabels, DEFAULT_WEIGHTS } from "../src/eval/replay.ts";
import { enable, isOn } from "../src/features.ts";
import { LayaClient, layaConfig } from "../src/routing/laya-client.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const positive = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

async function main(): Promise<number> {
  if (!isOn("replay-harness")) {
    process.stderr.write("F142 replay-harness is disabled.\n");
    return 2;
  }
  const cutoff = Number(option("cutoff") ?? 4);
  if (![3, 4, 5].includes(cutoff)) {
    process.stderr.write("--cutoff takes 3, 4 or 5 (model calls of the cheap turn).\n");
    return 2;
  }
  const home = option("home") ?? defaultHome();
  // The replay asks Laya on purpose, so the gate's client is switched on here (it is off by default in runs).
  enable("laya-gate");
  const laya = new LayaClient({ ...layaConfig(), timeoutMs: positive(option("timeout"), 5000) });
  const weights = { ...DEFAULT_WEIGHTS, haiku: positive(option("haiku-weight"), DEFAULT_WEIGHTS.haiku), sonnet: positive(option("sonnet-weight"), DEFAULT_WEIGHTS.sonnet) };
  const history = loadHistory(home);
  const { report, rows } = await replay(history.runs, history.skipped, { cutoff, ask: (text) => laya.decideRouting(text), weights, includeChecks: flag("include-checks") });
  console.log(formatReplay(report));
  if (!flag("no-export")) {
    const out = option("out") ?? join(home, "routing", "laya-labels.jsonl");
    writeLabels(out, rows);
    console.log(`\nLabels: ${rows.length} rows written to ${out} (local; not for the repository).`);
  }
  return 0;
}

process.exitCode = await main();
