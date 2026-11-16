#!/usr/bin/env node
// [F13 nm-tools] One small tool that any agent CLI can call from its shell
// (Codex, Claude Code, Antigravity), so finding one's way in a repository costs
// a few hundred tokens instead of directory listings and whole-file reads.
// It reads; `run` runs the agent's own command, and the tool itself never writes
// into the repository (the log of a run goes to the system temp folder).
//
//   node nm.ts map [words...]        repository map, most relevant to the words first
//   node nm.ts show <file> [symbol]  a symbol's body (or the file) with line numbers
//   node nm.ts find <regex> [path]   matching lines, grouped by file, capped
//   node nm.ts checks [--only <file>]  the project's checks, in short form (or one test file)
//   node nm.ts run -- <command...>   any command, with long output cut to the failures and both ends

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPacket, symbolBody, symbolsOf, trackedFiles } from "../context/packet.ts";
import { detectChecks } from "../checks/checks.ts";
import { commandLine, onlyCommand, runCommand, shorten } from "./shortout.ts"; // [F114 short-output]

const [command, ...args] = process.argv.slice(2);
const cwd = process.cwd();
const numbered = (lines: string[], first: number): string => lines.map((l, i) => `${String(first + i).padStart(5)}  ${l}`).join("\n");

function map(): number {
  process.stdout.write((buildPacket(cwd, args.join(" "), { maxChars: 12_000 }) ?? "The repository has no files yet.") + "\n");
  return 0;
}

function show(): number {
  const [file, symbol] = args;
  if (!file || !existsSync(file)) {
    process.stderr.write(`usage: nm show <file> [symbol]${file ? ` (no file ${file})` : ""}\n`);
    return 2;
  }
  const text = readFileSync(file, "utf8");
  if (symbol) {
    const body = symbolBody(file, text, symbol);
    if (!body) {
      process.stderr.write(`No definition of ${symbol} in ${file}. Definitions there: ${symbolsOf(file, text).map((s) => s.name).join(", ") || "none found"}\n`);
      return 1;
    }
    process.stdout.write(numbered(body.lines, body.start) + "\n");
    return 0;
  }
  const lines = text.split("\n");
  const limit = 400;
  process.stdout.write(numbered(lines.slice(0, limit), 1) + (lines.length > limit ? `\n(${lines.length - limit} more lines; use nm show ${file} <symbol>)` : "") + "\n");
  return 0;
}

function find(): number {
  const [pattern, path] = args;
  if (!pattern) {
    process.stderr.write("usage: nm find <regex> [path]\n");
    return 2;
  }
  const r = spawnSync("git", ["grep", "-n", "-I", "-E", "--untracked", pattern, "--", ...(path ? [path] : [])], { cwd, encoding: "utf8" });
  const hits = (r.stdout ?? "").split("\n").filter(Boolean);
  if (hits.length === 0) {
    process.stdout.write("No matches.\n");
    return 1;
  }
  const byFile = new Map<string, string[]>();
  for (const h of hits) {
    const [file, line, ...rest] = h.split(":");
    byFile.set(file!, [...(byFile.get(file!) ?? []), `${line}: ${rest.join(":").trim().slice(0, 160)}`]);
  }
  let shown = 0;
  for (const [file, lines] of byFile) {
    if (shown >= 60) break;
    process.stdout.write(`${file}\n`);
    for (const l of lines.slice(0, 12)) process.stdout.write(`  ${l}\n`);
    if (lines.length > 12) process.stdout.write(`  (${lines.length - 12} more in this file)\n`);
    shown += Math.min(lines.length, 12) + 1;
  }
  if (hits.length > shown) process.stdout.write(`(${hits.length} matches in ${byFile.size} files in all; narrow the pattern or give a path)\n`);
  return 0;
}

function checks(): number {
  let specs = detectChecks(cwd);
  if (specs.length === 0) {
    process.stdout.write("No checks found (no test script or test setup).\n");
    return 0;
  }
  // [F114 short-output] --only <file or pattern>: just that test file, where the runner allows it.
  const at = args.indexOf("--only");
  if (at >= 0) {
    const pattern = args[at + 1];
    if (!pattern) {
      process.stderr.write("usage: nm checks --only <file or pattern>\n");
      return 2;
    }
    const only = onlyCommand(cwd, specs, pattern);
    if ("error" in only) {
      process.stdout.write(`${only.error}\n`);
      return 2;
    }
    if ("unsupported" in only) process.stdout.write(`--only is not supported here (${only.unsupported}); running all the checks.\n`);
    else specs = [{ name: "test", command: only.command }];
  }
  let failed = 0;
  for (const c of specs) {
    const r = spawnSync("sh", ["-c", `exec 2>&1\n${c.command}`], { cwd, encoding: "utf8", timeout: 5 * 60_000 });
    const ok = r.status === 0;
    if (!ok) failed++;
    process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${c.name}  (${c.command})\n`);
    if (!ok) process.stdout.write((r.stdout ?? "").trimEnd().split("\n").slice(-30).map((l) => `    ${l}`).join("\n") + "\n");
  }
  return failed > 0 ? 1 : 0;
}

/**
 * [F114 short-output] Run a command; save everything it prints to a log outside the repository
 * (so it never shows in a diff); show `exit <code>`, the log's path and either all of the output
 * (short) or its failures and both ends. Never writes into the repository.
 */
function run(): number {
  const parts = args[0] === "--" ? args.slice(1) : args;
  if (parts.length === 0) {
    process.stderr.write("usage: nm run -- <command...>\n");
    return 2;
  }
  const result = runCommand(commandLine(parts), cwd);
  const dir = join(tmpdir(), "nm-logs");
  const logPath = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.log`);
  let logged = true;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(logPath, result.output);
  } catch {
    logged = false; // The output is still shown; only the full copy is lost.
  }
  const code = result.timedOut ? "timeout (killed after 5 minutes)" : String(result.status ?? "unknown (killed by a signal)");
  process.stdout.write(`exit ${code}${logged ? `  log: ${logPath}` : "  (the log could not be saved)"}\n`);
  const body = shorten(result.output, logged ? logPath : "the command's output");
  if (body) process.stdout.write(body + "\n");
  return result.status ?? 1;
}

const commands: Record<string, () => number> = { map, show, find, checks, run };
if (!command || !commands[command]) {
  process.stdout.write("nm: map [words...] | show <file> [symbol] | find <regex> [path] | checks [--only <file>] | run -- <command...>\n");
  process.exit(command ? 2 : 0);
}
// Keep the tool usable even if listing fails: trackedFiles is the only git dependency for map.
void trackedFiles;
process.exit(commands[command]!());
