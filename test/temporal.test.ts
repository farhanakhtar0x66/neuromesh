// [F140 temporal-cascade] [F141 cleanroom-handoff] The temporal cascade end to end on the fake backend and the mock
// Laya server, and the handoff's pieces. No model calls; Laya is the in-process mock or a closed port.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { claudeArgs, claudeParser } from "../src/backends/claude.ts";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { AgentRequest, AgentResult } from "../src/backends/types.ts";
import { resumeRun, startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { loadState } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { loadPreset } from "../src/presets/presets.ts";
import { MAX_DIGEST_TOKENS, buildCleanRoomFactsPacket, buildTrajectoryDigest, framePointers, parseTrajectory } from "../src/routing/handoff.ts";
import type { CheapTurn } from "../src/routing/handoff.ts";
import { estimateTokens } from "../src/routing/probe.ts";
import type { ProbeFacts } from "../src/routing/probe.ts";
import { conformal, startMockLaya } from "./support/mock-laya.ts";
import type { MockLaya } from "./support/mock-laya.ts";

const scratch = mkdtempSync(join(tmpdir(), "nm-temporal-test-"));
let laya: MockLaya;
let closedUrl: string;
before(async () => {
  laya = await startMockLaya();
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  closedUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  await new Promise<void>((r) => s.close(() => r()));
});
after(async () => {
  await laya.close();
  rmSync(scratch, { recursive: true, force: true });
});
let counter = 0;

/** What the cheap model "thinks": none of it may reach the stronger model. */
const CHEAP_TEXT = "CHEAP-DIAGNOSIS the root cause is the cache in store.js; plan: rewrite the mutex";
const POISON = "cheap-probe-edit";

function repo(files: Record<string, string>): string {
  const dir = join(scratch, `repo-${++counter}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

/** A check that passes once `file` contains `text`. */
const checkFor = (file: string, text: string): Record<string, string> => ({
  "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
  "check.js": `const fs=require('fs');if(!fs.existsSync(${JSON.stringify(file)})||!fs.readFileSync(${JSON.stringify(file)},'utf8').includes(${JSON.stringify(text)})){console.error('AssertionError: expected ${file} to contain ${text}\\n    at check (check.js:1:1)');process.exit(1)}`,
});

/** The small, coupled async app of probe archetype 1. */
function coupledApp(): string {
  const files: Record<string, string> = {
    ...checkFor("src/store.js", "versioned"),
    "src/store.js": "import { Mutex } from './mutex.js';\nconst lock = new Mutex();\nexport async function update(key, value) {\n  await lock.acquire();\n  try { state[key] = value; } finally { lock.release(); }\n}\nexport const state = {};\n",
    "src/mutex.js": "export class Mutex { async acquire() {} release() {} }\n",
  };
  for (const name of ["cart", "users", "orders", "search", "checkout", "profile"]) files[`src/${name}.js`] = `import { update, state } from './store.js';\nexport function ${name}View() {\n  return state.${name};\n}\n`;
  return repo(files);
}

/** A Claude Code stream log for the cheap turn: tool calls, and text that must never be read. */
function writeLog(req: AgentRequest, tools: { name: string; input: Record<string, unknown>; error?: boolean }[]): void {
  if (!req.logPath) return;
  mkdirSync(dirname(req.logPath), { recursive: true });
  const lines: unknown[] = [{ type: "assistant", message: { id: "m0", content: [{ type: "text", text: CHEAP_TEXT }] } }];
  tools.forEach((t, i) => {
    lines.push({ type: "assistant", message: { id: `m${i + 1}`, content: [{ type: "tool_use", id: `tu${i}`, name: t.name, input: t.input }] } });
    lines.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tu${i}`, is_error: t.error === true, content: "..." }] } });
  });
  writeFileSync(req.logPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const report = (summary: string): Partial<AgentResult> => ({ structured: { status: "done", summary, notes: summary } });
const answers = (mech: boolean, inv: boolean, cheap: boolean) => ({ answers: [conformal("is_mechanical_or_localized", mech), conformal("has_implied_invariants", inv), conformal("cheap_will_resolve", cheap)] });

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

async function runTemporal(dir: string, prompt: string, script: (req: AgentRequest, i: number) => Partial<AgentResult>, layaUrl: string, extra: Partial<EngineContext> = {}) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script as never, "claude");
  const ctx: EngineContext = { home: join(scratch, `home-${++counter}`), backends: { claude: fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 10_000, layaUrl, ...extra };
  const state = await startRun({ cwd: dir, prompt, preset: loadPreset("temporal-claude") }, ctx);
  return { state, fake, events, ctx };
}

const diffOf = (state: RunState): string => (existsSync(join(state.dir, "diff.patch")) ? readFileSync(join(state.dir, "diff.patch"), "utf8") : "");

// ---------------------------------------------------------------------------
// 1. Easy-looking, complex: the probe wanders, Laya says Opus, the cheap edits are gone, Opus sees facts only.

test("easy-looking complex repo: a capped Haiku probe, Laya escalate_opus, a clean room, a facts-only Opus", async () => {
  laya.reply = { json: answers(false, true, false) };
  laya.requests.length = 0;
  const seen: { model?: string; poisonAtStart?: boolean; prompt: string; maxTurns?: number; append?: string }[] = [];
  const run = await runTemporal(coupledApp(), "the app sometimes shows stale data after a refresh, make it more robust", (req) => {
    seen.push({ model: req.model, poisonAtStart: existsSync(join(req.cwd, "poison.js")), prompt: req.prompt, maxTurns: req.maxTurns, append: req.appendSystemPrompt });
    if (req.model === HAIKU) {
      writeLog(req, [
        { name: "Read", input: { file_path: join(req.cwd, "src/cart.js") } },
        { name: "Grep", input: { path: join(req.cwd, "src/users.js"), pattern: "state" } },
        { name: "Read", input: { file_path: join(req.cwd, "src/cart.js") } },
        { name: "Bash", input: { command: "node check.js" }, error: true },
        { name: "Bash", input: { command: "node check.js" }, error: true },
        { name: "Edit", input: { file_path: join(req.cwd, "src/store.js") } },
      ]);
      writeFileSync(join(req.cwd, "poison.js"), `// ${POISON}\n`);
      writeFileSync(join(req.cwd, "src/store.js"), `// ${POISON}: ${CHEAP_TEXT}\n`);
      return { ...report(CHEAP_TEXT), capped: true, usage: { calls: 4 } };
    }
    // Opus: fixes the store properly.
    writeFileSync(join(req.cwd, "src/store.js"), "export const state = {}; // versioned\n");
    return report("versioned the store");
  }, laya.url);
  assert.equal(run.state.status, "finished", run.state.reason);
  const t = run.state.tasks[0]!.temporal!;
  assert.equal(t.action, "escalate_opus");
  assert.equal(t.conformalAuto, true);
  assert.equal(t.resets, 1);
  assert.deepEqual(seen.map((s) => s.model), [HAIKU, OPUS]);
  assert.equal(seen[0]!.maxTurns, 4, "the probe's checkpoint cap");
  const opus = seen[1]!;
  assert.equal(opus.poisonAtStart, false, "the cheap edits were discarded before Opus started");
  assert.equal(opus.maxTurns, undefined);
  assert.ok(!opus.prompt.includes("CHEAP") && !opus.prompt.includes("root cause") && !opus.prompt.includes(POISON), "no cheap diagnosis, plan or edit in Opus's input");
  assert.ok(!opus.append?.includes("CHEAP"));
  assert.match(opus.prompt, /the app sometimes shows stale data/, "the request as typed");
  assert.match(opus.prompt, /Facts Neuromesh verified by running the project's checks before any change/);
  assert.match(opus.prompt, /`npm test` exits 1 on the unchanged code/);
  assert.match(opus.prompt, /expected src\/store\.js to contain versioned/, "the verified failure output");
  assert.ok(!opus.prompt.includes("behaviour the request does not mention"), "F132");
  assert.ok(!diffOf(run.state).includes(POISON), "nothing of the cheap work in the result");
  // Laya was asked once, with the probe's text and the digest, and no file names or cheap text.
  assert.equal(laya.requests.length, 1);
  const context = (laya.requests[0]!.body as { state: string }).state;
  assert.match(context, /tiny repository, with high cross-module coupling/);
  assert.match(context, /re-read a file|same failing command/);
  assert.ok(!context.includes("CHEAP") && !context.includes("store.js") && !context.includes("cart.js"));
  const stages = run.events.filter((e) => e.type === "temporal.stage").map((e) => e.stage);
  assert.deepEqual(stages, ["probe_running", "probe_done", "laya_decided", "cleanroom_reset", "cleanroom_reset_done", "escalated_running"]);
});

// ---------------------------------------------------------------------------
// 2. Complex-looking, easy: a rename in a 200-file repository, Laya says continue, Haiku finishes.

test("complex-looking easy repo: a rename, Laya continue_cheap, Haiku finishes in its extra turns", async () => {
  const files: Record<string, string> = { ...checkFor("src/dto/UserDto.ts", "AccountDto") };
  for (let i = 0; i < 199; i++) files[`src/dto/Item${i}Dto.ts`] = `export interface Item${i}Dto {\n  id: string;\n  name: string;\n}\n`;
  files["src/dto/UserDto.ts"] = "export interface UserDto {\n  id: string;\n  name: string;\n}\n";
  laya.reply = { json: answers(true, false, true) };
  const models: (string | undefined)[] = [];
  const resumes: (string | undefined)[] = [];
  const caps: (number | undefined)[] = [];
  const run = await runTemporal(repo(files), "Rename `UserDto` to `AccountDto` in src/dto/UserDto.ts.", (req, i) => {
    models.push(req.model);
    resumes.push(req.resumeSessionId);
    caps.push(req.maxTurns);
    if (i === 0) {
      writeLog(req, [{ name: "Read", input: { file_path: join(req.cwd, "src/dto/UserDto.ts") } }]);
      return { ...report("started"), capped: true, sessionId: "haiku-1" };
    }
    writeFileSync(join(req.cwd, "src/dto/UserDto.ts"), "export interface AccountDto {\n  id: string;\n  name: string;\n}\n");
    return { ...report("renamed"), sessionId: "haiku-1" };
  }, laya.url);
  assert.equal(run.state.status, "finished", run.state.reason);
  assert.deepEqual(models, [HAIKU, HAIKU], "no stronger model");
  assert.deepEqual(resumes, [undefined, "haiku-1"], "the same session, resumed");
  assert.equal(run.state.probe?.facts.trivialSelfContained, true, "a named one-file rename is trivially self-contained");
  assert.deepEqual(caps, [6, 6], "the trivial cap, then the continuation cap");
  const t = run.state.tasks[0]!.temporal!;
  assert.equal(t.action, "continue_cheap");
  assert.equal(t.resets, 0);
  assert.match(diffOf(run.state), /AccountDto/);
});

// ---------------------------------------------------------------------------
// 3. An explicit bug in a medium repository: Haiku stalls, Laya says Sonnet, Sonnet fixes it.

test("explicit bug, Haiku stalls: Laya escalate_sonnet (nothing implied, auto), Sonnet runs in a clean room", async () => {
  const files: Record<string, string> = { ...checkFor("lib/parse.js", "trim()") };
  for (let i = 0; i < 40; i++) files[`lib/mod${i}.js`] = `export function mod${i}() { return ${i}; }\n`;
  files["lib/parse.js"] = "export function parseLine(line) {\n  return line.split(',');\n}\n";
  laya.reply = { json: answers(false, false, false) };
  const seen: { model?: string; prompt: string; poison: boolean }[] = [];
  const run = await runTemporal(repo(files), "parseLine in lib/parse.js keeps surrounding spaces: `parseLine(' a, b')` should return ['a', 'b'].", (req) => {
    seen.push({ model: req.model, prompt: req.prompt, poison: existsSync(join(req.cwd, "scratch-repro.js")) });
    if (req.model === HAIKU) {
      writeLog(req, [1, 2, 3].map(() => ({ name: "Bash", input: { command: "node check.js" }, error: true })));
      writeFileSync(join(req.cwd, "scratch-repro.js"), `// ${POISON}\n`);
      return { ...report(CHEAP_TEXT), capped: true };
    }
    writeFileSync(join(req.cwd, "lib/parse.js"), "export function parseLine(line) {\n  return line.split(',').map((s) => s.trim());\n}\n");
    return report("trimmed");
  }, laya.url);
  assert.equal(run.state.status, "finished", run.state.reason);
  assert.deepEqual(seen.map((s) => s.model), [HAIKU, SONNET]);
  const sonnet = seen[1]!;
  assert.equal(sonnet.poison, false, "Haiku's reproduction script was discarded");
  assert.ok(!sonnet.prompt.includes("CHEAP") && !sonnet.prompt.includes(POISON));
  assert.equal(run.state.tasks[0]!.temporal!.action, "escalate_sonnet");
  assert.ok(!diffOf(run.state).includes(POISON));
});

test("Sonnet failing the checks falls back once to Opus, in a fresh clean room", async () => {
  const files: Record<string, string> = { ...checkFor("lib/parse.js", "trim()") };
  files["lib/parse.js"] = "export function parseLine(line) {\n  return line.split(',');\n}\n";
  laya.reply = { json: answers(false, false, false) };
  const seen: { model?: string; sonnetLeft: boolean }[] = [];
  const run = await runTemporal(repo(files), "parseLine in lib/parse.js keeps surrounding spaces.", (req) => {
    seen.push({ model: req.model, sonnetLeft: existsSync(join(req.cwd, "sonnet-attempt.js")) });
    if (req.model === HAIKU) return { ...report("tried"), capped: true };
    if (req.model === SONNET) {
      writeFileSync(join(req.cwd, "sonnet-attempt.js"), "// wrong\n");
      return report("wrong fix");
    }
    writeFileSync(join(req.cwd, "lib/parse.js"), "export const parseLine = (l) => l.split(',').map((s) => s.trim());\n");
    return report("fixed");
  }, laya.url);
  assert.equal(run.state.status, "finished", run.state.reason);
  assert.deepEqual(seen.map((s) => s.model), [HAIKU, SONNET, OPUS]);
  assert.equal(seen[2]!.sonnetLeft, false, "Sonnet's failed work was discarded too");
  const t = run.state.tasks[0]!.temporal!;
  assert.equal(t.resets, 2);
  assert.equal(t.seniorFellBack, true);
});

// ---------------------------------------------------------------------------
// 4. Laya offline: conservative escalation, no crash.

test("Laya offline: the gate escalates conservatively by the probe and the run finishes", async () => {
  const run = await runTemporal(coupledApp(), "make the store more robust", (req) => {
    if (req.model === HAIKU) {
      writeFileSync(join(req.cwd, "poison.js"), `// ${POISON}\n`);
      return { ...report("partial"), capped: true };
    }
    writeFileSync(join(req.cwd, "src/store.js"), "export const state = {}; // versioned\n");
    return report("done");
  }, closedUrl);
  assert.equal(run.state.status, "finished", run.state.reason);
  const t = run.state.tasks[0]!.temporal!;
  assert.equal(t.laya, "unavailable");
  assert.equal(t.action, "escalate_opus", "a hard repository goes to the expert, never stays cheap");
  assert.equal(t.conformalAuto, false);
  assert.ok(run.fake.calls.every((c) => c.model !== SONNET));
  assert.ok(!diffOf(run.state).includes(POISON));
});

test("a passing, mechanical probe is accepted without Laya; a green-start suite is not trusted", async () => {
  laya.requests.length = 0;
  const files: Record<string, string> = { ...checkFor("src/dto/UserDto.ts", "AccountDto") };
  for (let i = 0; i < 30; i++) files[`src/dto/Item${i}Dto.ts`] = `export interface Item${i}Dto {\n  id: string;\n}\n`;
  files["src/dto/UserDto.ts"] = "export interface UserDto {\n  id: string;\n}\n";
  const run = await runTemporal(repo(files), "Rename `UserDto` to `AccountDto` in src/dto/UserDto.ts.", (req) => {
    writeFileSync(join(req.cwd, "src/dto/UserDto.ts"), "export interface AccountDto {\n  id: string;\n}\n");
    return report("renamed");
  }, laya.url);
  assert.equal(run.state.status, "finished");
  assert.equal(run.fake.calls.length, 1);
  assert.equal(laya.requests.length, 0, "Laya not needed");
  assert.equal(run.state.tasks[0]!.temporal!.stage, "probe_done");
});

// ---------------------------------------------------------------------------
// Resume: a kill mid-solve neither resets again nor brings the cheap edits back.

test("an interrupted Opus turn resumes in the clean room without a second reset", async () => {
  laya.reply = { json: answers(false, true, false) };
  const stopper = new AbortController();
  const dir = coupledApp();
  const first = await runTemporal(dir, "make the store more robust", (req) => {
    if (req.model === HAIKU) {
      writeFileSync(join(req.cwd, "poison.js"), `// ${POISON}\n`);
      return { ...report(CHEAP_TEXT), capped: true };
    }
    // Opus starts, writes part of its work, and the engine is stopped under it.
    writeFileSync(join(req.cwd, "opus-progress.txt"), "half\n");
    stopper.abort();
    return new Promise(() => {}) as never;
  }, laya.url, { signal: stopper.signal });
  assert.equal(first.state.status, "interrupted");
  assert.equal(first.state.tasks[0]!.temporal!.stage, "escalated_running");
  const second = createFakeBackend(((req: AgentRequest) => {
    assert.equal(existsSync(join(req.cwd, "poison.js")), false);
    assert.equal(existsSync(join(req.cwd, "opus-progress.txt")), true, "Opus's own work so far is kept");
    writeFileSync(join(req.cwd, "src/store.js"), "export const state = {}; // versioned\n");
    return report("done");
  }) as never, "claude");
  const resumed = await resumeRun(loadState(first.state.dir), { ...first.ctx, signal: undefined, backends: { claude: second } });
  assert.equal(resumed.status, "finished", resumed.reason);
  assert.equal(resumed.tasks[0]!.temporal!.resets, 1, "no second reset");
  assert.deepEqual(second.calls.map((c) => c.model), [OPUS]);
});

test("a run interrupted mid-reset redoes the reset and goes on", async () => {
  laya.reply = { json: answers(false, true, false) };
  const stopper = new AbortController();
  const first = await runTemporal(coupledApp(), "make the store more robust", (req) => {
    writeFileSync(join(req.cwd, "poison.js"), `// ${POISON}\n`);
    return { ...report("x"), capped: true };
  }, laya.url, {
    signal: stopper.signal,
    onEvent: (e) => {
      if (e.type === "temporal.stage" && e.stage === "cleanroom_reset") stopper.abort();
    },
  });
  assert.equal(first.state.tasks[0]!.temporal!.stage, "cleanroom_reset");
  const second = createFakeBackend(((req: AgentRequest) => {
    assert.equal(existsSync(join(req.cwd, "poison.js")), false);
    writeFileSync(join(req.cwd, "src/store.js"), "export const state = {}; // versioned\n");
    return report("done");
  }) as never, "claude");
  const resumed = await resumeRun(loadState(first.state.dir), { ...first.ctx, signal: undefined, onEvent: undefined, backends: { claude: second } });
  assert.equal(resumed.status, "finished", resumed.reason);
  assert.equal(resumed.tasks[0]!.temporal!.resets, 1);
});

// ---------------------------------------------------------------------------
// F141 pieces

const BIG: ProbeFacts = { repoFileCount: 400, namedSymbols: [], candidateFiles: ["src/store.js"] } as unknown as ProbeFacts;

test("the trajectory is read from tool calls only, and the digest has no names and stays short", () => {
  const log = [
    { type: "assistant", message: { content: [{ type: "text", text: CHEAP_TEXT }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Read", input: { file_path: "src/a/x.js" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", is_error: false }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", is_error: true }] } },
    "not json",
  ].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");
  const tools = parseTrajectory(log);
  assert.deepEqual(tools, [{ name: "Read", path: "src/a/x.js" }, { name: "Bash", command: "npm test", failed: true }]);
  assert.ok(!JSON.stringify(tools).includes("CHEAP"));
  const scattered: CheapTurn = { tools: ["a", "b", "c", "d", "e"].map((d) => ({ name: "Read", path: `${d}/f.js` })), changedFiles: ["a/x.js", "b/y.js", "c/z.js"], checks: [{ name: "test", command: "npm test", status: "failed", exitCode: 1, durationMs: 1, tail: "x", logPath: "" }], capped: true };
  const digest = buildTrajectoryDigest(BIG, [scattered], [{ name: "test", command: "npm test", status: "passed", exitCode: 0, durationMs: 1, tail: "", logPath: "" }]);
  assert.match(digest, /many unrelated parts/);
  assert.match(digest, /spread over several modules/);
  assert.match(digest, /broke something it was not asked to touch/);
  assert.match(digest, /whole turn allowance/);
  assert.ok(estimateTokens(digest) < MAX_DIGEST_TOKENS);
  assert.ok(!/\.js|npm/.test(digest), "no file names or commands");
  assert.match(buildTrajectoryDigest(undefined, [{ tools: [{ name: "Read", path: "src/store.js" }] }]), /looked around/);
  assert.match(buildTrajectoryDigest(BIG, [{ tools: [{ name: "Read", path: "src/store.js" }], changedFiles: ["src/store.js"] }]), /went straight to the code the request names/);
});

test("the facts packet holds verified check output and gated pointers, never the cheap turns", () => {
  const dir = repo({ "src/store.js": "x\n", "lib/util.py": "y\n" });
  const baseline = [
    { name: "test", command: "npm test", status: "failed" as const, exitCode: 1, durationMs: 1, tail: "\u001b[31mError\u001b[0m at update (src/store.js:12:5)\n  File \"lib/util.py\", line 3, in f\n at node:internal/x.js:1:1", logPath: "" },
    { name: "lint", command: "npm run lint", status: "passed" as const, exitCode: 0, durationMs: 1, tail: "", logPath: "" },
  ];
  const cheap: CheapTurn[] = [{ tools: [{ name: "Bash", command: CHEAP_TEXT }], changedFiles: ["poison.js"] }];
  const packet = buildCleanRoomFactsPacket(BIG, cheap, { files: 2 }, { baseline, dir });
  assert.ok(!packet.includes("CHEAP") && !packet.includes("poison"));
  assert.match(packet, /an earlier attempt's changes were discarded/);
  assert.match(packet, /`npm test` exits 1 on the unchanged code/);
  assert.match(packet, /`npm run lint` passes on the unchanged code/);
  assert.ok(!packet.includes("\u001b["), "through F136's filter");
  assert.match(packet, /- src\/store\.js:12\n- lib\/util\.py:3/);
  assert.ok(!packet.split("Locations named")[1]!.includes("node:internal"), "a runtime frame is not a pointer");
  const named = buildCleanRoomFactsPacket({ ...BIG, namedSymbols: ["update"] } as ProbeFacts, cheap, { files: 0 }, { baseline, dir });
  assert.ok(!named.includes("Locations named"), "no pointers when the request names code (F130)");
  assert.ok(!named.includes("discarded"));
  const small = buildCleanRoomFactsPacket({ ...BIG, repoFileCount: 20 } as ProbeFacts, cheap, undefined, { baseline, dir });
  assert.ok(!small.includes("Locations named"), "no pointers in a small repository");
  assert.equal(buildCleanRoomFactsPacket(BIG, cheap, undefined, { dir }), "");
  assert.deepEqual(framePointers("a.js:1 b.js:2 c.js:3", dir), [], "only files that exist");
});

test("the Claude adapter caps turns with --max-turns and reads error_max_turns as a checkpoint", () => {
  const args = claudeArgs({ cwd: "/r", prompt: "p", access: "write", timeoutMs: 1, maxTurns: 4 });
  assert.equal(args[args.indexOf("--max-turns") + 1], "4");
  assert.ok(!claudeArgs({ cwd: "/r", prompt: "p", access: "write", timeoutMs: 1 }).includes("--max-turns"));
  const parser = claudeParser({});
  parser.onEvent({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s9", usage: { input_tokens: 1, output_tokens: 2 } });
  const r = parser.result();
  assert.equal(r.stop, "done");
  assert.equal(r.capped, true);
  assert.equal(r.sessionId, "s9");
});
