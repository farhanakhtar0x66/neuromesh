// A rule's occurrences must not depend on how many hours there are between two dates. docs/RECURRENCE.md says how each
// local date and time becomes an instant; the oracle (support/oracle.ts) is Temporal with disambiguation "compatible".
import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrences } from "../src/index.ts";
import { mulberry32, oracle, WINDOW, ZONES } from "./support/oracle.ts";
import type { OracleRule } from "./support/oracle.ts";

const iso = (ms: number[]): string[] => ms.map((t) => new Date(t).toISOString());
const got = (rule: OracleRule, window = {}): string[] => occurrences(rule as never, window).map((d) => d.toISOString());
const rule = (zone: string, start: string, time: string, repeat: OracleRule["repeat"], more: Partial<OracleRule> = {}): OracleRule => ({ zone, start, time, repeat, ...more });

// Worked examples (docs/RECURRENCE.md and the same arithmetic in other zones), instants written out by hand.

test("New York: a daily 09:00 keeps 09:00 across the March change", () => {
  const r = rule("America/New_York", "2026-03-06", "09:00", { type: "daily", every: 1 });
  assert.deepEqual(got(r, { limit: 4 }), ["2026-03-06T14:00:00.000Z", "2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z"]);
});

test("New York: a time that does not exist moves forward by the gap", () => {
  const r = rule("America/New_York", "2026-03-07", "02:30", { type: "daily", every: 1 });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-03-07T07:30:00.000Z", "2026-03-08T07:30:00.000Z", "2026-03-09T06:30:00.000Z"]);
});

test("New York: a time that happens twice takes the earlier instant, and the day is not doubled", () => {
  const r = rule("America/New_York", "2026-10-31", "01:30", { type: "daily", every: 1 });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-10-31T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
});

test("New York: a daily 00:30 across the November change fires once per date", () => {
  const r = rule("America/New_York", "2026-10-31", "00:30", { type: "daily", every: 1 });
  assert.deepEqual(got(r, { limit: 4 }), ["2026-10-31T04:30:00.000Z", "2026-11-01T04:30:00.000Z", "2026-11-02T05:30:00.000Z", "2026-11-03T05:30:00.000Z"]);
});

test("Lord Howe: the gap is 30 minutes", () => {
  const r = rule("Australia/Lord_Howe", "2026-10-03", "02:15", { type: "daily", every: 1 });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-10-02T15:45:00.000Z", "2026-10-03T15:45:00.000Z", "2026-10-04T15:15:00.000Z"]);
});

test("London: the repeated hour in October and the skipped hour in March", () => {
  const autumn = rule("Europe/London", "2026-10-24", "01:30", { type: "daily", every: 1 });
  assert.deepEqual(got(autumn, { limit: 3 }), ["2026-10-24T00:30:00.000Z", "2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
  const spring = rule("Europe/London", "2026-03-28", "01:30", { type: "daily", every: 1 });
  assert.deepEqual(got(spring, { limit: 3 }), ["2026-03-28T01:30:00.000Z", "2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"]);
});

test("Santiago: the clocks change at midnight", () => {
  const spring = rule("America/Santiago", "2026-09-05", "00:30", { type: "daily", every: 1 });
  assert.deepEqual(got(spring, { limit: 3 }), ["2026-09-05T04:30:00.000Z", "2026-09-06T04:30:00.000Z", "2026-09-07T03:30:00.000Z"]);
  const autumn = rule("America/Santiago", "2026-04-03", "23:30", { type: "daily", every: 1 });
  assert.deepEqual(got(autumn, { limit: 3 }), ["2026-04-04T02:30:00.000Z", "2026-04-05T02:30:00.000Z", "2026-04-06T03:30:00.000Z"]);
});

test("Chatham: offsets of 12:45 and 13:45, changes at 02:45", () => {
  const spring = rule("Pacific/Chatham", "2026-09-26", "03:00", { type: "daily", every: 1 });
  assert.deepEqual(got(spring, { limit: 3 }), ["2026-09-25T14:15:00.000Z", "2026-09-26T14:15:00.000Z", "2026-09-27T13:15:00.000Z"]);
  const autumn = rule("Pacific/Chatham", "2026-04-04", "03:00", { type: "daily", every: 1 });
  assert.deepEqual(got(autumn, { limit: 3 }), ["2026-04-03T13:15:00.000Z", "2026-04-04T13:15:00.000Z", "2026-04-05T14:15:00.000Z"]);
});

test("a weekly rule on a Sunday through the November change", () => {
  const r = rule("America/New_York", "2026-10-25", "01:30", { type: "weekly", days: ["SU"] });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-10-25T05:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-08T06:30:00.000Z"]);
});

test("a monthly rule for day 31 uses the last day of a short month", () => {
  const r = rule("America/New_York", "2026-01-01", "09:00", { type: "monthly", day: 31 });
  assert.deepEqual(got(r, { limit: 4 }), ["2026-01-31T14:00:00.000Z", "2026-02-28T14:00:00.000Z", "2026-03-31T13:00:00.000Z", "2026-04-30T13:00:00.000Z"]);
});

test("a monthly rule for day 30 in a leap February", () => {
  const r = rule("UTC", "2028-01-01", "00:00", { type: "monthly", day: 30 });
  assert.deepEqual(got(r, { limit: 3 }), ["2028-01-30T00:00:00.000Z", "2028-02-29T00:00:00.000Z", "2028-03-30T00:00:00.000Z"]);
});

test("the last Friday of the month in London, either side of the March change", () => {
  const r = rule("Europe/London", "2026-03-01", "16:00", { type: "monthly", last: "FR" });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-03-27T16:00:00.000Z", "2026-04-24T15:00:00.000Z", "2026-05-29T15:00:00.000Z"]);
});

test("until is a local date: the last day is included even when its time was moved", () => {
  const r = rule("America/New_York", "2026-03-06", "02:30", { type: "daily", every: 1 }, { until: "2026-03-08" });
  assert.deepEqual(got(r), ["2026-03-06T07:30:00.000Z", "2026-03-07T07:30:00.000Z", "2026-03-08T07:30:00.000Z"]);
});

test("a monthly rule starts in the start month only if its date is not before the start", () => {
  const r = rule("UTC", "2026-01-31", "08:00", { type: "monthly", day: 30 });
  assert.deepEqual(got(r, { limit: 3 }), ["2026-02-28T08:00:00.000Z", "2026-03-30T08:00:00.000Z", "2026-04-30T08:00:00.000Z"]);
  const s = rule("UTC", "2026-01-30", "08:00", { type: "monthly", day: 30 });
  assert.deepEqual(got(s, { limit: 2 }), ["2026-01-30T08:00:00.000Z", "2026-02-28T08:00:00.000Z"]);
});

test("count counts the occurrences before the window too, across a change", () => {
  const r = rule("America/New_York", "2026-03-05", "09:00", { type: "daily", every: 1 }, { count: 6 });
  assert.deepEqual(got(r, { from: new Date("2026-03-08T00:00:00Z") }), ["2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z", "2026-03-10T13:00:00.000Z"]);
});

// Three years in every zone, every kind of rule, against the oracle.

const KINDS: Record<string, (time: string) => OracleRule["repeat"][]> = {
  "daily rules": () => [{ type: "daily", every: 1 }, { type: "daily", every: 2 }, { type: "daily", every: 7 }],
  "weekly rules": () => [{ type: "weekly", days: ["SU"] }, { type: "weekly", days: ["MO", "TU", "WE", "TH", "FR"] }, { type: "weekly", days: ["SA", "SU"] }],
  "monthly rules for a day": () => [1, 15, 29, 30, 31].map((day) => ({ type: "monthly" as const, day })),
  "monthly rules for the last weekday": () => ["SU", "FR", "SA"].map((last) => ({ type: "monthly" as const, last })),
};

for (const [zone, times] of Object.entries(ZONES)) {
  for (const [kind, repeats] of Object.entries(KINDS)) {
    test(`${zone}: ${kind} over three years`, () => {
      for (const time of times) {
        for (const repeat of repeats(time)) {
          const r = rule(zone, "2025-01-01", time, repeat);
          const want = iso(oracle(r, WINDOW));
          const have = got(r, { from: new Date(WINDOW.from), to: new Date(WINDOW.to) });
          assert.equal(have.length, want.length, `${zone} ${time} ${JSON.stringify(repeat)}: ${have.length} occurrences, wanted ${want.length}`);
          for (let i = 0; i < want.length; i++) assert.equal(have[i], want[i], `${zone} ${time} ${JSON.stringify(repeat)}, occurrence ${i + 1}`);
        }
      }
    });
  }
}

// Random rules, random windows (fixed seed), against the oracle.

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function randomRule(rng: () => number): { rule: OracleRule; window: { from?: Date; to?: Date; limit?: number } } {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const zone = pick(Object.keys(ZONES));
  const time = rng() < 0.6 ? pick(ZONES[zone]!) : `${String(Math.floor(rng() * 24)).padStart(2, "0")}:${String(Math.floor(rng() * 60)).padStart(2, "0")}`;
  const kind = Math.floor(rng() * 4);
  const repeat: OracleRule["repeat"] =
    kind === 0 ? { type: "daily", every: 1 + Math.floor(rng() * 9) }
    : kind === 1 ? { type: "weekly", days: WEEKDAYS.filter(() => rng() < 0.3).concat(pick(WEEKDAYS)).filter((d, i, a) => a.indexOf(d) === i) }
    : kind === 2 ? { type: "monthly", day: 1 + Math.floor(rng() * 31) }
    : { type: "monthly", last: pick(WEEKDAYS) };
  const day0 = Date.UTC(2025, 0, 1) + Math.floor(rng() * 730) * 86_400_000;
  const start = new Date(day0).toISOString().slice(0, 10);
  const r: OracleRule = { zone, start, time, repeat };
  if (rng() < 0.5) r.until = new Date(day0 + Math.floor(rng() * 900) * 86_400_000).toISOString().slice(0, 10);
  if (rng() < 0.3) r.count = 1 + Math.floor(rng() * 80);
  const window: { from?: Date; to?: Date; limit?: number } = {};
  if (rng() < 0.7) window.from = new Date(day0 + Math.floor(rng() * 700) * 86_400_000 + Math.floor(rng() * 86_400_000));
  window.to = new Date(Date.UTC(2028, 0, 1) + Math.floor(rng() * 400) * 86_400_000);
  if (rng() < 0.3) window.limit = 1 + Math.floor(rng() * 40);
  return { rule: r, window };
}

for (let batch = 0; batch < 6; batch++) {
  test(`random rules and windows, batch ${batch + 1} of 6`, () => {
    const rng = mulberry32(777 + batch);
    for (let i = 0; i < 50; i++) {
      const { rule: r, window } = randomRule(rng);
      const want = iso(oracle(r, { from: window.from?.getTime(), to: window.to?.getTime(), limit: window.limit }));
      assert.deepEqual(got(r, window), want, JSON.stringify({ r, window }));
    }
  });
}
