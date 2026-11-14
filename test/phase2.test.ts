// F100 to F104, from the phase-2 review (docs/21-phase-2-review.md). Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { blindPathOk, brokenTest, signaturesOf, wantsBlindTests } from "../src/checks/blind.ts";
import { leadTerms, startHere } from "../src/context/packet.ts";
import { MAX_AGE_MS, loadQuota, recordQuota, shiftNow, windowUsed } from "../src/engine/quota.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain } from "../src/engine/types.ts";
import type { Preset } from "../src/presets/presets.ts";
import { validatePreset } from "../src/presets/presets.ts";
import { MIN_EVIDENCE, calibrated, describeCalibration, evidencePick, record } from "../src/routing/calibration.ts";
import type { CalibrationTable } from "../src/routing/calibration.ts";
import { probeDraw, routeTier } from "../src/routing/router.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-phase2-test-"));
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

/** Passes when fixed.txt says ok. */
const fixable = (): string =>
  makeRepo({
    "README.md": "# demo\n",
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": "const fs=require('fs');if(!fs.existsSync('fixed.txt')||fs.readFileSync('fixed.txt','utf8').trim()!=='ok'){console.error('expected fixed.txt to say ok');process.exit(1)}",
  });

/** Passes when value.txt starts with ok and every file in tests/ runs without failing. */
const testable = (): string =>
  makeRepo({
    "README.md": "# demo\n",
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": "const fs=require('fs');if(!fs.existsSync('value.txt')||!fs.readFileSync('value.txt','utf8').startsWith('ok')){console.error('expected value.txt to start with ok');process.exit(1)}for(const f of fs.existsSync('tests')?fs.readdirSync('tests'):[])require('./tests/'+f);",
  });

const WORKER = { backend: "fake", model: "fake-worker", tier: "worker" as const };
const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };

function preset(roles: RoleChain = {}, extra: Partial<Preset> = {}): Preset {
  return { name: "phase2", description: "", mode: "solo", roles: { worker: [WORKER], ...roles }, repairs: 1, maxTasks: 4, maxParallel: 1, turnTimeoutMinutes: 1, intake: false, brief: false, routing: "rules", advise: false, test: "no-checks", ...extra };
}

function context(script: FakeScript, others: Record<string, FakeScript> = {}) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const extra = Object.fromEntries(Object.entries(others).map(([id, s]) => [id, createFakeBackend(s, id)]));
  const home = join(scratch, `home-${++counter}`);
  const ctx: EngineContext = { home, backends: { fake, ...extra }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  return { ctx, fake, extra, events, home };
}

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isBlind = (r: AgentRequest): boolean => "tests" in props(r);
const isAdvice = (r: AgentRequest): boolean => "diagnosis" in props(r);
const isBuild = (r: AgentRequest): boolean => "status" in props(r);
const report = (summary: string) => ({ structured: { status: "done", summary, notes: "", run: "" } });
const write = (cwd: string, file: string, text: string): void => {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), `${text}\n`);
};
const worktrees = (repo: string): string[] => execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" }).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));

// ---------------------------------------------------------------------------
// F100 start-here

const CONTEXT_JS = `const LIMIT = 20;

function loadNotes(path) {
  return [];
}

function compactNotes(notes, limit) {
  // SECRET-BODY
  while (notes.length > limit) notes.shift();
  return notes;
}

module.exports = { loadNotes, compactNotes };
`;

test("F100: a task that names a definition is pointed at its lines, with the body when it is short", () => {
  const repo = makeRepo({ "src/context.js": CONTEXT_JS, "src/other.js": "function unrelated() {\n  return 1;\n}\n", "README.md": "# x\n" });
  const lead = startHere(repo, "compactNotes keeps too many entries: bound it at the limit");
  assert.ok(lead, "a lead was found");
  assert.deepEqual(lead.files, ["src/context.js"]);
  assert.match(lead.text, /src\/context\.js:7-11 {2}function compactNotes\(notes, limit\)/);
  assert.match(lead.text, /9: {3}while \(notes\.length > limit\) notes\.shift\(\);/, "the body is shown with line numbers");
  assert.match(lead.text, /where to look first, not a limit/, "worded as a start, not a boundary");
  assert.doesNotMatch(lead.text, /unrelated/);
});

test("F100: nothing is said when no definition is named by the task, and a file the task names is always a lead", () => {
  const repo = makeRepo({ "src/context.js": CONTEXT_JS, "README.md": "# x\n" });
  assert.equal(startHere(repo, "make the build faster and write a changelog"), undefined, "no lead is better than a wrong one");
  assert.equal(startHere(repo, "speed up the load"), undefined, "a definition that merely contains an ordinary word is noise");
  assert.equal(startHere(repo, "improve the notes"), undefined, "so are two of them");
  assert.deepEqual(startHere(repo, "the context is rebuilt too often")?.files, ["src/context.js"], "a word that is a file's own name is a lead");
  assert.deepEqual([...leadTerms("fix `flush`, max_size and render() in compactNotes, then tidy the layout").strong].sort(), ["compactnotes", "flush", "max_size", "render"]);
  const named = startHere(repo, "tidy src/context.js");
  assert.match(named?.text ?? "", /src\/context\.js \[14 lines\]: loadNotes \(3\), compactNotes \(7\)/);
  assert.equal(startHere(makeRepo({ "README.md": "empty\n" }), "add compactNotes"), undefined);
});

test("F100: the task's first prompt carries the lead, and switching the feature off removes it", async () => {
  const files = { "src/context.js": CONTEXT_JS, "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }), "check.js": "const fs=require('fs');if(!fs.existsSync('fixed.txt')){console.error('missing fixed.txt');process.exit(1)}" };
  const script: FakeScript = (req) => {
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  };
  const on = context(script);
  const state = await startRun({ cwd: makeRepo(files), prompt: "fix compactNotes so it respects the limit", preset: preset() }, on.ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.match(on.fake.calls[0]!.prompt, /Start here \(Neuromesh matched these/);
  assert.match(on.fake.calls[0]!.prompt, /src\/context\.js:7-11/);
  const lead = on.events.find((e) => e.type === "context.start-here");
  assert.equal(lead?.feature, "F100");
  assert.deepEqual(lead?.files, ["src/context.js"]);

  const off = context(script);
  await startRun({ cwd: makeRepo(files), prompt: "fix compactNotes so it respects the limit", preset: preset({}, { disable: ["start-here"] }) }, off.ctx);
  assert.doesNotMatch(off.fake.calls[0]!.prompt, /Start here/);
});

// ---------------------------------------------------------------------------
// F101 blind-tests

test("F101: which work gets blind tests, what the tester may see, and which failures are the test's own", () => {
  assert.ok(wantsBlindTests("add a bounded cache that evicts the oldest entry"));
  assert.ok(wantsBlindTests("write a parser for the config format"));
  assert.ok(wantsBlindTests("make the queue thread-safe"));
  assert.ok(!wantsBlindTests("fix the typo in the readme"));
  assert.ok(!wantsBlindTests("add a --verbose flag to the command"));

  const repo = makeRepo({ "src/context.js": CONTEXT_JS, "test/context.test.js": "function testIt() {}\n" });
  const sig = signaturesOf(repo, ["src/context.js", "test/context.test.js", "gone.js"]);
  assert.deepEqual(sig.files, ["src/context.js"], "tests and missing files are left out");
  assert.match(sig.text, /7: function compactNotes\(notes, limit\)/);
  assert.doesNotMatch(sig.text, /SECRET-BODY|shift\(\)/, "signatures only, never a body");

  assert.ok(brokenTest("Error: Cannot find module './cache'"));
  assert.ok(brokenTest("ModuleNotFoundError: No module named 'cache'"));
  assert.ok(!brokenTest("AssertionError: expected 20 entries, got 500"));
  assert.ok(!brokenTest("SyntaxError: unexpected token"), "a parser may throw this by design");

  assert.ok(blindPathOk(repo, "test/blind.test.js"));
  assert.ok(!blindPathOk(repo, "src/context.js"), "never an existing file");
  assert.ok(!blindPathOk(repo, "../outside.js"));
  assert.ok(!blindPathOk(repo, ".git/hooks/pre-commit"));
  assert.ok(!blindPathOk(repo, "/etc/passwd"));
});

const BLIND_REQUEST = "add a bounded cache that keeps at most 20 entries";
const blindTest = (expect: string): { path: string; content: string } => ({
  path: "tests/blind_bound.test.js",
  content: `const fs=require('fs');if(fs.readFileSync('value.txt','utf8').trim()!=='${expect}'){console.error('AssertionError: expected the cache to stay bounded');process.exit(1)}`,
});
/** A worker that builds the cache, and what it does with failing blind tests. */
function cacheWorker(onBlindFix: (req: AgentRequest) => void, tests: { path: string; content: string }[] | "garbage"): FakeScript {
  return (req) => {
    if (isBlind(req)) return { structured: tests === "garbage" ? { tests: "all of them" } : { tests, summary: "long runs stay bounded" } };
    if (isAdvice(req)) return { structured: { diagnosis: "d", steps: ["s"] } };
    if (/A second developer, who saw the task and your signatures/.test(req.prompt)) {
      onBlindFix(req);
      return report("judged the blind tests");
    }
    write(req.cwd, "value.txt", "ok");
    write(req.cwd, "src/cache.js", "function put(key, value) {\n  // SECRET-BODY\n}\nmodule.exports = { put };");
    return report("built the cache");
  };
}

test("F101: a blind test that finds a real defect is fixed by the developer and stays in the change", async () => {
  const repo = testable();
  const { ctx, fake, events } = context(cacheWorker((req) => write(req.cwd, "value.txt", "ok-bounded"), [blindTest("ok-bounded")]));
  const state = await startRun({ cwd: repo, prompt: BLIND_REQUEST, preset: preset({ escalation: [EXPERT] }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "blind", "review-fix"]);
  const blind = fake.calls.find(isBlind)!;
  assert.match(blind.prompt, /function put\(key, value\)/, "the tester gets the signatures");
  assert.doesNotMatch(blind.prompt, /SECRET-BODY/, "and nothing of the code");
  assert.equal(blind.access, "read-only");
  assert.ok(!blind.cwd.startsWith(state.dir) && !blind.cwd.startsWith(repo), "it works in a folder away from the project and from the run's folders, where the code is");
  assert.ok(!existsSync(blind.cwd), "which is removed afterwards");
  const fix = fake.calls.find((c) => /A second developer/.test(c.prompt))!;
  assert.match(fix.prompt, /tests\/blind_bound\.test\.js/);
  assert.match(fix.prompt, /expected the cache to stay bounded/, "the developer sees the failing output");
  assert.ok(events.some((e) => e.type === "blind.tests" && e.feature === "F101" && e.outcome === "failed"));
  assert.ok(!events.some((e) => e.type === "blind.dropped"));
  assert.ok(state.outcome?.files.some((f) => f.path === "tests/blind_bound.test.js"), "the test that was right ships with the fix");
  assert.equal(readFileSync(join(state.worktree, "value.txt"), "utf8").trim(), "ok-bounded");
  assert.ok(!worktrees(repo).some((t) => /tester$/.test(t)), "the copy the tests ran on is gone");
});

test("F101: a blind test that is itself wrong costs one turn: it is taken out, recorded, and the expert is never called", async () => {
  const repo = testable();
  // The developer changes nothing: the test expects what the task never stated.
  const { ctx, fake, events } = context(cacheWorker(() => {}, [blindTest("something the task never said")]));
  const state = await startRun({ cwd: repo, prompt: BLIND_REQUEST, preset: preset({ escalation: [EXPERT] }, { repairs: 2, advise: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "blind", "review-fix"], "one turn with the tests, then no repair rounds, race or expert");
  assert.ok(!fake.calls.some((c) => c.model === "fake-expert"));
  const dropped = events.find((e) => e.type === "blind.dropped");
  assert.equal(dropped?.feature, "F101");
  assert.deepEqual(dropped?.files, ["tests/blind_bound.test.js"]);
  assert.ok(!state.outcome?.files.some((f) => f.path.startsWith("tests/")), "the wrong test does not reach the person's diff");
  assert.equal(state.tasks[0]?.blind?.dropped, true);
});

test("F101: blind tests that pass change nothing and are not kept; ones that cannot load, or an unusable answer, cost no developer turn", async () => {
  const passing = context(cacheWorker(() => assert.fail("no fix turn"), [blindTest("ok")]));
  const a = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset() }, passing.ctx);
  assert.equal(a.status, "finished", a.reason);
  assert.deepEqual(a.attempts.map((x) => x.kind), ["initial", "blind"]);
  assert.equal(passing.events.find((e) => e.type === "blind.tests")?.outcome, "passed");
  assert.ok(!a.outcome?.files.some((f) => f.path.startsWith("tests/")));

  const broken = context(cacheWorker(() => assert.fail("no fix turn"), [{ path: "tests/blind_import.test.js", content: "require('./no-such-module');" }]));
  const b = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset() }, broken.ctx);
  assert.equal(b.status, "finished", b.reason);
  assert.deepEqual(b.attempts.map((x) => x.kind), ["initial", "blind"]);
  assert.equal(broken.events.find((e) => e.type === "blind.tests")?.outcome, "broken");

  const garbage = context(cacheWorker(() => assert.fail("no fix turn"), "garbage"));
  const c = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset() }, garbage.ctx);
  assert.equal(c.status, "finished", c.reason);
  assert.equal(garbage.events.find((e) => e.type === "blind.tests")?.outcome, "none");

  // An existing file is never replaced, whatever the tester answers.
  const overwrite = context(cacheWorker(() => assert.fail("no fix turn"), [{ path: "check.js", content: "process.exit(1)" }]));
  const d = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset() }, overwrite.ctx);
  assert.equal(d.status, "finished", d.reason);
  assert.equal(d.outcome?.checks, "passed");
  assert.equal(overwrite.events.find((e) => e.type === "blind.tests")?.outcome, "none");
});

test("F101: routine work, and a run with the feature off, get no blind tests", async () => {
  const routine = context(cacheWorker(() => {}, [blindTest("x")]));
  const a = await startRun({ cwd: testable(), prompt: "add a --verbose flag to the command", preset: preset() }, routine.ctx);
  assert.equal(a.status, "finished", a.reason);
  assert.deepEqual(a.attempts.map((x) => x.kind), ["initial"]);

  const off = context(cacheWorker(() => {}, [blindTest("x")]));
  const b = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset({}, { disable: ["blind-tests"] }) }, off.ctx);
  assert.equal(b.status, "finished", b.reason);
  assert.deepEqual(b.attempts.map((x) => x.kind), ["initial"]);
});

// ---------------------------------------------------------------------------
// F102 repair-race

const REWRITE = /Do not patch the failing part again/;

test("F102: a worker out of repairs gets two fresh attempts side by side; the one that passes wins and the expert is not called", async () => {
  const repo = fixable();
  const { ctx, fake, events } = context((req) => {
    if (!isBuild(req)) return { structured: { diagnosis: "d", steps: ["s"] } };
    // Only the developer told to rewrite the failing part gets it right.
    write(req.cwd, "fixed.txt", REWRITE.test(req.prompt) ? "ok" : "nope");
    return report("tried");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair", "race", "race"]);
  assert.ok(!fake.calls.some((c) => c.model === "fake-expert"), "the escalation did not happen");
  const racers = fake.calls.filter((c) => /in your own copy of the project/.test(c.prompt));
  assert.equal(racers.length, 2);
  assert.notEqual(racers[0]!.cwd, racers[1]!.cwd, "each in its own copy");
  assert.ok(racers.every((c) => /race-[ab]$/.test(c.cwd)));
  assert.match(racers[0]!.prompt, /Repair it in place/);
  assert.match(racers[1]!.prompt, REWRITE);
  assert.ok(racers.every((c) => /expected fixed\.txt to say ok/.test(c.prompt)), "both are told what fails");
  assert.ok(racers.every((c) => !/answer with status "split"/.test(c.prompt)), "a racer is not offered a split");
  const done = events.find((e) => e.type === "race.finished");
  assert.equal(done?.feature, "F102");
  assert.equal(done?.winner, "b");
  assert.equal(state.tasks[0]?.raced, true);
  assert.equal(state.tasks[0]?.escalated, false);
  assert.ok(!worktrees(repo).some((t) => /race-/.test(t)), "the copies are gone");
  assert.equal(readFileSync(join(state.worktree, "fixed.txt"), "utf8").trim(), "ok");
});

test("F102: when both attempts pass, the smaller change wins", async () => {
  const { ctx, events } = context((req) => {
    const racing = /in your own copy of the project/.test(req.prompt);
    write(req.cwd, "fixed.txt", racing ? "ok" : "nope");
    if (racing && !REWRITE.test(req.prompt)) write(req.cwd, "extra.txt", "x".repeat(4_000));
    return report("tried");
  });
  const state = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  const done = events.find((e) => e.type === "race.finished");
  assert.equal(done?.winner, "b");
  assert.equal(done?.passed, 2);
  assert.ok(!existsSync(join(state.worktree, "extra.txt")), "the losing copy's files are not the task's");
});

test("F102: when neither attempt passes, the task goes on to the expert as before, once", async () => {
  const { ctx, events } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "fixed.txt must contain exactly ok", steps: ["Write ok"] } };
    write(req.cwd, "fixed.txt", /Diagnosis:/.test(req.prompt) ? "ok" : "nope");
    return report("tried");
  });
  const state = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair", "race", "race", "advice", "advised-fix"]);
  assert.equal(events.find((e) => e.type === "race.finished")?.passed, 0);
  assert.match(state.tasks[0]!.history.at(-1)?.failures ?? "", /Two fresh attempts at the repair/, "the expert is told the race failed too");
});

test("F102: no race where nothing dearer follows, where the project has no checks, or below the top of a tier", async () => {
  // Nothing above the worker: a solo run fails as it did, and its cost stays what "that model alone" means.
  const solo = context((req) => (write(req.cwd, "fixed.txt", "nope"), report("tried")));
  const a = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset() }, solo.ctx);
  assert.deepEqual(a.attempts.map((x) => x.kind), ["initial", "repair"]);

  // A two-rung ladder: the climb to the stronger rung of the same tier is not a race; the top rung's exit to the expert is.
  const ladder = [
    { backend: "fake", model: "low", tier: "worker" as const },
    { backend: "fake", model: "high", tier: "worker" as const },
  ];
  const climbing = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "d", steps: ["s"] } };
    write(req.cwd, "fixed.txt", /Diagnosis:/.test(req.prompt) ? "ok" : "nope");
    return report("tried");
  });
  const b = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { advise: true, workerLadder: ladder }) }, climbing.ctx);
  assert.equal(b.status, "finished", b.reason);
  assert.deepEqual(b.attempts.map((x) => `${x.model}:${x.kind}`), ["low:initial", "low:repair", "high:climb", "high:repair", "high:race", "high:race", "fake-expert:advice", "high:advised-fix"]);
});

// ---------------------------------------------------------------------------
// F103 evidence-override

function tableOf(cluster: "worker" | "senior", tier: "grunt" | "worker" | "senior", tries: number, passes: number): CalibrationTable {
  const table: CalibrationTable = { version: 1, cells: {} };
  for (let i = 0; i < tries; i++) record(table, { cluster, tiers: [tier], passed: i < passes });
  return table;
}

test("F103: enough failures of the matched tier overrule a confident match upward; a handful does not", () => {
  // The worker failed 5 of 6 worker-like tasks here.
  const bad = tableOf("worker", "worker", 6, 1);
  const e = evidencePick(bad, "worker", "worker");
  assert.equal(e?.tier, "senior");
  assert.equal(e?.direction, "up");
  assert.equal(e?.tries, 6);
  assert.equal(evidencePick(tableOf("worker", "worker", MIN_EVIDENCE - 1, 0), "worker", "worker"), undefined, "four runs are not a rate");
  assert.equal(evidencePick(tableOf("worker", "worker", 8, 8), "worker", "worker"), undefined, "a tier that passes stays");

  const request = { request: "Add a --verbose flag to the CLI and unit tests for it.", kind: "feature" as const };
  const plain = routeTier(request, calibrated(bad), { instructionOnly: true });
  assert.equal(plain.tier, "worker", "with the feature off the match stands");
  const routed = routeTier(request, calibrated(bad), { instructionOnly: true, evidence: true });
  assert.equal(routed.tier, "senior");
  assert.equal(routed.stage, "calibrated");
  assert.equal(routed.evidence?.from, "worker");
  assert.match(routed.reasons.join(" "), /the worker tier passed about \d+% of 6 such tasks here: senior/);
  assert.match(describeCalibration(bad).join("\n"), /worker-like requests matched to worker start on senior/);
});

test("F103: a cheaper tier with a record that clears the bar is used instead, but never the grunt for something to build", () => {
  const good = tableOf("senior", "worker", 6, 6);
  const e = evidencePick(good, "senior", "senior");
  assert.equal(e?.tier, "worker");
  assert.equal(e?.direction, "down");
  const refactor = { request: "Refactor the parser across the modules and fix the state machine.", kind: "refactor" as const };
  assert.equal(routeTier(refactor, calibrated(good), { evidence: true }).tier, "worker");
  assert.equal(routeTier(refactor, calibrated(good), {}).tier, "senior");

  const grunt = tableOf("worker", "grunt", 6, 6);
  const feature = { request: "Add a --verbose flag to the CLI and unit tests for it.", kind: "feature" as const };
  assert.equal(routeTier(feature, calibrated(grunt), { evidence: true }).tier, "worker");
});

test("F103: a probe starts a share of confident senior matches on the worker, the same request always the same way", () => {
  const empty: CalibrationTable = { version: 1, cells: {} };
  const requests = Array.from({ length: 200 }, (_, i) => `Refactor the parser across the modules, variant ${i}, and fix the state machine.`);
  const probed = requests.filter((r) => routeTier({ request: r, kind: "refactor" }, calibrated(empty), { evidence: true, probe: 0.2 }).probe);
  assert.ok(probed.length > 15 && probed.length < 70, `about a fifth probe (${probed.length} of 200)`);
  for (const r of probed.slice(0, 5)) {
    const again = routeTier({ request: r, kind: "refactor" }, calibrated(empty), { evidence: true, probe: 0.2 });
    assert.equal(again.tier, "worker");
    assert.equal(again.probe, true);
    assert.equal(routeTier({ request: r, kind: "refactor" }, calibrated(empty), { evidence: true }).tier, "senior", "no probe unless the preset asks");
  }
  assert.equal(probeDraw("abc"), probeDraw("abc"));
  // Only senior matches: a worker match is never probed down to the grunt.
  assert.ok(!routeTier({ request: "Add a --verbose flag to the CLI and unit tests for it.", kind: "feature" }, calibrated(empty), { evidence: true, probe: 1 }).probe);
});

// ---------------------------------------------------------------------------
// F104 quota-shift

test("F104: a reading is known only while its window lasts; an unknown never moves a turn", () => {
  const now = 1_800_000_000_000;
  const shift = { backend: "claude", window: "five_hour", above: 0.7, to: [{ backend: "codex", model: "luna" }] };
  assert.deepEqual(shiftNow(shift, { used: { five_hour: 0.82 }, at: now - 60_000 }, now), { used: 0.82 });
  assert.equal(shiftNow(shift, { used: { five_hour: 0.69 }, at: now }, now), undefined, "below the threshold");
  assert.equal(shiftNow(shift, undefined, now), undefined, "never read");
  assert.equal(shiftNow(shift, { used: { seven_day: 0.9 }, at: now }, now), undefined, "another window");
  assert.equal(windowUsed({ used: { five_hour: 0.9 }, at: now - MAX_AGE_MS - 1 }, "five_hour", now), undefined, "too old to say anything about now");
  assert.equal(windowUsed({ used: { five_hour: 0.9 }, resets: { five_hour: now / 1000 - 10 }, at: now - 60_000 }, "five_hour", now), undefined, "the window has reset since");
  assert.equal(windowUsed({ used: { five_hour: 0.9 }, resets: { five_hour: now / 1000 + 600 }, at: now - 60_000 }, "five_hour", now), 0.9);

  const home = join(scratch, `home-${++counter}`);
  recordQuota(home, "claude", { five_hour: 0.4, seven_day: 0.2 }, { five_hour: 123 }, now);
  recordQuota(home, "claude", { five_hour: 0.75 }, undefined, now + 1);
  assert.deepEqual(loadQuota(home).claude, { used: { five_hour: 0.75, seven_day: 0.2 }, resets: { five_hour: 123 }, at: now + 1 });
  writeFileSync(join(home, "quota.json"), "{ not json");
  assert.deepEqual(loadQuota(home), {}, "a damaged file is an unknown reading");
});

test("F104: a preset's quotaShift is checked, and moves turns only to another tool", () => {
  const base = { name: "p", mode: "solo", roles: { worker: { backend: "claude", model: "haiku" } } };
  const ok = validatePreset({ ...base, quotaShift: { backend: "claude", above: 0.7, to: { backend: "codex", model: "luna" } } }, "p.json");
  assert.deepEqual(ok.quotaShift, { backend: "claude", window: "five_hour", above: 0.7, to: [{ backend: "codex", model: "luna", effort: undefined, tier: "worker" }] });
  assert.throws(() => validatePreset({ ...base, quotaShift: { backend: "claude", above: 0.7, to: { backend: "claude", model: "haiku" } } }, "p.json"), /another tool/);
  assert.throws(() => validatePreset({ ...base, quotaShift: { backend: "claude", above: 7, to: { backend: "codex" } } }, "p.json"), /fraction/);
  const shipped = validatePreset(JSON.parse(readFileSync(new URL("../presets/cascade-hybrid.json", import.meta.url), "utf8")), "cascade-hybrid.json");
  assert.equal(shipped.quotaShift?.backend, "claude");
  assert.equal(shipped.cascade?.probe, 0.2);
});

const SHIFT = { backend: "fake", window: "five_hour", above: 0.7, to: [{ backend: "other", model: "luna", tier: "worker" as const }] };

test("F104: once the watched window passes the threshold, the worker's next turn goes to the other plan; the expert stays", async () => {
  const repo = fixable();
  const { ctx, fake, extra, events, home } = context(
    (req) => {
      if (isAdvice(req)) return { structured: { diagnosis: "fixed.txt must contain exactly ok", steps: ["Write ok"] }, quotaUsed: { five_hour: 0.9 } };
      // The worker on the watched plan gets it wrong, and its tool reports the window at 80%.
      write(req.cwd, "fixed.txt", "nope");
      return { ...report("tried"), quotaUsed: { five_hour: 0.8 }, quotaResets: { five_hour: Date.now() / 1000 + 3_600 } };
    },
    {
      other: (req) => {
        write(req.cwd, "fixed.txt", /Diagnosis:/.test(req.prompt) ? "ok" : "still nope");
        return report("the other plan's worker");
      },
    },
  );
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true, quotaShift: SHIFT, disable: ["repair-race"] }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => `${a.backend}/${a.model}:${a.kind}`), ["fake/fake-worker:initial", "other/luna:repair", "fake/fake-expert:advice", "other/luna:advised-fix"]);
  assert.equal(fake.calls.filter(isAdvice).length, 1, "the expert's turn stayed on its own plan");
  // The repair moved to a model with no session of its own: it gets the whole task, not "fix it" alone.
  assert.match(extra.other!.calls[0]!.prompt, /make the test pass/);
  assert.match(extra.other!.calls[0]!.prompt, /An earlier attempt at this task already changed some files/);
  const moved = events.filter((e) => e.type === "quota.shifted");
  assert.equal(moved.length, 1, "said once");
  assert.equal(moved[0]?.feature, "F104");
  assert.equal(moved[0]?.used, 0.8);
  assert.equal(loadQuota(home).fake?.used.five_hour, 0.9, "the latest reading is kept for the next run");
});

test("F104: an earlier run's reading moves the first turn; a stale one, no reading, or the feature off moves nothing", async () => {
  const good: FakeScript = (req) => (write(req.cwd, "fixed.txt", "ok"), report("done"));
  const run = async (seed: (home: string) => void, extra: Partial<Preset> = {}) => {
    const c = context(good, { other: good });
    seed(c.home);
    const state = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({}, { quotaShift: SHIFT, ...extra }) }, c.ctx);
    assert.equal(state.status, "finished", state.reason);
    return state.attempts.map((a) => a.backend);
  };
  assert.deepEqual(await run((home) => recordQuota(home, "fake", { five_hour: 0.95 })), ["other"]);
  assert.deepEqual(await run((home) => recordQuota(home, "fake", { five_hour: 0.95 }, undefined, Date.now() - MAX_AGE_MS - 60_000)), ["fake"], "a stale reading is unknown");
  assert.deepEqual(await run(() => {}), ["fake"], "never read: unknown, not 0 and not full");
  assert.deepEqual(await run((home) => recordQuota(home, "fake", { five_hour: 0.5 })), ["fake"]);
  assert.deepEqual(await run((home) => recordQuota(home, "fake", { five_hour: 0.95 }), { disable: ["quota-shift"] }), ["fake"]);
});

test("F104: a senior's turns are not moved", async () => {
  // The worker's turn moves to the other plan and fails there; the senior rung it climbs to stays on the watched plan.
  const c = context(
    (req) => (write(req.cwd, "fixed.txt", req.model === "senior" ? "ok" : "nope"), report("tried")),
    { other: (req) => (write(req.cwd, "fixed.txt", "nope"), report("the other plan, wrong")) },
  );
  recordQuota(c.home, "fake", { five_hour: 0.95 });
  const senior = { backend: "fake", model: "senior", tier: "worker" as const };
  const state = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 0, workerLadder: [WORKER], seniorLadder: [senior], quotaShift: SHIFT, disable: ["repair-race"] }) }, c.ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => `${a.backend}/${a.model}:${a.kind}`), ["other/luna:initial", "fake/senior:climb"]);
});

// ---------------------------------------------------------------------------
// A failing feature is tagged with its id, switched off, and the run goes on without it.

test("F100 to F104: an injected fault in each is recorded under its id and the run finishes without the feature", async () => {
  const fault = async (key: string, run: () => Promise<{ status: string; reason?: string; featureErrors?: { id: string; key: string }[] }>): Promise<void> => {
    process.env.NEUROMESH_FAULT = key;
    try {
      const state = await run();
      assert.equal(state.status, "finished", `${key}: ${state.reason}`);
      assert.ok(state.featureErrors?.some((e) => e.key === key && /^F10[0-4]$/.test(e.id)), `${key} is named in the run's feature errors`);
    } finally {
      delete process.env.NEUROMESH_FAULT;
    }
  };
  const good: FakeScript = (req) => (write(req.cwd, "fixed.txt", "ok"), report("done"));

  // F100: the first prompt simply has no lead.
  await fault("start-here", async () => {
    const c = context(good);
    const state = await startRun({ cwd: makeRepo({ "src/context.js": CONTEXT_JS, "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }), "check.js": "if(!require('fs').existsSync('fixed.txt'))process.exit(1)" }), prompt: "fix compactNotes", preset: preset() }, c.ctx);
    assert.doesNotMatch(c.fake.calls[0]!.prompt, /Start here/);
    return state;
  });

  // F101: the work that passed its checks merges as it would have.
  await fault("blind-tests", async () => {
    const c = context(cacheWorker(() => assert.fail("no fix turn"), [blindTest("x")]));
    const state = await startRun({ cwd: testable(), prompt: BLIND_REQUEST, preset: preset() }, c.ctx);
    assert.deepEqual(state.attempts.map((a) => a.kind), ["initial"]);
    return state;
  });

  // F102: the stuck task goes to the expert, as before the race existed.
  await fault("repair-race", async () => {
    const c = context((req) => {
      if (isAdvice(req)) return { structured: { diagnosis: "fixed.txt must contain exactly ok", steps: ["Write ok"] } };
      write(req.cwd, "fixed.txt", /Diagnosis:/.test(req.prompt) ? "ok" : "nope");
      return report("tried");
    });
    const repo = fixable();
    const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { advise: true }) }, c.ctx);
    assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair", "advice", "advised-fix"]);
    assert.ok(!worktrees(repo).some((t) => /race-/.test(t)));
    return state;
  });

  // F104: the turn stays on its own plan.
  await fault("quota-shift", async () => {
    const c = context(good, { other: good });
    recordQuota(c.home, "fake", { five_hour: 0.95 });
    const state = await startRun({ cwd: fixable(), prompt: "make the test pass", preset: preset({}, { quotaShift: SHIFT }) }, c.ctx);
    assert.deepEqual(state.attempts.map((a) => a.backend), ["fake"]);
    return state;
  });

  // F103: Tier 0 goes on with the match alone.
  await fault("evidence-override", async () => {
    const c = context(good);
    mkdirSync(join(c.home, "routing"), { recursive: true });
    writeFileSync(join(c.home, "routing", "calibration.json"), JSON.stringify(tableOf("worker", "worker", 6, 1)));
    const cascade: Partial<Preset> = { mode: "team", brief: true, routing: "worker-first", roles: { worker: [WORKER], orchestrator: [EXPERT], escalation: [EXPERT] }, workerLadder: [WORKER], seniorLadder: [{ backend: "fake", model: "senior", tier: "worker" }], cascade: {} };
    const state = await startRun({ cwd: fixable(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset({}, cascade) }, c.ctx);
    assert.equal(c.events.find((e) => e.type === "route.tier")?.tier, "worker", "the match stands");
    return state;
  });
});

test("F103: in a run, the record sends a worker-like request to the senior and says why", async () => {
  const c = context((req) => (write(req.cwd, "fixed.txt", "ok"), report("done")));
  mkdirSync(join(c.home, "routing"), { recursive: true });
  writeFileSync(join(c.home, "routing", "calibration.json"), JSON.stringify(tableOf("worker", "worker", 6, 1)));
  const cascade: Partial<Preset> = { mode: "team", brief: true, routing: "worker-first", roles: { worker: [WORKER], orchestrator: [EXPERT], escalation: [EXPERT] }, workerLadder: [WORKER], seniorLadder: [{ backend: "fake", model: "senior", tier: "worker" }], cascade: {} };
  const state = await startRun({ cwd: fixable(), prompt: "Add a --verbose flag to the CLI and unit tests for it.", preset: preset({}, cascade) }, c.ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(c.events.find((e) => e.type === "route.tier")?.tier, "senior");
  const why = c.events.find((e) => e.type === "route.evidence");
  assert.equal(why?.feature, "F103");
  assert.equal(why?.direction, "up");
  assert.equal(why?.from, "worker");
  assert.equal(c.fake.calls.filter(isBuild)[0]?.model, "senior");
});
