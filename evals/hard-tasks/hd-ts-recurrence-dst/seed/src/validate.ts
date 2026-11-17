import { parseDate } from "./dates.ts";
import { RuleError } from "./errors.ts";
import type { Rule } from "./types.ts";

const WEEKDAYS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Throws RuleError with a message that says what is wrong. */
export function validateRule(rule: Rule): void {
  if (typeof rule.zone !== "string" || !isValidZone(rule.zone)) throw new RuleError(`unknown time zone "${String(rule.zone)}"`);
  if (typeof rule.start !== "string" || !parseDate(rule.start)) throw new RuleError(`start must be a date YYYY-MM-DD, got "${String(rule.start)}"`);
  if (typeof rule.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) throw new RuleError(`time must be HH:MM, got "${String(rule.time)}"`);
  if (rule.until !== undefined && (typeof rule.until !== "string" || !parseDate(rule.until))) throw new RuleError(`until must be a date YYYY-MM-DD, got "${String(rule.until)}"`);
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1)) throw new RuleError("count must be a whole number of at least 1");
  const r = rule.repeat as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") throw new RuleError("repeat is missing");
  if (r.type === "daily") {
    if (!Number.isInteger(r.every) || (r.every as number) < 1) throw new RuleError("every must be a whole number of at least 1");
  } else if (r.type === "weekly") {
    const days = r.days;
    if (!Array.isArray(days) || days.length === 0 || !days.every((d) => WEEKDAYS.has(d))) throw new RuleError("days must name at least one weekday (MO TU WE TH FR SA SU)");
  } else if (r.type === "monthly") {
    if ("last" in r) {
      if (!WEEKDAYS.has(r.last as string)) throw new RuleError("last must be a weekday (MO TU WE TH FR SA SU)");
    } else if (!Number.isInteger(r.day) || (r.day as number) < 1 || (r.day as number) > 31) throw new RuleError("day must be a whole number from 1 to 31");
  } else throw new RuleError(`unknown repeat type "${String(r.type)}"`);
}
