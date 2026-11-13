// Rerun the current hidden checkers on a run's kept workspaces (no model
// calls), after a checker was found too narrow. The score at run time stays in
// the record as `scoreAtRun`.
//
//   node evals/routing-bench/rescore.ts <name>...

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

for (const name of process.argv.slice(2)) {
  const dir = join(HERE, "results", name);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(dir, file);
    const rec = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & { slug: string; id: string; score?: { passed: number; total: number }; scoreAtRun?: { passed: number; total: number } };
    const repo = join(homedir(), ".neuromesh-bench", name, rec.slug, "repo");
    if (!existsSync(repo)) {
      process.stdout.write(`${name} ${rec.id}: workspace gone, not rescored\n`);
      continue;
    }
    rmSync(join(repo, "hidden"), { recursive: true, force: true });
    cpSync(join(HERE, "tasks", rec.slug, "hidden"), join(repo, "hidden"), { recursive: true });
    const r = spawnSync("sh", ["-c", "python3 -I hidden/check.py 2>&1"], { cwd: repo, encoding: "utf8", timeout: 15 * 60_000 });
    const out = (r.stdout ?? "").trim();
    const m = [...out.matchAll(/^SCORE (\d+)\/(\d+)\s*$/gm)].at(-1);
    if (!m) continue;
    const score = { passed: Number(m[1]), total: Number(m[2]) };
    const before = rec.scoreAtRun ?? rec.score;
    if (before && (before.passed !== score.passed || before.total !== score.total)) {
      rec.scoreAtRun = before;
      process.stdout.write(`${name} ${rec.id}: ${before.passed}/${before.total} -> ${score.passed}/${score.total}\n`);
    }
    rec.score = score;
    rec.quality = (10 * score.passed) / score.total;
    rec.hiddenOutput = out.slice(-4000);
    writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
  }
}
