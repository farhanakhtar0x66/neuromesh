#!/usr/bin/env node
// [F13 nm-tools] One small tool that any agent CLI can call from its shell
// (Codex, Claude Code, Antigravity), so finding one's way in a repository costs
// a few hundred tokens instead of directory listings and whole-file reads.
// It only reads; it never changes files.
//
//   node nm.ts map [words...]        repository map, most relevant to the words first
//   node nm.ts show <file> [symbol]  a symbol's body (or the file) with line numbers
//   node nm.ts find <regex> [path]   matching lines, grouped by file, capped
//   node nm.ts checks                the project's checks, in short form

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { buildPacket, symbolBody, symbolsOf, trackedFiles } from "../context/packet.ts";
import { detectChecks } from "../checks/checks.ts";

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
  const specs = detectChecks(cwd);
  if (specs.length === 0) {
    process.stdout.write("No checks found (no test script or test setup).\n");
    return 0;
  }
  let failed = 0;
  for (const c of specs) {
    const r = spawnSync("sh", ["-c", `${c.command} 2>&1`], { cwd, encoding: "utf8", timeout: 5 * 60_000 });
    const ok = r.status === 0;
    if (!ok) failed++;
    process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${c.name}  (${c.command})\n`);
    if (!ok) process.stdout.write((r.stdout ?? "").trimEnd().split("\n").slice(-30).map((l) => `    ${l}`).join("\n") + "\n");
  }
  return failed > 0 ? 1 : 0;
}

const commands: Record<string, () => number> = { map, show, find, checks };
if (!command || !commands[command]) {
  process.stdout.write("nm: map [words...] | show <file> [symbol] | find <regex> [path] | checks\n");
  process.exit(command ? 2 : 0);
}
// Keep the tool usable even if listing fails: trackedFiles is the only git dependency for map.
void trackedFiles;
process.exit(commands[command]!());
