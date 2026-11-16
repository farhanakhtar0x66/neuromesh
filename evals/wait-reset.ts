// Reading the Claude subscription windows and waiting for the five-hour one to reset.
// Shared by evals/routing-bench/run.ts (--wait-reset) and evals/baselines.ts.
// Each reading is one one-word Haiku call: the only live call this file makes.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackend } from "../src/backends/types.ts";

export async function quotaReading(claude: AgentBackend): Promise<{ used?: Record<string, number>; resets?: Record<string, number> }> {
  const dir = mkdtempSync(join(tmpdir(), "routing-bench-quota-"));
  try {
    const r = await claude.run({ cwd: dir, prompt: "Reply with the single word: ok", model: "claude-haiku-5-5", effort: "low", access: "read-only", timeoutMs: 120_000, idleMs: 120_000 });
    return { used: r.quotaUsed, resets: r.quotaResets };
  } catch {
    return {};
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function quota(claude: AgentBackend): Promise<Record<string, number> | undefined> {
  return (await quotaReading(claude)).used;
}

/** "2026-11-13 22:10" (UTC) for a Unix time in seconds. */
export function utcMinute(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * --wait-reset: start only once the Claude five-hour window has reset, so the
 * run's readings are not mixed with whatever used the window before it.
 */
export async function waitForReset(claude: AgentBackend, note: (line: string) => void, options: { freshBelow?: number } = {}): Promise<void> {
  const { used, resets } = await quotaReading(claude);
  // freshBelow: a window used less than this (a share, 0.02 = 2 points) counts as already reset; waiting out its next
  // reset would only be waiting for the probe's own window to end. Not set: always wait, as routing-bench does.
  if (options.freshBelow !== undefined && used?.five_hour !== undefined && used.five_hour < options.freshBelow) {
    note(`--wait-reset: five-hour window at ${Math.round(used.five_hour * 100)}%, already fresh; starting`);
    return;
  }
  const at = resets?.five_hour;
  if (at === undefined) {
    note("--wait-reset: the five-hour window's reset time is unknown; starting now");
    return;
  }
  const ms = at * 1000 - Date.now() + 90_000;
  if (ms <= 0) return;
  note(`--wait-reset: five-hour window at ${Math.round((used?.five_hour ?? 0) * 100)}%; waiting until it resets at ${utcMinute(at)} UTC (${Math.round(ms / 60_000)} min)`);
  await new Promise((r) => setTimeout(r, ms));
  const after = await quota(claude);
  note(`--wait-reset: five-hour window now at ${after?.five_hour === undefined ? "unknown" : `${Math.round(after.five_hour * 100)}%`}; starting`);
}
