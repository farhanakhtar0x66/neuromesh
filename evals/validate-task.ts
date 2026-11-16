// Check a real-repository task before it counts (plan item M9, for tasks made by make-task.ts). No model is called.
//
//   node evals/validate-task.ts <task folder> [--runs 3]
//
// On the seed, every fail-to-pass test must fail and every pass-to-pass test must pass. On the reference
// (the real change), all of them must pass, in each of 3 runs in fresh copies, and no test may change its
// result between runs: a check that is flaky cannot tell two systems apart. Exit 0 only if all of that holds.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReference } from "./make-task.ts";
import { grade } from "./real-task/grade.ts";
import type { TaskSpec } from "./real-task/grade.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Validation {
  ok: boolean;
  checks: Check[];
}

const names = (o: Record<string, boolean>, want: boolean): string[] => Object.entries(o).filter(([, v]) => v === want).map(([k]) => k);

export function validateTask(dir: string, options: { runs?: number } = {}): Validation {
  const runs = options.runs ?? 3;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string): boolean => {
    checks.push({ name, ok, ...(detail ? { detail } : {}) });
    return ok;
  };
  const task = resolve(dir);
  const files = ["seed", "hidden/tests", "hidden/spec.json", "hidden/grade.ts", "reference/files", "prompt.md", "task.json"];
  const missing = files.filter((f) => !existsSync(join(task, f)) && !(f === "reference/files" && existsSync(join(task, "reference", "deleted.txt"))));
  if (!add("the task folder has seed, hidden tests, spec, grader, reference, prompt and task.json", missing.length === 0, missing.join(", "))) return { ok: false, checks };
  const spec = JSON.parse(readFileSync(join(task, "hidden", "spec.json"), "utf8")) as TaskSpec;
  if (!add("at least one fail-to-pass test is named", spec.failToPass.length > 0)) return { ok: false, checks };
  add("the prompt is not empty", readFileSync(join(task, "prompt.md"), "utf8").trim().length > 0);
  add("the hidden tests exist", readdirSync(join(task, "hidden", "tests")).length > 0);

  const tmp = mkdtempSync(join(tmpdir(), "neuromesh-validate-task-"));
  try {
    // 1. On the seed.
    const seedWs = join(tmp, "seed");
    cpSync(join(task, "seed"), seedWs, { recursive: true });
    const onSeed = grade(seedWs, join(task, "hidden", "tests"), spec);
    const stillPass = names(onSeed.failToPass, true);
    add("on the seed, every fail-to-pass test fails", stillPass.length === 0, stillPass.slice(0, 5).join("; "));
    const broken = names(onSeed.passToPass, false);
    add("on the seed, every pass-to-pass test passes", broken.length === 0, broken.slice(0, 5).join("; "));

    // The project's own check (task.json "checks"), which Neuromesh runs while it works, must pass on the seed:
    // one that fails before anyone has done anything sends every attempt after a phantom.
    const own = (JSON.parse(readFileSync(join(task, "task.json"), "utf8")) as { checks?: { name: string; command: string }[] }).checks ?? [];
    for (const c of own) {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
      delete env.NODE_TEST_CONTEXT;
      const plain = join(tmp, "seed-plain");
      if (!existsSync(plain)) cpSync(join(task, "seed"), plain, { recursive: true });
      const r = spawnSync("sh", ["-c", c.command], { cwd: plain, encoding: "utf8", env, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
      add(`the project's own check "${c.name}" passes on the seed`, r.status === 0, `${c.command}: ${(r.stdout + r.stderr).split("\n").slice(-6).join(" | ").slice(0, 300)}`);
    }

    // 2. On the reference, several times, each in a fresh copy.
    const seen = new Map<string, Set<boolean>>();
    let allPass = true;
    const failing = new Set<string>();
    for (let i = 1; i <= runs; i++) {
      const ws = join(tmp, `ref-${i}`);
      applyReference(join(task, "seed"), join(task, "reference"), ws);
      const g = grade(ws, join(task, "hidden", "tests"), spec);
      for (const [id, ok] of [...Object.entries(g.failToPass), ...Object.entries(g.passToPass)]) {
        if (!seen.has(id)) seen.set(id, new Set());
        seen.get(id)!.add(ok);
        if (!ok) failing.add(id);
      }
      allPass = allPass && g.pass;
    }
    add(`on the reference, every named test passes, in each of ${runs} runs`, allPass, [...failing].slice(0, 5).join("; "));
    const flaky = [...seen].filter(([, v]) => v.size > 1).map(([k]) => k);
    add(`no test changes its result between the ${runs} runs`, flaky.length === 0, flaky.slice(0, 5).join("; "));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

function main(): number {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--runs");
  if (!dir) {
    console.error("usage: node evals/validate-task.ts <task folder> [--runs 3]");
    return 2;
  }
  const i = argv.indexOf("--runs");
  const v = validateTask(dir, { runs: i >= 0 ? Number(argv[i + 1]) : 3 });
  for (const c of v.checks) console.log(`${c.ok ? "ok  " : "BAD "} ${c.name}${c.ok || !c.detail ? "" : `: ${c.detail}`}`);
  console.log(v.ok ? "valid: this task can be used" : "NOT valid: do not use this task");
  return v.ok ? 0 : 1;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) process.exitCode = main();
