// Grading a real-repository task (plan item M1): run the project's own tests, with the tests that
// came with the change laid over the workspace, and say which of the named tests pass.
//
// This one file is used three ways: by make-task.ts (to find which tests fail before the change
// and pass after), by validate-task.ts (to check a task before it counts), and, copied into a
// task's hidden/ folder as grade.ts, as the hidden check itself:
//
//   node hidden/grade.ts        (run in the workspace; exits 0 only if every named test passes)
//
// No dependencies. Node runs it directly. Test runners understood: node --test, pytest, cargo test.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Runner = "node" | "pytest" | "cargo";

export interface TestSpec {
  runner: Runner;
  /** The command that runs the tests, as one would type it in the repository root: "node --test", "pytest tests/", "cargo test". */
  testCommand: string;
  /** Run once before the tests in a fresh workspace (install dependencies). */
  setup?: string;
  timeoutSec?: number;
}

export interface TaskSpec extends TestSpec {
  failToPass: string[];
  passToPass: string[];
}

export interface TestRun {
  /** Test id to whether it passed. Empty when the command produced nothing readable. */
  results: Map<string, boolean>;
  exitCode: number | null;
  output: string;
}

/** The command with the flag that makes the runner print one line per test. */
export function commandFor(runner: Runner, testCommand: string): string {
  if (runner === "node") return /--test-reporter/.test(testCommand) ? testCommand : testCommand.replace(/--test\b(?!-)/, "--test --test-reporter=tap");
  if (runner === "pytest") return /\s-rA\b/.test(testCommand) ? testCommand : testCommand.replace(/pytest\b/, "pytest -rA -p no:cacheprovider");
  return testCommand;
}

/** One id per test from the runner's output. A suite that contains tests is a test too: it passes if they all do. */
export function parseResults(runner: Runner, output: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const add = (id: string, ok: boolean): void => {
    let key = id.trim();
    for (let n = 2; out.has(key); n++) key = `${id.trim()} #${n}`;
    out.set(key, ok);
  };
  if (runner === "node") {
    // TAP: "# Subtest: name" opens a suite at an indent; "ok N - name" / "not ok N - name" closes a test.
    const stack: string[] = [];
    for (const line of output.split("\n")) {
      const sub = /^(\s*)# Subtest: (.*)$/.exec(line);
      if (sub) {
        stack[sub[1]!.length / 4] = sub[2]!.trim();
        continue;
      }
      const m = /^(\s*)(not )?ok \d+ - (.*?)(?:\s+# (?:SKIP|TODO).*)?$/.exec(line);
      if (!m || /\s# (SKIP|TODO)/.test(line)) continue;
      const level = m[1]!.length / 4;
      add([...stack.slice(0, level), m[3]!].join(" > "), m[2] === undefined);
    }
  } else if (runner === "pytest") {
    for (const line of output.split("\n")) {
      const m = /^(PASSED|FAILED|ERROR) (\S+)/.exec(line);
      if (m) add(m[2]!, m[1] === "PASSED");
    }
  } else {
    for (const line of output.split("\n")) {
      const m = /^test (\S+) \.\.\. (ok|FAILED)\b/.exec(line);
      if (m) add(m[1]!, m[2] === "ok");
    }
  }
  return out;
}

/** Copy every file under `from` into `to`, keeping paths; returns the relative paths written. */
export function overlay(from: string, to: string): string[] {
  const written: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const rel = relative(from, path);
        mkdirSync(dirname(join(to, rel)), { recursive: true });
        cpSync(path, join(to, rel));
        written.push(rel);
      }
    }
  };
  if (existsSync(from)) walk(from);
  return written.sort();
}

function sh(dir: string, command: string, timeoutSec: number): { code: number | null; output: string } {
  // NODE_TEST_CONTEXT is set inside a node --test child; left in, a project's own `node --test` would report to it instead of printing.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", NO_COLOR: "1" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8", timeout: timeoutSec * 1000, maxBuffer: 128 * 1024 * 1024, env });
  return { code: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run the project's tests in `dir` (set up first, if the spec says so). */
export function runTests(dir: string, spec: TestSpec): TestRun {
  const timeout = spec.timeoutSec ?? 600;
  if (spec.setup) {
    const s = sh(dir, spec.setup, timeout);
    if (s.code !== 0) return { results: new Map(), exitCode: s.code, output: `setup failed:\n${s.output}` };
  }
  const r = sh(dir, commandFor(spec.runner, spec.testCommand), timeout);
  return { results: parseResults(spec.runner, r.output), exitCode: r.code, output: r.output };
}

export interface Grade {
  pass: boolean;
  failToPass: Record<string, boolean>;
  passToPass: Record<string, boolean>;
}

/** Lay the hidden tests over `dir`, run, and look the named tests up. A named test that did not run counts as failed. */
export function grade(dir: string, hiddenTests: string, spec: TaskSpec): Grade & { output: string } {
  overlay(hiddenTests, dir);
  const run = runTests(dir, spec);
  const look = (ids: string[]): Record<string, boolean> => Object.fromEntries(ids.map((id) => [id, run.results.get(id) === true]));
  const failToPass = look(spec.failToPass);
  const passToPass = look(spec.passToPass);
  return { pass: Object.values(failToPass).every(Boolean) && Object.values(passToPass).every(Boolean), failToPass, passToPass, output: run.output };
}

function main(): number {
  const spec = JSON.parse(readFileSync(join("hidden", "spec.json"), "utf8")) as TaskSpec;
  const g = grade(process.cwd(), join("hidden", "tests"), spec);
  for (const [id, ok] of Object.entries(g.failToPass)) console.log(`${ok ? "PASS" : "FAIL"} fail-to-pass: ${id}`);
  for (const [id, ok] of Object.entries(g.passToPass)) console.log(`${ok ? "PASS" : "FAIL"} pass-to-pass: ${id}`);
  const all = [...Object.values(g.failToPass), ...Object.values(g.passToPass)];
  console.log(`SCORE ${all.filter(Boolean).length}/${all.length}`);
  return g.pass ? 0 : 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href && fileURLToPath(import.meta.url).endsWith("grade.ts")) process.exitCode = main();
