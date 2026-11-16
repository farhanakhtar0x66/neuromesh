// [F114 short-output] The pure parts of `nm run` and `nm checks --only`, kept apart from
// nm.ts (which runs on import) so they can be tested. Node built-ins only.
//
// Why: in a worker turn every model call reads the whole conversation again, so a
// 10,000-character test run is paid for on every later call. The agent gets the
// verdict, the lines that say what broke and the two ends of the output; the rest
// is in a log file it can read in pieces if it needs to.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckSpec } from "../checks/checks.ts";

export const SHORT_LIMIT = 2_000; // output shorter than this is shown whole
export const SHORT_CAP = 3_000; // the shortened form stays near this
const HEAD = 15;
const TAIL = 25;
const MAX_FAILURE_LINES = 40;
const LINE_CLIP = 120;
const FAILURE = /fail|error|panic|assert|expected|not ok|✗|×/i;

const clip = (line: string): string => (line.length > LINE_CLIP ? `${line.slice(0, LINE_CLIP - 1)}…` : line);

/**
 * What an agent sees of a command's output. Under SHORT_LIMIT characters: all of it.
 * Otherwise the lines that look like failures (each with the line after it, at most
 * MAX_FAILURE_LINES of them), the first 15 and the last 25 lines, in order, near
 * SHORT_CAP characters, and a line saying how much was left out.
 */
export function shorten(output: string, logPath: string): string {
  if (output.length < SHORT_LIMIT) return output.replace(/\n+$/, "");
  const lines = output.replace(/\n+$/, "").split("\n");
  const n = lines.length;
  const keep = new Set<number>();
  const headEnd = Math.min(HEAD, n);
  const tailStart = Math.max(headEnd, n - TAIL);
  for (let i = 0; i < headEnd; i++) keep.add(i);
  for (let i = tailStart; i < n; i++) keep.add(i);

  // The two ends first; if they alone are over the cap, trim them toward the middle.
  const cost = (set: Set<number>): number => [...set].reduce((sum, i) => sum + clip(lines[i]!).length + 1, 0);
  let head = headEnd;
  let tail = n - tailStart;
  while (cost(keep) > SHORT_CAP - 400 && (head > 5 || tail > 8)) {
    if (head > 5) keep.delete(--head);
    if (tail > 8 && cost(keep) > SHORT_CAP - 400) keep.delete(n - tail--);
  }

  // Failure lines, with one line of context each, while the budget lasts.
  let budget = SHORT_CAP - 400 - cost(keep);
  let found = 0;
  for (let i = 0; i < n && found < MAX_FAILURE_LINES; i++) {
    if (keep.has(i) || !FAILURE.test(lines[i]!)) continue;
    found++;
    for (const j of [i, i + 1]) {
      if (j >= n || keep.has(j)) continue;
      const c = clip(lines[j]!).length + 1;
      if (c > budget) continue;
      keep.add(j);
      budget -= c;
    }
  }

  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > prev + 1) out.push(`  ⋯ ${i - prev - 1} lines`);
    out.push(clip(lines[i]!));
    prev = i;
  }
  if (prev < n - 1) out.push(`  ⋯ ${n - 1 - prev} lines`);
  const cut = [...keep].some((i) => lines[i]!.length > LINE_CLIP) ? `; lines over ${LINE_CLIP} characters are cut` : "";
  out.push(`(${n - keep.size} of ${n} lines left out${cut}. The rest: nm show ${logPath}, or tail/grep on that file)`);
  return out.join("\n");
}

/** Arguments as one shell command line: a single argument is taken as the command itself. */
export function commandLine(args: string[]): string {
  if (args.length === 1) return args[0]!;
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** Run a command through `sh -c`, output combined, with the 5-minute limit `checks` uses. */
export function runCommand(command: string, cwd: string): { status: number | null; output: string; timedOut: boolean } {
  const r = spawnSync("sh", ["-c", `exec 2>&1\n${command}`], { cwd, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 256 * 1024 * 1024 });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { status: r.status, output: (r.stdout ?? "") + (r.error && !timedOut ? `\n${r.error.message}` : ""), timedOut };
}

function trackedAndNew(dir: string): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

/** Test files whose path is `pattern` or contains it (a `*` matches anything). */
function matchTestFiles(dir: string, pattern: string, isTestFile: RegExp): string[] {
  if (existsSync(join(dir, pattern))) return [pattern];
  const glob = new RegExp(pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
  return trackedAndNew(dir).filter((f) => isTestFile.test(f) && glob.test(f));
}

const shellWord = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export type OnlyResult = { command: string } | { error: string } | { unsupported: string };

/**
 * `nm checks --only <pattern>`: the command that runs just that test file or name
 * through the project's runner, where that is possible: node --test, cargo test <name>,
 * pytest <path>. Anything else is "unsupported" and the caller runs every check.
 */
export function onlyCommand(dir: string, specs: CheckSpec[], pattern: string): OnlyResult {
  const test = specs.find((c) => c.name === "test");
  if (!test) return { unsupported: "this project has no test check" };

  // node --test: the package's own test script, with its file arguments swapped for the match.
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    let script = "";
    try {
      script = String(((JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}).test ?? "");
    } catch {
      // An unreadable package.json is "not supported", below.
    }
    if (/^node\b.*--test\b/.test(script.trim())) {
      const files = matchTestFiles(dir, pattern, /\.(test|spec)\.[cm]?[jt]sx?$/);
      if (files.length === 0) return { error: `no test file matches ${pattern}` };
      const flags = script.trim().split(/\s+/).filter((t) => t.startsWith("-") || t === "node");
      return { command: `${flags.join(" ")} ${files.map(shellWord).join(" ")}` };
    }
  }

  if (/^cargo test\b/.test(test.command)) return { command: `${test.command} ${shellWord(pattern)}` };

  const python = /^if (\S+) -c "import pytest"/.exec(test.command)?.[1];
  if (python || /\bpytest\b/.test(test.command)) {
    const files = matchTestFiles(dir, pattern, /(^|\/)(test_.*|.*_test)\.py$/);
    if (files.length === 0) return { error: `no test file matches ${pattern}` };
    const runner = python ? `${python} -m pytest -q -rs` : test.command.replace(/\bpytest\b.*$/, "pytest -q");
    if (python && spawnSync("sh", ["-c", `${python} -c "import pytest"`], { cwd: dir }).status !== 0) {
      return { unsupported: "pytest is not installed here, so the tests run through unittest" };
    }
    return { command: `${runner} ${files.map(shellWord).join(" ")}` };
  }

  return { unsupported: `no way to run one file through \`${test.command}\`` };
}
