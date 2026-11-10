import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { formatCents } from "../src/money.js";
import { parseOrders } from "../src/orders.js";
import { summarize } from "../src/report.js";
import { readFileSync } from "node:fs";

test("hidden: formatCents", () => {
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(-500), "-$5.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(100000000), "$1,000,000.00");
});

const expected = [
  { customer: "bo", orders: 1, items: 1, totalCents: 250000 },
  { customer: "cy", orders: 2, items: 6, totalCents: 15000 },
  { customer: "ana", orders: 2, items: 13, totalCents: 3099 },
];

test("hidden: summarize", () => {
  assert.deepEqual(summarize(parseOrders(readFileSync("sample.csv", "utf8"))), expected);
  const tie = parseOrders("h\n1,zed,a,1,100\n2,amy,b,1,100\n");
  assert.deepEqual(summarize(tie).map((r) => r.customer), ["amy", "zed"]);
});

test("hidden: command line", () => {
  const json = spawnSync(process.execPath, ["bin/report.js", "sample.csv", "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), expected);
  const table = spawnSync(process.execPath, ["bin/report.js", "sample.csv"], { encoding: "utf8" });
  assert.equal(table.status, 0, table.stderr);
  const rows = table.stdout.trim().split("\n").map((l) => l.trim().split(/\s{2,}/));
  assert.deepEqual(rows[0], ["customer", "orders", "items", "total"]);
  assert.deepEqual(rows[1], ["bo", "1", "1", "$2,500.00"]);
  assert.deepEqual(rows[2], ["cy", "2", "6", "$150.00"]);
  assert.deepEqual(rows[3], ["ana", "2", "13", "$30.99"]);
  assert.deepEqual(rows[4], ["TOTAL", "5", "20", "$2,680.99"]);
  const missing = spawnSync(process.execPath, ["bin/report.js", "nope.csv"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "File not found: nope.csv");
});
