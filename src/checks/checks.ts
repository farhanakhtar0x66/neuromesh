// The project's own checks (type-check, lint, tests), found from its files and
// run by the engine itself. They cost no tokens and they are the ground truth:
// an agent saying "done" counts for nothing until these agree.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../backends/proc.ts";

export interface CheckSpec {
  name: string;
  command: string;
}

export type CheckStatus = "passed" | "failed" | "timeout" | "unavailable" | "cancelled";

export interface CheckResult {
  name: string;
  command: string;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  /** The last lines of output, for the agent and the user. */
  tail: string;
  /** Normalised failure fingerprint, used later to spot an agent going in circles. */
  signature?: string;
  /**
   * [F57 hollow-checks] The check exited 0 without testing anything: it ran no
   * tests, or skipped tests because a package is missing.
   */
  hollow?: string;
  logPath: string;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function hasPythonTests(dir: string): boolean {
  for (const folder of ["tests", "test"]) {
    const path = join(dir, folder);
    if (!existsSync(path)) continue;
    try {
      if (readdirSync(path).some((f) => /^test_.*\.py$|_test\.py$/.test(f))) return true;
    } catch {
      // Not a folder.
    }
  }
  try {
    return readdirSync(dir).some((f) => /^test_.*\.py$/.test(f));
  } catch {
    return false;
  }
}

/** Find the checks a project already has. A `neuromesh.json` file overrides detection. */
export function detectChecks(dir: string): CheckSpec[] {
  const config = readJson(join(dir, "neuromesh.json"));
  if (Array.isArray(config?.checks)) {
    return (config.checks as unknown[]).flatMap((c) => {
      const check = c as Partial<CheckSpec>;
      return typeof check.name === "string" && typeof check.command === "string"
        ? [{ name: check.name, command: check.command }]
        : [];
    });
  }

  const checks: CheckSpec[] = [];

  const pkg = readJson(join(dir, "package.json"));
  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const pm = existsSync(join(dir, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(dir, "yarn.lock"))
        ? "yarn"
        : existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))
          ? "bun"
          : "npm";
    const typecheck = ["typecheck", "type-check", "check-types"].find((s) => scripts[s]);
    if (typecheck) checks.push({ name: "typecheck", command: `${pm} run ${typecheck}` });
    else if (existsSync(join(dir, "tsconfig.json")) && existsSync(join(dir, "node_modules", ".bin", "tsc"))) {
      checks.push({ name: "typecheck", command: "npx --no-install tsc --noEmit" });
    }
    if (scripts.lint) checks.push({ name: "lint", command: `${pm} run lint` });
    const test = scripts.test;
    if (test && !/no test specified/.test(test)) checks.push({ name: "test", command: `${pm} test` });
  }

  if (existsSync(join(dir, "Cargo.toml"))) {
    checks.push({ name: "test", command: "cargo test --quiet" });
  }

  const pythonProject = ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini"].some((f) => existsSync(join(dir, f)));
  if ((pythonProject || hasPythonTests(dir)) && !checks.some((c) => c.name === "test")) {
    const python = existsSync(join(dir, ".venv", "bin", "python"))
      ? ".venv/bin/python"
      : existsSync(join(dir, "venv", "bin", "python"))
        ? "venv/bin/python"
        : "python3";
    if (existsSync(join(dir, "uv.lock"))) {
      checks.push({ name: "test", command: "uv run pytest -q" });
    } else {
      // pytest when it is installed, otherwise the standard library's unittest.
      checks.push({
        name: "test",
        // [F57 hollow-checks] -rs and -v print why a test was skipped, so a skip over a missing package is seen.
        command: `if ${python} -c "import pytest" 2>/dev/null; then ${python} -m pytest -q -rs; else ${python} -m unittest discover -v -t . -s ${existsSync(join(dir, "tests")) ? "tests" : existsSync(join(dir, "test")) ? "test" : "."}; fi`,
      });
    }
  }

  if (existsSync(join(dir, "go.mod"))) checks.push({ name: "test", command: "go test ./..." });

  if (checks.length === 0 && existsSync(join(dir, "Makefile"))) {
    const makefile = readFileSync(join(dir, "Makefile"), "utf8");
    if (/^test:/m.test(makefile)) checks.push({ name: "test", command: "make test" });
  }

  return checks;
}

/** A check that cannot run at all in this environment (the tool is missing). */
function isUnavailable(exitCode: number | null, tail: string): boolean {
  return exitCode === 127 || /command not found|No module named pytest\b/.test(tail);
}

/** Strip what changes between runs (timings, paths, addresses) so equal failures compare equal. */
export function failureSignature(tail: string): string {
  const normalised = tail
    .split("\n")
    .map((line) =>
      line
        .replace(/\/[^\s:'"]+\//g, "/…/")
        .replace(/0x[0-9a-f]+/gi, "0x…")
        .replace(/\d+(\.\d+)?\s*(ms|s|sec|seconds)\b/gi, "#time")
        .replace(/\b\d{2}:\d{2}:\d{2}\b/g, "#clock")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

export interface RunChecksOptions {
  dir: string;
  checks: CheckSpec[];
  logDir: string;
  label: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** [F54 work-env] Extra environment variables (the work folder's Python environment first on PATH). */
  env?: Record<string, string>;
  /** [F57 hollow-checks] Names of checks for which a hollow pass counts as a failure. */
  strict?: Set<string>;
}

const ZERO_TESTS = /^Ran 0 tests?\b|\bno tests ran\b|collected 0 items|^(?:# |ℹ )tests 0\s*$|^\s*0 passing\b|NO TESTS RAN/i;
const SOME_TESTS = /^Ran [1-9]\d* tests?\b|collected [1-9]\d* items?|^(?:# |ℹ )tests [1-9]\d*|^\s*[1-9]\d* passing\b|running [1-9]\d* tests?|\b[1-9]\d* passed\b|test result: ok\. [1-9]/i;
const SKIP_LINE = /\bskip(?:ped)?\b|# SKIP|SKIPPED/i;
const MISSING_DEP = /No module named|ModuleNotFoundError|ImportError|cannot import|not installed|could not import|Cannot find module|missing (?:dependency|package|module)|requires? [\w.-]+ (?:to be )?installed|\binstall\b|requirements(?:\.txt)?\b|\bdependenc(?:y|ies)\b/i;

/** [F57 hollow-checks] Why a passing check tested nothing, read from all of its output; undefined when it did test. */
export function hollowReason(lines: string[]): string | undefined {
  let zero = false;
  let some = false;
  let skippedMissing = 0;
  for (const line of lines) {
    if (ZERO_TESTS.test(line)) zero = true;
    if (SOME_TESTS.test(line)) some = true;
    if (SKIP_LINE.test(line) && MISSING_DEP.test(line)) skippedMissing += 1;
  }
  if (skippedMissing > 0) {
    return `Neuromesh: this check exited 0, but ${skippedMissing === 1 ? "a test was" : `${skippedMissing} tests were`} skipped because a package is missing, so the code it should test was never run. Declare the package (requirements.txt or package.json; Neuromesh installs it before the checks) and do not skip tests over a missing package.`;
  }
  if (zero && !some) return "Neuromesh: this check exited 0 but ran no tests, so it tested nothing. Add tests the check finds and runs.";
  return undefined;
}

const TAIL_LINES = 60;

export async function runChecks(options: RunChecksOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of options.checks) {
    const logPath = join(options.logDir, `${options.label}-${check.name}.log`);
    const lines: string[] = [];
    // [F57 hollow-checks] Every line is looked at once (a skip reason may be far above the tail).
    const notable: string[] = [];
    const proc = await runProcess({
      command: "sh",
      args: ["-c", `${check.command} 2>&1`],
      cwd: options.dir,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      signal: options.signal,
      logPath,
      env: { ...process.env, ...options.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      onLine: (line) => {
        lines.push(line);
        if (lines.length > TAIL_LINES * 4) lines.splice(0, lines.length - TAIL_LINES);
        if ((ZERO_TESTS.test(line) || SOME_TESTS.test(line) || (SKIP_LINE.test(line) && MISSING_DEP.test(line))) && notable.length < 500) notable.push(line);
      },
    });
    let tail = lines.slice(-TAIL_LINES).join("\n");
    let status: CheckStatus;
    if (proc.cancelled) status = "cancelled";
    else if (proc.timedOut) status = "timeout";
    else if (proc.exitCode === 0) status = "passed";
    else if (isUnavailable(proc.exitCode, tail)) status = "unavailable";
    else status = "failed";
    const hollow = status === "passed" ? hollowReason(notable) : undefined;
    if (hollow && options.strict?.has(check.name)) {
      status = "failed";
      const skips = notable.filter((l) => SKIP_LINE.test(l) && MISSING_DEP.test(l)).slice(0, 8);
      tail = `${hollow}\n${skips.length > 0 ? `The skipped tests:\n${skips.join("\n")}\n` : ""}Last lines of the output:\n${tail}`;
    }
    results.push({
      name: check.name,
      command: check.command,
      status,
      exitCode: proc.exitCode,
      durationMs: proc.durationMs,
      tail,
      signature: status === "failed" || status === "timeout" ? failureSignature(tail) : undefined,
      hollow,
      logPath,
    });
    if (proc.cancelled) break;
  }
  return results;
}
