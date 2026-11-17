import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrences, RuleError } from "../src/index.ts";
import type { Rule } from "../src/index.ts";

const base: Rule = { zone: "UTC", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 } };
const bad = (patch: Partial<Rule>, message: string) => assert.throws(() => occurrences({ ...base, ...patch }, { limit: 1 }), { name: "RuleError", message });

test("a good rule is accepted", () => {
  assert.equal(occurrences(base, { limit: 1 }).length, 1);
});

test("unknown time zone", () => bad({ zone: "Mars/Olympus" }, 'unknown time zone "Mars/Olympus"'));
test("bad start", () => bad({ start: "2026-02-30" }, 'start must be a date YYYY-MM-DD, got "2026-02-30"'));
test("bad time", () => bad({ time: "9:00" }, 'time must be HH:MM, got "9:00"'));
test("bad until", () => bad({ until: "soon" }, 'until must be a date YYYY-MM-DD, got "soon"'));
test("bad count", () => bad({ count: 0 }, "count must be a whole number of at least 1"));
test("bad every", () => bad({ repeat: { type: "daily", every: 0 } }, "every must be a whole number of at least 1"));
test("empty weekdays", () => bad({ repeat: { type: "weekly", days: [] } }, "days must name at least one weekday (MO TU WE TH FR SA SU)"));
test("bad month day", () => bad({ repeat: { type: "monthly", day: 32 } }, "day must be a whole number from 1 to 31"));
test("RuleError is exported", () => assert.ok(new RuleError("x") instanceof Error));
