// `neuromesh routing`: the routing cascade's table, Tier 0 on a request, and
// the shadow grading (F80, F81, F88).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackend } from "../backends/types.ts";
import { defaultHome } from "../engine/store.ts";
import { buildBrief, repoFacts } from "../intake/brief.ts";
import { DEFAULT_PRESET, loadPreset } from "../presets/presets.ts";
import { DEFAULT_ALPHA, calibrated, demote, describeCalibration, loadCalibration, saveCalibration } from "../routing/calibration.ts";
import { routeTier } from "../routing/router.ts";
import { GRADE_SCHEMA, gradePrompt, markGraded, parseGrade, pending } from "../routing/shadow.ts";
import { findRepo } from "../workspace/workspace.ts";

export const ROUTING_HELP = `  neuromesh routing             the Tier 0 calibration table and the shadow sample waiting for a grade
  neuromesh routing route "<request>"
                                where Tier 0 would send a request, and why (no model call)
  neuromesh routing grade       grade the shadow sample with the preset's senior model (live calls)
      --preset <name>           whose senior model grades (default: cascade)
      --limit <n>               most items to grade (default 5)
`;

export async function commandRouting(positional: string[], flags: Map<string, string>, all: Record<string, AgentBackend>): Promise<number> {
  const home = defaultHome();
  const sub = positional[0];
  const presetName = flags.get("preset") ?? "cascade";
  const alpha = (() => {
    try {
      return loadPreset(presetName).cascade?.alpha ?? DEFAULT_ALPHA;
    } catch {
      return DEFAULT_ALPHA;
    }
  })();

  if (sub === undefined || sub === "table") {
    const waiting = pending(home).length;
    process.stdout.write(`${describeCalibration(loadCalibration(home), alpha).join("\n")}\n\nShadow sample waiting for a grade: ${waiting}${waiting > 0 ? ' ("neuromesh routing grade")' : ""}\n`);
    return 0;
  }

  if (sub === "route") {
    const file = flags.get("prompt-file");
    const prompt = (file ? readFileSync(file, "utf8") : positional.slice(1).join(" ")).trim();
    if (!prompt) {
      process.stderr.write('Give a request: neuromesh routing route "fix the race in the job queue"\n');
      return 2;
    }
    const preset = loadPreset(flags.get("preset") ?? DEFAULT_PRESET);
    const repo = findRepo(flags.get("repo") ?? process.cwd());
    const brief = buildBrief(prompt, repoFacts(repo.root), { team: preset.mode === "team", maxParallel: preset.maxParallel, canSpec: false });
    const r = routeTier({ request: brief.request, kind: brief.kind, totalWords: [brief.request, ...brief.attached.map((a) => a.text)].join(" ").split(/\s+/).filter(Boolean).length }, calibrated(loadCalibration(home), alpha));
    const scores = Object.entries(r.scores).map(([t, s]) => `${t} ${s}`).join(", ");
    process.stdout.write(
      `Tier: ${r.tier} (stage ${r.stage === "rules" ? "0A rules" : r.stage === "similarity" ? "0B similarity" : "0C calibrated"})\n` +
        `Kind: ${brief.kind}; cluster: ${r.cluster ?? "none"} at ${Math.round(r.confidence * 100)}% of the match (${scores})\n` +
        r.reasons.map((x) => `  - ${x}`).join("\n") +
        (r.stripped.length > 0 ? `\nIgnored:\n${r.stripped.map((x) => `  - ${x}`).join("\n")}` : "") +
        "\n",
    );
    return 0;
  }

  if (sub === "grade") {
    const preset = loadPreset(presetName);
    const config = preset.seniorLadder?.[0] ?? preset.roles.tester?.[0];
    if (!config) {
      process.stderr.write(`Preset ${presetName} has no senior or tester model to grade with.\n`);
      return 2;
    }
    const backend = all[config.backend];
    if (!backend) {
      process.stderr.write(`Unknown backend "${config.backend}".\n`);
      return 2;
    }
    const limit = Math.max(1, Number.parseInt(flags.get("limit") ?? "5", 10) || 5);
    const items = pending(home).slice(0, limit);
    if (items.length === 0) {
      process.stdout.write("Nothing waiting for a grade.\n");
      return 0;
    }
    process.stdout.write(`Grading ${items.length} item(s) with ${config.backend}/${config.model ?? "default"}: ${items.length} live model call(s).\n`);
    const table = loadCalibration(home);
    let failed = 0;
    for (const { path, item } of items) {
      const cwd = mkdtempSync(join(tmpdir(), "neuromesh-grade-"));
      try {
        const result = await backend.run({ cwd, prompt: gradePrompt(item), model: config.model, effort: config.effort, access: "read-only", outputSchema: GRADE_SCHEMA, timeoutMs: 10 * 60_000 });
        const grade = result.stop === "done" ? parseGrade(result) : undefined;
        if (!grade) {
          process.stdout.write(`  ${item.run} ${item.task}: no usable grade (${result.stop}${result.detail ? `: ${result.detail.slice(0, 80)}` : ""}); left in the queue\n`);
          if (result.stop === "quota" || result.stop === "auth") break;
          continue;
        }
        if (grade.verdict === "fail") {
          demote(table, item.cluster, item.tier);
          failed += 1;
        }
        markGraded(home, path, grade);
        process.stdout.write(`  ${item.run} ${item.task} (${item.tier}): ${grade.verdict}, ${grade.summary.slice(0, 120)}\n`);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
    saveCalibration(home, table);
    process.stdout.write(`${failed} pass(es) rejected; the calibration table counts them as failures.\n`);
    return 0;
  }

  process.stderr.write(`Unknown routing command "${sub}".\n\n${ROUTING_HELP}`);
  return 2;
}
