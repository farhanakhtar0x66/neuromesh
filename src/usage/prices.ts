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
}

export const PRICES_AS_OF = "2026-11-11";

const TABLE: [RegExp, Price][] = [
  [/^gemini-3\.8-flash/, { input: 0.75, cacheRead: 0.075, output: 3.75, cacheWriteFactor: 0 }],
  [/^gpt-6\.1-sol/, { input: 2, cacheRead: 0.1, output: 10, cacheWriteFactor: 0 }],
  [/^gpt-6\.1-terra/, { input: 1, cacheRead: 0.05, output: 5, cacheWriteFactor: 0 }],
  [/^gpt-6-astra/, { input: 10, cacheRead: 1, output: 50, cacheWriteFactor: 0 }],
  [/^gpt-6-luna/, { input: 0.1, cacheRead: 0.01, output: 0.5, cacheWriteFactor: 0 }],
  // Claude Code writes one-hour cache entries, billed at twice the input price.
  [/^claude-opus-5-5/, { input: 4, cacheRead: 0.2, output: 20, cacheWriteFactor: 2 }],
  [/^claude-sonnet-5-5/, { input: 2, cacheRead: 0.1, output: 10, cacheWriteFactor: 2 }],
  [/^claude-haiku-5-5/, { input: 0.1, cacheRead: 0.01, output: 0.5, cacheWriteFactor: 2 }],
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
  return (
    (usage.input * price.input +
      (usage.cacheRead ?? 0) * price.cacheRead +
      (usage.cacheWrite ?? 0) * price.input * price.cacheWriteFactor +
      usage.output * price.output) /
    1_000_000
  );
}
