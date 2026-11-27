// [F137 cache-accounting] A turn's or a run's tokens as five explicit fields, so
// cache reads (cheap, and the bulk of a long session) are never mixed up with
// fresh input, and the number of model calls (what a frontier model's cost
// follows: HANDOFF, finding 3) sits next to them.
//
// Written beside the existing `usage` object (which keeps its field names:
// input, cacheRead, cacheWrite, output), so every reader of record.jsonl,
// results.json and evals/bench.ts goes on working. A count the tool did not
// report is left out, never written as 0 (CLAUDE.md).

import type { Usage } from "../backends/types.ts";

export interface TokenFields {
  /** Input not read from cache (Usage.input). */
  inputUncached?: number;
  cacheRead?: number;
  /** Input written to cache (Usage.cacheWrite). */
  cacheCreation?: number;
  output?: number;
  /** Model calls (Usage.calls). */
  calls?: number;
}

/** The explicit fields of one usage; undefined when the tool reported none of them. */
export function tokenFields(u: Usage | undefined): TokenFields | undefined {
  if (!u) return undefined;
  const out: TokenFields = {};
  if (u.input !== undefined) out.inputUncached = u.input;
  if (u.cacheRead !== undefined) out.cacheRead = u.cacheRead;
  if (u.cacheWrite !== undefined) out.cacheCreation = u.cacheWrite;
  if (u.output !== undefined) out.output = u.output;
  if (u.calls !== undefined) out.calls = u.calls;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The fields summed over several turns. A field is summed only when every turn
 * reported it; if any turn did not, the total is unknown and left out.
 */
export function sumTokenFields(parts: (TokenFields | undefined)[]): TokenFields | undefined {
  if (parts.length === 0) return undefined;
  const out: TokenFields = {};
  for (const key of ["inputUncached", "cacheRead", "cacheCreation", "output", "calls"] as const) {
    let total = 0;
    let known = true;
    for (const p of parts) {
      const v = p?.[key];
      if (v === undefined) {
        known = false;
        break;
      }
      total += v;
    }
    if (known) out[key] = total;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
