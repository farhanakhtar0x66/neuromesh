// [F136 lean-runner] and [F137 cache-accounting]: the output filter, the hook, the
// fresh-session rule, the lean prompt's cleanliness, and the explicit token fields.
// No model calls: the fake backend only.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeArgs, claudeParser } from "../src/backends/claude.ts";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { LEAN_FRESH_AT, LEAN_SKILL, changesOnDisk, leanFreshDue, leanRequest, leanTaskPrompt, sessionCalls } from "../src/engine/lean-runner.ts";
import { startRun, usageByModel } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { loadPreset } from "../src/presets/presets.ts";
import { linesFromEvent, linesFromState } from "../src/record/record.ts";
import { FILTER_FAILURES, FILTER_HEAD, FILTER_TAIL, cleanOutput, collapseRepeats, filterOutput, hookAnswer, hookSettings, shouldWrap, wrapCommand } from "../src/tools/leanfilter.ts";
import { sumTokenFields, tokenFields } from "../src/usage/tokens.ts";

const scratch = mkdtempSync(join(tmpdir(), "nm-lean-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

const F132_PHRASE = "behaviour the request does not mention";
const RUN_SCRIPT = fileURLToPath(new URL("../src/tools/lean-run.ts", import.meta.url));

// ---------------------------------------------------------------------------
// The output filter

const bigLog = (n: number): string => {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) lines.push(i % 97 === 0 ? `\u001b[31mFAILED tests/test_x.py::case_${i} - AssertionError\u001b[0m` : `collected item ${i}`);
  return lines.join("\n");
};

test("the filter is deterministic and keeps the head, the failure lines, the tail and the exit code", () => {
  const raw = bigLog(1000);
  const a = filterOutput(raw, 1);
  assert.equal(a, filterOutput(raw, 1), "same input, same output");
  const lines = a.split("\n");
  assert.equal(lines.at(-1), "[exit code 1]");
  assert.deepEqual(lines.slice(0, FILTER_HEAD), Array.from({ length: FILTER_HEAD }, (_, i) => `collected item ${i + 1}`));
  assert.ok(lines.includes("collected item 1000") && lines.includes(`collected item ${1000 - FILTER_TAIL + 1}`));
  assert.ok(!lines.includes(`collected item ${1000 - FILTER_TAIL}`), "nothing of the middle except failure lines");
  // Failures in the middle (97, 194, ..., 873 below line 941) are kept, without their colour codes.
  const failures = lines.filter((l) => l.startsWith("FAILED"));
  assert.ok(failures.length >= 9, String(failures.length));
  assert.ok(!a.includes("\u001b["), "ANSI codes are stripped");
  // The notice states exactly what was left out.
  const middle = 1000 - FILTER_HEAD - FILTER_TAIL;
  const kept = failures.filter((l) => lines.indexOf(l) > FILTER_HEAD && lines.indexOf(l) < lines.length - FILTER_TAIL - 1).length;
  assert.match(a, new RegExp(`shortened this output: ${middle - kept} of 1000 lines \\(\\d+ bytes\\) left out`));
  assert.match(a, new RegExp(`printed ${Buffer.byteLength(raw)} bytes in all`));
});

test("the filter's output is bounded however long the log is", () => {
  const raw = Array.from({ length: 50_000 }, (_, i) => `error at step ${i}`).join("\n");
  const lines = filterOutput(raw, 2).split("\n");
  // head + notice + failure header + failures + "last lines" + tail + exit code
  assert.ok(lines.length <= FILTER_HEAD + 1 + 1 + FILTER_FAILURES + 1 + FILTER_TAIL + 1, String(lines.length));
  const long = filterOutput("x".repeat(100_000), 0);
  assert.ok(long.length < 1_000, "a single huge line is cut");
});

test("short output is shown whole, with the exit code; a signal is an unknown exit code, not 0", () => {
  assert.equal(filterOutput("ok\n", 0), "ok\n[exit code 0]");
  assert.equal(filterOutput("", 0), "[exit code 0]");
  assert.match(filterOutput("x", null), /exit code unknown/);
});

test("carriage-return redraws, progress bars and repeated lines collapse", () => {
  assert.equal(cleanOutput("downloading 10%\rdownloading 50%\rdownloading 100%\ndone"), "downloading 100%\ndone");
  const bars = collapseRepeats(["[#####     ] 50%", "[########  ] 80%", "[##########] 100%", "next"]);
  assert.deepEqual(bars, ["[##########] 100%", "  (2 earlier progress lines left out)", "next"]);
  assert.deepEqual(collapseRepeats(["a", "a", "a", "a", "b"]), ["a", "  (the line above repeated 3 more times)", "b"]);
  assert.deepEqual(collapseRepeats(["a", "a", "b"]), ["a", "a", "b"]);
});

// ---------------------------------------------------------------------------
// The hook

test("the hook wraps ordinary Bash commands and leaves shell-state, background and other tools alone", () => {
  assert.ok(shouldWrap({ command: "pytest -q tests/test_a.py" }, RUN_SCRIPT));
  for (const command of ["cd src", "export X=1", "source .venv/bin/activate", "", `node ${RUN_SCRIPT} abc`, "node /x/nm.ts run -- pytest"]) assert.equal(shouldWrap({ command }, RUN_SCRIPT), false, command);
  assert.equal(shouldWrap({ command: "npm start", run_in_background: true }, RUN_SCRIPT), false);
  assert.equal(hookAnswer({ tool_name: "Read", tool_input: { file_path: "a" } }, RUN_SCRIPT), undefined);
  assert.equal(hookAnswer("not json", RUN_SCRIPT), undefined);
  const answer = hookAnswer({ tool_name: "Bash", tool_input: { command: "echo 'a \"b\"' $HOME", description: "d", timeout: 5 } }, RUN_SCRIPT) as { hookSpecificOutput: { updatedInput: Record<string, unknown>; hookEventName: string } };
  assert.equal(answer.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(answer.hookSpecificOutput.updatedInput.description, "d", "other inputs are kept");
  assert.equal(answer.hookSpecificOutput.updatedInput.timeout, 5);
  assert.equal(answer.hookSpecificOutput.updatedInput.command, wrapCommand("echo 'a \"b\"' $HOME", RUN_SCRIPT));
  const settings = JSON.parse(hookSettings("/x/lean-hook.ts")) as { hooks: { PreToolUse: { matcher: string }[] } };
  assert.equal(settings.hooks.PreToolUse[0]!.matcher, "Bash");
});

test("a wrapped command prints the filtered output and keeps its exit code", () => {
  const command = "for i in $(seq 1 200); do echo row $i; done; echo 'quote \"x\"'; exit 7";
  const r = spawnSync("sh", ["-c", wrapCommand(command, RUN_SCRIPT)], { encoding: "utf8" });
  assert.equal(r.status, 7);
  assert.match(r.stdout, /shortened this output/);
  assert.match(r.stdout, /quote "x"/);
  assert.match(r.stdout, /\[exit code 7\]\n$/);
});

// ---------------------------------------------------------------------------
// The fresh-session rule (Claude Code owns the history; Neuromesh only decides resume or fresh)

test("a session is resumed below the threshold and restarted from facts at or above it", () => {
  assert.equal(LEAN_FRESH_AT, 22);
  assert.equal(leanFreshDue(19), false, "turn 19: nothing touched, the cached prefix stays");
  assert.equal(leanFreshDue(21), false);
  assert.equal(leanFreshDue(22), true, "turn 22: fresh session");
  assert.equal(leanFreshDue(25), true);
  assert.equal(leanFreshDue(undefined), false, "an unknown count never triggers it");
  const attempts = [
    { sessionId: "s1", usage: { calls: 12 } },
    { sessionId: "s2", usage: { calls: 30 } },
    { sessionId: "s1", usage: { calls: 10 } },
  ];
  assert.equal(sessionCalls(attempts, "s1"), 22);
  assert.equal(sessionCalls([...attempts, { sessionId: "s1", usage: {} }], "s1"), undefined);
  assert.equal(sessionCalls(attempts, undefined), undefined);
});

// ---------------------------------------------------------------------------
// The lean prompt (F109 and F132)

test("the lean prompt is the request as typed, never the brief's standards (F132) or rewrite (F109)", () => {
  const standards = `Working standards:\n- Keep the change small; ${F132_PHRASE} must stay as it is.\n- Add a test.`;
  const state = {
    request: "merge_dicts in molecule/config.py should merge nested dicts",
    prompt: `Merge_dicts in molecule/config.py should merge nested dicts.\n\n${standards}`,
    brief: { attached: [{ path: "notes.txt", text: "nested example" }], standards: ["x"] },
    checks: [{ name: "test", command: "pytest -q" }],
    tasks: [],
  } as unknown as RunState;
  const prompt = leanTaskPrompt(state);
  assert.ok(!prompt.includes(F132_PHRASE), prompt);
  assert.ok(!LEAN_SKILL.includes(F132_PHRASE));
  assert.ok(!/Working standards/.test(prompt));
  assert.ok(prompt.includes("merge_dicts in molecule/config.py"), "the identifier is not capitalised");
  assert.ok(prompt.includes("--- notes.txt ---\nnested example"), "attached files stay");
  assert.ok(prompt.includes("`pytest -q`"));
  assert.equal(leanRequest({ prompt: "as typed", request: undefined, brief: undefined }), "as typed");
});

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

/** A project whose test passes once fixed.txt says "ok", with enough files for a repository map. */
function project(): string {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": "const fs=require('fs');const ok=fs.existsSync('fixed.txt')&&fs.readFileSync('fixed.txt','utf8').trim()==='ok';if(!ok){console.error('expected fixed.txt to say ok');process.exit(1)}",
  };
  for (let i = 0; i < 20; i++) files[`src/part${i}.js`] = `export function part${i}() {\n  return ${i};\n}\n`;
  return repo(files);
}

/** A real preset with its claude backend replaced by the fake one. */
async function runPreset(name: string, script: (req: AgentRequest, i: number) => Record<string, unknown>) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script as never, "claude");
  const ctx: EngineContext = { home: join(scratch, `home-${++counter}`), backends: { claude: fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  const state = await startRun({ cwd: project(), prompt: "make the test pass: fixed.txt must say ok", preset: name === "lean-solo" ? { ...loadPreset("solo-opus"), name: "lean-solo", enable: ["lean-runner"] } : loadPreset(name) }, ctx);
  return { state, fake, events };
}

const done = (summary: string) => ({ structured: { status: "done", summary, notes: "" } });

test("the lean runner (solo Opus with lean-runner on) sends the lean prompt, the skill and the hook; solo-opus is unchanged", async () => {
  const lean = await runPreset("lean-solo", (req) => {
    writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
    return done("wrote it");
  });
  assert.equal(lean.state.status, "finished");
  const first = lean.fake.calls[0]!;
  assert.equal(first.appendSystemPrompt, LEAN_SKILL);
  assert.ok(first.settings?.includes("lean-hook.ts"));
  assert.ok(!first.prompt.includes("mapped by Neuromesh"), "no repository map");
  assert.ok(!first.prompt.includes("Start here"), "no start-here lines");
  assert.ok(!first.prompt.includes(F132_PHRASE));
  const args = claudeArgs(first);
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], LEAN_SKILL);
  assert.ok(args.indexOf("--settings") > 0 && args.indexOf("--settings") < args.indexOf("--allowedTools"), "before the variadic tool list");

  const solo = await runPreset("solo-opus", (req) => {
    writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
    return done("wrote it");
  });
  const soloFirst = solo.fake.calls[0]!;
  assert.equal(soloFirst.appendSystemPrompt, undefined);
  assert.equal(soloFirst.settings, undefined);
  assert.ok(soloFirst.prompt.includes("mapped by Neuromesh"), "solo-opus keeps its map");
  assert.ok(!claudeArgs(soloFirst).includes("--append-system-prompt"));
});

for (const [calls, fresh] of [[19, false], [22, true], [25, true]] as const) {
  test(`a repair after a first turn of ${calls} model calls ${fresh ? "starts a fresh session from facts" : "resumes the session"}`, async () => {
    const run = await runPreset("lean-solo", (req, i) => {
      if (i === 0) return { ...done("first try"), usage: { input: 10, output: 5, cacheRead: 1000, cacheWrite: 50, calls } };
      writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
      return { ...done("fixed"), usage: { input: 3, output: 2, cacheRead: 200, calls: 2 } };
    });
    assert.equal(run.state.status, "finished");
    const repair = run.fake.calls[1]!;
    assert.equal(repair.resumeSessionId === undefined, fresh);
    if (fresh) {
      assert.match(repair.prompt, /No file in this directory differs from the start of the task yet\. Neuromesh then ran the project.s checks/);
      assert.match(repair.prompt, /expected fixed\.txt to say ok/, "the checks' raw output, a fact");
      assert.ok(!repair.prompt.includes("first try"), "not the earlier session's own summary (F131)");
      assert.ok(run.events.some((e) => e.type === "context.compacted" && e.feature === "F136"));
    } else {
      assert.ok(!run.events.some((e) => e.type === "context.compacted"));
    }
  });
}

// ---------------------------------------------------------------------------
// F137: explicit token fields

test("the Claude parser counts model calls per message id", () => {
  const parser = claudeParser({});
  const usage = (input: number, read: number) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0 });
  for (const event of [
    { type: "assistant", message: { id: "m1", usage: usage(5, 100), content: [] } },
    { type: "assistant", message: { id: "m1", usage: usage(5, 100), content: [] } },
    { type: "assistant", message: { id: "m2", usage: usage(3, 200), content: [] } },
    { type: "result", subtype: "success", is_error: false, result: "", usage: { input_tokens: 8, output_tokens: 40, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } },
  ]) parser.onEvent(event);
  const u = parser.result().usage;
  assert.equal(u.calls, 2, "a message seen twice in the stream is one call");
  assert.deepEqual(tokenFields(u), { inputUncached: 8, cacheRead: 300, cacheCreation: 0, output: 40, calls: 2 });
});

test("token fields leave an unknown count out, and a total is unknown when one part is", () => {
  assert.equal(tokenFields(undefined), undefined);
  assert.equal(tokenFields({}), undefined);
  assert.deepEqual(tokenFields({ input: 7, output: 3 }), { inputUncached: 7, output: 3 }, "no cacheCreation 0 invented");
  assert.deepEqual(sumTokenFields([{ inputUncached: 1, cacheRead: 10, calls: 2 }, { inputUncached: 2, calls: 3 }]), { inputUncached: 3, calls: 5 });
  assert.equal(sumTokenFields([]), undefined);
});

test("record turn and run lines, events and eval usage carry the token fields beside the old usage", async () => {
  const run = await runPreset("lean-solo", (req) => {
    writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
    return { ...done("ok"), usage: { input: 4, output: 9, cacheRead: 700, cacheWrite: 30, calls: 3 } };
  });
  const finished = run.events.find((e) => e.type === "agent.finished")!;
  assert.deepEqual(finished.tokens, { inputUncached: 4, cacheRead: 700, cacheCreation: 30, output: 9, calls: 3 });
  const [turn] = linesFromEvent(finished);
  assert.equal(turn!.kind, "turn");
  const t = turn as unknown as { usage: Record<string, number>; tokens: Record<string, number> };
  assert.equal(t.usage.cacheRead, 700, "the old field names stay for existing readers");
  assert.equal(t.tokens.calls, 3);
  const runLine = linesFromState(run.state).find((l) => l.kind === "run") as { tokens?: Record<string, number> };
  assert.deepEqual(runLine.tokens, { inputUncached: 4, cacheRead: 700, cacheCreation: 30, output: 9, calls: 3 });
  const [model] = usageByModel(run.state.attempts);
  assert.deepEqual(model!.tokens, { inputUncached: 4, cacheRead: 700, cacheCreation: 30, output: 9, calls: 3 });
  assert.equal(model!.usage.input, 4);
});

test("a failing lean runner (NEUROMESH_FAULT) is switched off and the run goes on with the ordinary prompt", async () => {
  process.env.NEUROMESH_FAULT = "lean-runner";
  try {
    const run = await runPreset("lean-solo", (req) => {
      writeFileSync(join(req.cwd, "fixed.txt"), "ok\n");
      return done("ok");
    });
    assert.equal(run.state.status, "finished");
    assert.equal(run.fake.calls[0]!.appendSystemPrompt, undefined);
    assert.ok(run.state.featureErrors?.some((f) => f.id === "F136"));
  } finally {
    delete process.env.NEUROMESH_FAULT;
  }
});

test("F136: a fresh session after 22 calls is shown the changes already on disk (paths and counts, never content)", () => {
  const dir = mkdtempSync(join(tmpdir(), "neuromesh-lean-changes-"));
  try {
    const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "calc.js"), "export const add = (a, b) => a * b;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
    const base = git("rev-parse", "HEAD");
    assert.equal(changesOnDisk(dir, base), "", "nothing changed yet");
    writeFileSync(join(dir, "calc.js"), "export const add = (a, b) => a + b;\n");
    writeFileSync(join(dir, "repro.js"), "secret body\n");
    const list = changesOnDisk(dir, base)!;
    assert.match(list, /calc\.js \| 2 \+-/);
    assert.match(list, /repro\.js \(new, not yet added\)/);
    assert.ok(!list.includes("a + b") && !list.includes("secret body"), "no content");
    assert.equal(changesOnDisk(join(dir, "missing"), base), undefined, "git cannot say: unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
