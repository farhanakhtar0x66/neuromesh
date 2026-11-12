// Run the fault harness (test/support/chaos.ts) over many seeds. No model calls.
//
//   node evals/chaos.ts                    300 seeds from 1, on most of the cores
//   node evals/chaos.ts --seeds 2000 --from 5000 --jobs 8
//   node evals/chaos.ts --seed 1234        one seed, with its full result
//   node evals/chaos.ts --kill 1 --seeds 400   each run's engine process is killed part way, then resumed
//   (add --trace 1 to a single seed to see every event, --deadline 45 for a shorter time limit)
//
// Prints each broken rule once, with how many seeds broke it and a few of them
// to replay. Exits 1 when any rule was broken.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runChaos } from "../test/support/chaos.ts";
import type { ChaosResult } from "../test/support/chaos.ts";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string, fallback: number): number => {
  const v = Number.parseInt(arg(name) ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
};

/**
 * One seed whose engine process is killed part way and then resumed here. The
 * first half runs in a process of its own, because it kills itself.
 */
async function killed(seed: number, scratch: string, options: { deadlineMs: number; trace: boolean }): Promise<ChaosResult> {
  const killAt = seed % 9;
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--victim", String(seed), "--kill-at", String(killAt), "--scratch", scratch, "--deadline", String(options.deadlineMs / 1000)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (child.signal !== "SIGKILL") {
    // It ended before the kill came: its own result stands.
    const line = child.stdout.trim().split("\n").at(-1) ?? "";
    try {
      return JSON.parse(line) as ChaosResult;
    } catch {
      return { seed, scenario: "?", status: "none", calls: 0, resumes: 0, ms: 0, violations: [`the process to be killed ended oddly (exit ${child.status}, signal ${child.signal}): ${child.stderr.slice(-300)}`] };
    }
  }
  const result = await runChaos(seed, { scratch, ...options, resume: true });
  return { ...result, scenario: `KILLED at turn ${killAt}, resumed; ${result.scenario}` };
}

async function range(from: number, count: number): Promise<ChaosResult[]> {
  const scratch = mkdtempSync(join(tmpdir(), "neuromesh-chaos-"));
  const results: ChaosResult[] = [];
  try {
    for (let seed = from; seed < from + count; seed++) {
      let result: ChaosResult;
      try {
        const options = { deadlineMs: num("deadline", 120) * 1000, trace: arg("trace") !== undefined };
        result = arg("kill") !== undefined ? await killed(seed, scratch, options) : await runChaos(seed, { scratch, ...options });
      } catch (error) {
        result = { seed, scenario: "?", status: "none", calls: 0, resumes: 0, ms: 0, violations: [`the harness itself failed: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 3).join(" | ") : String(error)}`] };
      }
      results.push(result);
      // One line per seed, for the parent.
      process.stdout.write(`${JSON.stringify(result)}\n`);
      rmSync(join(scratch, `repo-${seed}`), { recursive: true, force: true });
      rmSync(join(scratch, `home-${seed}`), { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return results;
}

/** The same rule with its numbers and names taken out, so seeds group together. */
function ruleOf(violation: string): string {
  return violation
    .replace(/\$[\d.]+/g, "$N")
    .replace(/\d+/g, "N")
    .replace(/task [\w.-]+/g, "task T")
    .replace(/on [\w.-]+\)/g, "on T)")
    .replace(/: .*$/s, (rest) => (rest.length > 140 ? rest.slice(0, 140) : rest));
}

async function main(): Promise<void> {
  if (arg("victim") !== undefined) {
    const result = await runChaos(num("victim", 1), { scratch: arg("scratch")!, deadlineMs: num("deadline", 120) * 1000, killAt: num("kill-at", 0), trace: arg("trace") !== undefined });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const single = arg("seed");
  if (single !== undefined) {
    const [result] = await range(Number.parseInt(single, 10), 1);
    process.exitCode = result!.violations.length > 0 ? 1 : 0;
    return;
  }
  if (arg("child") !== undefined) {
    await range(num("from", 1), num("seeds", 1));
    return;
  }
  const seeds = num("seeds", 300);
  const from = num("from", 1);
  const jobs = Math.max(1, Math.min(num("jobs", Math.max(1, availableParallelism() - 2)), seeds));
  const started = Date.now();
  const results: ChaosResult[] = [];
  const per = Math.ceil(seeds / jobs);
  await Promise.all(
    Array.from({ length: jobs }, (_, j) => {
      const first = from + j * per;
      const count = Math.min(per, from + seeds - first);
      if (count <= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const pass = ["deadline", "kill"].flatMap((name) => (arg(name) !== undefined ? [`--${name}`, arg(name)!] : []));
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", "1", "--from", String(first), "--seeds", String(count), ...pass], { stdio: ["ignore", "pipe", "inherit"] });
        let buffer = "";
        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          let at: number;
          while ((at = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, at);
            buffer = buffer.slice(at + 1);
            try {
              results.push(JSON.parse(line) as ChaosResult);
            } catch {
              // Not a result line.
            }
          }
        });
        child.on("close", (code) => {
          if (code !== 0) results.push({ seed: -1, scenario: `seeds ${first} to ${first + count - 1}`, status: "none", calls: 0, resumes: 0, ms: 0, violations: [`a harness process died with exit code ${code}`] });
          resolve();
        });
      });
    }),
  );
  const byRule = new Map<string, ChaosResult[]>();
  for (const r of results) for (const v of r.violations) byRule.set(ruleOf(v), [...(byRule.get(ruleOf(v)) ?? []), r]);
  const statuses = new Map<string, number>();
  for (const r of results) statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
  const bad = results.filter((r) => r.violations.length > 0);
  console.log(`${results.length} seeds in ${Math.round((Date.now() - started) / 1000)} s on ${jobs} processes: ${[...statuses].map(([s, n]) => `${n} ${s}`).join(", ")}; ${results.reduce((n, r) => n + r.calls, 0)} agent turns`);
  if (bad.length === 0) {
    console.log("Every run kept every rule.");
    return;
  }
  console.log(`${bad.length} seeds broke a rule:\n`);
  for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(4)} × ${rule}`);
    console.log(`       seeds: ${list.slice(0, 8).map((r) => r.seed).join(", ")}`);
    console.log(`       e.g. ${list[0]!.scenario}`);
  }
  process.exitCode = 1;
}

await main();
