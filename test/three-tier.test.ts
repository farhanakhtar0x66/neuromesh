// Three tiers by difficulty (F78): the plan marks each part worker, senior or
// expert, and each starts on its own model. Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { claudeParser } from "../src/backends/claude.ts";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest, Usage } from "../src/backends/types.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { Preset } from "../src/presets/presets.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-tiers-test-"));
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

function threePartRepo(): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js":
      "const fs=require('fs');for(const f of ['a.txt','b.txt']){if(!fs.existsSync(f)){console.error('missing '+f);process.exit(1)}}if(!fs.existsSync('fixed.txt')||fs.readFileSync('fixed.txt','utf8').trim()!=='ok'){console.error('expected fixed.txt to say ok');process.exit(1)}",
  });
}

const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };
const WORKERS = [
  { backend: "fake", model: "worker-medium", tier: "worker" as const },
  { backend: "fake", model: "worker-high", tier: "worker" as const },
];
const SENIORS = [
  { backend: "fake", model: "senior-medium", tier: "worker" as const },
  { backend: "fake", model: "senior-high", tier: "worker" as const },
];

function preset(extra: Partial<Preset> = {}): Preset {
  return {
    name: "test",
    description: "",
    mode: "team",
    roles: { worker: [WORKERS[1]!], briefer: [EXPERT], orchestrator: [EXPERT], escalation: [EXPERT] },
    repairs: 1,
    maxTasks: 7,
    maxParallel: 1,
    turnTimeoutMinutes: 1,
    intake: false,
    brief: true,
    routing: "worker-first",
    advise: false,
    test: "no-checks",
    workerLadder: WORKERS,
    seniorLadder: SENIORS,
    ...extra,
  };
}

function context(script: FakeScript) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const ctx: EngineContext = { home: join(scratch, `home-${++counter}`), backends: { fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  return { ctx, fake, events };
}

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isSpec = (r: AgentRequest): boolean => "design" in props(r);
const isScout = (r: AgentRequest): boolean => "facts" in props(r);
const isTest = (r: AgentRequest): boolean => "verdict" in props(r);
const report = (summary: string) => ({ structured: { status: "done", summary, notes: "", run: "" } });
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), text + "\n");
const builds = (calls: AgentRequest[]): AgentRequest[] => calls.filter((c) => /Your task:/.test(c.prompt));

const spec = (owners: [string, string, string]) => ({
  name: "trio",
  summary: "s",
  features: ["f"],
  behaviour: [],
  out_of_scope: [],
  design: ["three files"],
  acceptance: [],
  tasks: [
    { id: "t1", title: "part a", brief: "Write a.txt", owned: ["a.txt"], depends_on: [], owner: owners[0] },
    { id: "t2", title: "part b", brief: "Write b.txt", owned: ["b.txt"], depends_on: ["t1"], owner: owners[1] },
    { id: "t3", title: "finish", brief: "Write fixed.txt saying ok", owned: ["fixed.txt"], depends_on: ["t2"], owner: owners[2] },
  ],
});

function builder(owners: [string, string, string], finish: (req: AgentRequest) => string = () => "ok"): FakeScript {
  return (req) => {
    if (isScout(req)) return { structured: { facts: [] } };
    if (isSpec(req)) return { structured: spec(owners) };
    if (isTest(req)) return { structured: { verdict: "pass", summary: "ok", findings: [] } };
    if (/Your task: part a/.test(req.prompt)) write(req.cwd, "a.txt", "a");
    else if (/Your task: part b/.test(req.prompt)) write(req.cwd, "b.txt", "b");
    else write(req.cwd, "fixed.txt", finish(req));
    return report("done");
  };
}

test("each part of the plan starts on its own tier: worker, senior, expert", async () => {
  const { ctx, fake } = context(builder(["worker", "senior", "expert"]));
  const state = await startRun({ cwd: threePartRepo(), prompt: "build a command-line tool that writes three files", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.tasks.map((t) => [t.id, t.owner, t.status]), [["t1", "worker", "passed"], ["t2", "senior", "passed"], ["t3", "expert", "passed"]]);
  assert.deepEqual(builds(fake.calls).map((c) => c.model), ["worker-medium", "senior-medium", "fake-expert"]);
  const asked = fake.calls.find(isSpec)!.prompt;
  assert.match(asked, /"senior": about three times the price/, "the lead engineer is told about the three kinds");
  assert.match(asked, /2 to 7 tasks/, "and the preset's task limit");
});

test("a worker stuck on its last rung climbs to the senior rungs before the expert is asked", async () => {
  const { ctx, fake, events } = context(builder(["worker", "worker", "worker"], (req) => (req.model?.startsWith("senior") ? "ok" : "not yet")));
  const state = await startRun({ cwd: threePartRepo(), prompt: "build a command-line tool that writes three files", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  const finish = builds(fake.calls).filter((c) => /Your task: finish/.test(c.prompt)).map((c) => c.model);
  assert.deepEqual([...new Set(finish)], ["worker-medium", "worker-high", "senior-medium"], "rung by rung");
  assert.ok(!fake.calls.some((c) => c.model === "fake-expert" && !isSpec(c) && !isScout(c)), "the expert built nothing");
  assert.equal(events.filter((e) => e.type === "task.climbed").length, 2);
});

test("without a senior ladder a part marked senior is a worker's, and the spec is not told about tiers", async () => {
  const { ctx, fake } = context(builder(["worker", "senior", "worker"]));
  const state = await startRun({ cwd: threePartRepo(), prompt: "build a command-line tool that writes three files", preset: preset({ seniorLadder: undefined, maxTasks: 4 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.tasks.map((t) => t.owner), ["worker", "worker", "worker"]);
  assert.ok(builds(fake.calls).every((c) => c.model === "worker-medium"));
  const asked = fake.calls.find(isSpec)!.prompt;
  assert.doesNotMatch(asked, /"senior"/);
  assert.match(asked, /2 to 4 tasks/, "the plan is asked to fit the preset's task limit");
});

test("three-tier switched off: the senior rungs are not used at all", async () => {
  const { ctx, fake } = context(builder(["worker", "senior", "worker"]));
  const state = await startRun({ cwd: threePartRepo(), prompt: "build a command-line tool that writes three files", preset: preset({ disable: ["three-tier"] }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.seniorRung, undefined);
  assert.ok(builds(fake.calls).every((c) => c.model === "worker-medium"));
});

test("the Claude parser reports usage while the model is still thinking, before its first message", () => {
  const seen: Usage[] = [];
  const parser = claudeParser({ onUsage: (u) => seen.push(u) });
  for (let i = 0; i < 5; i++) parser.onEvent({ type: "system", subtype: "thinking_tokens", estimated_tokens: (i + 1) * 150, estimated_tokens_delta: 150 });
  assert.equal(seen.length, 5);
  assert.equal(seen.at(-1)!.output, 750);
});

test("a spec plan one task over the preset's limit is kept, not thrown away", async () => {
  const { ctx, fake, events } = context(builder(["worker", "worker", "worker"]));
  const state = await startRun({ cwd: threePartRepo(), prompt: "build a command-line tool that writes three files", preset: preset({ seniorLadder: undefined, maxTasks: 2 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.tasks.length, 3, "all three planned parts were built");
  assert.equal(builds(fake.calls).length, 3);
  assert.ok(!events.some((e) => e.type === "feature.failed"), "the plan feature did not fail");
});
