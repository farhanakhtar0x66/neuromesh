// Where Tier 0 sends each benchmark prompt, with no model call: the 15 regression prompts (Table A)
// and the 15 held-out prompts (Table B), each with its own count.
// Run it before and after a router change: a prompt that moves is a change to
// check against the suite's expected tier (task.json), not only the unit tests.
//
//   node evals/routing-bench/routes.ts
//   NEUROMESH_DISABLE=prose-guard node evals/routing-bench/routes.ts   (one feature off)
//   node evals/routing-bench/routes.ts --set=held-out                  (one table only)
//
// By default only the calibration priors are used (an empty table), so the
// result does not depend on this machine's past runs; with --calibrated it
// uses ~/.neuromesh/routing/calibration.json as a real run would. A match is
// counted as score.ts counts it ("cascade 1>2>3" starts on the grunt); an expected tier written
// "worker|senior" accepts either.

import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOn } from "../../src/features.ts";
import { calibrated, loadCalibration } from "../../src/routing/calibration.ts";
import { routeTier } from "../../src/routing/router.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks = join(here, "tasks");
const useCalibration = process.argv.includes("--calibrated");
const table = useCalibration
  ? calibrated(loadCalibration(process.env.NEUROMESH_HOME ?? join(homedir(), ".neuromesh")), 0.8)
  : calibrated({ version: 1, cells: {} }, 0.8);

const CASCADE_START: Record<string, string> = { "1": "grunt", "2": "worker", "3": "senior" };

/** The tiers a task may start on: "grunt", "worker|senior" (either is fine), "cascade 2>3" (starts on the worker). */
function acceptable(expected: string): string[] {
  return expected.split("|").map((e) => (e.startsWith("cascade") ? CASCADE_START[e.split(" ")[1]?.[0] ?? ""] ?? e : e));
}

interface SetResult {
  rows: string[];
  asExpected: number;
  total: number;
}

function route(set: string, dir: string): SetResult {
  const rows: string[] = [];
  let asExpected = 0;
  for (const slug of readdirSync(dir).sort()) {
    const request = readFileSync(join(dir, slug, "prompt.md"), "utf8");
    const task = JSON.parse(readFileSync(join(dir, slug, "task.json"), "utf8")) as { bench: { id: string; expectedTier: string } };
    // An empty workspace: every benchmark prompt starts in a fresh repository.
    const r = routeTier({ request, kind: "greenfield" }, table, { instructionOnly: isOn("instruction-scoring"), breadth: isOn("subsystem-breadth") });
    const expected = task.bench.expectedTier;
    const match = acceptable(expected).includes(r.tier);
    if (match) asExpected++;
    rows.push(`${match ? "  " : "≠ "}${task.bench.id.padEnd(5)} ${slug.padEnd(22)} ${r.tier.padEnd(7)} ${r.stage.padEnd(11)} expected ${expected}`);
  }
  console.log(`${set}\n${rows.join("\n")}`);
  console.log(`${asExpected}/${rows.length} start on an expected tier${useCalibration ? " (with this machine's calibration)" : " (calibration priors only)"}.\n`);
  return { rows, asExpected, total: rows.length };
}

// Table A is the regression set: the prompts Tier 0 was tuned against. Table B is the held-out set, written
// after the router and never used to change it; a router change is judged on B, and B is never tuned on.
const only = process.argv.find((a) => a.startsWith("--set="))?.slice(6);
if (!only || only === "regression") route("Table A: regression set (1.1 to 5.3, tuned on)", join(here, "tasks"));
if (!only || only === "held-out") route("Table B: held-out set (H1.1 to H5.3, never tuned on)", join(here, "held-out", "tasks"));
