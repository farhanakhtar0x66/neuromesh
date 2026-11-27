// [F136 lean-runner] The lean frontier runner: how a whole-request task is put to
// a frontier model when the preset asks for it (temporal-claude). Opt-in; the
// cascade, dossier and solo presets are unchanged.
//
// What it changes, against the solo prompt (docs/28-v04-lean-runner.md has the
// audit this comes from):
// - The prompt is the request as typed (F109: state.request, never the brief's
//   rewrite), the project's checks, and the answer format. No repository map
//   (F12), no start-here lines (F100), no brief standards (F132), no dossier.
// - A short anti-waste skill goes once into Claude Code's system prompt
//   (`--append-system-prompt`), the same text on every call and turn, so it
//   stays in the cached prefix.
// - Bash output is filtered before the model reads it (src/tools/leanfilter.ts,
//   through Claude Code's documented PreToolUse hook).
// - Claude Code owns the session history and Neuromesh cannot mask it mid-turn.
//   Instead, a follow-up turn (a repair) after a session has made LEAN_FRESH_AT
//   model calls starts a fresh session from facts only (the request, the checks'
//   raw output, the files already changed on disk), not from the model's own
//   transcript or summary (F131). Below that, the session is always resumed, so
//   its cached prefix is never rewritten early.

import { fileURLToPath } from "node:url";
import type { CheckSpec } from "../checks/checks.ts";
import { isOn } from "../features.ts";
import { hookSettings } from "../tools/leanfilter.ts";
import { NM_TOOL, failureSummary } from "./prompts.ts";
import type { AttemptRecord, RunState, TaskState } from "./types.ts";

/** A session that has made at least this many model calls is not resumed for a follow-up; a fresh one starts from facts. */
export const LEAN_FRESH_AT = 22;

export const LEAN_HOOK = fileURLToPath(new URL("../tools/lean-hook.ts", import.meta.url));

/**
 * The anti-waste skill: appended once to the system prompt, never changed
 * during a run (a change would rewrite the cached prefix of every later call).
 */
export const LEAN_SKILL = [
  "Working efficiently (each model call re-reads the whole conversation, so every wasted step is paid for again on every later call):",
  "- On your first turn, issue the independent searches and reads you need together, in parallel, rather than one per call.",
  "- Do not re-read a file or a part of one that is already in this conversation; scroll back instead. Re-read only after you have changed it.",
  "- Read the part of a file you need (a line range, a grep), not whole large files.",
  "- If you need a reproduction, write one script and keep re-running and editing it; do not create variant scripts.",
  "- While iterating, run the single test or test file that covers your change. Run the broader check once, before you finish.",
  "- Long command output is shortened before you see it: exit code, the first and last lines, and the failure lines between them, with a notice of what was left out.",
  `  If a command's output reaches you unshortened and long, run it as \`node ${NM_TOOL} run -- <command>\`.`,
  "- Narrow a noisy command instead of re-running it whole (one test, -x, grep, head or tail).",
  "- Batch related edits to one file into one edit.",
  "- When the checks pass and the request is done, stop and give the final answer; do not polish further.",
].join("\n");

/** Is this task run by the lean runner? Only the one task of an unplanned run (the whole request). */
export function isLean(state: Pick<RunState, "tasks" | "prompt">, task: Pick<TaskState, "brief">): boolean {
  return isOn("lean-runner") && state.tasks.length === 1 && task.brief === state.prompt;
}

/** The request as the person typed it (F109), with any files it named attached; never the brief's standards (F132). */
export function leanRequest(state: Pick<RunState, "request" | "prompt" | "brief">): string {
  if (state.request === undefined || !state.brief) return state.prompt;
  const files = state.brief.attached.map((a) => `The file ${a.path}, which the request refers to:\n--- ${a.path} ---\n${a.text}\n--- end of ${a.path} ---`);
  return [state.request, ...files].join("\n\n");
}

function checkLines(checks: CheckSpec[]): string {
  if (checks.length === 0) return "This project has no automatic checks. Test your change by hand where you can.";
  return `Neuromesh runs these checks after your turn and sends you any failure:\n${checks.map((c) => `- ${c.name}: \`${c.command}\``).join("\n")}`;
}

const LEAN_RULES = `Work only inside the current directory, and do not commit, push or change git settings: Neuromesh collects your changes from the files. Nobody can answer questions during this task; make reasonable choices and say what you chose in your answer.

When you finish, give your final answer in the required JSON format (status "done", or "blocked" with the reason in notes).`;

/** The first prompt of a lean task. */
export function leanTaskPrompt(state: RunState): string {
  return `Complete this request by editing the files in the current directory.

${leanRequest(state)}

${checkLines(state.checks)}

${LEAN_RULES}`;
}

/** The first prompt of a fresh session for a follow-up: facts only (the request, what is on disk, the checks' output). */
export function leanFreshPrompt(state: RunState, task: TaskState): string {
  return `${leanTaskPrompt(state)}

An earlier session already changed files in this directory (\`git diff\` shows them). Neuromesh then ran the project's checks:

${failureSummary(task.latest, state.baseline)}

Fix the problem.`;
}

/** Model calls the session has made in the run so far; undefined when a turn of it did not report its count. */
export function sessionCalls(attempts: Pick<AttemptRecord, "sessionId" | "usage">[], sessionId: string | undefined): number | undefined {
  if (!sessionId) return undefined;
  let calls = 0;
  for (const a of attempts) {
    if (a.sessionId !== sessionId) continue;
    if (a.usage.calls === undefined) return undefined;
    calls += a.usage.calls;
  }
  return calls;
}

/**
 * Should the follow-up start a fresh session? Only once the session has made
 * LEAN_FRESH_AT calls: never below, so a session's cached prefix is rewritten
 * at most once per LEAN_FRESH_AT calls. An unknown count never triggers it.
 */
export function leanFreshDue(calls: number | undefined): boolean {
  return calls !== undefined && calls >= LEAN_FRESH_AT;
}

/** What the backend is asked for on a lean turn (Claude Code reads both; other tools ignore them). */
export function leanBackendOptions(): { appendSystemPrompt: string; settings: string } {
  return { appendSystemPrompt: LEAN_SKILL, settings: hookSettings(LEAN_HOOK) };
}
