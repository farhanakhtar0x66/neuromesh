import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import { detectChecks, failureSignature } from "../src/checks/checks.ts";
import { applyRun, discardRun } from "../src/engine/apply.ts";
import { resumeRun, startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { loadState, saveState } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { Preset } from "../src/presets/presets.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-engine-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

function makeRepo(files: Record<string, string>): string {
  const dir = join(scratch, `repo-${++counter}`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

/** A project whose test passes only when fixed.txt says "ok". */
function fixableRepo(extra: Record<string, string> = {}): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js":
      "const fs=require('fs');const ok=fs.existsSync('fixed.txt')&&fs.readFileSync('fixed.txt','utf8').trim()==='ok';if(!ok){console.error('expected fixed.txt to say ok');process.exit(1)}",
    ...extra,
  });
}

const preset: Preset = {
  name: "test",
  description: "",
  mode: "solo",
  worker: { backend: "fake", model: "fake-model" },
  repairs: 1,
  turnTimeoutMinutes: 1,
};

function context(script: FakeScript, extra: Partial<EngineContext> = {}) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const ctx: EngineContext = {
    home: join(scratch, `home-${++counter}`),
    backends: { fake },
    onEvent: (e) => events.push(e),
    turnTimeoutMs: 5_000,
    ...extra,
  };
  return { ctx, fake, events };
}

const report = (summary: string) => ({ structured: { status: "done", summary, notes: "" } });

function writeFixed(cwd: string, text: string): void {
  writeFileSync(join(cwd, "fixed.txt"), text + "\n");
}

test("a run goes from prompt to a checked diff, and apply brings it home", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    writeFixed(req.cwd, "ok");
    return report("wrote fixed.txt");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.baseline?.[0]?.status, "failed");
  assert.equal(state.latest?.[0]?.status, "passed");
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.outcome?.files.map((f) => f.path), ["fixed.txt"]);
  assert.equal(state.report?.summary, "wrote fixed.txt");
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.cwd, state.worktree);
  assert.equal(fake.calls[0]!.access, "write");
  assert.match(fake.calls[0]!.prompt, /make the test pass/);
  assert.match(fake.calls[0]!.prompt, /npm test/);
  assert.ok(!existsSync(join(repo, "fixed.txt")), "the user's files are untouched during a run");
  assert.deepEqual(
    events.map((e) => e.type).filter((t) => t !== "agent.activity"),
    ["run.started", "workspace.ready", "checks.detected", "checks.finished", "agent.started", "agent.finished", "checks.finished", "run.finished"],
  );

  const applied = applyRun(loadState(state.dir));
  assert.equal(applied.files, 1);
  assert.equal(readFileSync(join(repo, "fixed.txt"), "utf8"), "ok\n");
  assert.ok(!existsSync(state.worktree), "the worktree is removed after apply");
  const branches = execFileSync("git", ["branch", "--list", "neuromesh/*"], { cwd: repo, encoding: "utf8" });
  assert.equal(branches.trim(), "");
  assert.equal(loadState(state.dir).status, "applied");
});

test("failing checks get a repair turn in the same session", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req, i) => {
    writeFixed(req.cwd, i === 0 ? "nope" : "ok");
    return report(i === 0 ? "first try" : "fixed it");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.outcome?.checks, "passed");
  assert.equal(state.round, 1);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair"]);
  assert.equal(fake.calls[1]!.resumeSessionId, "fake-session-0");
  assert.match(fake.calls[1]!.prompt, /Check "test"/);
  assert.match(fake.calls[1]!.prompt, /expected fixed.txt to say ok/);
  assert.match(fake.calls[1]!.prompt, /already failing before you started/);
});

test("when repairs run out the run finishes with failing checks, and apply needs --force", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req) => {
    writeFixed(req.cwd, "nope");
    return report("tried");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset, repairs: 2 }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.outcome?.checks, "failed");
  assert.equal(fake.calls.length, 3);
  assert.throws(() => applyRun(state), /failing checks/);
  assert.equal(applyRun(state, { force: true }).files, 1);
});

test("a subscription limit pauses the run; resume continues with a fresh session", async () => {
  const repo = fixableRepo();
  const first = context(() => ({ stop: "quota", detail: "You've hit your usage limit." }));
  const paused = await startRun({ cwd: repo, prompt: "make the test pass", preset }, first.ctx);
  assert.equal(paused.status, "paused");
  assert.match(paused.reason ?? "", /usage limit/);
  assert.equal(loadState(paused.dir).status, "paused");

  const second = createFakeBackend((req) => {
    writeFixed(req.cwd, "ok");
    return report("done after the pause");
  });
  const resumed = await resumeRun(loadState(paused.dir), { ...first.ctx, backends: { fake: second } });
  assert.equal(resumed.status, "finished");
  assert.equal(resumed.outcome?.checks, "passed");
  assert.equal(second.calls[0]!.resumeSessionId, undefined);
  assert.match(second.calls[0]!.prompt, /interrupted part way/);
  assert.deepEqual(resumed.attempts.map((a) => [a.kind, a.stop]), [
    ["initial", "quota"],
    ["continue", "done"],
  ]);
});

test("cancelling interrupts the run, and it can be resumed", async () => {
  const repo = fixableRepo();
  const controller = new AbortController();
  const first = context(() => new Promise(() => {}), { signal: controller.signal });
  setTimeout(() => controller.abort(), 300);
  const stopped = await startRun({ cwd: repo, prompt: "make the test pass", preset }, first.ctx);
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.pid, undefined);

  const second = createFakeBackend((req) => {
    writeFixed(req.cwd, "ok");
    return report("finished");
  });
  const resumed = await resumeRun(loadState(stopped.dir), { ...first.ctx, signal: undefined, backends: { fake: second } });
  assert.equal(resumed.status, "finished");
});

test("a run left 'running' by a crashed engine can be resumed", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    writeFixed(req.cwd, "ok");
    return report("ok");
  });
  const done = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  // Pretend the engine died mid-turn: state says running, owned by a dead process.
  const crashed = loadState(done.dir);
  crashed.status = "running";
  crashed.step = "agent";
  crashed.pid = 999_999;
  crashed.outcome = undefined;
  crashed.attempts = [];
  crashed.inFlight = { role: "worker", tier: "worker", kind: "initial", round: 0, backend: "fake", startedAt: new Date().toISOString() };
  saveState(crashed);
  const resumed = await resumeRun(loadState(done.dir), ctx);
  assert.equal(resumed.status, "finished");
  assert.equal(resumed.outcome?.checks, "passed");
  assert.deepEqual(resumed.attempts.map((a) => [a.kind, a.stop]), [
    ["initial", "cancelled"],
    ["continue", "done"],
  ]);
  assert.deepEqual(resumed.attempts[0]!.usage, {}, "a lost turn's usage stays unknown");
  assert.equal(resumed.inFlight, undefined);
});

test("an engine error is recorded as Neuromesh's fault and never left running", async () => {
  const repo = fixableRepo();
  const { ctx } = context(() => report("unused"));
  const state = await startRun({ cwd: repo, prompt: "x", preset, worker: { backend: "missing" } }, ctx);
  assert.equal(state.status, "failed");
  assert.equal(state.failure, "engine");
  assert.match(state.reason ?? "", /unknown backend "missing"/);
  assert.equal(loadState(state.dir).pid, undefined);
});

test("an agent failure is recorded as the agent's fault", async () => {
  const repo = fixableRepo();
  const { ctx } = context(() => ({ stop: "permission", detail: "user denied permission to run command" }));
  const state = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  assert.equal(state.status, "failed");
  assert.equal(state.failure, "agent");
  assert.match(state.reason ?? "", /permission/);
});

test("a check whose tool is missing is skipped instead of blocking the run", async () => {
  const repo = fixableRepo({
    "neuromesh.json": JSON.stringify({
      checks: [
        { name: "lint", command: "nm-no-such-linter --check" },
        { name: "test", command: "node check.js" },
      ],
    }),
  });
  const { ctx, events } = context((req) => {
    writeFixed(req.cwd, "ok");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  assert.deepEqual(state.checks.map((c) => c.name), ["test"]);
  assert.equal(state.baseline?.find((r) => r.name === "lint")?.status, "unavailable");
  assert.ok(events.some((e) => e.type === "note" && /lint/.test(String(e.message))));
  assert.equal(state.outcome?.checks, "passed");
});

test("installed dependencies are copied in but never part of the diff; uncommitted work is flagged", async () => {
  const repo = fixableRepo({ ".gitignore": "node_modules/\n" });
  mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(repo, "scratch.txt"), "uncommitted\n");
  const { ctx, events, fake } = context((req) => {
    assert.ok(existsSync(join(req.cwd, "node_modules", "dep", "index.js")), "dependencies are present for the agent");
    assert.ok(!existsSync(join(req.cwd, "scratch.txt")), "uncommitted files are not in the run");
    writeFixed(req.cwd, "ok");
    writeFileSync(join(req.cwd, "node_modules", "dep", "extra.js"), "changed by the agent\n");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  assert.equal(state.reason, undefined);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(state.prepared, ["node_modules"]);
  assert.deepEqual(state.outcome?.files.map((f) => f.path), ["fixed.txt"]);
  assert.ok(events.some((e) => e.type === "note" && /uncommitted/.test(String(e.message))));
  assert.ok(!existsSync(join(repo, "node_modules", "dep", "extra.js")), "the user's node_modules is untouched");
});

test("an agent that commits its work is still captured in the diff", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    writeFixed(req.cwd, "ok");
    execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qam", "x", "--allow-empty"], { cwd: req.cwd });
    execFileSync("git", ["add", "fixed.txt"], { cwd: req.cwd });
    execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", "agent commit"], { cwd: req.cwd });
    return report("committed");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  assert.deepEqual(state.outcome?.files.map((f) => f.path), ["fixed.txt"]);
  applyRun(state);
  assert.equal(readFileSync(join(repo, "fixed.txt"), "utf8"), "ok\n");
});

test("discard removes the worktree and branch; finished runs cannot be resumed", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    writeFixed(req.cwd, "ok");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset }, ctx);
  await assert.rejects(resumeRun(state, ctx), /nothing to resume/);
  discardRun(state);
  assert.ok(!existsSync(state.worktree));
  assert.equal(loadState(state.dir).status, "discarded");
  assert.ok(!existsSync(join(repo, "fixed.txt")));
});

test("a run outside a git repository explains what to do", async () => {
  const dir = mkdtempSync(join(scratch, "plain-"));
  const { ctx } = context(() => report("x"));
  await assert.rejects(startRun({ cwd: dir, prompt: "x", preset }, ctx), /git init/);
});

test("detectChecks finds the project's own commands", () => {
  const dir = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(scratch, "detect-"));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(d, p)), { recursive: true });
      writeFileSync(join(d, p), c);
    }
    return d;
  };
  assert.deepEqual(detectChecks(dir({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })), []);
  assert.deepEqual(
    detectChecks(dir({ "package.json": JSON.stringify({ scripts: { test: "vitest", lint: "eslint .", typecheck: "tsc" } }), "pnpm-lock.yaml": "" })),
    [
      { name: "typecheck", command: "pnpm run typecheck" },
      { name: "lint", command: "pnpm run lint" },
      { name: "test", command: "pnpm test" },
    ],
  );
  assert.deepEqual(detectChecks(dir({ "Cargo.toml": "[package]" })), [{ name: "test", command: "cargo test --quiet" }]);
  const python = detectChecks(dir({ "tests/test_x.py": "" }));
  assert.equal(python.length, 1);
  assert.match(python[0]!.command, /pytest/);
  assert.match(python[0]!.command, /unittest discover/);
});

test("failure signatures ignore timings and paths", () => {
  const a = "FAIL test/x.test.ts (12 ms)\nat /Users/a/tmp/run-1/src/x.ts:4:2\nexpected 1 got 2";
  const b = "FAIL test/x.test.ts (340 ms)\nat /Users/a/tmp/run-2/src/x.ts:4:2\nexpected 1 got 2";
  const c = "FAIL test/x.test.ts (12 ms)\nat /Users/a/tmp/run-1/src/x.ts:4:2\nexpected 1 got 3";
  assert.equal(failureSignature(a), failureSignature(b));
  assert.notEqual(failureSignature(a), failureSignature(c));
});
