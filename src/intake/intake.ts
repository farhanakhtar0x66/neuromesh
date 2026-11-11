// Intake: decide, with no model call, whether a request needs the team.
//
// The expert is the expensive part of a team run, so a small, focused request
// goes straight to a single worker. Anything that looks like several parts, or
// is long enough to hide several, goes to the orchestrator, which may still
// plan a single task. The rules are deliberately simple and err toward the team.

export interface Route {
  mode: "solo" | "team";
  reason: string;
}

const SMALL_CHANGE =
  /\b(typo|typos|spelling|misspell\w*|rename|bump|version|comment|comments|readme|docstring|wording|whitespace|indent\w*|format\w*|default (port|value|timeout)|change (the )?\w+ (from|to))\b/i;

/**
 * "rules": plan anything that is not clearly small.
 * "worker-first": a worker starts on everything except clearly large requests;
 * the expert steps in only when the worker gets stuck. This is the factory floor
 * taken literally, and on small and medium tasks it spends far less expert effort.
 */
export type RoutePolicy = "rules" | "worker-first";

export function route(prompt: string, policy: RoutePolicy = "rules"): Route {
  if (policy === "worker-first") return workerFirst(prompt);
  return rules(prompt);
}

function workerFirst(prompt: string): Route {
  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const parts = Math.max((text.match(/^\s*\d+[.)]\s/gm) ?? []).length, (text.match(/^\s*[-*]\s/gm) ?? []).length);
  const files = new Set(text.match(/[\w./-]+\.(?:[jt]sx?|py|rs|go|md|json|toml|ya?ml|css|html)\b/g) ?? []).size;
  if (parts >= 4) return { mode: "team", reason: `a large request with ${parts} parts; the expert plans it` };
  if (words >= 250) return { mode: "team", reason: `a large request (${words} words); the expert plans it` };
  if (files >= 6) return { mode: "team", reason: `the request names ${files} files; the expert plans it` };
  return { mode: "solo", reason: "a worker starts; the expert steps in only if it gets stuck" };
}

function rules(prompt: string): Route {
  const text = prompt.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const numbered = (text.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  const bullets = (text.match(/^\s*[-*]\s/gm) ?? []).length;
  const files = new Set(text.match(/[\w./-]+\.(?:[jt]sx?|py|rs|go|md|json|toml|ya?ml|css|html)\b/g) ?? []).size;

  if (numbered >= 2 || bullets >= 3) {
    return { mode: "team", reason: `the request lists ${Math.max(numbered, bullets)} parts` };
  }
  if (files >= 3) {
    return { mode: "team", reason: `the request names ${files} files` };
  }
  if (words <= 60 && SMALL_CHANGE.test(text)) {
    return { mode: "solo", reason: "a small, focused change; one worker is enough" };
  }
  if (words <= 30) {
    return { mode: "solo", reason: `a short request (${words} words); one worker is enough` };
  }
  return { mode: "team", reason: `a ${words}-word request; the orchestrator decides how to split it` };
}
