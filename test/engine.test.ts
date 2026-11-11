import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { detectChecks, failureSignature } from "../src/checks/checks.ts";
import { applyRun, discardRun } from "../src/engine/apply.ts";
import { clearCooldowns } from "../src/engine/cooldown.ts";
import { resumeRun, startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { loadState, saveState } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain } from "../src/engine/types.ts";
import { route } from "../src/intake/intake.ts";
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

function preset(roles: RoleChain = {}, extra: Partial<Preset> = {}): Preset {
  return {
    name: "test",
    description: "",
    mode: "solo",
    roles: { worker: [{ backend: "fake", model: "fake-worker", tier: "worker" }], ...roles },
    repairs: 1,
    maxTasks: 4,
    maxParallel: 1,
    turnTimeoutMinutes: 1,
    intake: false,
    routing: "rules",
    advise: false,
    test: "always",
    ...extra,
  };
}

const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };
const TESTER = { backend: "fake", model: "fake-tester", tier: "worker" as const };

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
const isPlan = (r: AgentRequest): boolean => Boolean((r.outputSchema?.properties as Record<string, unknown> | undefined)?.tasks);
const isTest = (r: AgentRequest): boolean => Boolean((r.outputSchema?.properties as Record<string, unknown> | undefined)?.verdict);
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), text + "\n");

// ---------------------------------------------------------------------------
// Solo runs

test("a solo run goes from prompt to a checked diff, and apply brings it home", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    write(req.cwd, "fixed.txt", "ok");
    return report("wrote fixed.txt");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.mode, "solo");
  assert.equal(state.baseline?.[0]?.status, "failed");
  assert.equal(state.latest?.[0]?.status, "passed");
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.outcome?.files.map((f) => f.path), ["fixed.txt"]);
  assert.equal(state.tasks[0]?.report?.summary, "wrote fixed.txt");
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.access, "write");
  assert.match(fake.calls[0]!.prompt, /make the test pass/);
  assert.match(fake.calls[0]!.prompt, /npm test/);
  assert.ok(!existsSync(join(repo, "fixed.txt")), "the user's files are untouched during a run");
  assert.deepEqual(
    events.map((e) => e.type).filter((t) => t !== "agent.activity"),
    ["run.started", "workspace.ready", "checks.detected", "checks.finished", "task.started", "agent.started", "agent.finished", "checks.finished", "task.merged", "run.finished"],
  );

  const applied = applyRun(loadState(state.dir));
  assert.equal(applied.files, 1);
  assert.equal(readFileSync(join(repo, "fixed.txt"), "utf8"), "ok\n");
  assert.ok(!existsSync(state.worktree), "the worktree is removed after apply");
  const branches = execFileSync("git", ["branch", "--list", "neuromesh*"], { cwd: repo, encoding: "utf8" });
  assert.equal(branches.trim(), "");
  assert.equal(loadState(state.dir).status, "applied");
});

test("failing checks get a repair turn in the same session", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req, i) => {
    write(req.cwd, "fixed.txt", i === 0 ? "nope" : "ok");
    return report(i === 0 ? "first try" : "fixed it");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair"]);
  assert.equal(fake.calls[1]!.resumeSessionId, "fake-session-0");
  assert.match(fake.calls[1]!.prompt, /Check "test"/);
  assert.match(fake.calls[1]!.prompt, /expected fixed.txt to say ok/);
  assert.match(fake.calls[1]!.prompt, /already failing before the work started/);
});

test("the stagnation breaker stops a worker repeating itself; with no expert the run finishes with failing checks", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req) => {
    write(req.cwd, "fixed.txt", "nope");
    return report("tried");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({}, { repairs: 5 }) }, ctx);

  assert.equal(state.status, "finished");
  assert.equal(state.outcome?.checks, "failed");
  assert.equal(fake.calls.length, 2, "the second identical failure stops it, well before 5 repairs");
  assert.match(state.tasks[0]?.error ?? "", /repeated an earlier failed state/);
  assert.throws(() => applyRun(state), /failing checks/);
  assert.equal(applyRun(state, { force: true }).files, 1);
});

test("a subscription limit pauses the run; resume continues with a fresh session", async () => {
  const repo = fixableRepo();
  const first = context(() => ({ stop: "quota", detail: "You've hit your usage limit." }));
  const paused = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, first.ctx);
  assert.equal(paused.status, "paused");
  assert.match(paused.reason ?? "", /usage limit/);

  // Resuming before the reset would only pause again; pretend the limit has reset.
  clearCooldowns(first.ctx.home);
  const second = createFakeBackend((req) => {
    write(req.cwd, "fixed.txt", "ok");
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
  const first = context(
    () => {
      setTimeout(() => controller.abort(), 50);
      return new Promise(() => {});
    },
    { signal: controller.signal },
  );
  const stopped = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, first.ctx);
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.pid, undefined);
  assert.deepEqual(stopped.inFlight, {});

  const second = createFakeBackend((req) => {
    write(req.cwd, "fixed.txt", "ok");
    return report("finished");
  });
  const resumed = await resumeRun(loadState(stopped.dir), { ...first.ctx, signal: undefined, backends: { fake: second } });
  assert.equal(resumed.status, "finished");
  assert.match(second.calls[0]!.prompt, /interrupted part way/);
});

test("a run whose engine died mid-turn is resumed and the lost turn is recorded", async () => {
  const repo = fixableRepo();
  const controller = new AbortController();
  let snapshot = "";
  let dir = "";
  const first = context(
    (req) =>
      new Promise(() => {
        write(req.cwd, "fixed.txt", "half");
        // Capture run.json as a killed engine would leave it: mid-turn, owned by a live process.
        const runs = join(first.ctx.home, "projects");
        const found = execFileSync("find", [runs, "-name", "run.json"], { encoding: "utf8" }).trim().split("\n")[0]!;
        dir = dirname(found);
        snapshot = readFileSync(found, "utf8");
        controller.abort();
      }),
    { signal: controller.signal },
  );
  await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, first.ctx);
  const crashed = JSON.parse(snapshot);
  assert.equal(crashed.status, "running");
  assert.equal(Object.keys(crashed.inFlight).length, 1);
  crashed.pid = 999_999;
  saveState(crashed);

  const second = createFakeBackend((req) => {
    assert.equal(readFileSync(join(req.cwd, "fixed.txt"), "utf8"), "half\n", "the half-done work is still there");
    write(req.cwd, "fixed.txt", "ok");
    return report("finished it");
  });
  const resumed = await resumeRun(loadState(dir), { ...first.ctx, signal: undefined, backends: { fake: second } });
  assert.equal(resumed.status, "finished");
  assert.equal(resumed.outcome?.checks, "passed");
  assert.deepEqual(resumed.attempts.map((a) => [a.kind, a.stop]), [
    ["initial", "cancelled"],
    ["continue", "done"],
  ]);
  assert.deepEqual(resumed.attempts[0]!.usage, {}, "a lost turn's usage stays unknown");
});

test("an engine error is recorded as Neuromesh's fault and never left running", async () => {
  const repo = fixableRepo();
  const { ctx } = context(() => report("unused"));
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset(), worker: { backend: "missing" } }, ctx);
  assert.equal(state.status, "failed");
  assert.equal(state.failure, "engine");
  assert.match(state.reason ?? "", /unknown backend "missing"/);
  assert.equal(loadState(state.dir).pid, undefined);
});

test("an agent failure is recorded as the agent's fault", async () => {
  const repo = fixableRepo();
  const { ctx } = context(() => ({ stop: "permission", detail: "user denied permission to run command" }));
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
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
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
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
    write(req.cwd, "fixed.txt", "ok");
    writeFileSync(join(req.cwd, "node_modules", "dep", "extra.js"), "changed by the agent\n");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
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
    write(req.cwd, "fixed.txt", "ok");
    execFileSync("git", ["add", "fixed.txt"], { cwd: req.cwd });
    execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", "agent commit"], { cwd: req.cwd });
    return report("committed");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
  assert.deepEqual(state.outcome?.files.map((f) => f.path), ["fixed.txt"]);
  applyRun(state);
  assert.equal(readFileSync(join(repo, "fixed.txt"), "utf8"), "ok\n");
});

test("discard removes the worktrees and branches; finished runs cannot be resumed", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
  await assert.rejects(resumeRun(state, ctx), /nothing to resume/);
  discardRun(state);
  assert.ok(!existsSync(state.worktree));
  assert.equal(loadState(state.dir).status, "discarded");
  assert.equal(execFileSync("git", ["branch", "--list", "neuromesh*"], { cwd: repo, encoding: "utf8" }).trim(), "");
});

test("a run outside a git repository explains what to do", async () => {
  const dir = mkdtempSync(join(scratch, "plain-"));
  const { ctx } = context(() => report("x"));
  await assert.rejects(startRun({ cwd: dir, prompt: "x", preset: preset() }, ctx), /git init/);
});

// ---------------------------------------------------------------------------
// Team runs

/** Passes when a.txt and b.txt both say ok. */
function twoPartRepo(): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": "const fs=require('fs');const r=f=>fs.existsSync(f)&&fs.readFileSync(f,'utf8').trim()==='ok';if(!(r('a.txt')&&r('b.txt'))){console.error('need a.txt and b.txt');process.exit(1)}",
  });
}

const twoTaskPlan = (dependent: boolean) => ({
  structured: {
    summary: "two parts",
    tasks: [
      { id: "t1", title: "part a", brief: "Write a.txt containing ok.", owned: ["a.txt"], depends_on: [], owner: "worker" },
      { id: "t2", title: "part b", brief: "Write b.txt containing ok.", owned: ["b.txt"], depends_on: dependent ? ["t1"] : [], owner: "worker" },
    ],
  },
});

function workerFor(req: AgentRequest): void {
  if (/Write a\.txt/.test(req.prompt)) write(req.cwd, "a.txt", "ok");
  if (/Write b\.txt/.test(req.prompt)) write(req.cwd, "b.txt", "ok");
}

test("a team run: the expert plans, workers build in order, each task is merged", async () => {
  const repo = twoPartRepo();
  const { ctx, fake, events } = context((req) => {
    if (isPlan(req)) return twoTaskPlan(true);
    workerFor(req);
    return report("done");
  });
  const team = preset({ orchestrator: [EXPERT] }, { mode: "team" });
  const state = await startRun({ cwd: repo, prompt: "build a and b", preset: team }, ctx);

  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.tasks.map((t) => [t.id, t.status]), [["t1", "passed"], ["t2", "passed"]]);
  assert.deepEqual(state.attempts.map((a) => [a.role, a.tier, a.model]), [
    ["orchestrator", "expert", "fake-expert"],
    ["worker", "worker", "fake-worker"],
    ["worker", "worker", "fake-worker"],
  ]);
  assert.equal(fake.calls[0]!.access, "read-only");
  assert.match(fake.calls[0]!.prompt, /build a and b/);
  assert.match(fake.calls[1]!.prompt, /Your task: part a/);
  assert.doesNotMatch(fake.calls[1]!.prompt, /Write b\.txt/, "a worker only sees its own brief");
  assert.deepEqual(state.outcome?.files.map((f) => f.path).sort(), ["a.txt", "b.txt"]);
  assert.ok(events.some((e) => e.type === "plan.ready"));
  applyRun(state);
  assert.equal(readFileSync(join(repo, "b.txt"), "utf8"), "ok\n");
});

test("the tester's findings go back to the worker's session, and a pass lets the task merge", async () => {
  const repo = fixableRepo();
  let tests = 0;
  const { ctx, fake } = context((req) => {
    if (isTest(req)) {
      tests += 1;
      return tests === 1
        ? { structured: { verdict: "fail", summary: "not quite", findings: [{ problem: "fixed.txt lacks the word great", file: "fixed.txt", reproduce: "cat fixed.txt" }] } }
        : { structured: { verdict: "pass", summary: "good", findings: [] } };
    }
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ tester: [TESTER] }) }, ctx);

  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => [a.role, a.kind]), [
    ["worker", "initial"],
    ["tester", "test"],
    ["worker", "review-fix"],
    ["tester", "test"],
  ]);
  const fix = fake.calls[2]!;
  assert.equal(fix.resumeSessionId, "fake-session-0");
  assert.match(fix.prompt, /lacks the word great/);
  assert.match(fix.prompt, /cat fixed\.txt/);
  const testerCall = fake.calls[1]!;
  assert.notEqual(testerCall.cwd, state.tasks[0]!.worktree, "the tester works in a throwaway copy");
  assert.match(testerCall.prompt, /\+ok/, "the tester sees the diff");
  assert.equal(state.tasks[0]?.verdict?.verdict, "pass");
});

test("with test 'no-checks', the tester only runs when the project has no checks", async () => {
  const withChecks = fixableRepo();
  const a = context((req) => {
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const p = preset({ tester: [TESTER] }, { test: "no-checks" });
  await startRun({ cwd: withChecks, prompt: "x", preset: p }, a.ctx);
  assert.equal(a.fake.calls.filter(isTest).length, 0, "checks exist, so no tester");

  const noChecks = makeRepo({ "notes.md": "hello\n" });
  const b = context((req) => {
    if (isTest(req)) return { structured: { verdict: "pass", summary: "fine", findings: [] } };
    write(req.cwd, "notes.md", "hello world");
    return report("ok");
  });
  await startRun({ cwd: noChecks, prompt: "x", preset: p }, b.ctx);
  assert.equal(b.fake.calls.filter(isTest).length, 1, "no checks, so the tester reviews");
});

test("a stuck worker is escalated: the expert starts clean and sees diffs and failures, not the chat", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    if (req.model === "fake-expert") {
      assert.ok(!existsSync(join(req.cwd, "fixed.txt")), "the expert starts from the task's clean start");
      write(req.cwd, "fixed.txt", "ok");
      return report("expert fixed it");
    }
    write(req.cwd, "fixed.txt", "nope");
    return report("SECRET-WORKER-REASONING");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 3 }) }, ctx);

  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.equal(state.tasks[0]?.escalated, true);
  assert.deepEqual(state.attempts.map((a) => [a.role, a.kind, a.tier]), [
    ["worker", "initial", "worker"],
    ["worker", "repair", "worker"],
    ["escalation", "escalation", "expert"],
  ]);
  const expertPrompt = fake.calls[2]!.prompt;
  assert.match(expertPrompt, /\+nope/, "the autopsy carries the attempted diff");
  assert.match(expertPrompt, /expected fixed.txt to say ok/, "and the exact failure");
  assert.doesNotMatch(expertPrompt, /SECRET-WORKER-REASONING/, "but none of the worker's own words");
  assert.ok(events.some((e) => e.type === "task.escalated" && /repeated/.test(String(e.reason))));
});

const isAdvice = (r: AgentRequest): boolean => Boolean((r.outputSchema?.properties as Record<string, unknown> | undefined)?.diagnosis);

test("a stuck worker first gets the expert's advice and fixes the task itself", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "fixed.txt must contain exactly ok", steps: ["Write ok to fixed.txt"] } };
    write(req.cwd, "fixed.txt", /Diagnosis: fixed\.txt must contain exactly ok/.test(req.prompt) ? "ok" : "nope");
    return report("tried");
  });
  const state = await startRun(
    { cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true }) },
    ctx,
  );
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.equal(state.tasks[0]?.escalated, false, "the expert never took the task over");
  assert.deepEqual(state.attempts.map((a) => [a.role, a.kind, a.tier]), [
    ["worker", "initial", "worker"],
    ["worker", "repair", "worker"],
    ["escalation", "advice", "expert"],
    ["worker", "advised-fix", "worker"],
  ]);
  const adviceCall = fake.calls[2]!;
  assert.equal(adviceCall.access, "read-only", "the expert only reads");
  assert.match(adviceCall.prompt, /\+nope/, "and sees the failed attempt");
  assert.equal(fake.calls[3]!.resumeSessionId, "fake-session-1", "the worker continues its latest session");
  assert.ok(events.some((e) => e.type === "task.advised"));
});

test("when the advice does not help, the expert takes the task over", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "unclear", steps: ["try harder"] } };
    if (req.model === "fake-expert") {
      write(req.cwd, "fixed.txt", "ok");
      return report("expert did it");
    }
    write(req.cwd, "fixed.txt", "nope");
    return report("tried");
  });
  const state = await startRun(
    { cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true }) },
    ctx,
  );
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.equal(state.tasks[0]?.escalated, true);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair", "advice", "advised-fix", "escalation"]);
});

test("the expert budget stops expert help once spent", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "x", steps: ["y"] }, usage: { input: 900, output: 200 } };
    write(req.cwd, "fixed.txt", "nope");
    return report("tried");
  });
  const p = preset({ escalation: [EXPERT] }, { repairs: 1, advise: true, expertBudget: 1_000 });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: p }, ctx);
  assert.equal(state.status, "finished");
  assert.equal(state.outcome?.checks, "failed");
  assert.equal(fake.calls.filter((c) => c.model === "fake-expert").length, 1, "advice once, then the budget stops the takeover");
  assert.ok(events.some((e) => e.type === "note" && /Expert budget reached/.test(String(e.message))));
});

test("when the expert runs out of quota the next model in its list takes over", async () => {
  const repo = twoPartRepo();
  const { ctx, events } = context((req) => {
    if (req.model === "expert-a") return { stop: "quota", detail: "Individual quota reached." };
    if (isPlan(req)) return twoTaskPlan(true);
    workerFor(req);
    return report("done");
  });
  const team = preset(
    {
      orchestrator: [
        { backend: "fake", model: "expert-a", tier: "expert" },
        { backend: "fake", model: "expert-b", tier: "expert" },
      ],
    },
    { mode: "team" },
  );
  const state = await startRun({ cwd: repo, prompt: "build a and b", preset: team }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.exhausted, ["fake/expert-a"]);
  assert.equal(state.attempts.find((a) => a.role === "orchestrator" && a.stop === "done")?.model, "expert-b");
  assert.ok(events.some((e) => e.type === "model.exhausted" && e.next === "fake/expert-b"));
});

test("a model out of quota stays out for later runs until its reset time", async () => {
  const repo = fixableRepo();
  let calls = 0;
  const { ctx, events } = context((req) => {
    if (req.model === "limited") {
      calls += 1;
      return { stop: "quota", detail: "Individual quota reached. Resets in 4h55m56s." };
    }
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const p = preset({ worker: [{ backend: "fake", model: "limited" }, { backend: "fake", model: "fake-worker" }] });
  await startRun({ cwd: repo, prompt: "x", preset: p }, ctx);
  const second = await startRun({ cwd: repo, prompt: "x", preset: p }, ctx);
  assert.equal(second.status, "finished");
  assert.equal(calls, 1, "the second run does not try the limited model again");
  assert.ok(events.some((e) => e.type === "note" && /still out of quota/.test(String(e.message))));
  const until = Date.parse(JSON.parse(readFileSync(join(ctx.home, "cooldowns.json"), "utf8"))["fake/limited"].until);
  assert.ok(Math.abs(until - (Date.now() + 4 * 3_600_000 + 55 * 60_000 + 56_000)) < 60_000);
});

test("a dropped connection is retried once", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req, i) => {
    if (i === 0) return { stop: "error", detail: "The stream was interrupted. Please continue the task you were working on." };
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const state = await startRun({ cwd: repo, prompt: "x", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(fake.calls.length, 2);
});

test("a model that is no longer offered is skipped like an exhausted one", async () => {
  const repo = fixableRepo();
  const { ctx } = context((req) => {
    if (req.model === "gone") return { stop: "error", detail: "invalid model selection: model gone is not recognized as a known model" };
    write(req.cwd, "fixed.txt", "ok");
    return report("ok");
  });
  const p = preset({ worker: [{ backend: "fake", model: "gone" }, { backend: "fake", model: "fake-worker" }] });
  const state = await startRun({ cwd: repo, prompt: "x", preset: p }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.exhausted, ["fake/gone"]);
});

test("independent tasks run side by side, and the expert fixes a merged result that fails", async () => {
  // Each task alone passes; together they need c.txt, which only the integration fix adds.
  const repo = makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": "const fs=require('fs');if(fs.existsSync('a.txt')&&fs.existsSync('b.txt')&&!fs.existsSync('c.txt')){console.error('a and b need c');process.exit(1)}",
  });
  let running = 0;
  let overlap = false;
  const { ctx, events } = context(async (req) => {
    if (isPlan(req)) return twoTaskPlan(false);
    if (req.model === "fake-expert") {
      write(req.cwd, "c.txt", "glue");
      return report("added c");
    }
    running += 1;
    if (running > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 300));
    workerFor(req);
    running -= 1;
    return report("done");
  });
  const team = preset({ orchestrator: [EXPERT] }, { mode: "team", maxParallel: 2 });
  const state = await startRun({ cwd: repo, prompt: "build a and b", preset: team }, ctx);

  assert.equal(state.status, "finished", state.reason);
  assert.ok(overlap, "the two workers ran at the same time");
  assert.equal(state.integrationFixes, 1);
  assert.ok(events.some((e) => e.type === "integration.fix"));
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.outcome?.files.map((f) => f.path).sort(), ["a.txt", "b.txt", "c.txt"]);
  const fix = state.attempts.find((a) => a.kind === "integration");
  assert.equal(fix?.tier, "expert");
});

test("a task whose change conflicts with merged work is redone on top of it", async () => {
  const repo = makeRepo({ "package.json": JSON.stringify({ name: "demo", scripts: { test: "node -e 0" } }) });
  const { ctx, fake, events } = context(async (req) => {
    if (isPlan(req)) return twoTaskPlan(false);
    await new Promise((r) => setTimeout(r, 200));
    workerFor(req);
    // Both tasks also write the same file, which forces a conflict for whichever merges second.
    const mine = /a\.txt/.test(req.prompt.split("Your task:")[1] ?? "") ? "from a" : "from b";
    const shared = join(req.cwd, "shared.txt");
    write(req.cwd, "shared.txt", existsSync(shared) ? `${readFileSync(shared, "utf8").trim()} + ${mine}` : mine);
    return report("done");
  });
  const team = preset({ orchestrator: [EXPERT] }, { mode: "team", maxParallel: 2 });
  const state = await startRun({ cwd: repo, prompt: "build a and b", preset: team }, ctx);

  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.tasks.reduce((n, t) => n + t.conflicts, 0), 1);
  assert.ok(events.some((e) => e.type === "task.conflict"));
  const redo = fake.calls.find((c) => /no longer applies/.test(c.prompt));
  assert.ok(redo, "the conflicting task is redone");
  assert.match(redo.prompt, /shared\.txt/, "with its earlier diff for reference");
  applyRun(state);
  assert.match(readFileSync(join(repo, "shared.txt"), "utf8"), /from a \+ from b|from b \+ from a/, "both changes survive");
});

test("when planning fails outright, a worker takes the whole request", async () => {
  const repo = fixableRepo();
  const { ctx, events } = context((req) => {
    if (isPlan(req)) return { stop: "timeout", detail: "the planner hung" };
    write(req.cwd, "fixed.txt", "ok");
    return report("did it alone");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ orchestrator: [EXPERT] }, { mode: "team" }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.mode, "solo");
  assert.equal(state.outcome?.checks, "passed");
  assert.ok(events.some((e) => e.type === "note" && /Planning failed/.test(String(e.message))));
});

test("a plan that breaks the rules is sent back once for correction", async () => {
  const repo = twoPartRepo();
  let plans = 0;
  const { ctx, fake } = context((req) => {
    if (isPlan(req)) {
      plans += 1;
      if (plans === 1) {
        return { structured: { summary: "loop", tasks: [{ id: "t1", title: "x", brief: "Write a.txt", owned: [], depends_on: ["t1"], owner: "worker" }] } };
      }
      return twoTaskPlan(true);
    }
    workerFor(req);
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "build a and b", preset: preset({ orchestrator: [EXPERT] }, { mode: "team" }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.match(fake.calls[1]!.prompt, /depends on itself/);
  assert.equal(fake.calls[1]!.resumeSessionId, "fake-session-0");
});

// ---------------------------------------------------------------------------
// Pieces

test("intake sends small requests to one worker and larger ones to the team", () => {
  assert.equal(route("Fix the spelling mistakes in README.md. Do not change anything else.").mode, "solo");
  assert.equal(route("Change the server's default port from 3000 to 8080, including where the README mentions it.").mode, "solo");
  assert.equal(route("add a --verbose flag").mode, "solo");
  assert.equal(route("Add a report with three parts:\n1. money.js\n2. report.js\n3. bin/report.js").mode, "team");
  assert.equal(route("x ".repeat(80)).mode, "team");
  // Worker first: the expert plans only clearly large requests.
  assert.equal(route("Add a report with three parts:\n1. money.js\n2. report.js\n3. bin/report.js", "worker-first").mode, "solo");
  assert.equal(route("Build it:\n- a\n- b\n- c\n- d\n- e\n- f", "worker-first").mode, "solo", "bullets are requirements");
  assert.equal(route("Build it:\n1. a\n2. b\n3. c\n4. d\n5. e", "worker-first").mode, "team");
  assert.equal(route("x ".repeat(300), "worker-first").mode, "team");
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
