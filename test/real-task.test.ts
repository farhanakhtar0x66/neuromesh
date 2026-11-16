// Plan item M1: make-task.ts and validate-task.ts, end to end on a small synthetic git repository.
// No model calls. The repository is a tiny Node project whose tests use node --test.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { makeTask, isTestPath } from "../evals/make-task.ts";
import { validateTask } from "../evals/validate-task.ts";
import { commandFor, parseResults } from "../evals/real-task/grade.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-real-task-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function put(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: "pipe" });

const TEST_HEAD = `import { test } from "node:test";\nimport assert from "node:assert/strict";\n`;

/**
 * Commit 1: a clamp() that forgets the lower bound, an add(), and a test for add().
 * Commit 2 (the change): clamp() fixed, a deleted helper, a new test for clamp's lower bound and a test
 * that passes or fails by an environment variable (to show what a flaky check does to validate-task).
 */
function syntheticRepo(): { dir: string; fix: string } {
  const dir = join(scratch, "origin");
  put(dir, {
    "package.json": JSON.stringify({ name: "demo", type: "module" }),
    "src/math.js": `export const add = (a, b) => a + b;\nexport const clamp = (x, lo, hi) => Math.min(x, hi);\n`,
    "src/old-helper.js": `export const unused = 1;\n`,
    "test/add.test.js": `${TEST_HEAD}import { add } from "../src/math.js";\ntest("adds", () => assert.equal(add(1, 2), 3));\n`,
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "clamp, add");
  put(dir, {
    "src/math.js": `export const add = (a, b) => a + b;\nexport const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi));\n`,
    "test/clamp.test.js":
      `${TEST_HEAD}import { existsSync, readFileSync, writeFileSync } from "node:fs";\nimport { clamp } from "../src/math.js";\n` +
      `test("clamps the lower bound", () => assert.equal(clamp(-5, 0, 10), 0));\n` +
      `test("clamps the upper bound", () => assert.equal(clamp(50, 0, 10), 10));\n` +
      `test("a flaky one", () => {\n  const f = process.env.FLAKE_FILE;\n  if (!f) return;\n  const n = existsSync(f) ? Number(readFileSync(f, "utf8")) : 0;\n  writeFileSync(f, String(n + 1));\n  assert.ok(n % 2 === 0);\n});\n`,
  });
  rmSync(join(dir, "src/old-helper.js"));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "Fix clamp: values below the lower bound were not clamped\n\nclamp(-5, 0, 10) returned -5.");
  return { dir, fix: git(dir, "rev-parse", "HEAD").trim() };
}

const made = (() => {
  const { dir, fix } = syntheticRepo();
  return { dir, fix, task: join(scratch, "task-clamp") };
})();

test("M1: make-task turns a commit into a task folder with the recipe's parts", () => {
  const t = makeTask({ repo: made.dir, commit: made.fix, name: "clamp", runner: "node", testCommand: "node --test", kind: "bug", language: "javascript", out: made.task });
  assert.equal(t.sha, made.fix);
  assert.deepEqual(t.testFiles, ["test/clamp.test.js"]);
  assert.deepEqual(t.sourceFiles, ["src/math.js"]);
  assert.deepEqual(t.deleted, ["src/old-helper.js"]);
  assert.equal(t.promptFrom, "commit message");
  // The seed is the parent: the bug is there, the new test is not.
  assert.match(readFileSync(join(made.task, "seed/src/math.js"), "utf8"), /Math\.min\(x, hi\)/);
  assert.ok(!existsSync(join(made.task, "seed/test/clamp.test.js")));
  assert.ok(existsSync(join(made.task, "seed/src/old-helper.js")));
  // The reference is the change; the hidden tests are the ones that came with it.
  assert.match(readFileSync(join(made.task, "reference/files/src/math.js"), "utf8"), /Math\.max\(lo/);
  assert.equal(readFileSync(join(made.task, "reference/deleted.txt"), "utf8"), "src/old-helper.js\n");
  assert.ok(existsSync(join(made.task, "hidden/tests/test/clamp.test.js")));
  assert.match(readFileSync(join(made.task, "reference/change.patch"), "utf8"), /Math\.max\(lo/);
  assert.match(readFileSync(join(made.task, "prompt.md"), "utf8"), /Fix clamp: values below the lower bound/);
  const task = JSON.parse(readFileSync(join(made.task, "task.json"), "utf8")) as { hiddenCheck: string; kind: string; source: { commit: string } };
  assert.equal(task.hiddenCheck, "node hidden/grade.ts");
  assert.equal(task.kind, "bug");
  assert.equal(task.source.commit, made.fix);
  // The two lists come from running the project's tests before and after.
  assert.deepEqual(t.failToPass, ["clamps the lower bound"]);
  assert.deepEqual(t.passToPass, ["a flaky one", "adds", "clamps the upper bound"]);
});

test("M1: make-task refuses a name that already exists, and a commit with no test", () => {
  assert.throws(() => makeTask({ repo: made.dir, commit: made.fix, name: "clamp", runner: "node", testCommand: "node --test", out: made.task }), /already exists/);
  assert.throws(() => makeTask({ repo: made.dir, commit: made.fix, name: "x", runner: "node", testCommand: "node --test", tests: ["nothing/**"], out: join(scratch, "x") }), /changes no test file/);
  assert.throws(() => makeTask({ repo: made.dir, commit: "HEAD~1", name: "root", runner: "node", testCommand: "node --test", out: join(scratch, "root") }), /no parent/);
});

test("M1: validate-task passes a good task (fails on the seed, passes three times on the reference)", () => {
  const v = validateTask(made.task, { runs: 3 });
  assert.ok(v.ok, v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" | "));
  assert.ok(v.checks.length >= 7);
});

test("M1: the grader (hidden/grade.ts) scores a workspace: the seed fails it, the reference change passes it", () => {
  const seedWs = join(scratch, "ws-seed");
  cpSync(join(made.task, "seed"), seedWs, { recursive: true });
  cpSync(join(made.task, "hidden"), join(seedWs, "hidden"), { recursive: true });
  const run = (cwd: string): { code: number; out: string } => {
    try {
      return { code: 0, out: execFileSync("node", ["hidden/grade.ts"], { cwd, encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      return { code: (e as { status: number }).status, out: String((e as { stdout: string }).stdout) };
    }
  };
  const before = run(seedWs);
  assert.equal(before.code, 1);
  assert.match(before.out, /FAIL fail-to-pass: clamps the lower bound/);
  assert.match(before.out, /SCORE 3\/4/);
  const fixed = join(scratch, "ws-fixed");
  cpSync(seedWs, fixed, { recursive: true });
  cpSync(join(made.task, "reference/files/src/math.js"), join(fixed, "src/math.js"));
  const after = run(fixed);
  assert.equal(after.code, 0, after.out);
  assert.match(after.out, /SCORE 4\/4/);
});

test("M1: validate-task rejects a task whose reference does not fix it, whose seed already passes, and a flaky one", () => {
  // A reference that does not fix the bug.
  const bad = join(scratch, "task-bad-reference");
  cpSync(made.task, bad, { recursive: true });
  writeFileSync(join(bad, "reference/files/src/math.js"), `export const add = (a, b) => a + b;\nexport const clamp = (x, lo, hi) => Math.min(x, hi);\n`);
  const a = validateTask(bad, { runs: 1 });
  assert.equal(a.ok, false);
  assert.ok(a.checks.some((c) => !c.ok && /on the reference/.test(c.name)));

  // A seed that already passes: the "failing" test was never failing.
  const easy = join(scratch, "task-easy-seed");
  cpSync(made.task, easy, { recursive: true });
  cpSync(join(made.task, "reference/files/src/math.js"), join(easy, "seed/src/math.js"));
  const b = validateTask(easy, { runs: 1 });
  assert.equal(b.ok, false);
  assert.ok(b.checks.some((c) => !c.ok && /on the seed, every fail-to-pass test fails/.test(c.name)));

  // A flaky test: it alternates between runs when FLAKE_FILE names a counter.
  const flaky = join(scratch, "task-flaky");
  cpSync(made.task, flaky, { recursive: true });
  const spec = JSON.parse(readFileSync(join(flaky, "hidden/spec.json"), "utf8")) as { passToPass: string[] };
  assert.ok(spec.passToPass.includes("a flaky one"));
  process.env.FLAKE_FILE = join(scratch, "flake-counter");
  try {
    const c = validateTask(flaky, { runs: 3 });
    assert.equal(c.ok, false);
    assert.ok(c.checks.some((x) => !x.ok && /(changes its result|every named test passes)/.test(x.name)), JSON.stringify(c.checks.filter((x) => !x.ok)));
  } finally {
    delete process.env.FLAKE_FILE;
  }
});

test("M1: validate-task says what is missing from a folder that is not a task", () => {
  const v = validateTask(join(scratch, "no-such-task"));
  assert.equal(v.ok, false);
  assert.match(v.checks[0]!.detail ?? "", /seed/);
});

test("M1: test files are found by the usual places and names, or by globs", () => {
  for (const p of ["test/a.js", "tests/x/y.py", "src/__tests__/a.ts", "lib/a.test.ts", "pkg/test_util.py", "src/util_test.go"]) assert.equal(isTestPath(p), true, p);
  for (const p of ["src/a.js", "latest/notes.md", "src/contest.py"]) assert.equal(isTestPath(p), false, p);
  assert.equal(isTestPath("spec_files/a.rb", ["spec_files/**"]), true);
  assert.equal(isTestPath("test/a.js", ["spec_files/**"]), false);
});

test("M1: the runners' output is read into one result per test", () => {
  const tap = ["TAP version 13", "# Subtest: math", "    ok 1 - adds", "    not ok 2 - clamps", "ok 3 - skipped one # SKIP no", "not ok 1 - math", "1..1"].join("\n");
  assert.deepEqual([...parseResults("node", tap)], [["math > adds", true], ["math > clamps", false], ["math", false]]);
  const py = ["PASSED tests/test_a.py::test_one", "FAILED tests/test_a.py::test_two - assert 1 == 2", "ERROR tests/test_b.py::test_three"].join("\n");
  assert.deepEqual([...parseResults("pytest", py)], [["tests/test_a.py::test_one", true], ["tests/test_a.py::test_two", false], ["tests/test_b.py::test_three", false]]);
  const rust = ["running 3 tests", "test util::adds ... ok", "test util::clamps ... FAILED", "test util::slow ... ignored"].join("\n");
  assert.deepEqual([...parseResults("cargo", rust)], [["util::adds", true], ["util::clamps", false]]);
  assert.equal(commandFor("node", "node --test test/"), "node --test --test-reporter=tap test/");
  assert.equal(commandFor("pytest", "python3 -m pytest tests/"), "python3 -m pytest -rA -p no:cacheprovider tests/");
  assert.equal(commandFor("cargo", "cargo test"), "cargo test");
});

test("M1: make-batch builds every task in a manifest from its prompt file, validates it, and fails on a task that is not valid", () => {
  const batch = join(scratch, "batch");
  mkdirSync(join(batch, "prompts"), { recursive: true });
  writeFileSync(join(batch, "prompts", "clamp.md"), "clamp() lets values below the lower bound through.\n");
  writeFileSync(join(batch, "prompts", "other.md"), "x\n");
  const entry = (name: string, extra: object = {}) => ({ name, repo: made.dir, commit: made.fix, kind: "bug", language: "javascript", runner: "node", testCommand: "node --test", ...extra });
  const manifest = join(batch, "batch.json");
  writeFileSync(manifest, JSON.stringify([entry("clamp")]));
  const root = join(scratch, "batch-out");
  const run = (): { code: number; out: string } => {
    try {
      return { code: 0, out: execFileSync("node", ["evals/make-batch.ts", manifest, "--out-root", root], { encoding: "utf8", stdio: "pipe", env: { ...process.env, NODE_TEST_CONTEXT: "" } }) };
    } catch (e) {
      return { code: (e as { status: number }).status, out: String((e as { stdout: string }).stdout) };
    }
  };
  const first = run();
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /valid\s+clamp\s+bug\s+fail-to-pass\s+1\s+pass-to-pass\s+3/);
  assert.match(first.out, /every task is valid/);
  assert.equal(readFileSync(join(root, "clamp", "prompt.md"), "utf8").trim(), "clamp() lets values below the lower bound through.");
  // A task whose commit has no test cannot be made: the batch reports it and fails.
  writeFileSync(manifest, JSON.stringify([entry("clamp"), entry("other", { commit: "HEAD~1" })]));
  const second = run();
  assert.equal(second.code, 1);
  assert.match(second.out, /FAILED\s+other/);
});

test("M1: the eval runner runs a real-repository task folder, grades it with its hidden grader, and records the result (fake backend, no model calls)", async () => {
  const { runEval, loadTasks } = await import("../src/eval/eval.ts");
  const { referenceBackend } = await import("../src/eval/reference.ts");
  const { createFakeBackend } = await import("../src/backends/fake.ts");
  const { loadPreset } = await import("../src/presets/presets.ts");
  const { readRecord, select } = await import("../src/record/record.ts");
  const suite = join(scratch, "suite");
  cpSync(made.task, join(suite, "clamp"), { recursive: true });
  const tasks = loadTasks(suite);
  assert.deepEqual(tasks.map((t) => [t.name, t.kind, t.hiddenCheck]), [["clamp", "bug", "node hidden/grade.ts"]]);
  const preset = loadPreset("solo-haiku");
  const run = async (name: string, backend: ReturnType<typeof referenceBackend>, home: string) =>
    runEval({ name, preset, tasks, ctx: { home, backends: { claude: backend }, onEvent: () => {}, turnTimeoutMs: 60_000 }, onTaskStart: (t) => { current = t; } });
  let current: { dir: string } | undefined;
  // The reference solves it: the hidden grader passes, with its score of fail-to-pass plus pass-to-pass.
  const home = join(scratch, "eval-home");
  const solved = await run("solved", referenceBackend(() => current), home);
  assert.equal(solved.results.clamp!.hidden, "pass");
  assert.deepEqual(solved.results.clamp!.score, { passed: 4, total: 4 });
  const lines = select(readRecord(home), { kind: "result" }) as { name: string; task: string; passed?: number; total?: number; src: string }[];
  assert.deepEqual(lines.map((l) => [l.name, l.task, l.passed, l.total, l.src]), [["solved", "clamp", 4, 4, "eval"]]);
  // A backend that changes nothing leaves the bug: the fail-to-pass test fails, and the result says so.
  const idle = createFakeBackend((req) => ("status" in ((req.outputSchema?.properties ?? {}) as object) ? { structured: { status: "done", summary: "nothing", notes: "", run: "" } } : { structured: {} }), "claude");
  const unsolved = await run("unsolved", idle, join(scratch, "eval-home-2"));
  assert.equal(unsolved.results.clamp!.hidden, "fail");
  assert.deepEqual(unsolved.results.clamp!.score, { passed: 3, total: 4 });
});
