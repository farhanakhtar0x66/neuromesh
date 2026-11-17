import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrences } from "../src/index.ts";
import type { Rule } from "../src/index.ts";

const iso = (rule: Rule, window = {}): string[] => occurrences(rule, window).map((d) => d.toISOString());

test("daily at a time in UTC", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-05", time: "09:30", repeat: { type: "daily", every: 1 } };
  assert.deepEqual(iso(rule, { limit: 3 }), ["2026-01-05T09:30:00.000Z", "2026-01-06T09:30:00.000Z", "2026-01-07T09:30:00.000Z"]);
});

test("every 3 days", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-30", time: "00:00", repeat: { type: "daily", every: 3 } };
  assert.deepEqual(iso(rule, { limit: 4 }), ["2026-01-30T00:00:00.000Z", "2026-02-02T00:00:00.000Z", "2026-02-05T00:00:00.000Z", "2026-02-08T00:00:00.000Z"]);
});

test("count stops the series", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 }, count: 2 };
  assert.equal(occurrences(rule).length, 2);
});

test("until is inclusive", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 }, until: "2026-01-07" };
  assert.deepEqual(iso(rule), ["2026-01-05T09:00:00.000Z", "2026-01-06T09:00:00.000Z", "2026-01-07T09:00:00.000Z"]);
});

test("weekly on listed weekdays, from the start date", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-07", time: "10:00", repeat: { type: "weekly", days: ["MO", "WE", "FR"] } };
  assert.deepEqual(iso(rule, { limit: 5 }), ["2026-01-07T10:00:00.000Z", "2026-01-09T10:00:00.000Z", "2026-01-12T10:00:00.000Z", "2026-01-14T10:00:00.000Z", "2026-01-16T10:00:00.000Z"]);
});

test("monthly on a day, and not before the start", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-20", time: "12:00", repeat: { type: "monthly", day: 15 } };
  assert.deepEqual(iso(rule, { limit: 3 }), ["2026-02-15T12:00:00.000Z", "2026-03-15T12:00:00.000Z", "2026-04-15T12:00:00.000Z"]);
});

test("monthly on the last Friday", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-01", time: "16:00", repeat: { type: "monthly", last: "FR" } };
  assert.deepEqual(iso(rule, { limit: 3 }), ["2026-01-30T16:00:00.000Z", "2026-02-27T16:00:00.000Z", "2026-03-27T16:00:00.000Z"]);
});

test("a zone without clock changes: Asia/Kolkata", () => {
  const rule: Rule = { zone: "Asia/Kolkata", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 } };
  const all = occurrences({ ...rule, until: "2026-12-31" });
  assert.equal(all.length, 361);
  assert.ok(all.every((d) => d.toISOString().endsWith("T03:30:00.000Z")));
});

test("a zone with clock changes, in winter: America/New_York", () => {
  const rule: Rule = { zone: "America/New_York", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 } };
  assert.deepEqual(iso(rule, { limit: 2 }), ["2026-01-05T14:00:00.000Z", "2026-01-06T14:00:00.000Z"]);
});

test("a monthly rule in a zone with clock changes, all year", () => {
  const rule: Rule = { zone: "America/New_York", start: "2026-01-01", time: "09:00", repeat: { type: "monthly", day: 15 }, count: 12 };
  const got = iso(rule);
  assert.equal(got[0], "2026-01-15T14:00:00.000Z");
  assert.equal(got[5], "2026-06-15T13:00:00.000Z");
  assert.equal(got[11], "2026-12-15T14:00:00.000Z");
});

test("the window: from, to and limit", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-01", time: "00:00", repeat: { type: "daily", every: 1 } };
  assert.deepEqual(iso(rule, { from: new Date("2026-01-10T00:00:00Z"), to: new Date("2026-01-13T00:00:00Z") }), ["2026-01-10T00:00:00.000Z", "2026-01-11T00:00:00.000Z", "2026-01-12T00:00:00.000Z"]);
  assert.equal(occurrences(rule, { from: new Date("2026-02-01T00:00:00Z"), limit: 2 }).length, 2);
});

test("count counts from the start of the series, not from the window", () => {
  const rule: Rule = { zone: "UTC", start: "2026-01-01", time: "00:00", repeat: { type: "daily", every: 1 }, count: 5 };
  assert.deepEqual(iso(rule, { from: new Date("2026-01-04T00:00:00Z") }), ["2026-01-04T00:00:00.000Z", "2026-01-05T00:00:00.000Z"]);
});
