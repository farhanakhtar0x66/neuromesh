// [F138 structural-probe] Fixture repositories for the four archetypes, the deadline, the summary's size,
// and the rule that the probe reads the request as typed (F109). No model calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import { startRun } from "../src/engine/run.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import { loadPreset } from "../src/presets/presets.ts";
import { MAX_LAYA_TOKENS, detectTestRunners, estimateTokens, extractNames, importedStems, layaText, probeRepo } from "../src/routing/probe.ts";

const scratch = mkdtempSync(join(tmpdir(), "nm-probe-test-"));
const locked: string[] = [];
after(() => {
  for (const d of locked) chmodSync(d, 0o755);
  rmSync(scratch, { recursive: true, force: true });
});
let counter = 0;

function fixture(files: Record<string, string | Buffer>): string {
  const dir = join(scratch, `repo-${++counter}`);
  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const underLimit = (text: string): void => assert.ok(estimateTokens(text) < MAX_LAYA_TOKENS, `${estimateTokens(text)} tokens: ${text}`);

// ---------------------------------------------------------------------------
// 1. Easy-looking, complex: a small repository, one async hub every module imports, a vague request.

test("archetype 1: a small repository with a highly coupled async hub and a vague request", () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "app", scripts: { test: "node --test" } }),
    "src/store.js": "import { Mutex } from './mutex.js';\nconst lock = new Mutex();\nexport async function update(key, value) {\n  await lock.acquire();\n  try { state[key] = value; } finally { lock.release(); }\n}\nexport const state = {};\n",
    "src/mutex.js": "export class Mutex { async acquire() {} release() {} }\n",
  };
  for (const name of ["cart", "users", "orders", "search", "checkout", "profile"]) files[`src/${name}.js`] = `import { update, state } from './store.js';\nexport function ${name}View() {\n  return state.${name};\n}\n`;
  const p = probeRepo(fixture(files), "the app sometimes shows stale data after a refresh, make it more robust");
  const f = p.facts;
  assert.equal(f.namedFiles.length + f.namedSymbols.length, 0);
  assert.equal(f.couplingBasis, "repository hub");
  assert.deepEqual(f.candidateFiles, ["src/store.js"]);
  assert.equal(f.fanIn[0]!.importers, 6);
  assert.equal(f.couplingSignal, "high");
  assert.ok(f.mechanicalScore < 0.5, String(f.mechanicalScore));
  assert.ok(f.complexitySignals.includes("async or concurrent code"));
  assert.equal(f.trivialSelfContained, false);
  assert.equal(f.skipDossier, true, "a small repository has no search to save (F130)");
  assert.match(p.layaStateText, /^A tiny repository, with high cross-module coupling around the repository's most imported module/);
  assert.match(p.layaStateText, /names no file, function or class/);
  assert.match(p.layaStateText, /core complexity/);
  assert.ok(!/store\.js|\d/.test(p.layaStateText), "no file names or raw numbers in the summary");
  underLimit(p.layaStateText);
});

// ---------------------------------------------------------------------------
// 2. Complex-looking, easy: 200 files of one template, an explicit rename of one of them.

test("archetype 2: two hundred boilerplate files and an explicit rename", () => {
  const files: Record<string, string> = { "package.json": JSON.stringify({ name: "api", scripts: { test: "jest" }, devDependencies: { jest: "^30" } }) };
  for (let i = 0; i < 199; i++) files[`src/dto/Item${i}Dto.ts`] = `export interface Item${i}Dto {\n  id: string;\n  name: string;\n  createdAt: number;\n}\n`;
  files["src/dto/UserDto.ts"] = "export interface UserDto {\n  id: string;\n  name: string;\n  createdAt: number;\n}\n";
  files["src/api/users.ts"] = "import type { UserDto } from '../dto/UserDto';\nexport function listUsers(): UserDto[] {\n  return [];\n}\n";
  const dir = fixture(files);
  const p = probeRepo(dir, "Rename `UserDto` to `AccountDto` in src/dto/UserDto.ts and update its one import.");
  const f = p.facts;
  assert.equal(f.repoFileCount, 202);
  assert.ok(f.namedFiles.includes("src/dto/UserDto.ts"));
  assert.ok(f.resolvedHits.some((h) => h.name === "UserDto" && h.files.includes("src/dto/UserDto.ts")));
  assert.ok(f.unresolvedNames.includes("AccountDto"), "the new name does not exist yet");
  assert.deepEqual(f.candidateFiles, ["src/dto/UserDto.ts"]);
  assert.equal(f.fanIn[0]!.importers, 1);
  assert.equal(f.couplingSignal, "low");
  assert.ok(f.mechanicalScore >= 0.65, `${f.mechanicalScore} ${f.mechanicalSignals.join("; ")}`);
  assert.ok(f.mechanicalSignals.includes("many files repeat one pattern"));
  assert.ok(f.mechanicalSignals.includes("the files involved are schemas, models, config or generated code"));
  assert.equal(f.skipDossier, true, "over 150 files, but the names lead to one file");
  assert.equal(f.detectedTestCmd?.runner, "jest");
  assert.match(p.layaStateText, /medium-sized repository, with low cross-module coupling on the code the request names/);
  assert.match(p.layaStateText, /looks mechanical/);
  assert.ok(!p.layaStateText.includes("UserDto"));
  underLimit(p.layaStateText);
});

// ---------------------------------------------------------------------------
// 3. Links (one a loop), an unreadable folder, empty folders, non-UTF-8 and binary files, a FIFO.

test("archetype 3: links, a loop, an unreadable folder, a FIFO and non-UTF-8 files neither crash nor hang", () => {
  const dir = fixture({
    "main.py": "from util import helper\n\ndef run():\n    return helper()\n",
    "util.py": "def helper():\n    return 1\n",
    "latin1.py": Buffer.from([0x23, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a, 0x78, 0x3d, 0x31, 0x0a]),
    "blob.py": Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
  });
  mkdirSync(join(dir, "empty"));
  mkdirSync(join(dir, "nested", "deeper", "still-empty"), { recursive: true });
  symlinkSync(".", join(dir, "loop"));
  symlinkSync("nested", join(dir, "linked-folder"));
  symlinkSync("nowhere.py", join(dir, "broken.py"));
  mkdirSync(join(dir, "secret"));
  writeFileSync(join(dir, "secret", "hidden.py"), "x = 1\n");
  chmodSync(join(dir, "secret"), 0o000);
  locked.push(join(dir, "secret"));
  execFileSync("mkfifo", [join(dir, "pipe.py")]);
  const started = Date.now();
  const p = probeRepo(dir, 'Traceback:\n  File "main.py", line 4, in run\n    return helper()\nfix `helper`');
  assert.ok(Date.now() - started < 2_000, "returns promptly");
  const f = p.facts;
  assert.equal(f.truncated, false);
  assert.equal(f.skipped.links, 3);
  if (process.getuid?.() !== 0) assert.equal(f.skipped.unreadable, 1);
  assert.equal(f.skipped.binary, 1);
  assert.ok(f.resolvedHits.some((h) => h.name === "main.py"));
  assert.ok(f.resolvedHits.some((h) => h.name === "helper" && h.files.includes("util.py")));
  assert.equal(f.fanIn.find((x) => x.file === "util.py")?.importers, 1);
  underLimit(p.layaStateText);
});

test("a probe past its deadline returns what it found, marked truncated", () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 50; i++) files[`pkg/m${i}.py`] = `def f${i}():\n    return ${i}\n`;
  const dir = fixture(files);
  let t = 0;
  const p = probeRepo(dir, "fix f3", { deadlineMs: 500, now: () => (t += 40) });
  assert.equal(p.facts.truncated, true);
  assert.ok(p.layaStateText.length > 0);
  assert.match(p.layaStateText, /ran out of time/);
  const missing = probeRepo(join(scratch, "does-not-exist"), "anything");
  assert.equal(missing.facts.repoFileCount, 0);
  assert.equal(missing.facts.skipped.unreadable, 1);
});

// ---------------------------------------------------------------------------
// 4. Test runners, read from config files only.

test("archetype 4: Node, Python, Rust and Go runners in one repository, nothing executed", () => {
  const dir = fixture({
    "package.json": JSON.stringify({ name: "poly", scripts: { test: "vitest run" }, devDependencies: { vitest: "^3" } }),
    "pyproject.toml": "[project]\nname = 'poly'\n\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n",
    "tests/test_core.py": "def test_core():\n    assert True\n",
    "Cargo.toml": "[package]\nname = \"poly\"\nversion = \"0.1.0\"\n",
    "go.mod": "module example.com/poly\n\ngo 1.24\n",
    // A Makefile that would do damage if run: the probe reads it only.
    "Makefile": "test:\n\trm -rf /tmp/should-never-run\n",
  });
  const runners = probeRepo(dir, "make the tests pass").facts.testRunners;
  assert.deepEqual(runners.map((r) => r.runner), ["vitest", "pytest", "cargo", "go"]);
  assert.equal(runners.find((r) => r.runner === "pytest")!.single, "python -m pytest -q {file}::{name}");
  assert.equal(runners.find((r) => r.runner === "go")!.single, "go test ./{package} -run '^{name}$'");

  const nodeTest = fixture({ "package.json": JSON.stringify({ scripts: { test: "node --test test/*.test.js" } }) });
  assert.deepEqual(detectTestRunners(nodeTest, ["package.json"]).map((r) => [r.runner, r.single]), [["node", "node --test {file}"]]);
  const unittest = fixture({ "test_a.py": "import unittest\n" });
  assert.equal(detectTestRunners(unittest, ["test_a.py"])[0]!.runner, "unittest");
  const make = fixture({ Makefile: "test:\n\techo ok\n" });
  assert.deepEqual(detectTestRunners(make, ["Makefile"]).map((r) => [r.runner, r.single]), [["make", undefined]]);
  assert.deepEqual(detectTestRunners(fixture({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified"' } }) }), ["package.json"]), []);
});

// ---------------------------------------------------------------------------
// Pieces

test("names, stack frames and imports are read across languages", () => {
  const n = extractNames('at parseRow (src/csv/reader.js:41:9)\n  File "pkg/core.py", line 12\nerror --> src/lib.rs:3:5\nIn `Response.unset_cookie` and HTTPClient, call load_config() from config.yaml');
  for (const file of ["src/csv/reader.js", "pkg/core.py", "src/lib.rs", "config.yaml"]) assert.ok(n.files.includes(file), file);
  for (const symbol of ["Response.unset_cookie", "load_config", "HTTPClient"]) assert.ok(n.symbols.includes(symbol), symbol);
  assert.deepEqual([...importedStems("import x from './a/b.js';\nconst y = require(\"../c\");\nfrom pkg.mod import thing, other as o\nuse crate::net::{tcp, udp};\n#include \"util.h\"\n")].sort(), ["b", "c", "mod", "net", "other", "tcp", "thing", "udp", "util"]);
});

test("the summary stays under the token limit even when every signal fires", () => {
  const p = probeRepo(fixture({ "a.py": "x = 1\n" }), "x");
  const f = {
    ...p.facts,
    repoFileCount: 60_000,
    truncated: true,
    namedFiles: ["a"],
    namedSymbols: ["b"],
    resolvedHits: [{ name: "a", files: ["a.py"] }],
    unresolvedNames: ["b"],
    candidateFiles: ["a.py"],
    couplingSignal: "high" as const,
    couplingBasis: "named code" as const,
    mechanicalScore: 0.1,
    complexitySignals: ["async or concurrent code", "locks or atomics", "a state machine", "metaprogramming", "SQL", "a parser or tokenizer"],
    hasExistingSpec: true,
    specSignals: ["acceptance criteria", "an expected result", "steps to reproduce"],
    testRunners: [{ runner: "pytest" as const, command: "c", single: "s", from: "f" }, { runner: "go" as const, command: "c", from: "f" }],
    trivialSelfContained: true,
    skipDossier: true,
  };
  underLimit(layaText({ ...f, detectedTestCmd: f.testRunners[0] }));
});

test("the probe reads the request as typed, not the brief's rewrite (F109), and its event names no files", async () => {
  // JavaScript, not Python: a Python project makes the engine build a .venv, which only slows the test.
  const dir = fixture({
    "package.json": JSON.stringify({ name: "cfg", scripts: { test: "node --test" } }),
    "pkg/config.js": "export function merge_dicts(a, b) {\n  return { ...a, ...b };\n}\n",
    "test/config.test.js": "import { merge_dicts } from '../pkg/config.js';\n",
  });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed"], { cwd: dir });
  const typed = "merge_dicts in pkg/config.js drops nested keys: fix the bug so nested dictionaries merge";
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(() => ({ structured: { status: "done", summary: "ok", notes: "" } }), "claude");
  const preset = { ...loadPreset("temporal-claude"), brief: true };
  const state = await startRun({ cwd: dir, prompt: typed, preset }, { home: join(scratch, `home-${++counter}`), backends: { claude: fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 });
  assert.notEqual(state.prompt, typed, "the brief rewrote the prompt");
  const f = state.probe!.facts;
  assert.equal(f.requestWords, typed.split(/\s+/).length, "the typed request, not the rewritten one");
  assert.ok(f.namedSymbols.includes("merge_dicts"), "not the brief's capitalised Merge_dicts");
  assert.ok(f.resolvedHits.some((h) => h.files.includes("pkg/config.js")));
  const ready = events.find((e) => e.type === "probe.ready")!;
  assert.equal(ready.feature, "F138");
  assert.ok(!JSON.stringify(ready).includes("config.js") && !JSON.stringify(ready).includes("merge_dicts"), "no names in the event");
  underLimit(state.probe!.layaStateText);

  const solo = await startRun({ cwd: dir, prompt: typed, preset: loadPreset("solo-opus") }, { home: join(scratch, `home-${++counter}`), backends: { claude: fake }, turnTimeoutMs: 5_000 });
  assert.equal(solo.probe, undefined, "off outside temporal-claude");
});
