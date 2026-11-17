// Wall-clock time in an IANA zone, from the platform's time zone data (Intl). Instants are milliseconds since the epoch.

import type { CivilDate } from "./types.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(zone, f);
  }
  return f;
}

/** The zone's offset from UTC at an instant, in minutes (east is positive). */
export function offsetMinutesAt(zone: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(instant))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return Math.round((wall - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The local calendar date in the zone at an instant. */
export function localDateAt(zone: string, instant: number): CivilDate {
  const d = new Date(instant + offsetMinutesAt(zone, instant) * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const DAY = 86_400_000;

/**
 * The instant at which the zone's clocks show `time` ("HH:MM") on `date`.
 *
 * The wall-clock reading is tried with the offset in force a day before and a day after (a zone changes its offset at most
 * once in that span): an offset fits when the zone really has that offset at the instant it gives. Both fit: the clocks
 * showed this time twice, the earlier instant is taken. Neither fits: the time was skipped, and the offset from before the
 * change moves it forward by the length of the gap.
 */
export function localToInstant(date: CivilDate, time: string, zone: string): number {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  const before = wall - offsetMinutesAt(zone, wall - DAY) * 60_000;
  const after = wall - offsetMinutesAt(zone, wall + DAY) * 60_000;
  if (before === after) return before;
  const beforeFits = offsetMinutesAt(zone, before) === (wall - before) / 60_000;
  const afterFits = offsetMinutesAt(zone, after) === (wall - after) / 60_000;
  if (beforeFits && afterFits) return Math.min(before, after);
  if (afterFits) return after;
  return before; // beforeFits, or a gap
}
