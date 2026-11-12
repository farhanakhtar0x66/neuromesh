// The changes from the python-bot run (docs/12-python-bot-run.md), F54 to F63.
// Fake backend only: no model calls.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { codexArgs } from "../src/backends/codex.ts";
import { hollowReason } from "../src/checks/checks.ts";
import { verifyFindings } from "../src/checks/acceptance.ts";
import { ensureEnv, envNote, envVars, missingModule, pyprojectDependencies } from "../src/engine/env.ts";
import { observedText } from "../src/engine/observed.ts";
import { compactAttempts, parseSpec, parseVerdict } from "../src/engine/prompts.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain, TaskState } from "../src/engine/types.ts";
import type { Preset } from "../src/presets/presets.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-pybot-test-"));
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

/** The test passes only when fixed.txt says "ok"; `checkJs` replaces the check for special cases. */
function fixableRepo(checkJs?: string): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js":
      checkJs ??
      "const fs=require('fs');const ok=fs.existsSync('fixed.txt')&&fs.readFileSync('fixed.txt','utf8').trim()==='ok';if(!ok){console.error('expected fixed.txt to say ok');process.exit(1)}",
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
    brief: false,
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
  const ctx: EngineContext = { home: join(scratch, `home-${++counter}`), backends: { fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000, ...extra };
  return { ctx, fake, events };
}

const report = (summary: string, status = "done", notes = "") => ({ structured: { status, summary, notes, run: "" } });
const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isTest = (r: AgentRequest): boolean => "verdict" in props(r);
const isAdvice = (r: AgentRequest): boolean => "diagnosis" in props(r);
const isSpec = (r: AgentRequest): boolean => "design" in props(r);
const isScout = (r: AgentRequest): boolean => "facts" in props(r);
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), text + "\n");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

// ---------------------------------------------------------------------------
// [F57 hollow-checks]

test("a passing check that skipped tests over a missing package, or ran none, is hollow", () => {
  assert.match(
    hollowReason(["test_convert (tests.test_convert.ConvertTests.test_convert) ... skipped 'beautifulsoup4 is not installed'", "Ran 13 tests in 0.01s", "OK (skipped=4)"])!,
    /skipped because a package is missing/,
  );
  assert.match(hollowReason(["SKIPPED [2] tests/test_x.py:3: could not import 'bs4': No module named 'bs4'", "3 passed, 2 skipped"])!, /package is missing/);
  // The python-bot worker's own wording.
  assert.match(hollowReason(["test_infobox (tests.test_convert.ConvertTests) ... skipped 'install requirements.txt to run converter tests'", "OK (skipped=4)"])!, /package is missing/);
  assert.match(hollowReason(["ℹ tests 0", "ℹ pass 0"])!, /ran no tests/);
  assert.equal(hollowReason(["Ran 4 tests in 0.1s", "OK"]), undefined);
  assert.equal(hollowReason(["test_x ... skipped 'needs Windows'", "Ran 4 tests", "OK (skipped=1)"]), undefined, "a skip for another reason is fine");
});

test("a check that ran no tests counts as failed, unless it ran none before the work started", async () => {
  // Fails at first; once fixed.txt says ok it "passes" with zero tests, until real.txt exists.
  const repo = fixableRepo(
    "const fs=require('fs');const ok=fs.existsSync('fixed.txt')&&fs.readFileSync('fixed.txt','utf8').trim()==='ok';if(!ok){console.error('expected fixed.txt to say ok');process.exit(1)}console.log(fs.existsSync('real.txt')?'ℹ tests 1':'ℹ tests 0')",
  );
  let turn = 0;
  const { ctx, fake } = context((req) => {
    turn += 1;
    write(req.cwd, "fixed.txt", "ok");
    if (turn > 1) write(req.cwd, "real.txt", "yes");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair"]);
  assert.match(fake.calls[1]!.prompt, /ran no tests, so it tested nothing/);
  assert.equal(state.outcome?.checks, "passed");
});

// ---------------------------------------------------------------------------
// [F56 env-blocked]

test("a missing package is an environment problem: the worker declares it, no repair round is used and the expert is never called", async () => {
  const repo = fixableRepo(
    "const fs=require('fs');if(!fs.existsSync('fixed.txt')){console.error('expected fixed.txt');process.exit(1)}if(!fs.existsSync('declared.txt')){console.error(\"ModuleNotFoundError: No module named 'bs4'\");process.exit(1)}",
  );
  const { ctx, fake, events } = context((req) => {
    if (req.model === "fake-expert") throw new Error("the expert must not be called");
    write(req.cwd, "fixed.txt", "ok");
    if (/because of the environment/.test(req.prompt)) write(req.cwd, "declared.txt", "bs4");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 0 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "repair"]);
  assert.match(fake.calls[1]!.prompt, /module `bs4` is not installed/);
  assert.equal(state.tasks[0]?.round, 0, "not counted as a repair round");
  assert.ok(events.some((e) => e.type === "env.problem" && e.feature === "F56"));
});

test("an environment problem that does not go away stops the run as an environment failure, not an agent one", async () => {
  const repo = fixableRepo("console.error(\"ModuleNotFoundError: No module named 'lxml'\");process.exit(1)");
  const { ctx } = context((req) => {
    if (req.model === "fake-expert") throw new Error("the expert must not be called");
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 0 }) }, ctx);
  assert.equal(state.status, "failed");
  assert.equal(state.failure, "engine");
  assert.match(state.reason ?? "", /^environment: /);
  assert.equal(state.attempts.length, 3, "the first turn and two environment turns");
});

test("a module of the project's own that cannot be imported is a code problem, not the environment", () => {
  assert.equal(missingModule("ModuleNotFoundError: No module named 'wikimd.convert'"), "wikimd");
  assert.equal(missingModule("Error: Cannot find module 'left-pad'"), "left-pad");
  assert.equal(missingModule("Error: Cannot find module './local'"), undefined);
});

// ---------------------------------------------------------------------------
// [F60 no-rebuild]

test("the expert fixes the stuck worker's code in place instead of rebuilding from an empty folder", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    if (req.model === "fake-expert") {
      assert.equal(readFileSync(join(req.cwd, "fixed.txt"), "utf8"), "nope\n", "the worker's work is still there");
      write(req.cwd, "fixed.txt", "ok");
      return report("fixed in place");
    }
    write(req.cwd, "fixed.txt", "nope");
    return report("SECRET-WORKER-REASONING");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 3 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  const expert = fake.calls.find((c) => c.model === "fake-expert")!;
  assert.match(expert.prompt, /smallest changes/);
  assert.match(expert.prompt, /do not rewrite, restyle or start over/);
  assert.doesNotMatch(expert.prompt, /SECRET-WORKER-REASONING/);
  assert.ok(events.some((e) => e.type === "task.escalated"));
});

test("an expert turn is stopped when the run's estimated expert spending passes the budget, and its work is kept", async () => {
  const repo = fixableRepo();
  const SOL = { backend: "fake", model: "gpt-6.1-sol", tier: "expert" as const };
  const { ctx, events } = context((req) => {
    if (req.model === "gpt-6.1-sol") {
      write(req.cwd, "fixed.txt", "ok");
      // $2 of fresh input on Sol, against a $0.50 budget: the engine stops the turn.
      req.onUsage?.({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 });
      return new Promise(() => {});
    }
    write(req.cwd, "fixed.txt", "nope");
    return report("stuck");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [SOL] }, { repairs: 0, expertBudgetUsd: 0.5 }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.tasks[0]?.status, "passed", "the expert's changes so far were checked and kept");
  assert.ok(events.some((e) => e.type === "note" && e.feature === "F60" && /stopping it/.test(String(e.message))));
  const turn = state.attempts.find((a) => a.model === "gpt-6.1-sol")!;
  assert.match(turn.detail ?? "", /expert budget was reached during this turn/);
});

// ---------------------------------------------------------------------------
// [F59 reproduced-findings]

test("a blocker whose check passes is dropped, one without a check becomes minor, and the task merges without the expert", async () => {
  const repo = fixableRepo();
  const { ctx, events } = context((req) => {
    if (req.model === "fake-expert") throw new Error("the expert must not be called");
    if (isTest(req)) {
      return {
        structured: {
          verdict: "fail",
          summary: "two problems",
          findings: [
            { problem: "escaping is missing", file: "fixed.txt", reproduce: "", severity: "blocker", check: "grep -q ok fixed.txt" },
            { problem: "something vague", file: "", reproduce: "", severity: "blocker", check: "" },
          ],
        },
      };
    }
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ tester: [TESTER], escalation: [EXPERT] }, { repairs: 0, advise: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.attempts.map((a) => a.kind), ["initial", "test"]);
  const checked = events.find((e) => e.type === "findings.checked")!;
  assert.equal((checked.dropped as unknown[]).length, 1);
  assert.equal(state.tasks[0]?.verdict?.findings.every((f) => f.severity === "minor"), true);
});

test("finding checks: exit 0 drops, a failing exit verifies, a missing command proves nothing", async () => {
  const dir = mkdtempSync(join(scratch, "verify-"));
  const { kept, dropped } = await verifyFindings(dir, [
    { problem: "a", severity: "blocker", check: "true" },
    { problem: "b", severity: "blocker", check: "false" },
    { problem: "c", severity: "blocker", check: "no-such-command-anywhere" },
    { problem: "d", severity: "minor", check: "false" },
  ]);
  assert.deepEqual(dropped.map((d) => d.problem), ["a"]);
  assert.deepEqual(kept.map((k) => [k.problem, k.verified ?? false]), [["b", true], ["c", false], ["d", false]]);
});

test("the reviewer's check command is parsed with its finding", () => {
  const v = parseVerdict({ stop: "done", finalText: "", usage: {}, durationMs: 0, exitCode: 0, structured: { verdict: "fail", summary: "s", findings: [{ problem: "p", file: "f", reproduce: "", severity: "blocker", check: " grep -q x f " }] } });
  assert.equal(v?.findings[0]?.check, "grep -q x f");
});

// ---------------------------------------------------------------------------
// [F58 acceptance-runs] [F63 scout-facts] [F55 worker-network]

test("a new program: a scout checks facts for the expert's spec, the spec's acceptance runs are run, and the reviewer judges their output", async () => {
  const repo = fixableRepo();
  const { ctx, fake, events } = context((req) => {
    if (isScout(req)) return { structured: { facts: ["The site serves math as MathML only, with no LaTeX text."] } };
    if (isSpec(req)) {
      return {
        structured: {
          name: "greeter",
          summary: "s",
          features: ["greets"],
          behaviour: [],
          out_of_scope: [],
          design: ["one file"],
          acceptance: [{ command: "cat fixed.txt && echo > out.md '# Report'", expect: "prints ok and writes out.md" }],
        },
      };
    }
    if (isTest(req)) return { structured: { verdict: "pass", summary: "good", findings: [] } };
    write(req.cwd, "fixed.txt", "ok");
    return report("done");
  });
  const p = preset({ briefer: [EXPERT], tester: [TESTER] }, { brief: true });
  const state = await startRun({ cwd: repo, prompt: "build a command-line tool that greets people", preset: p }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.facts, ["The site serves math as MathML only, with no LaTeX text."]);
  const scout = fake.calls.find(isScout)!;
  assert.equal(scout.network, true, "the scout may use the network");
  assert.match(scout.cwd, /scout$/, "in a scratch folder, not the repository");
  assert.match(fake.calls.find(isSpec)!.prompt, /MathML only/, "the spec writer gets the facts");
  const worker = fake.calls.find((c) => c.model === "fake-worker" && !isScout(c))!;
  assert.equal(worker.network, true, "a new program's worker has the network");
  assert.match(worker.prompt, /Acceptance runs/, "the worker sees how it will be judged");
  const review = fake.calls.find(isTest)!;
  assert.match(review.prompt, /Run 1: `cat fixed\.txt/);
  assert.match(review.prompt, /exit code 0/);
  assert.match(review.prompt, /out\.md/, "the files the run wrote are listed");
  assert.match(review.prompt, /# Report/, "with their first lines");
  assert.ok(events.some((e) => e.type === "acceptance.ran" && e.feature === "F58"));
});

test("the spec's acceptance runs are parsed, at most four", () => {
  const spec = parseSpec({
    stop: "done",
    finalText: "",
    usage: {},
    durationMs: 0,
    exitCode: 0,
    structured: { name: "n", summary: "s", features: ["f"], behaviour: [], out_of_scope: [], design: [], acceptance: [1, 2, 3, 4, 5].map((i) => ({ command: `run ${i}`, expect: "e" })) },
  });
  assert.equal(spec?.acceptance?.length, 4);
});

test("Codex gets the network inside its sandbox only for a writing turn that asks for it", () => {
  const base = { cwd: "/w", prompt: "p", timeoutMs: 1 };
  assert.ok(codexArgs({ ...base, access: "write", network: true }).includes("sandbox_workspace_write.network_access=true"));
  assert.ok(!codexArgs({ ...base, access: "write" }).includes("sandbox_workspace_write.network_access=true"));
  assert.ok(!codexArgs({ ...base, access: "read-only", network: true }).includes("sandbox_workspace_write.network_access=true"));
});

// ---------------------------------------------------------------------------
// [F61 advice-facts] [F62 advice-cap]

test("the expert's advice prompt carries what failed in the worker's environment, and only a short piece of a long diff", async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req) => {
    if (isAdvice(req)) return { structured: { diagnosis: "write ok", steps: ["write ok"] } };
    if (req.logPath) {
      mkdirSync(dirname(req.logPath), { recursive: true });
      writeFileSync(
        req.logPath,
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'pip install bs4'", exit_code: 1, aggregated_output: "Failed to resolve 'pypi.org'" } }) + "\n",
      );
    }
    write(req.cwd, "big.txt", "x".repeat(20_000));
    write(req.cwd, "fixed.txt", /write ok/.test(req.prompt) ? "ok" : "nope");
    return report("stuck", "done", "could not reach pypi");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 1, advise: true }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  const advice = fake.calls.find(isAdvice)!.prompt;
  assert.match(advice, /What the worker observed/);
  assert.match(advice, /\$ 'pip install bs4'/);
  assert.match(advice, /Failed to resolve 'pypi\.org'/);
  assert.match(advice, /could not reach pypi/);
  assert.doesNotMatch(advice, /x{5000}/, "the long diff is cut");
  assert.match(advice, /touches: big\.txt, fixed\.txt|touches: fixed\.txt, big\.txt/);
});

test("observed facts read Claude Code logs too, and repeated commands appear once", () => {
  const dir = mkdtempSync(join(scratch, "obs-"));
  const log = join(dir, "c.jsonl");
  const lines = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm install left-pad" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "ENOTFOUND registry.npmjs.org" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm install left-pad" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "ENOTFOUND registry.npmjs.org" }] } },
  ];
  writeFileSync(log, lines.map((l) => JSON.stringify(l)).join("\n"));
  const text = observedText([log], { status: "blocked", summary: "no network", notes: "" });
  assert.equal(text.match(/npm install left-pad/g)?.length, 1);
  assert.match(text, /ENOTFOUND/);
  assert.match(text, /report \(blocked\): no network/);
});

test("the compact stuck state is a few thousand characters however long the diffs", () => {
  const big = `diff --git a/a.py b/a.py\n${"+line\n".repeat(5_000)}`;
  const task = { history: [{ diff: big, failures: "boom ".repeat(2_000) }, { diff: big, failures: "bang ".repeat(2_000), findings: [{ problem: "p", severity: "blocker" as const }] }] } as unknown as TaskState;
  const text = compactAttempts(task);
  assert.ok(text.length < 6_500, String(text.length));
  assert.match(text, /touches: a\.py/);
  assert.match(text, /open findings/);
});

// ---------------------------------------------------------------------------
// [F54 work-env]

test("pyproject dependencies are read from [project] only", () => {
  const deps = pyprojectDependencies('[project]\nname = "x"\ndependencies = [\n  "requests>=2",\n  "beautifulsoup4",\n]\n\n[tool.other]\ndependencies = ["nope"]\n');
  assert.deepEqual(deps, ["requests>=2", "beautifulsoup4"]);
});

test("a Python work folder gets its own .venv, put first on PATH and named in the worker's note", { skip: !hasPython }, async () => {
  const dir = mkdtempSync(join(scratch, "env-"));
  writeFileSync(join(dir, "main.py"), "print(1)\n");
  const outcome = await ensureEnv(dir);
  assert.equal(outcome.failed, undefined, outcome.failed);
  assert.deepEqual(outcome.folders, [".venv", "*.pyc"]);
  assert.ok(existsSync(join(dir, ".venv", "bin", "python")));
  assert.match(envVars(dir).PATH ?? "", /\.venv\/bin:/);
  assert.match(envNote(dir), /\.venv\/bin\/python/);
  assert.deepEqual((await ensureEnv(dir)).installed, [], "nothing declared, nothing installed");
});

test("the environment is made before the first turn and never enters the diff", { skip: !hasPython }, async () => {
  const repo = fixableRepo();
  const { ctx, fake } = context((req) => {
    assert.ok(existsSync(join(req.cwd, ".venv", "bin", "python")), "the worker's first turn has the environment");
    write(req.cwd, "fixed.txt", "ok");
    write(req.cwd, "main.py", "print('hi')");
    // Bytecode an agent's own Python run left behind never reaches the diff.
    mkdirSync(join(req.cwd, "__pycache__"), { recursive: true });
    writeFileSync(join(req.cwd, "__pycache__", "main.cpython-312.pyc"), "x");
    assert.equal(req.env?.PYTHONDONTWRITEBYTECODE, "1");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass with a small python script", preset: preset() }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.match(fake.calls[0]!.prompt, /\.venv\/bin\/python/);
  assert.ok(!state.outcome!.files.some((f) => f.path.startsWith(".venv") || f.path.endsWith(".pyc")), state.outcome!.files.map((f) => f.path).join(","));
  assert.ok(state.outcome!.files.some((f) => f.path === "main.py"));
});
