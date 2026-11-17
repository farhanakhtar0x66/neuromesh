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

/** The instant at which the zone's clocks show `time` ("HH:MM") on `date`. */
export function localToInstant(date: CivilDate, time: string, zone: string): number {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  return wall - offsetMinutesAt(zone, wall) * 60_000;
}
