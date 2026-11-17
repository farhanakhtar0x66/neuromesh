// Calendar arithmetic on dates without a zone. Days are counted from 1970-01-01.

import type { CivilDate, Weekday } from "./types.ts";

const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseDate(s: string): CivilDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return fromDays(toDays(date)).d === date.d && fromDays(toDays(date)).m === date.m ? date : undefined;
}

export function formatDate(c: CivilDate): string {
  return `${String(c.y).padStart(4, "0")}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

export function toDays(c: CivilDate): number {
  return Math.floor(Date.UTC(c.y, c.m - 1, c.d) / 86_400_000);
}

export function fromDays(n: number): CivilDate {
  const d = new Date(n * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export function addDays(c: CivilDate, n: number): CivilDate {
  return fromDays(toDays(c) + n);
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return toDays(a) - toDays(b);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function weekdayOf(c: CivilDate): Weekday {
  return WEEKDAYS[new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay()]!;
}

/** The last date of the month that falls on `weekday`. */
export function lastWeekdayOfMonth(y: number, m: number, weekday: Weekday): CivilDate {
  let date: CivilDate = { y, m, d: daysInMonth(y, m) };
  while (weekdayOf(date) !== weekday) date = addDays(date, -1);
  return date;
}

export function nextMonth(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}
