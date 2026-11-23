// [F115 reproduce-first] The pure parts of "reproduce the bug before fixing it" (plan item O1,
// docs/22-path-to-the-goal.md): the cheap writer's prompt and schema, reading its answer, the
// command that runs only its test file, and the rule for a failure that counts. The engine's step
// that runs the turn and acts on the outcome is `reproduceStep` in run.ts.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseStructured } from "../backends/shared.ts";
import type { AgentResult } from "../backends/types.ts";
import type { CheckResult } from "../checks/checks.ts";
import { brokenTest } from "../checks/blind.ts";
import { TEST_PATH } from "../context/packet.ts";
import { CODE_FILE } from "../intake/brief.ts";

/** The reproduction the engine keeps for a task: the test file, how to run it, and what became of it. */
export interface Reproduction {
  /** "judging": asked for and written, not yet run on the seed; "accepted": fails on the seed and now gates the task; "rejected": discarded. */
  stage: "judging" | "accepted" | "rejected";
  path?: string;
  /** What the file held when it was accepted: the engine puts it back if the build turn edits it. */
  content?: string;
  command?: string;
  /** Why it was discarded (or "failed on the seed" when accepted). */
  outcome?: string;
  /** What the build turns did to it: how many times the engine put it back. */
  restored?: number;
}

export const REPRODUCE_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    command: { type: "string" },
    summary: { type: "string" },
  },
  required: ["path", "summary"],
  additionalProperties: false,
};

/** The cheap writer's prompt: a single new test file that fails now, because of the reported bug. */
export function reproducePrompt(request: string, tests: string[], checks: { name: string; command: string }[]): string {
  return `A bug has been reported on this project. Before anyone fixes it, you write the test that reproduces it. You do not fix it.

The report:
${request.slice(0, 12_000)}

${tests.length > 0 ? `The project's existing test files (look at one for where tests live, how they are named, what they import and how they call the code): ${tests.join(", ")}` : "The project has no test files yet."}
${checks.length > 0 ? `The project runs its checks with: ${checks.map((c) => `\`${c.command}\``).join(", ")}` : "The project has no automatic checks."}

Read the code you need (you have tools), then write ONE new test file that reproduces the reported bug:
- It calls the code through its public interface, the way a user or another module would, and asserts the behaviour the report says is right. It must FAIL now, on this code, because of the bug: a failed assertion, not an error. A test that cannot load (a wrong import or name, a syntax error) does not count.
- Use the project's own test runner and the style of its existing tests, and put the file where the project keeps its tests. The file name is new and must not exist yet.
- Change no other file. Do not fix the bug, do not edit the code, do not touch an existing test.
- Run your test once, on its own, and check that it fails for the reason in the report. If it passes, the bug is not what you thought: read more and try once more. If you cannot reproduce it, say so and write nothing.

Give your answer in the required JSON format: path (the new test file, from the project's root; an empty string if you could not reproduce the bug), command (the command that runs only that file, or an empty string) and summary (one sentence: what the test asserts).`;
}

/** The writer's answer, when it names a test file; undefined otherwise. */
export function parseReproduce(result: AgentResult): { path: string; command?: string; summary: string } | undefined {
  const raw = (result.structured ?? parseStructured(result.finalText)) as { path?: unknown; command?: unknown; summary?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || typeof raw.path !== "string") return undefined;
  const path = raw.path.trim().replace(/^(\.\/)+/, "");
  if (path === "" || path.length > 300) return undefined;
  const command = typeof raw.command === "string" && raw.command.trim() !== "" ? raw.command.trim().slice(0, 400) : undefined;
  return { path, command, summary: typeof raw.summary === "string" ? raw.summary.slice(0, 400) : "" };
}

/** A path that is safe to put in a shell command and looks like a test file. */
export function reproducePathOk(path: string): boolean {
  return /^[\w@.+/-]+$/.test(path) && !path.split("/").includes("..") && !path.startsWith("/") && TEST_PATH.test(path);
}

/** The first words of a command a model may name when the engine has no rule for the project's runner. */
const RUNNERS = /^(npm|npx|pnpm|yarn|bun|node|deno|python3?|\.venv\/bin\/python|venv\/bin\/python|uv|pytest|cargo|go|mocha|jest|vitest|ruby|rspec|mix|dotnet|mvn|gradle|make)\b/;

/**
 * The command that runs only this test file, from the project's own runner, with no model call.
 * When the files do not say how, the writer's own command is used if it starts with a known runner,
 * names the file and has no shell syntax beyond arguments. Undefined: the engine cannot run it, and
 * the reproduction is dropped.
 */
export function reproduceCommand(dir: string, path: string, offered?: string): string | undefined {
  if (!reproducePathOk(path)) return undefined;
  const ext = extname(path);
  let text = "";
  try {
    text = readFileSync(join(dir, path), "utf8");
  } catch {
    return undefined;
  }
  if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"].includes(ext)) {
    const scripts = ((): string => {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
        return String(pkg.scripts?.test ?? "");
      } catch {
        return "";
      }
    })();
    if (/\bvitest\b/.test(scripts)) return `npx --no-install vitest run ${path}`;
    if (/\bjest\b/.test(scripts)) return `npx --no-install jest ${path}`;
    if (/\bmocha\b/.test(scripts)) return `npx --no-install mocha ${path}`;
    if (/\bnode\b[^&|;]*--test\b/.test(scripts) || /from ["']node:test["']|require\(["']node:test["']\)/.test(text)) return `node --test ${path}`;
  } else if (ext === ".py") {
    const python = existsSync(join(dir, ".venv", "bin", "python")) ? ".venv/bin/python" : existsSync(join(dir, "venv", "bin", "python")) ? "venv/bin/python" : "python3";
    const dotted = path.slice(0, -3).split("/").join(".");
    return `if ${python} -c "import pytest" 2>/dev/null; then ${python} -m pytest -q -rs ${path}; else ${python} -m unittest -v ${dotted}; fi`;
  } else if (ext === ".rs" && /^tests\/[\w-]+\.rs$/.test(path)) {
    return `cargo test --quiet --test ${path.slice("tests/".length, -3)}`;
  }
  if (offered && RUNNERS.test(offered) && offered.includes(path) && !/[;&|`$<>(){}\n\\]/.test(offered)) return offered;
  return undefined;
}

/** The test could not be loaded or built: a mistake in the file, not the bug. */
const LOAD_ERROR = /SyntaxError|IndentationError|TabError|ReferenceError|NameError|ERROR collecting|errors? during collection|error\[E0\d+\]|error: could not compile|error: cannot find|Cannot find (module|name)|Unexpected token|ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND/;
/** The runner said a test failed or an assertion did not hold. */
const TEST_FAILED = /AssertionError|\bassert|\bFAIL(ED)?\b|\bnot ok\b|✖|✗|\bfailed\b|\bfailing\b|panicked|--- FAIL|\bexpected\b|\bExpected\b/;

/**
 * Whether a test's first run, on the code as it is, is a failure worth keeping:
 * the runner reported a failed test or assertion, and not a load, syntax or import error.
 * (A crude rule on purpose: a wrong reproduction that fails for a reason other than the
 * bug is the risk the measurement is there to size.)
 */
export function failedForTheBug(result: Pick<CheckResult, "status" | "exitCode" | "tail">): { ok: true } | { ok: false; why: string } {
  if (result.status === "passed") return { ok: false, why: "passes on the current code" };
  if (result.status !== "failed") return { ok: false, why: `the run ${result.status}` };
  if (brokenTest(result.tail) || LOAD_ERROR.test(result.tail)) return { ok: false, why: "cannot load (a syntax, name or import error)" };
  if (!TEST_FAILED.test(result.tail)) return { ok: false, why: "no failed test or assertion in the output" };
  return { ok: true };
}

/** [F133 new-project-tests] A project with no source file yet (test files and docs do not count). */
export function isNewProject(files: string[]): boolean {
  return !files.some((f) => CODE_FILE.test(f) && !TEST_PATH.test(f));
}

/** [F133 new-project-tests] A mistake in the test file itself: it does not parse. */
const OWN_MISTAKE = /SyntaxError|IndentationError|TabError|Unexpected token|ERR_UNKNOWN_FILE_EXTENSION/;

/**
 * [F133 new-project-tests] On a new project the code under test does not exist yet, so a test that cannot find it
 * (a missing module or name) is the failure expected before the build, as is a failed assertion. It is still rejected
 * when it passes with nothing built, when the run times out or cannot start, or when the test file does not parse.
 */
export function failsBeforeTheBuild(result: Pick<CheckResult, "status" | "exitCode" | "tail">): { ok: true } | { ok: false; why: string } {
  if (result.status === "passed") return { ok: false, why: "passes before anything is built" };
  if (result.status !== "failed") return { ok: false, why: `the run ${result.status}` };
  if (OWN_MISTAKE.test(result.tail)) return { ok: false, why: "the test file does not parse" };
  if (!brokenTest(result.tail) && !LOAD_ERROR.test(result.tail) && !TEST_FAILED.test(result.tail)) return { ok: false, why: "no failed test, assertion or missing module in the output" };
  return { ok: true };
}

/** The one line the build prompt gets. */
export function reproduceLine(task: { reproduce?: Reproduction }): string {
  const r = task.reproduce;
  return r?.stage === "accepted" && r.path ? `\n\nA test reproducing the bug is at ${r.path}; make it pass without weakening it.` : "";
}
