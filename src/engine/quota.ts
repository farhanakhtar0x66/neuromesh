// [F104 quota-shift] Routine turns leave a subscription that is running low.
//
// A tool that reports its subscription windows (Claude Code: the 5-hour and
// 7-day windows, as a fraction used) says how close the plan is to its limit.
// A preset may name another tool's models for the cheap turns to move to once
// a window passes a threshold, so what is left of the plan is kept for the
// turns only its models can do (the senior and the expert).
//
// The last reading per tool is kept in ~/.neuromesh/quota.json, so a run knows
// where the plan stands before its own first turn on that tool. A reading
// whose window has since reset, or that is older than MAX_AGE_MS, is unknown:
// an unknown is never taken for 0, and never for "over the threshold" either.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RoleConfig } from "./types.ts";

export interface QuotaShift {
  /** The tool whose subscription is watched ("claude"). */
  backend: string;
  /** Which of its windows ("five_hour"). */
  window: string;
  /** At or above this fraction used, the cheap turns move. */
  above: number;
  /** Where they move: models on another plan, first choice first. */
  to: RoleConfig[];
}

export interface QuotaReading {
  used: Record<string, number>;
  /** When each window resets (Unix seconds), when the tool says. */
  resets?: Record<string, number>;
  /** When this was read (Unix milliseconds). */
  at: number;
}

/** A reading older than this says nothing about now (the shortest window Claude reports is five hours). */
export const MAX_AGE_MS = 5 * 60 * 60_000;

export function quotaPath(home: string): string {
  return join(home, "quota.json");
}

export function loadQuota(home: string): Record<string, QuotaReading> {
  const path = quotaPath(home);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, QuotaReading>;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    // A damaged file is an unknown reading, not a stopped run.
    return {};
  }
}

/** Keep a tool's latest reading. Windows it did not report this time keep their earlier value. */
export function recordQuota(home: string, backend: string, used: Record<string, number>, resets?: Record<string, number>, now = Date.now()): void {
  const clean = Object.fromEntries(Object.entries(used).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
  if (Object.keys(clean).length === 0) return;
  const all = loadQuota(home);
  const before = all[backend];
  all[backend] = { used: { ...(before?.used ?? {}), ...clean }, resets: { ...(before?.resets ?? {}), ...(resets ?? {}) }, at: now };
  const path = quotaPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`);
  renameSync(tmp, path);
}

/** The fraction of a window used, as far as it is still known; undefined when it is not. */
export function windowUsed(reading: QuotaReading | undefined, window: string, now = Date.now()): number | undefined {
  const used = reading?.used?.[window];
  if (reading === undefined || typeof used !== "number" || !Number.isFinite(used)) return undefined;
  if (now - reading.at > MAX_AGE_MS) return undefined;
  const resetsAt = reading.resets?.[window];
  // The window has started again since the reading: what was used then is gone.
  if (typeof resetsAt === "number" && resetsAt * 1000 <= now) return undefined;
  return used;
}

/** Whether the cheap turns should move now. Unknown usage never moves them. */
export function shiftNow(shift: QuotaShift, reading: QuotaReading | undefined, now = Date.now()): { used: number } | undefined {
  const used = windowUsed(reading, shift.window, now);
  return used !== undefined && used >= shift.above ? { used } : undefined;
}
