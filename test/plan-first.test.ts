// Opus plans first, workers build small pieces, and a worker can hand a task
// back to be split (F65 to F68). Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { claudeParser } from "../src/backends/claude.ts";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain } from "../src/engine/types.ts";
import type { Preset } from "../src/presets/presets.ts";
import { estimateCost } from "../src/usage/prices.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-planfirst-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

function makeRepo(files: Record<string, string>): string {
  const dir = join(scratch, `repo-${++counter}`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

/** The test passes when a.txt, b.txt and fixed.txt (saying ok) all exist. */
function threePartRepo(): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js":
      "const fs=require('fs');for(const f of ['a.txt','b.txt']){if(!fs.existsSync(f)){console.error('missing '+f);process.exit(1)}}if(!fs.existsSync('fixed.txt')||fs.readFileSync('fixed.txt','utf8').trim()!=='ok'){console.error('expected fixed.txt to say ok');process.exit(1)}",
  });
}

const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };
const TESTER = { backend: "fake", model: "fake-tester", tier: "worker" as const };
const LADDER = [
  { backend: "fake", model: "worker-medium", tier: "worker" as const },
  { backend: "fake", model: "worker-high", tier: "worker" as const },
];

function preset(roles: RoleChain = {}, extra: Partial<Preset> = {}): Preset {
  return {
    name: "test",
    description: "",
    mode: "team",
    roles: { worker: [LADDER[1]!], ...roles },
    repairs: 1,
    maxTasks: 5,
    maxParallel: 1,
    turnTimeoutMinutes: 1,
    intake: false,
    brief: false,
    routing: "worker-first",
    advise: false,
    test: "always",
    workerLadder: LADDER,
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
const isPlan = (r: AgentRequest): boolean => "tasks" in props(r) && !("design" in props(r));
const report = (summary: string, status = "done", notes = "") => ({ structured: { status, summary, notes, run: "" } });
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), text + "\n");

const SPEC = {
  name: "trio",
  summary: "s",
  features: ["f"],
  behaviour: [],
  out_of_scope: [],
  design: ["three files"],
  acceptance: [{ command: "cat fixed.txt", expect: "says ok" }],
  tasks: [
    { id: "t1", title: "part a", brief: "Write a.txt", owned: ["a.txt"], depends_on: [], owner: "worker" },
    { id: "t2", title: "part b", brief: "Write b.txt", owned: ["b.txt"], depends_on: ["t1"], owner: "worker" },
    { id: "t3", title: "finish", brief: "Write fixed.txt saying ok", owned: ["fixed.txt"], depends_on: ["t2"], owner: "worker" },
  ],
};

test("Opus's spec turn plans the build: each task gets its own small worker session, with no planning turn", async () => {
  const repo = threePartRepo();
  const { ctx, fake, events } = context((req) => {
    if (isScout(req)) return { structured: { facts: [] } };
    if (isSpec(req)) return { structured: SPEC };
    if (isPlan(req)) throw new Error("no separate planning turn");
    if (isTest(req)) return { structured: { verdict: "pass", summary: "ok", findings: [] } };
    if (/Your task: part a/.test(req.prompt)) write(req.cwd, "a.txt", "a");
    else if (/Your task: part b/.test(req.prompt)) write(req.cwd, "b.txt", "b");
    else if (/Your task: finish/.test(req.prompt)) write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "build a command-line tool that writes three files", preset: preset({ briefer: [EXPERT], tester: [TESTER] }, { brief: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.tasks.map((t) => [t.id, t.status]), [["t1", "passed"], ["t2", "passed"], ["t3", "passed"]]);
  assert.ok(events.some((e) => e.type === "plan.ready" && e.feature === "F65"));
  const builds = fake.calls.filter((c) => /Your task:/.test(c.prompt));
  assert.equal(builds.length, 3, "one fresh session per task");
  assert.ok(builds.every((c) => c.model === "worker-medium" && c.resumeSessionId === undefined), "small tasks start on the first rung");
  assert.match(builds[0]!.prompt, /Build plan \(each task is built by one developer/);
  const reviews = fake.calls.filter(isTest);
  assert.equal(reviews.length, 3);
  assert.ok(!/Run 1:/.test(reviews[0]!.prompt) && /Run 1: `cat fixed\.txt`/.test(reviews[2]!.prompt), "acceptance runs only once the program is whole");
});

test("a spec with a single task stays one worker task, as before", async () => {
  const repo = threePartRepo();
  const { ctx, fake } = context((req) => {
    if (isScout(req)) return { structured: { facts: [] } };
    if (isSpec(req)) return { structured: { ...SPEC, tasks: [SPEC.tasks[0]] } };
    if (isTest(req)) return { structured: { verdict: "pass", summary: "ok", findings: [] } };
    for (const f of ["a.txt", "b.txt"]) write(req.cwd, f, "x");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "build a command-line tool that writes three files", preset: preset({ briefer: [EXPERT], tester: [TESTER] }, { brief: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.tasks.map((t) => t.id), ["main"]);
  assert.equal(fake.calls.find((c) => /Complete the request below/.test(c.prompt))?.model, "worker-high", "a whole new program still starts on the top rung");
});

test("a worker that finds its task too big asks for a split: the expert divides it, builds the hard part itself, and workers finish", async () => {
  const repo = threePartRepo();
  let asked = false;
  const { ctx, fake, events } = context((req) => {
    if (isPlan(req)) {
      assert.match(req.prompt, /judged the task too big/);
      assert.match(req.prompt, /Files it has written so far: a\.txt/);
      return {
        structured: {
          summary: "hard part first",
          tasks: [
            { id: "x", title: "the hard part", brief: "Write b.txt", owned: ["b.txt"], depends_on: [], owner: "expert" },
            { id: "y", title: "the rest", brief: "Write fixed.txt saying ok", owned: ["fixed.txt"], depends_on: ["x"], owner: "worker" },
          ],
        },
      };
    }
    if (req.model === "fake-expert") {
      write(req.cwd, "b.txt", "b");
      return report("built the hard part");
    }
    if (!asked) {
      asked = true;
      assert.match(req.prompt, /answer with status "split"/);
      write(req.cwd, "a.txt", "a");
      return report("too big", "split", "needs a scheduler and a parser");
    }
    assert.doesNotMatch(req.prompt, /answer with status "split"/, "a part cannot be split again");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ orchestrator: [EXPERT], escalation: [EXPERT] }), mode: "solo" }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.tasks.map((t) => [t.id, t.owner, t.status]), [["main", "worker", "passed"], ["main.x", "expert", "passed"], ["main.y", "worker", "passed"]]);
  assert.equal(state.tasks[0]?.report?.status, "split");
  assert.ok(events.some((e) => e.type === "task.split" && e.feature === "F68"));
  const order = fake.calls.filter((c) => !isPlan(c)).map((c) => c.model);
  assert.deepEqual(order, ["worker-medium", "fake-expert", "worker-medium"], "the expert's part is built before the part that needs it");
});

test("when the expert keeps the task whole, its brief goes back to the worker as advice", async () => {
  const repo = threePartRepo();
  let turns = 0;
  const { ctx, fake } = context((req) => {
    if (isPlan(req)) return { structured: { summary: "it is fine as one", tasks: [{ id: "a", title: "all", brief: "Write a.txt, b.txt and fixed.txt", owned: [], depends_on: [], owner: "worker" }] } };
    turns += 1;
    if (turns === 1) return report("too big", "split", "lots of files");
    for (const f of ["a.txt", "b.txt"]) write(req.cwd, f, "x");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ orchestrator: [EXPERT] }), mode: "solo" }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.tasks.map((t) => t.id), ["main"]);
  assert.match(fake.calls.at(-1)!.prompt, /Write a\.txt, b\.txt and fixed\.txt/);
});

test("a worker session that grew past 90K tokens is not resumed for the repair", async () => {
  const repo = threePartRepo();
  let turn = 0;
  const { ctx, fake, events } = context((req) => {
    turn += 1;
    if (turn === 1) return { ...report("first try"), peakPrompt: 120_000 };
    for (const f of ["a.txt", "b.txt"]) write(req.cwd, f, "x");
    write(req.cwd, "fixed.txt", "ok");
    return report("fixed");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({}, { workerLadder: undefined }), mode: "solo" }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(fake.calls[1]!.resumeSessionId, undefined, "a fresh session");
  assert.match(fake.calls[1]!.prompt, /An earlier attempt at this task already changed some files/);
  assert.ok(events.some((e) => e.type === "context.compacted" && e.feature === "F67"));
});

test("Haiku calls over 100K prompt tokens are priced at the long-context rate", () => {
  const short = estimateCost("claude-haiku-5-5", { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 100_000 })!;
  assert.ok(Math.abs(short - 0.06) < 1e-9, String(short));
  const all = estimateCost("claude-haiku-5-5", { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 100_000, long: { input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 100_000 } })!;
  assert.ok(Math.abs(all - 0.3) < 1e-9, String(all));
  assert.equal(estimateCost("claude-opus-5-5", { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000, long: { input: 0, output: 1_000 } }), 0.02, "models without a long tier are unchanged");
});

test("the Claude parser counts the calls over 100K apart, and reports the largest prompt", () => {
  const parser = claudeParser({});
  const call = (id: string, cacheRead: number) => parser.onEvent({ type: "assistant", message: { id, usage: { input_tokens: 1, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 1_000 }, content: [] } });
  call("m1", 50_000);
  call("m2", 120_000);
  call("m3", 140_000);
  call("m4", 30_000);
  parser.onEvent({ type: "result", subtype: "success", result: "{}", usage: { input_tokens: 4, output_tokens: 8_000, cache_read_input_tokens: 340_000, cache_creation_input_tokens: 4_000 } });
  const run = parser.result();
  assert.deepEqual(run.usage.long, { input: 2, cacheRead: 260_000, cacheWrite: 2_000, output: 4_000 });
  assert.equal(run.peakPrompt, 141_001);
});
