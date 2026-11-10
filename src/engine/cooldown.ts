// Models that hit a subscription limit stay out until their reset time, across
// runs. Without this every new run would spend a call rediscovering that the
// expert is out of quota. Kept in ~/.neuromesh/cooldowns.json.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Cooldown {
  until: string;
  reason: string;
}

/** When the message gives no reset time, try again after this long. */
const DEFAULT_COOLDOWN_MS = 30 * 60_000;

function path(home: string): string {
  return join(home, "cooldowns.json");
}

function read(home: string): Record<string, Cooldown> {
  try {
    return existsSync(path(home)) ? (JSON.parse(readFileSync(path(home), "utf8")) as Record<string, Cooldown>) : {};
  } catch {
    return {};
  }
}

/** How long until the limit resets, from messages such as "Resets in 4h55m56s" or "try again in 20 minutes". */
export function resetDelayMs(detail: string): number | undefined {
  const compact = /resets? in\s+((?:\d+\s*[hms]\s*)+)/i.exec(detail);
  if (compact?.[1]) {
    let ms = 0;
    for (const [, n, unit] of compact[1].matchAll(/(\d+)\s*([hms])/gi)) {
      ms += Number(n) * (unit!.toLowerCase() === "h" ? 3_600_000 : unit!.toLowerCase() === "m" ? 60_000 : 1000);
    }
    return ms > 0 ? ms : undefined;
  }
  const words = /(?:try again|resets?|available again) in\s+(\d+)\s*(hours?|minutes?|seconds?)/i.exec(detail);
  if (words?.[1] && words[2]) {
    const unit = words[2].toLowerCase();
    return Number(words[1]) * (unit.startsWith("h") ? 3_600_000 : unit.startsWith("m") ? 60_000 : 1000);
  }
  return undefined;
}

export function recordCooldown(home: string, model: string, detail: string, now = Date.now()): Cooldown {
  const all = read(home);
  const cooldown = { until: new Date(now + (resetDelayMs(detail) ?? DEFAULT_COOLDOWN_MS)).toISOString(), reason: detail.slice(0, 200) };
  all[model] = cooldown;
  mkdirSync(home, { recursive: true });
  writeFileSync(`${path(home)}.tmp`, JSON.stringify(all, null, 2) + "\n");
  renameSync(`${path(home)}.tmp`, path(home));
  return cooldown;
}

/** Models still cooling down right now. */
export function coolingModels(home: string, now = Date.now()): Record<string, Cooldown> {
  return Object.fromEntries(Object.entries(read(home)).filter(([, c]) => Date.parse(c.until) > now));
}

export function clearCooldowns(home: string): void {
  if (existsSync(path(home))) writeFileSync(path(home), "{}\n");
}
