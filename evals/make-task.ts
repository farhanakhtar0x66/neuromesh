// Turn a real change into a benchmark task (plan item M1). No model is called.
//
//   node evals/make-task.ts --repo <path or url> --commit <hash> --name <name> \
//        --runner node|pytest|cargo --test-cmd "node --test" [--setup "npm ci"] \
//        [--kind bug|feature|refactor|program] [--language javascript] \
//        [--prompt "text" | --prompt-file file] [--tests "glob,glob"] [--checks "cmd"] [--out dir] [--no-run]
//
// The recipe is the one public benchmarks use:
//   seed        the repository as it was before the change (the commit's parent)
//   prompt.md   the commit message, or the text given with --prompt (read it: it must not give the solution away)
//   hidden/     the tests the change came with (laid over the workspace to grade), the grader, spec.json
//   reference/  the change's non-test files as they were after it, and the files it deleted
//   fail-to-pass: tests that fail on the seed and pass on the reference; pass-to-pass: tests that pass on both
//
// The two lists are found by running the project's tests twice (skip with --no-run, and name them
// yourself in hidden/spec.json). A task counts only once `node evals/validate-task.ts <dir>` passes.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overlay, runTests } from "./real-task/grade.ts";
import type { Runner, TaskSpec } from "./real-task/grade.ts";

export interface MakeOptions {
  repo: string;
  commit: string;
  name: string;
  runner: Runner;
  testCommand: string;
  setup?: string;
  kind?: string;
  language?: string;
  prompt?: string;
  /** Globs (* and **) naming the test files; default: the usual places and names. */
  tests?: string[];
  out?: string;
  /** Do not run the tests: the two lists stay empty for the person to fill in. */
  noRun?: boolean;
  /** The command Neuromesh runs as the project's own check while it works (a quick test of the code as it was before the change). Without it Neuromesh detects the project's checks, which for a repository seeded without its dependencies can only fail. */
  checks?: string;
}

export interface MadeTask {
  dir: string;
  sha: string;
  parent: string;
  testFiles: string[];
  sourceFiles: string[];
  deleted: string[];
  failToPass: string[];
  passToPass: string[];
  promptFrom: "given" | "commit message";
}

const here = dirname(fileURLToPath(import.meta.url));

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
}

/** Extract `paths` of a commit into `into` (git archive, so content is exact). */
function extract(repo: string, sha: string, paths: string[], into: string): void {
  mkdirSync(into, { recursive: true });
  const tar = join(into, ".extract.tar");
  const args = ["-C", repo, "archive", "--format=tar", "-o", tar, sha, ...(paths.length > 0 ? ["--", ...paths] : [])];
  const a = spawnSync("git", args, { encoding: "utf8" });
  if (a.status !== 0) throw new Error(`git archive failed: ${a.stderr.trim().slice(0, 300)}`);
  const t = spawnSync("tar", ["-xf", tar, "-C", into], { encoding: "utf8" });
  rmSync(tar, { force: true });
  if (t.status !== 0) throw new Error(`tar failed: ${t.stderr.trim().slice(0, 300)}`);
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${body}$`);
}

const DEFAULT_TEST = [
  /(^|\/)(tests?|__tests__|spec|specs)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go|rs)$/,
];

export function isTestPath(path: string, globs?: string[]): boolean {
  return globs && globs.length > 0 ? globs.some((g) => globToRegExp(g).test(path)) : DEFAULT_TEST.some((r) => r.test(path));
}

/** Where a task's files go when --out is not given. */
export function defaultOut(name: string): string {
  return join(here, "real-tasks", name);
}

export function makeTask(o: MakeOptions): MadeTask {
  if (!/^[\w.-]+$/.test(o.name)) throw new Error(`The task name "${o.name}" may only hold letters, digits, dots, dashes and underscores`);
  const out = resolve(o.out ?? defaultOut(o.name));
  if (existsSync(out)) throw new Error(`${out} already exists; choose another --name or --out`);
  const work = mkdtempSync(join(tmpdir(), "neuromesh-make-task-"));
  try {
    const clone = join(work, "repo");
    const c = spawnSync("git", ["clone", "-q", "--no-checkout", o.repo, clone], { encoding: "utf8" });
    if (c.status !== 0) throw new Error(`could not clone ${o.repo}: ${c.stderr.trim().slice(0, 300)}`);
    const sha = git(clone, ["rev-parse", "--verify", `${o.commit}^{commit}`]).trim();
    const parents = git(clone, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ").slice(1);
    if (parents.length === 0) throw new Error(`${sha.slice(0, 10)} has no parent: there is no "before" to seed from`);
    const parent = parents[0]!;
    const changes = git(clone, ["diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", parent, sha])
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ status: l[0]!, path: l.slice(1).trim() }));
    const testFiles = changes.filter((c) => c.status !== "D" && isTestPath(c.path, o.tests)).map((c) => c.path);
    const sourceChanges = changes.filter((c) => !isTestPath(c.path, o.tests));
    const sourceFiles = sourceChanges.filter((c) => c.status !== "D").map((c) => c.path);
    const deleted = sourceChanges.filter((c) => c.status === "D").map((c) => c.path);
    if (testFiles.length === 0) throw new Error(`${sha.slice(0, 10)} changes no test file, so there is nothing to grade with (use --tests to say which files are tests)`);
    if (sourceFiles.length + deleted.length === 0) throw new Error(`${sha.slice(0, 10)} changes only tests: there is no solution to ask for`);

    const stage = join(work, "task");
    extract(clone, parent, [], join(stage, "seed"));
    extract(clone, sha, testFiles, join(stage, "hidden", "tests"));
    if (sourceFiles.length > 0) extract(clone, sha, sourceFiles, join(stage, "reference", "files"));
    mkdirSync(join(stage, "reference"), { recursive: true });
    writeFileSync(join(stage, "reference", "deleted.txt"), deleted.map((d) => `${d}\n`).join(""));
    writeFileSync(join(stage, "reference", "change.patch"), git(clone, ["diff", parent, sha, "--", ...sourceChanges.map((c) => c.path)]));

    const message = git(clone, ["log", "-1", "--format=%B", sha]).trim();
    writeFileSync(join(stage, "prompt.md"), `${(o.prompt ?? message).trim()}\n`);

    const spec: TaskSpec = { runner: o.runner, testCommand: o.testCommand, ...(o.setup ? { setup: o.setup } : {}), failToPass: [], passToPass: [] };
    if (!o.noRun) {
      const before = join(work, "before");
      cpSync(join(stage, "seed"), before, { recursive: true });
      overlay(join(stage, "hidden", "tests"), before);
      const seedRun = runTests(before, spec);
      const after = join(work, "after");
      applyReference(join(stage, "seed"), join(stage, "reference"), after);
      overlay(join(stage, "hidden", "tests"), after);
      const refRun = runTests(after, spec);
      if (refRun.results.size === 0) throw new Error(`the tests printed nothing readable on the reference:\n${refRun.output.slice(-800)}`);
      for (const [id, passed] of refRun.results) {
        if (!passed) continue;
        if (seedRun.results.get(id) === true) spec.passToPass.push(id);
        else spec.failToPass.push(id);
      }
      spec.failToPass.sort();
      spec.passToPass.sort();
      if (spec.failToPass.length === 0) throw new Error("no test fails on the seed and passes on the reference: this change has no test that tells before from after");
    }
    writeFileSync(join(stage, "hidden", "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    cpSync(join(here, "real-task", "grade.ts"), join(stage, "hidden", "grade.ts"));
    writeFileSync(
      join(stage, "task.json"),
      `${JSON.stringify({ kind: o.kind ?? "other", language: o.language ?? "unknown", hiddenCheck: "node hidden/grade.ts", source: { repo: o.repo, commit: sha, parent }, runner: o.runner, testCommand: o.testCommand, ...(o.setup ? { setup: o.setup } : {}), ...(o.checks ? { checks: [{ name: "tests", command: o.checks }] } : {}), madeAt: new Date().toISOString() }, null, 2)}\n`,
    );
    mkdirSync(dirname(out), { recursive: true });
    cpSync(stage, out, { recursive: true });
    return { dir: out, sha, parent, testFiles, sourceFiles, deleted, failToPass: spec.failToPass, passToPass: spec.passToPass, promptFrom: o.prompt ? "given" : "commit message" };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The seed with the reference change applied, in a new folder: its files laid over, its deleted files removed. */
export function applyReference(seed: string, reference: string, into: string): void {
  cpSync(seed, into, { recursive: true });
  overlay(join(reference, "files"), into);
  const gone = existsSync(join(reference, "deleted.txt")) ? readFileSync(join(reference, "deleted.txt"), "utf8").split("\n").filter(Boolean) : [];
  for (const f of gone) rmSync(join(into, f), { force: true });
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const a: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith("--")) throw new Error(`Unexpected argument "${k}"`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k.slice(2)] = true;
    else {
      a[k.slice(2)] = next;
      i++;
    }
  }
  return a;
}

function main(): number {
  const a = parseArgs(process.argv.slice(2));
  const need = (k: string): string => {
    const v = a[k];
    if (typeof v !== "string") throw new Error(`--${k} is required (see the top of evals/make-task.ts)`);
    return v;
  };
  const runner = need("runner");
  if (!["node", "pytest", "cargo"].includes(runner)) throw new Error(`--runner is node, pytest or cargo, not "${runner}"`);
  const made = makeTask({
    repo: need("repo"),
    commit: need("commit"),
    name: need("name"),
    runner: runner as Runner,
    testCommand: need("test-cmd"),
    setup: typeof a.setup === "string" ? a.setup : undefined,
    kind: typeof a.kind === "string" ? a.kind : undefined,
    language: typeof a.language === "string" ? a.language : undefined,
    prompt: typeof a["prompt-file"] === "string" ? readFileSync(a["prompt-file"], "utf8") : typeof a.prompt === "string" ? a.prompt : undefined,
    tests: typeof a.tests === "string" ? a.tests.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    out: typeof a.out === "string" ? a.out : undefined,
    noRun: a["no-run"] === true,
    checks: typeof a.checks === "string" ? a.checks : undefined,
  });
  console.log(`Task written to ${made.dir}
  seed: ${made.parent.slice(0, 10)}  reference: ${made.sha.slice(0, 10)}
  test files laid over to grade: ${made.testFiles.join(", ")}
  reference changes: ${made.sourceFiles.length} files written, ${made.deleted.length} deleted
  fail-to-pass: ${made.failToPass.length}   pass-to-pass: ${made.passToPass.length}
  prompt.md is ${made.promptFrom === "given" ? "the text you gave" : "the commit message"}: read it, and cut anything that gives the solution away.
Next: node evals/validate-task.ts ${made.dir}`);
  return 0;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`make-task: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
