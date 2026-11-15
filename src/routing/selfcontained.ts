// [F109 direct-worker] Is this request one a worker can answer in a single call with no tools?
//
// A tool session pays for Claude Code's tool definitions and system prompt on every call, and
// for its own earlier turns re-read on every later call: on the routing benchmark's cascade runs
// that was 42 to 50 percent of the input in start-up and prompt and 47 to 55 percent in earlier
// turns (F106), against about 4 thousand tokens for one no-tools call. So a request that needs
// nothing the tools would fetch is cheaper to answer in one go.
//
// This is not Tier 0: it does not choose a tier and never changes a route. It is asked only once
// the router has put a task on a worker rung. Nothing here calls a model.

import { splitPayload } from "./router.ts";

export interface SelfContained {
  ok: boolean;
  /** What ruled it out, or what let it through; for the event log. */
  reasons: string[];
}

/** Longest request (in words) that is answered in one go. A long one is a project, not a call. */
export const MAX_WORDS = 100;
/** Most distinct files a request may name: a unit, not a program. */
export const MAX_NAMED_FILES = 2;
/** Most project text (characters) and files a one-answer worker is shown with the request. */
export const MAX_PROJECT_CHARS = 12_000;
export const MAX_PROJECT_FILES = 10;

/** Work that needs the program to be run, a service reached or a failure looked at: the tools are the point. */
const NEEDS_OBSERVATION = /\b(run (it|them|this|the|your|a|an)\b|execute|install|deploy|debug|reproduce|profile|benchmark|traceback|stack ?trace|crash(es|ing)?|failing|flaky|docker|kubernetes|postgres(ql)?|mysql|redis|migrat\w+|git (log|blame|diff|bisect)|npm (install|run|test|ci)|pip install|cargo (run|test|build)|curl|ssh\b|log files?|in production)\b/i;

/** Judgement, derivation or an argument, or a complexity bound (whether it can be met is the question): the early-exit gate and the confidence question belong to a turn with tools. */
const NEEDS_JUDGEMENT = /\b(explain|why\b|derive|derivation|prove|decide|recommend|trade-?offs?|compare|review|audit|is it possible|should (i|we))\b|\bO\([^)]*\)/i;

const FILE_NAME = /(?:^|[\s`'"(])([\w./-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx|rs|go|java|kt|c|h|cpp|rb|php|sh|sql|html|css|json|csv|tsv|txt|md|ya?ml|toml))\b/gi;

const SOURCE_FILE = /\.(py|js|mjs|cjs|ts|tsx|jsx|rs|go|java|kt|c|h|cpp|rb|php|sh)$/i;

export function selfContained(request: string, project: { path: string; content: string }[]): SelfContained {
  const no = (reason: string): SelfContained => ({ ok: false, reasons: [reason] });
  // Pasted material is data: only the instruction is judged for what it asks.
  const { instruction } = splitPayload(request);
  const words = request.trim().split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) return no(`${words} words: more than ${MAX_WORDS}`);
  if (NEEDS_OBSERVATION.test(instruction)) return no("asks for something that has to be run, installed or looked at");
  if (NEEDS_JUDGEMENT.test(instruction)) return no("asks for an explanation, a derivation or a decision");
  const chars = project.reduce((n, f) => n + f.content.length, 0);
  if (project.length > MAX_PROJECT_FILES || chars > MAX_PROJECT_CHARS) return no(`the project is ${project.length} files and ${chars} characters: too much to show in one prompt`);
  const named = new Set([...request.matchAll(FILE_NAME)].map((m) => m[1]!.toLowerCase()));
  if (named.size > MAX_NAMED_FILES) return no(`names ${named.size} files: more than ${MAX_NAMED_FILES}`);
  const names = named.size > 0;
  const code = project.some((f) => SOURCE_FILE.test(f.path));
  if (!names && !code) return no("names no file to write and the project has no code to change");
  return { ok: true, reasons: [`${words} words, ${project.length} project files (${chars} characters), ${names ? "names its file" : "changes the project's code"}`] };
}
