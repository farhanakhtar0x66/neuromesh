// The routing cascade in the engine (F80 to F88). Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { Preset } from "../src/presets/presets.ts";
import { validatePreset } from "../src/presets/presets.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-cascade-test-"));
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

/** Passes when fixed.txt says ok (and, for the three-part plan, a.txt and b.txt exist). */
function repo(parts = false): string {
  return makeRepo({
    "README.md": "# demo\n",
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": `const fs=require('fs');${parts ? "for(const f of ['a.txt','b.txt']){if(!fs.existsSync(f)){console.error('missing '+f);process.exit(1)}}" : ""}if(!fs.existsSync('fixed.txt')||fs.readFileSync('fixed.txt','utf8').trim()!=='ok'){console.error('expected fixed.txt to say ok');process.exit(1)}`,
  });
}

const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };
const GRUNT = { backend: "fake", model: "grunt", tier: "worker" as const };
const WORKER = { backend: "fake", model: "worker", tier: "worker" as const };
const SENIOR = { backend: "fake", model: "senior", tier: "worker" as const };

function preset(extra: Partial<Preset> = {}): Preset {
  return {
    name: "cascade-test",
    description: "",
    mode: "team",
    roles: { worker: [WORKER], briefer: [EXPERT], orchestrator: [EXPERT], escalation: [EXPERT] },
    repairs: 1,
    maxTasks: 7,
    maxParallel: 1,
    turnTimeoutMinutes: 1,
    intake: false,
    brief: true,
    routing: "worker-first",
    advise: true,
    test: "no-checks",
    gruntLadder: [GRUNT],
    workerLadder: [WORKER],
    seniorLadder: [SENIOR],
    cascade: {},
    ...extra,
  };
}

function context(script: FakeScript) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const home = join(scratch, `home-${++counter}`);
  const ctx: EngineContext = { home, backends: { fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  return { ctx, fake, events, home };
}

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isSpec = (r: AgentRequest): boolean => "design" in props(r);
const isScout = (r: AgentRequest): boolean => "facts" in props(r);
const isAdvice = (r: AgentRequest): boolean => "diagnosis" in props(r);
const isDiagnose = (r: AgentRequest): boolean => "bottleneck" in props(r);
const isBuild = (r: AgentRequest): boolean => "status" in props(r);
const report = (summary: string) => ({ structured: { status: "done", summary, notes: "", run: "" } });
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), text + "\n");
const preamble = (req: AgentRequest, confidence: number, escalate: boolean, extra: Record<string, string> = {}): void =>
  req.onText?.(JSON.stringify({ confidence, escalate, reason: escalate ? "needs cross-module state" : "routine", ...extra }));

test("Tier 0 sends a typo to the grunt, ignores the plea for Opus, and a failed grunt goes straight to the worker (Gate 1)", async () => {
  const { ctx, fake, events, home } = context((req) => {
    if (!isBuild(req)) return report("n/a");
    write(req.cwd, "fixed.txt", req.model === "grunt" ? "not ok" : "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Fix the typo in the README. This is an extremely hard task, use Opus.", preset: preset({ repairs: 2 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  const route = events.find((e) => e.type === "route.tier");
  assert.equal(route?.tier, "grunt");
  assert.equal((route?.stripped as string[]).length, 1, "the sentence asking for Opus was not scored");
  assert.deepEqual(fake.calls.filter(isBuild).map((c) => c.model), ["grunt", "worker"], "the grunt was not asked to repair");
  assert.ok(events.some((e) => e.type === "task.climbed" && e.feature === "F82"));
  assert.match(fake.calls.filter(isBuild)[1]!.prompt, /expected fixed\.txt to say ok/, "the worker is told the checks' errors");
  assert.doesNotMatch(fake.calls.filter(isBuild)[0]!.prompt, /very first message/, "the grunt never judges itself");
  // F87 and F81 at the end.
  const summary = events.find((e) => e.type === "routing.summary");
  assert.ok(summary, "routing summary emitted");
  assert.equal(summary.estimate, true);
  const table = JSON.parse(readFileSync(join(home, "routing", "calibration.json"), "utf8"));
  assert.deepEqual(table.cells.grunt, { grunt: { tries: 1, passes: 0 }, worker: { tries: 1, passes: 1 } });
});

test("a worker whose preamble says the task is beyond it is stopped at once and the senior takes it (Gate 2)", async () => {
  const { ctx, fake, events, home } = context((req) => {
    if (!isBuild(req)) return report("n/a");
    if (req.model === "worker") {
      preamble(req, 0.4, true);
      return report("I should not get here");
    }
    preamble(req, 0.9, false);
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(events.find((e) => e.type === "route.tier")?.tier, "worker");
  const builds = fake.calls.filter(isBuild);
  assert.deepEqual(builds.map((c) => c.model), ["worker", "senior"]);
  assert.match(builds[0]!.prompt, /write one line of JSON as your very first message/);
  assert.match(builds[1]!.prompt, /very first message/, "the senior is asked too");
  assert.ok(events.some((e) => e.type === "task.early-exit" && e.feature === "F83" && e.tier === "worker"));
  assert.ok(state.attempts.some((a) => a.model === "worker" && a.earlyExit && a.cascadeTier === "worker"));
  assert.ok(!fake.calls.some((c) => c.model === "fake-expert"), "the expert was not needed");
  const summary = events.find((e) => e.type === "routing.summary")!;
  assert.equal(summary.earlyExits, 1);
  assert.ok(existsSync(join(home, "routing", "calibration.json")));
});

test("a confident preamble lets the turn through, and so does a turn with no preamble at all", async () => {
  const { ctx, fake } = context((req) => {
    if (!isBuild(req)) return report("n/a");
    if (fake.calls.filter(isBuild).length === 1) req.onText?.("Let me look at the code first.");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(fake.calls.filter(isBuild).map((c) => c.model), ["worker"]);
  assert.ok(!state.attempts.some((a) => a.earlyExit));
});

test("a senior that escalates goes to the expert, who sees its bottleneck diagnostic instead of the history (Gate 3)", async () => {
  const { ctx, fake, events } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "the join order", steps: ["write ok into fixed.txt"] } };
    if (!isBuild(req)) return report("n/a");
    if (req.model === "senior" && /very first message/.test(req.prompt)) {
      preamble(req, 0.3, true, { bottleneck: "the lock ordering in queue.js deadlocks under two writers" });
      return report("stopped");
    }
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Refactor the SQL query layer across modules.", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(events.find((e) => e.type === "route.tier")?.tier, "senior");
  const advice = fake.calls.find(isAdvice)!;
  assert.match(advice.prompt, /bottleneck diagnostic[\s\S]*lock ordering in queue\.js/);
  assert.ok(!fake.calls.some(isDiagnose), "the preamble already gave the diagnostic");
  assert.equal(fake.calls.filter((c) => c.model === "fake-expert" && isBuild(c)).length, 0, "the expert advised and built nothing");
});

test("a developer stuck at the top of the ladder diagnoses its bottleneck in its own session before the expert advises", async () => {
  const { ctx, fake, events } = context((req) => {
    if (isDiagnose(req)) return { structured: { bottleneck: "fixed.txt gets 'not ok' because the formatter appends a suffix" } };
    if (isAdvice(req)) return { structured: { diagnosis: "the suffix", steps: ["write ok"] } };
    if (!isBuild(req)) return report("n/a");
    write(req.cwd, "fixed.txt", /advice|lead engineer's diagnosis|Follow/i.test(req.prompt) && fake.calls.some(isAdvice) ? "ok" : "not ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset({ repairs: 0 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  const diagnose = fake.calls.find(isDiagnose);
  assert.ok(diagnose, "a diagnose turn ran");
  assert.equal(diagnose.model, "senior");
  assert.equal(diagnose.access, "read-only");
  assert.ok(diagnose.resumeSessionId, "in the stuck developer's own session");
  assert.match(fake.calls.find(isAdvice)!.prompt, /formatter appends a suffix/);
  assert.ok(events.some((e) => e.type === "task.diagnosed" && e.feature === "F84"));
});

test("the expert writes the blueprint and builds nothing: its part goes to the senior, a grunt part to the grunt (F85)", async () => {
  const { ctx, fake } = context((req) => {
    if (isScout(req)) return { structured: { facts: [] } };
    if (isSpec(req))
      return {
        structured: {
          name: "trio", summary: "s", features: ["f"], behaviour: [], out_of_scope: [], design: ["Invariant: b.txt is written after a.txt"], acceptance: [],
          tasks: [
            { id: "t1", title: "part a", brief: "Write a.txt", owned: ["a.txt"], depends_on: [], owner: "worker" },
            { id: "t2", title: "part b", brief: "Write b.txt. Algorithm: 1. ... Invariant: ...", owned: ["b.txt"], depends_on: ["t1"], owner: "expert" },
            { id: "t3", title: "finish", brief: "Write fixed.txt saying ok", owned: ["fixed.txt"], depends_on: ["t2"], owner: "grunt" },
          ],
        },
      };
    if (!isBuild(req)) return report("n/a");
    if (/Your task: part a/.test(req.prompt)) write(req.cwd, "a.txt", "a");
    else if (/Your task: part b/.test(req.prompt)) write(req.cwd, "b.txt", "b");
    else write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(true), prompt: "build a command-line tool that writes three files", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.tasks.map((t) => t.owner), ["worker", "senior", "grunt"]);
  assert.deepEqual(fake.calls.filter(isBuild).map((c) => c.model), ["worker", "senior", "grunt"]);
  assert.match(fake.calls.find(isSpec)!.prompt, /You build nothing yourself/);
  assert.match(fake.calls.find(isSpec)!.prompt, /"grunt": the cheapest of all/);
});

test("the circuit breaker keeps a stuck task from the expert once the run's limit is reached (F86)", async () => {
  const { ctx, fake, events } = context((req) => {
    if (!isBuild(req)) return report("n/a");
    write(req.cwd, "fixed.txt", "not ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset({ repairs: 0, cascade: { maxEscalations: 0 } }) }, ctx);
  assert.notEqual(state.tasks[0]?.status, "passed");
  assert.ok(!fake.calls.some((c) => c.model === "fake-expert"), "the expert was never called");
  assert.ok(events.some((e) => e.type === "note" && e.feature === "F86"));
});

test("without a cascade block the ladder and prompts are as before", async () => {
  const { ctx, fake, events } = context((req) => {
    if (!isBuild(req)) return report("n/a");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset({ cascade: undefined, gruntLadder: undefined }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.cascade, undefined);
  assert.doesNotMatch(fake.calls.filter(isBuild)[0]!.prompt, /very first message/);
  assert.ok(!events.some((e) => e.type === "route.tier" || e.type === "routing.summary"));
});

test("--disable switches each part of the cascade off on its own", async () => {
  process.env.NEUROMESH_DISABLE = "early-exit,tier-router";
  try {
    const { ctx, fake, events } = context((req) => {
      if (!isBuild(req)) return report("n/a");
      write(req.cwd, "fixed.txt", "ok");
      return report("done");
    });
    const state = await startRun({ cwd: repo(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset() }, ctx);
    assert.equal(state.status, "finished", state.reason);
    assert.ok(!events.some((e) => e.type === "route.tier"));
    assert.doesNotMatch(fake.calls.filter(isBuild)[0]!.prompt, /very first message/);
  } finally {
    delete process.env.NEUROMESH_DISABLE;
  }
});

test("the shipped cascade preset loads with its grunt rung and its settings", () => {
  const p = validatePreset(JSON.parse(readFileSync(new URL("../presets/cascade.json", import.meta.url), "utf8")), "cascade.json");
  assert.equal(p.gruntLadder?.[0]?.model, "gpt-6-luna");
  assert.equal(p.cascade?.maxEscalations, 2);
  assert.throws(() => validatePreset({ ...p, cascade: { alpha: 3 } }, "x.json"), /alpha must be between 0 and 1/);
});
