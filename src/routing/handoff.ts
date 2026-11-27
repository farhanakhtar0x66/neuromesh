// [F141 cleanroom-handoff] What a cheap probe leaves behind for the router and for a stronger model.
//
// Two outputs, kept strictly apart:
// - buildTrajectoryDigest: how the cheap model behaved (found its files or wandered, repeated reads, looped on a
//   failing command, edited or not, checks closer or worse), in plain words for Laya (under 180 tokens, no file
//   names, no code). Read from the tool calls in Claude Code's stream log, never from the model's own text.
// - buildCleanRoomFactsPacket: what the stronger model is given, and only facts Neuromesh verified itself: the
//   project's check commands as Neuromesh ran them on the unchanged code, with their output through F136's
//   filter, and (only where F130's gate says the search is big) up to 5 file:line pointers taken from that
//   output. Never the cheap model's reasoning, diagnosis, plan, reproduction scripts or edits (F131), and no
//   working rules (F132). The cheap model's edits are discarded before the stronger model starts.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../checks/checks.ts";
import { filterOutput } from "../tools/leanfilter.ts";
import { estimateTokens } from "./probe.ts";
import type { ProbeFacts } from "./probe.ts";

export const MAX_DIGEST_TOKENS = 180;
export const MAX_POINTERS = 5;
/** F130's repository size below which there is no search to save. */
const BIG_REPO = 150;

export interface ToolCall {
  name: string;
  /** The file a read, edit or write was on, when there was one. */
  path?: string;
  /** A shell command, when the tool ran one. */
  command?: string;
  /** The tool reported an error (a failing command, a missing file). */
  failed?: boolean;
}

/** One cheap turn, as the digest sees it. */
export interface CheapTurn {
  /** Tool calls in order, from the turn's stream log. */
  tools: ToolCall[];
  /** Model calls in the turn, when known. */
  calls?: number;
  /** The checks Neuromesh ran after the turn, when it ran them. */
  checks?: CheckResult[];
  /** Files the turn left changed (paths only; for counts and spread). */
  changedFiles?: string[];
  /** The turn stopped at its turn cap. */
  capped?: boolean;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/**
 * The tool calls in a Claude Code stream-json log (`--output-format stream-json`): each `tool_use` block of an
 * assistant message, and whether its `tool_result` came back as an error. Text blocks are skipped: the model's
 * words never leave this function.
 */
export function parseTrajectory(logText: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const line of logText.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown> | undefined;
    try {
      event = obj(JSON.parse(line));
    } catch {
      continue;
    }
    const content = obj(event?.message)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const b = obj(raw);
      if (!b) continue;
      if (event!.type === "assistant" && b.type === "tool_use") {
        const input = obj(b.input) ?? {};
        const path = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : typeof input.notebook_path === "string" ? input.notebook_path : undefined;
        const call: ToolCall = { name: typeof b.name === "string" ? b.name : "tool", ...(path ? { path } : {}), ...(typeof input.command === "string" ? { command: input.command } : {}) };
        calls.push(call);
        if (typeof b.id === "string") byId.set(b.id, call);
      } else if (event!.type === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const call = byId.get(b.tool_use_id);
        if (call && b.is_error === true) call.failed = true;
      }
    }
  }
  return calls;
}

const failingOf = (results: CheckResult[] | undefined): CheckResult[] => (results ?? []).filter((r) => r.status === "failed" || r.status === "timeout");
const topDir = (p: string): string => p.replace(/^\.?\//, "").split("/").slice(0, p.includes("/") ? 1 : 0).join("/") || ".";

/**
 * How the cheap probe went, in plain words: located its files or scattered, repeated reads, looped on a failing
 * command, edited or not, checks closer to passing or failing on new errors, and signs of edges or coupling the
 * request did not state. No file names, commands, code or numbers to compare; under MAX_DIGEST_TOKENS.
 */
export function buildTrajectoryDigest(probe: ProbeFacts | undefined, turns: CheapTurn[], baseline?: CheckResult[]): string {
  const tools = turns.flatMap((t) => t.tools);
  const reads = tools.filter((t) => t.path && /^(Read|Grep|Glob|NotebookRead)$/.test(t.name));
  const edits = tools.filter((t) => t.path && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t.name));
  const bash = tools.filter((t) => t.command);
  const sentences: string[] = [];
  if (tools.length === 0) {
    sentences.push("The cheap model used no tools.");
  } else {
    // Located quickly: one of its first three file calls was on a file the probe resolved from the request.
    const named = new Set((probe?.candidateFiles ?? []).map((f) => f.toLowerCase()));
    const firstFiles = tools.filter((t) => t.path).slice(0, 3).map((t) => t.path!.toLowerCase());
    const hit = named.size > 0 && firstFiles.some((p) => [...named].some((n) => p.endsWith(n)));
    const dirs = new Set(reads.map((t) => topDir(t.path!)));
    if (hit) sentences.push("It went straight to the code the request names.");
    else if (dirs.size >= 4) sentences.push("It searched across many unrelated parts of the repository.");
    else if (reads.length > 0) sentences.push("It looked around a few places before settling.");
    const seen = new Map<string, number>();
    for (const r of reads) seen.set(r.path!, (seen.get(r.path!) ?? 0) + 1);
    if ([...seen.values()].some((n) => n >= 3)) sentences.push("It read the same file over and over.");
    else if ([...seen.values()].some((n) => n === 2)) sentences.push("It re-read a file it had already read.");
    const failedRuns = new Map<string, number>();
    for (const b of bash) if (b.failed) failedRuns.set(b.command!, (failedRuns.get(b.command!) ?? 0) + 1);
    if ([...failedRuns.values()].some((n) => n >= 2)) sentences.push("It ran the same failing command repeatedly, a loop.");
    else if (failedRuns.size > 0) sentences.push("Some of its commands failed.");
  }
  const changed = [...new Set(turns.flatMap((t) => t.changedFiles ?? []))];
  if (edits.length === 0 && changed.length === 0) sentences.push("It made no edit.");
  else if (changed.length >= 3 && new Set(changed.map(topDir)).size >= 2) sentences.push("Its edits spread over several modules.");
  else sentences.push("It made a focused edit.");
  const last = [...turns].reverse().find((t) => t.checks !== undefined)?.checks;
  if (last) {
    const before = failingOf(baseline);
    const after = failingOf(last);
    const fresh = after.filter((r) => !before.some((b) => b.name === r.name));
    if (after.length === 0) sentences.push(last.length > 0 ? "The project's checks now pass." : "The project has no checks to run.");
    else if (fresh.length > 0) sentences.push("Checks that passed before now fail: it broke something it was not asked to touch.");
    else sentences.push("The checks that failed before still fail.");
  } else sentences.push("Its work was not checked.");
  if (turns.some((t) => t.capped)) sentences.push("It used its whole turn allowance without finishing.");
  let text = sentences.join(" ");
  while (estimateTokens(text) >= MAX_DIGEST_TOKENS && sentences.length > 1) {
    sentences.splice(sentences.length - 2, 1);
    text = sentences.join(" ");
  }
  return text;
}

export interface DiffStats {
  /** Files the cheap work changed (discarded before the stronger model starts). */
  files: number;
  insertions?: number;
  deletions?: number;
}

/** file:line pointers in check output that exist in the repository: Python, JavaScript, Rust and Go frames. */
export function framePointers(output: string, dir: string, limit = MAX_POINTERS): string[] {
  const out: string[] = [];
  const add = (rawPath: string, line: string): void => {
    if (out.length >= limit) return;
    let path = rawPath.replace(/^\.\//, "");
    if (path.startsWith(dir)) path = path.slice(dir.length).replace(/^\/+/, "");
    if (path.startsWith("/") || path.includes("node_modules/") || path.includes("site-packages/") || /^node:|<frozen|^internal\//.test(path)) return;
    try {
      if (!existsSync(join(dir, path)) || !statSync(join(dir, path)).isFile()) return;
    } catch {
      return;
    }
    const p = `${path}:${line}`;
    if (!out.includes(p)) out.push(p);
  };
  // In the order the output names them.
  const found: { at: number; path: string; line: string }[] = [];
  for (const m of output.matchAll(/File "([^"]+)", line (\d+)/g)) found.push({ at: m.index!, path: m[1]!, line: m[2]! });
  for (const m of output.matchAll(/(?:^|[\s(])((?:[\w@.-]+\/)*[\w.-]+\.(?:[cm]?[jt]sx?|py|rs|go|rb|java|kt|c|cc|cpp|h)):(\d+)(?::\d+)?/gm)) found.push({ at: m.index!, path: m[1]!, line: m[2]! });
  for (const f of found.sort((a, b) => a.at - b.at)) add(f.path, f.line);
  return out;
}

/**
 * The facts a stronger model starts from, after the cheap work was discarded. Only what Neuromesh ran and saw
 * itself on the unchanged code (the baseline checks), shortened by F136's filter; pointers only where F130's
 * gate applies (a big repository and a request that names no code). Empty when there is nothing verified.
 */
export function buildCleanRoomFactsPacket(probe: ProbeFacts | undefined, _cheapTurns: CheapTurn[], gitDiffStats: DiffStats | undefined, verified: { baseline?: CheckResult[]; dir: string }): string {
  // The cheap turns are taken only to make clear they are not used: nothing of them is passed on.
  void _cheapTurns;
  const parts: string[] = [];
  if (gitDiffStats && gitDiffStats.files > 0) parts.push("You start from the original code: an earlier attempt's changes were discarded and are not shown to you.");
  const baseline = (verified.baseline ?? []).filter((r) => r.status !== "unavailable");
  if (baseline.length > 0) {
    const lines = baseline.map((r) => {
      if (r.status === "passed") return `- \`${r.command}\` passes on the unchanged code.`;
      const what = r.status === "timeout" ? "did not finish in time" : `exits ${r.exitCode ?? "with an unknown code"}`;
      return `- \`${r.command}\` ${what} on the unchanged code. Its output, as Neuromesh ran it:\n\`\`\`\n${filterOutput(r.tail, r.exitCode)}\n\`\`\``;
    });
    parts.push(`Facts Neuromesh verified by running the project's checks before any change:\n${lines.join("\n")}`);
    const gate = probe !== undefined && probe.repoFileCount > BIG_REPO && probe.namedSymbols.length === 0;
    if (gate) {
      const pointers = framePointers(baseline.filter((r) => r.status !== "passed").map((r) => r.tail).join("\n"), verified.dir);
      if (pointers.length > 0) parts.push(`Locations named in that output (from the output itself, not from anyone's reading of the code):\n${pointers.map((p) => `- ${p}`).join("\n")}`);
    }
  }
  return parts.join("\n\n");
}
