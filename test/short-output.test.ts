// [F114 short-output] `nm run`, `nm checks --only`, and the prompt line that points agents at them.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { taskPrompt } from "../src/engine/prompts.ts";
import type { RunState, TaskState } from "../src/engine/types.ts";
import { disable, resetFeatures } from "../src/features.ts";
import { shorten } from "../src/tools/shortout.ts";

const tool = fileURLToPath(new URL("../src/tools/nm.ts", import.meta.url));

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nm-short-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function nm(dir: string, ...args: string[]): { status: number | null; out: string; log: string } {
  // A nested `node --test` behaves as a worker of the outer run if it inherits this variable.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const r = spawnSync(process.execPath, [tool, ...args], { cwd: dir, encoding: "utf8", env });
  const out = r.stdout ?? "";
  return { status: r.status, out, log: /log: (\S+)/.exec(out)?.[1] ?? "" };
}

afterEach(() => resetFeatures());

test("nm run: short output passes through whole, with the exit code and the log path", () => {
  const dir = repo({ "a.txt": "x\n" });
  const r = nm(dir, "run", "--", "echo hello; echo oops >&2; exit 3");
  assert.equal(r.status, 3, "the command's exit code is the tool's");
  assert.match(r.out, /^exit 3 {2}log: /);
  assert.match(r.out, /hello\noops\n$/, "stderr is combined with stdout");
  assert.ok(r.log && existsSync(r.log));
  assert.ok(!r.log.startsWith(dir), "the log is not in the repository");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim(), "A  a.txt", "no new file in the repository");
});

test("nm run: several arguments are one command line, quoting kept", () => {
  const dir = repo({ "a.txt": "x\n" });
  const r = nm(dir, "run", "--", "printf", "%s|", "a b", "c");
  assert.equal(r.status, 0);
  assert.match(r.out, /a b\|c\|\n$/);
});

test("nm run: long output keeps the failure lines, the head and the tail within the cap, and the log holds everything", () => {
  const dir = repo({
    "gen.js": [
      "for (let i = 1; i <= 400; i++) console.log(`ok ${i} - some passing check with a fairly long name number ${i}`);",
      "console.log('not ok 401 - cart total with coupon');",
      "console.log('  AssertionError: expected 90 to equal 100');",
      "for (let i = 402; i <= 900; i++) console.log(`ok ${i} - another passing check with a long name number ${i}`);",
      "console.log('# tests 900');",
      "console.log('# last line');",
      "process.exit(1);",
    ].join("\n"),
  });
  const r = nm(dir, "run", "--", "node gen.js");
  assert.equal(r.status, 1);
  assert.match(r.out, /^exit 1 {2}log: /);
  const body = r.out.slice(r.out.indexOf("\n") + 1);
  assert.ok(body.length <= 3_300, `body was ${body.length} characters`);
  assert.match(body, /ok 1 - some passing/, "the first lines are kept");
  assert.match(body, /# last line/, "the last lines are kept");
  assert.match(body, /not ok 401 - cart total with coupon/, "a failure line far from both ends is kept");
  assert.match(body, /AssertionError: expected 90 to equal 100/);
  assert.doesNotMatch(body, /ok 200 - /, "the middle is left out");
  assert.match(body, /\d+ of 903 lines left out/);
  assert.ok(body.includes(r.log), "it says where the rest is");
  const full = readFileSync(r.log, "utf8");
  assert.equal(full.split("\n").filter(Boolean).length, 903);
  assert.ok(full.includes("ok 200 - another") || full.includes("ok 200 - some"), "the log holds the middle");
});

test("shorten: caps failure lines at 40 and the whole at about 3,000 characters, however noisy", () => {
  const noisy = Array.from({ length: 500 }, (_, i) => `error: thing ${i} went wrong in a way that is described at some length here`).join("\n");
  const out = shorten(noisy, "/tmp/x.log");
  assert.ok(out.length <= 3_300, `was ${out.length}`);
  assert.match(out, /lines left out/);
  const one = "x".repeat(50_000);
  assert.ok(shorten(one, "/tmp/x.log").length <= 3_300, "a single huge line is cut too");
  assert.equal(shorten("fine\n", "/tmp/x.log"), "fine");
});

const NODE_PKG = JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } });
const PASSING = `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("adds", () => { assert.equal(1 + 1, 2); });\n`;
const FAILING = `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("subtracts", () => { assert.equal(3 - 1, 99); });\n`;

test("nm checks --only runs one node --test file and nothing else", () => {
  const dir = repo({ "package.json": NODE_PKG, "test/a.test.js": PASSING, "test/b.test.js": FAILING });
  const a = nm(dir, "checks", "--only", "test/a.test.js");
  assert.equal(a.status, 0, a.out);
  assert.match(a.out, /^PASS {2}test {2}\(node --test test\/a\.test\.js\)/);
  const b = nm(dir, "checks", "--only", "b.test");
  assert.equal(b.status, 1, "a pattern finds the file");
  assert.match(b.out, /^FAIL {2}test {2}\(node --test test\/b\.test\.js\)/);
  assert.match(b.out, /99/);
  const none = nm(dir, "checks", "--only", "zzz");
  assert.equal(none.status, 2);
  assert.match(none.out, /no test file matches zzz/);
});

test("nm checks --only says so and runs everything where the runner cannot take one file", () => {
  const dir = repo({ "package.json": JSON.stringify({ scripts: { test: "sh ./run.sh" } }), "run.sh": "echo all-ran\n" });
  const r = nm(dir, "checks", "--only", "x.test.js");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /--only is not supported here .*running all the checks/);
  assert.match(r.out, /PASS {2}test {2}\(npm test\)/);
});

function taskState(): { state: RunState; task: TaskState } {
  const task = { id: "t1", title: "t", brief: "do it", owned: [], status: "pending" } as unknown as TaskState;
  const state = { id: "r", status: "running", prompt: "do it", attempts: [], tasks: [task], checks: [] } as unknown as RunState;
  return { state, task };
}

test("the prompt tells agents to run long commands through nm run only when short-output is on", () => {
  const { state, task } = taskState();
  const on = taskPrompt(state, task);
  assert.match(on, /run -- <command>/);
  assert.match(on, /checks --only <file>/);
  assert.match(on, /Batch related edits/);
  const added = on.slice(on.indexOf("\nRun tests, builds")).split("\n\n")[0]!.split("\n").filter(Boolean);
  assert.ok(added.length <= 4, "at most four lines");
  disable("short-output");
  const off = taskPrompt(state, task);
  assert.doesNotMatch(off, /run -- <command>|Batch related edits/);
  assert.match(off, /checks` \(the project's checks/, "the rest of the tool note is unchanged");
});

test("onlyCommand: cargo takes a test name, pytest takes a path, other runners are unsupported", async () => {
  const { onlyCommand } = await import("../src/tools/shortout.ts");
  const cargo = repo({ "Cargo.toml": "[package]\nname='x'\n" });
  assert.deepEqual(onlyCommand(cargo, [{ name: "test", command: "cargo test --quiet" }], "parses_empty"), { command: "cargo test --quiet parses_empty" });
  const py = repo({ "tests/test_cart.py": "def test_a():\n    pass\n", "tests/test_other.py": "" });
  const spec = { name: "test", command: `if python3 -c "import pytest" 2>/dev/null; then python3 -m pytest -q -rs; else python3 -m unittest discover; fi` };
  const got = onlyCommand(py, [spec], "cart");
  if (spawnSync("python3", ["-c", "import pytest"]).status === 0) assert.deepEqual(got, { command: "python3 -m pytest -q -rs tests/test_cart.py" });
  else assert.ok("unsupported" in got);
  assert.ok("unsupported" in onlyCommand(cargo, [{ name: "test", command: "go test ./..." }], "x"));
  assert.ok("unsupported" in onlyCommand(cargo, [{ name: "typecheck", command: "tsc" }], "x"));
});
