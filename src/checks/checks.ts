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
        command: `if ${python} -c "import pytest" 2>/dev/null; then ${python} -m pytest -q; else ${python} -m unittest discover -q -t . -s ${existsSync(join(dir, "tests")) ? "tests" : existsSync(join(dir, "test")) ? "test" : "."}; fi`,
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
}

const TAIL_LINES = 60;

export async function runChecks(options: RunChecksOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of options.checks) {
    const logPath = join(options.logDir, `${options.label}-${check.name}.log`);
    const lines: string[] = [];
    const proc = await runProcess({
      command: "sh",
      args: ["-c", `${check.command} 2>&1`],
      cwd: options.dir,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      signal: options.signal,
      logPath,
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      onLine: (line) => {
        lines.push(line);
        if (lines.length > TAIL_LINES * 4) lines.splice(0, lines.length - TAIL_LINES);
      },
    });
    const tail = lines.slice(-TAIL_LINES).join("\n");
    let status: CheckStatus;
    if (proc.cancelled) status = "cancelled";
    else if (proc.timedOut) status = "timeout";
    else if (proc.exitCode === 0) status = "passed";
    else if (isUnavailable(proc.exitCode, tail)) status = "unavailable";
    else status = "failed";
    results.push({
      name: check.name,
      command: check.command,
      status,
      exitCode: proc.exitCode,
      durationMs: proc.durationMs,
      tail,
      signature: status === "failed" || status === "timeout" ? failureSignature(tail) : undefined,
      logPath,
    });
    if (proc.cancelled) break;
  }
  return results;
}
