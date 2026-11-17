import { compareDates, daysInMonth, lastWeekdayOfMonth, nextMonth, parseDate, weekdayOf } from "./dates.ts";
import { validateRule } from "./validate.ts";
import { localDateAt, localToInstant } from "./zone.ts";
import type { CivilDate, Rule, Weekday, Window } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;

/** The instants of a rule in order, forever (the caller stops it). */
function* instants(rule: Rule): Generator<number> {
  const start = parseDate(rule.start)!;
  const first = localToInstant(start, rule.time, rule.zone);
  const repeat = rule.repeat;
  if (repeat.type === "daily") {
    for (let t = first; ; t += repeat.every * DAY) yield t;
  } else if (repeat.type === "weekly") {
    const days = new Set<Weekday>(repeat.days);
    for (let t = first; ; t += DAY) {
      if (days.has(weekdayOf(localDateAt(rule.zone, t)))) yield t;
    }
  } else {
    let { y, m } = start;
    for (;;) {
      let date: CivilDate | undefined;
      if ("last" in repeat) date = lastWeekdayOfMonth(y, m, repeat.last);
      else if (repeat.day <= daysInMonth(y, m)) date = { y, m, d: repeat.day };
      if (date && compareDates(date, start) >= 0) yield localToInstant(date, rule.time, rule.zone);
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
  for (const t of instants(rule)) {
    if (until && compareDates(localDateAt(rule.zone, t), until) > 0) break;
    if (rule.count !== undefined && n >= rule.count) break;
    if (t >= to) break;
    n++;
    if (t < from) continue;
    out.push(new Date(t));
    if (out.length >= limit) break;
  }
  return out;
}
