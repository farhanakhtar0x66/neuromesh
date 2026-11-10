// The stagnation breaker, ported from the Rust research kernel (progress.rs,
// milestone M2 of neuromesh-research). It decides, after each failed check
// run, whether a worker is still making progress or going in circles:
//
//   - the same state seen twice (same code, same failures)  -> oscillated
//   - two attempts in a row without improvement             -> no progress
//
// Improvement means: compiling where it did not before, or, with the same
// compile status, strictly fewer failing cases that are a subset of the
// previous ones. The research version keyed states by an AST hash of Rust
// code; this one uses a normalised diff, which works for any language.

import { createHash } from "node:crypto";
import type { CheckResult } from "../checks/checks.ts";

export interface Attempt {
  /** Fingerprint of the code: the normalised diff against the task's start. */
  codeKey: string;
  /** Fingerprints of the failing checks' output. */
  failureKey: string;
  failedCases: string[];
  compileOk: boolean;
}

export type Decision = "continue" | "passed" | "oscillated" | "no-progress";

export interface ProgressHistory {
  seen: string[];
  previous?: Attempt;
  consecutive: number;
}

export function newHistory(): ProgressHistory {
  return { seen: [], consecutive: 0 };
}

function stateKey(a: Attempt): string {
  return createHash("sha256")
    .update(JSON.stringify([a.codeKey, a.failureKey, [...a.failedCases].sort(), a.compileOk]))
    .digest("hex");
}

function improved(previous: Attempt, current: Attempt): boolean {
  if (!previous.compileOk && current.compileOk) return true;
  if (previous.compileOk !== current.compileOk) return false;
  const before = new Set(previous.failedCases);
  return current.failedCases.every((c) => before.has(c)) && current.failedCases.length < previous.failedCases.length;
}

/** Record a check run; returns what to do next. The history is updated in place. */
export function observe(history: ProgressHistory, attempt: Attempt, passed: boolean): Decision {
  if (passed) return "passed";
  const key = stateKey(attempt);
  if (history.seen.includes(key)) return "oscillated";
  history.seen.push(key);
  history.consecutive = history.previous && improved(history.previous, attempt) ? 0 : history.consecutive + 1;
  history.previous = attempt;
  // The first failed attempt has nothing earlier to improve on, so it counts
  // as one step without progress (the research version seeded the history
  // with the failing baseline to the same effect). Two such steps stop it.
  return history.consecutive >= 2 ? "no-progress" : "continue";
}

/** Remove what does not change behaviour: blank lines, indentation, comment-only lines. */
export function codeKey(diff: string): string {
  const normalised = diff
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .map((line) => line[0] + line.slice(1).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .filter((line) => !/^[+-]\s*(\/\/|#|\/\*|\*|--)/.test(line))
    .join("\n");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

const CASE_PATTERNS = [
  /^✖ (.+?)(?: \(\d[\d.]*m?s\))?$/gm, // node --test
  /^FAILED (\S+)/gm, // pytest
  /^(?:FAIL|ERROR): (\S+ \([^)]+\))/gm, // unittest
  /^test (\S+) \.\.\. FAILED$/gm, // cargo test
  /^--- FAIL: (\S+)/gm, // go test
  /^\s+✕ (.+?)(?: \(\d+ ?ms\))?$/gm, // jest / vitest
];

/** Turn check results into an attempt record. */
export function attemptFrom(results: CheckResult[], diff: string): Attempt {
  const failing = results.filter((r) => r.status === "failed" || r.status === "timeout");
  const cases = new Set<string>();
  for (const r of failing) {
    let found = false;
    for (const pattern of CASE_PATTERNS) {
      for (const match of r.tail.matchAll(pattern)) {
        if (match[1] && !/^failing tests:?$/i.test(match[1].trim())) {
          cases.add(`${r.name}: ${match[1].trim()}`);
          found = true;
        }
      }
    }
    if (!found) cases.add(r.name);
  }
  const compileError = /error\[E\d+\]|error TS\d+|SyntaxError|could not compile|IndentationError|ModuleNotFoundError|ImportError/;
  return {
    codeKey: codeKey(diff),
    failureKey: failing.map((r) => `${r.name}:${r.signature ?? ""}`).sort().join("|"),
    failedCases: [...cases].sort(),
    compileOk: !failing.some((r) => /^(typecheck|build|compile)$/.test(r.name) || compileError.test(r.tail)),
  };
}
