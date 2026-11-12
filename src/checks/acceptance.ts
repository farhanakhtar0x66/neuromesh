// [F58 acceptance-runs] [F59 reproduced-findings] The engine runs the program
// for real, and runs the reviewer's claims, instead of trusting either side.
//
// In the python-bot run 46 tests passed on hand-written samples while every
// formula on live Wikipedia came out flattened; one real run would have shown
// it. The same run's reviewer reported a "blocker" that was already fixed.
// Published work finds the same: model reviewers flag correct code, and one
// real run removes findings that argument does not (docs/12-python-bot-run.md).
//
// Both kinds of command were written by models, so on macOS they run under the
// write sandbox: they may write only in the throwaway copy and temp folders.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../backends/proc.ts";
import { sandboxAvailable, sandboxed } from "../backends/sandbox.ts";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

const OUTPUT_CHARS = 2_000;

export async function runCommand(dir: string, command: string, options: { timeoutMs: number; env?: Record<string, string>; signal?: AbortSignal }): Promise<CommandResult> {
  const lines: string[] = [];
  const shell = { command: "sh", args: ["-c", `${command} 2>&1`] };
  const run = sandboxAvailable() ? sandboxed(shell.command, shell.args, [dir, tmpdir()]) : shell;
  const proc = await runProcess({
    command: run.command,
    args: run.args,
    cwd: dir,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    stdin: "",
    env: { ...process.env, ...options.env, CI: "1", NO_COLOR: "1" },
    onLine: (l) => {
      lines.push(l);
      if (lines.length > 200) lines.shift();
    },
  });
  const output = lines.join("\n");
  return {
    command,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    output: output.length > OUTPUT_CHARS ? `…${output.slice(-OUTPUT_CHARS)}` : output,
    durationMs: proc.durationMs,
  };
}

const ENGINE_FOLDERS = /^(?:\.venv|node_modules)\//;
const TEXT_FILE = /\.(?:md|markdown|txt|json|csv|tsv|html?|xml|ya?ml|toml|log)$/i;

/** Files the commands created or changed in the copy (not the engine's own folders). */
export function changedFiles(dir: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
    .filter((p) => p !== "" && !ENGINE_FOLDERS.test(p));
}

/** The beginning of up to three text files the runs wrote, so the reviewer sees real output. */
function samples(dir: string, files: string[]): string {
  const text = files.filter((f) => TEXT_FILE.test(f)).slice(0, 3);
  return text
    .map((f) => {
      try {
        const body = readFileSync(join(dir, f), "utf8");
        const head = body.split("\n").slice(0, 80).join("\n").slice(0, 3_500);
        return `--- ${f} (first lines) ---\n${head}\n--- end of sample ---`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function sizeOf(dir: string, f: string): string {
  try {
    const n = statSync(join(dir, f)).size;
    return n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
  } catch {
    return "?";
  }
}

export interface AcceptanceOutcome {
  results: (CommandResult & { expect: string })[];
  files: string[];
  /** The evidence for the reviewer. */
  text: string;
}

export async function runAcceptance(
  dir: string,
  runs: { command: string; expect: string }[],
  options: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<AcceptanceOutcome> {
  const results: AcceptanceOutcome["results"] = [];
  for (const a of runs) {
    if (options.signal?.aborted) break;
    const r = await runCommand(dir, a.command, { timeoutMs: options.timeoutMs ?? 3 * 60_000, env: options.env, signal: options.signal });
    results.push({ ...r, expect: a.expect });
  }
  const files = changedFiles(dir);
  const listing = files.length > 0 ? files.slice(0, 40).map((f) => `- ${f} (${sizeOf(dir, f)})`).join("\n") + (files.length > 40 ? `\n- … and ${files.length - 40} more` : "") : "(none)";
  const text = [
    ...results.map(
      (r, i) =>
        `Run ${i + 1}: \`${r.command}\`\nExpected: ${r.expect}\nResult: ${r.timedOut ? "stopped after the time limit" : `exit code ${r.exitCode}`}, ${Math.round(r.durationMs / 1000)} s. Output:\n\`\`\`\n${r.output || "(no output)"}\n\`\`\``,
    ),
    `Files the runs created or changed:\n${listing}`,
    samples(dir, files),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { results, files, text };
}

export type CheckedFinding<F> = F & { verified?: boolean };

/**
 * Run each blocker's check. A check that exits 0 did not show the problem, so
 * that finding is dropped. One that cannot run at all (exit 127) proves
 * nothing either way and leaves the finding unverified.
 */
export async function verifyFindings<F extends { severity?: string; check?: string }>(
  dir: string,
  findings: F[],
  options: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ kept: CheckedFinding<F>[]; dropped: (F & { output: string })[] }> {
  const kept: CheckedFinding<F>[] = [];
  const dropped: (F & { output: string })[] = [];
  for (const f of findings) {
    if (f.severity === "minor" || !f.check || options.signal?.aborted) {
      kept.push({ ...f });
      continue;
    }
    const r = await runCommand(dir, f.check, { timeoutMs: options.timeoutMs ?? 90_000, env: options.env, signal: options.signal });
    if (r.exitCode === 0 && !r.timedOut) dropped.push({ ...f, output: r.output.slice(-400) });
    else if (r.exitCode === 127 || r.exitCode === null) kept.push({ ...f });
    else kept.push({ ...f, verified: true });
  }
  return { kept, dropped };
}
