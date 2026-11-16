// Make and validate batch 3 of the real-repository tasks (Rust, Python and C repositories with dependencies). No model is called.
//
//   node evals/real-tasks-3/build.ts [--only name,name] [--runs 3] [--no-prewarm] [--out-root dir]
//
// It reads batch-3.json next to it and, for every task: (1) PREWARMS the dependencies of the commit and of its parent
// (`prewarm`, run once in a plain checkout of each; this is the only step that needs the network, and it is why each
// task's own `setup` can then run offline), (2) makes the task with makeTask() from evals/make-task.ts, (3) optionally
// narrows the fail-to-pass list to tests that live in the hidden test files (`failToPassFrom: "hidden"`), (4) times one
// run of the hidden check on the seed, and (5) validates it (evals/validate-task.ts: fails on the seed, passes on the
// reference in each of 3 fresh runs, no flaky test). Exit 0 only if every task is valid. One line per task is printed with the
// times, which MANIFEST.md quotes.
//
// Why a separate builder: batch 2's make-batch.ts has no prewarm step and no way to say that some tests of the change live
// inside the reference's source files (Rust `#[cfg(test)]` modules), which a different solution cannot be expected to have.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTask } from "../make-task.ts";
import { grade } from "../real-task/grade.ts";
import type { Runner, TaskSpec } from "../real-task/grade.ts";
import { validateTask } from "../validate-task.ts";

interface Entry {
  name: string;
  repo: string;
  commit: string;
  kind: string;
  language: string;
  runner: Runner;
  testCommand: string;
  setup?: string;
  /** Shell command run in a checkout of the commit and of its parent, with the network, to fill the dependency caches. */
  prewarm?: string;
  tests?: string[];
  checks?: string;
  /** "hidden": keep only the fail-to-pass tests that are defined by the hidden test files (see narrowToHidden). */
  failToPassFrom?: "hidden";
}

const here = dirname(fileURLToPath(import.meta.url));

function sh(cwd: string, command: string): { code: number | null; out: string } {
  const r = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run `command` in a plain checkout of `rev` of the repository at `repo` (read only: `git archive`). */
function prewarm(repo: string, commit: string, command: string): void {
  for (const rev of [`${commit}^`, commit]) {
    const dir = mkdtempSync(join(tmpdir(), "neuromesh-prewarm-"));
    try {
      const a = spawnSync("sh", ["-c", `git -C "${repo}" archive "${rev}" | tar -x -C "${dir}"`], { encoding: "utf8" });
      if (a.status !== 0) throw new Error(`could not check out ${rev} of ${repo}: ${a.stderr.trim().slice(0, 200)}`);
      const r = sh(dir, command);
      if (r.code !== 0) throw new Error(`prewarm "${command}" failed on ${rev}: ${r.out.trim().split("\n").slice(-4).join(" | ").slice(0, 300)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Rust: the reference's source files hold `#[cfg(test)]` modules whose tests ("adb::tests::x") exist only in the reference, so no other
 * solution can have them. Keep the fail-to-pass tests whose id is unqualified (an integration test's free function) or begins with a
 * `mod` declared in the hidden test files. Everything else that the reference passes and the seed fails is dropped, not moved to pass-to-pass.
 */
function narrowToHidden(dir: string): { kept: number; dropped: number } {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(d, name.name));
      else files.push(join(d, name.name));
    }
  };
  walk(join(dir, "hidden", "tests"));
  const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const mods = new Set([...text.matchAll(/\bmod\s+(\w+)/g)].map((m) => m[1]!));
  const specFile = join(dir, "hidden", "spec.json");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as TaskSpec;
  const keep = spec.failToPass.filter((id) => {
    const bare = id.replace(/ #\d+$/, "");
    return !bare.includes("::") || mods.has(bare.split("::")[0]!);
  });
  const dropped = spec.failToPass.length - keep.length;
  spec.failToPass = keep;
  writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
  return { kept: keep.length, dropped };
}

function main(): number {
  const argv = process.argv.slice(2);
  const opt = (k: string): string | undefined => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const only = opt("only")?.split(",");
  const runs = Number(opt("runs") ?? 3);
  const root = resolve(opt("out-root") ?? here);
  const entries = JSON.parse(readFileSync(join(here, "batch-3.json"), "utf8")) as Entry[];
  let bad = 0;
  for (const e of entries) {
    if (only && !only.includes(e.name)) continue;
    const dir = join(root, e.name);
    const repo = e.repo.replace(/^~/, homedir());
    try {
      let prewarmS = 0;
      let makeS = 0;
      let note = "";
      if (!existsSync(dir)) {
        if (e.prewarm && !argv.includes("--no-prewarm")) {
          const t = Date.now();
          prewarm(repo, e.commit, e.prewarm);
          prewarmS = (Date.now() - t) / 1000;
        }
        const t = Date.now();
        makeTask({
          repo, commit: e.commit, name: e.name, runner: e.runner, testCommand: e.testCommand, setup: e.setup,
          kind: e.kind, language: e.language, tests: e.tests, checks: e.checks, out: dir,
          prompt: readFileSync(join(here, "prompts", `${e.name}.md`), "utf8"),
        });
        makeS = (Date.now() - t) / 1000;
        if (e.failToPassFrom === "hidden") {
          const n = narrowToHidden(dir);
          note = ` (fail-to-pass narrowed to the hidden test files: ${n.kept} kept, ${n.dropped} in the reference's own source dropped)`;
        }
      }
      // One timed run of the hidden check on the seed: it must fail, and quickly.
      const spec = JSON.parse(readFileSync(join(dir, "hidden", "spec.json"), "utf8")) as TaskSpec;
      const ws = mkdtempSync(join(tmpdir(), "neuromesh-seed-time-"));
      let seedS = 0;
      let seedFails = false;
      try {
        cpSync(join(dir, "seed"), ws, { recursive: true });
        const t = Date.now();
        const g = grade(ws, join(dir, "hidden", "tests"), spec);
        seedS = (Date.now() - t) / 1000;
        seedFails = !g.pass;
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
      const t0 = Date.now();
      const v = validateTask(dir, { runs });
      const validateS = (Date.now() - t0) / 1000;
      if (!v.ok || !seedFails) bad++;
      console.log(
        `${v.ok && seedFails ? "valid  " : "INVALID"} ${e.name.padEnd(24)} ${e.kind.padEnd(8)} f2p ${String(spec.failToPass.length).padStart(3)} p2p ${String(spec.passToPass.length).padStart(3)}  ` +
          `prewarm ${prewarmS.toFixed(0)}s  make ${makeS.toFixed(0)}s  seed check ${seedS.toFixed(0)}s (${seedFails ? "fails" : "PASSES"})  validate x${runs} ${validateS.toFixed(0)}s${note}` +
          (v.ok ? "" : `   ${v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? ""}`.slice(0, 200)).join("; ")}`),
      );
    } catch (err) {
      bad++;
      console.log(`FAILED  ${e.name.padEnd(24)} ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  console.log(bad === 0 ? "every task is valid" : `${bad} task(s) not valid`);
  return bad === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) process.exitCode = main();
