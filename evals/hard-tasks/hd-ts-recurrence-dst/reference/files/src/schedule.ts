import { addDays, compareDates, daysInMonth, lastWeekdayOfMonth, nextMonth, parseDate, weekdayOf } from "./dates.ts";
import { validateRule } from "./validate.ts";
import { localToInstant } from "./zone.ts";
import type { CivilDate, Rule, Weekday, Window } from "./types.ts";

/**
 * The local dates a rule produces, in order, forever (the caller stops it). Only calendar arithmetic happens here: a date is
 * turned into an instant afterwards, by localToInstant, so no day is ever "24 hours".
 */
function* dates(rule: Rule): Generator<CivilDate> {
  const start = parseDate(rule.start)!;
  const repeat = rule.repeat;
  if (repeat.type === "daily") {
    for (let i = 0; ; i++) yield addDays(start, i * repeat.every);
  } else if (repeat.type === "weekly") {
    const days = new Set<Weekday>(repeat.days);
    for (let date = start; ; date = addDays(date, 1)) if (days.has(weekdayOf(date))) yield date;
  } else {
    let { y, m } = start;
    for (;;) {
      // A month without the day takes its last day: one occurrence per month.
      const date = "last" in repeat ? lastWeekdayOfMonth(y, m, repeat.last) : { y, m, d: Math.min(repeat.day, daysInMonth(y, m)) };
      if (compareDates(date, start) >= 0) yield date;
      ({ y, m } = nextMonth(y, m));
    }
  }
}

/** The occurrences of the rule inside the window, in order. */
export function occurrences(rule: Rule, window: Window = {}): Date[] {
  validateRule(rule);
  const from = window.from?.getTime() ?? -Infinity;
  const to = window.to?.getTime() ?? Infinity;
  const limit = window.limit ?? Infinity;
  const until = rule.until ? parseDate(rule.until)! : undefined;
  const out: Date[] = [];
  let n = 0;
  for (const date of dates(rule)) {
    if (until && compareDates(date, until) > 0) break; // the local date of the rule, before any move for a gap
    if (rule.count !== undefined && n >= rule.count) break;
    const t = localToInstant(date, rule.time, rule.zone);
    if (t >= to) break;
    n++;
    if (t < from) continue;
    out.push(new Date(t));
    if (out.length >= limit) break;
  }
  return out;
}
