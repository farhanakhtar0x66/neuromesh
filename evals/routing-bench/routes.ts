// Where Tier 0 sends each of the 15 benchmark prompts, with no model call.
// Run it before and after a router change: a prompt that moves is a change to
// check against the suite's expected tier (task.json), not only the unit tests.
//
//   node evals/routing-bench/routes.ts
//   NEUROMESH_DISABLE=prose-guard node evals/routing-bench/routes.ts   (one feature off)
//
// By default only the calibration priors are used (an empty table), so the
// result does not depend on this machine's past runs; with --calibrated it
// uses ~/.neuromesh/routing/calibration.json as a real run would. A match is
// counted as score.ts counts it ("cascade 1>2>3" starts on the grunt).

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

let asExpected = 0;
const rows: string[] = [];
for (const slug of readdirSync(tasks).sort()) {
  const request = readFileSync(join(tasks, slug, "prompt.md"), "utf8");
  const task = JSON.parse(readFileSync(join(tasks, slug, "task.json"), "utf8")) as { bench: { expectedTier: string } };
  // An empty workspace: every benchmark prompt starts in a fresh repository.
  const r = routeTier({ request, kind: "greenfield" }, table, { instructionOnly: isOn("instruction-scoring"), breadth: isOn("subsystem-breadth") });
  const expected = task.bench.expectedTier;
  const start = expected.startsWith("cascade") ? ({ "1": "grunt", "2": "worker", "3": "senior" } as Record<string, string>)[expected.split(" ")[1]?.[0] ?? ""] : expected;
  const match = start === r.tier;
  if (match) asExpected++;
  rows.push(`${match ? "  " : "≠ "}${slug.padEnd(22)} ${r.tier.padEnd(7)} ${r.stage.padEnd(11)} expected ${expected}`);
}
console.log(rows.join("\n"));
console.log(`\n${asExpected}/${rows.length} start on the expected tier${useCalibration ? " (with this machine's calibration)" : " (calibration priors only)"}.`);
