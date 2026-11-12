// API list prices, used to put every model's usage into one unit.
//
// This is an ESTIMATE of what the same tokens would cost on each provider's
// pay-per-token API. Nothing here is money actually spent: runs use
// subscriptions. Source and date: docs/reference/api-pricing-2026-11-11.md.
//
// Caveats that make the estimate rough:
// - GPT prices are the short-context tier (requests up to 272K input tokens).
// - Gemini 3.8 Flash prices are promotional until 2026-12-31, then double.
// - Reasoning tokens are assumed to be included in each tool's output count.

import type { Usage } from "../backends/types.ts";

export interface Price {
  /** USD per million tokens. */
  input: number;
  cacheRead: number;
  output: number;
  /** Cache writes as a multiple of the input price; 0 when they are already counted as input. */
  cacheWriteFactor: number;
  /**
   * [F66 tier-pricing] Prices for a call whose prompt is over LONG_PROMPT
   * tokens, applied to that whole call (input and output).
   */
  long?: { input: number; cacheRead: number; output: number };
}

export const PRICES_AS_OF = "2026-11-11";

const TABLE: [RegExp, Price][] = [
  [/^gemini-3\.8-flash/, { input: 0.75, cacheRead: 0.075, output: 3.75, cacheWriteFactor: 0 }],
  [/^gpt-6\.1-sol/, { input: 2, cacheRead: 0.1, output: 10, cacheWriteFactor: 0 }],
  [/^gpt-6\.1-terra/, { input: 1, cacheRead: 0.05, output: 5, cacheWriteFactor: 0 }],
  [/^gpt-6-astra/, { input: 10, cacheRead: 1, output: 50, cacheWriteFactor: 0 }],
  [/^gpt-6-luna/, { input: 0.1, cacheRead: 0.01, output: 0.5, cacheWriteFactor: 0 }],
  [/^claude-fable-5-2/, { input: 8, cacheRead: 0.2, output: 40, cacheWriteFactor: 2 }],
  [/^claude-fable-5-1/, { input: 6, cacheRead: 0.15, output: 30, cacheWriteFactor: 2 }],
  // Claude Code writes one-hour cache entries, billed at twice the input price.
  [/^claude-opus-5-5/, { input: 4, cacheRead: 0.2, output: 20, cacheWriteFactor: 2 }],
  [/^claude-sonnet-5-5/, { input: 2, cacheRead: 0.1, output: 10, cacheWriteFactor: 2 }],
  // Over 100K prompt tokens the whole call costs five times as much (docs/reference/api-pricing-2026-11-11.md).
  [/^claude-haiku-5-5/, { input: 0.1, cacheRead: 0.01, output: 0.5, cacheWriteFactor: 2, long: { input: 0.5, cacheRead: 0.05, output: 2.5 } }],
  [/^claude-opus-4-6/, { input: 5, cacheRead: 0.5, output: 25, cacheWriteFactor: 2 }],
  [/^claude-sonnet-4-6/, { input: 3, cacheRead: 0.3, output: 15, cacheWriteFactor: 2 }],
  [/^deepseek-flash/, { input: 0.3, cacheRead: 0.006, output: 1.2, cacheWriteFactor: 0 }],
];

export function priceOf(model: string | undefined): Price | undefined {
  if (!model) return undefined;
  return TABLE.find(([pattern]) => pattern.test(model))?.[1];
}

/**
 * Estimated API cost in USD of some usage, or undefined when the model has no
 * listed price or the tool did not report its input or output tokens.
 */
export function estimateCost(model: string | undefined, usage: Usage): number | undefined {
  const price = priceOf(model);
  if (!price || usage.input === undefined || usage.output === undefined) return undefined;
  const at = (u: Usage, p: { input: number; cacheRead: number; output: number }): number =>
    ((u.input ?? 0) * p.input + (u.cacheRead ?? 0) * p.cacheRead + (u.cacheWrite ?? 0) * p.input * price.cacheWriteFactor + (u.output ?? 0) * p.output) / 1_000_000;
  // [F66 tier-pricing] The long calls at their own rates, the rest at the normal ones.
  const long = price.long && usage.long ? usage.long : undefined;
  if (!long) return at(usage, price);
  const minus = (x: number | undefined, y: number | undefined): number => Math.max(0, (x ?? 0) - (y ?? 0));
  const short: Usage = { input: minus(usage.input, long.input), cacheRead: minus(usage.cacheRead, long.cacheRead), cacheWrite: minus(usage.cacheWrite, long.cacheWrite), output: minus(usage.output, long.output) };
  return at(short, price) + at(long, price.long!);
}
