import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";

function cli(rule: object, args: string[]) {
  const path = join(mkdtempSync(join(tmpdir(), "remindly-hidden-")), "rule.json");
  writeFileSync(path, JSON.stringify(rule));
  const out: string[] = [];
  const err: string[] = [];
  const code = run(["next", path, ...args], (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

test("next across the March change keeps 09:00 and shows the new offset", () => {
  const r = cli({ zone: "America/New_York", start: "2026-03-01", time: "09:00", repeat: { type: "daily", every: 1 } }, ["--from", "2026-03-07T00:00:00Z", "--count", "3"]);
  assert.deepEqual(r.out, [
    "2026-03-07 09:00 -05:00  2026-03-07T14:00:00.000Z",
    "2026-03-08 09:00 -04:00  2026-03-08T13:00:00.000Z",
    "2026-03-09 09:00 -04:00  2026-03-09T13:00:00.000Z",
  ]);
});

test("next shows a moved time as it really happens", () => {
  const r = cli({ zone: "Australia/Lord_Howe", start: "2026-10-01", time: "02:15", repeat: { type: "daily", every: 1 } }, ["--from", "2026-10-03T00:00:00Z", "--count", "2"]);
  assert.deepEqual(r.out, ["2026-10-04 02:45 +11:00  2026-10-03T15:45:00.000Z", "2026-10-05 02:15 +11:00  2026-10-04T15:15:00.000Z"]);
});

test("next for a monthly rule on the 30th lists February", () => {
  const r = cli({ zone: "Pacific/Chatham", start: "2026-01-01", time: "10:00", repeat: { type: "monthly", day: 30 } }, ["--from", "2026-01-01T00:00:00Z", "--count", "3"]);
  assert.deepEqual(r.out, ["2026-01-30 10:00 +13:45  2026-01-29T20:15:00.000Z", "2026-02-28 10:00 +13:45  2026-02-27T20:15:00.000Z", "2026-03-30 10:00 +13:45  2026-03-29T20:15:00.000Z"]);
});
