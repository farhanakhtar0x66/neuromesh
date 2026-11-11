import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const run = (...args) => spawnSync(process.execPath, ["convert.js", ...args], { encoding: "utf8" });

test("hidden: conversions", () => {
  const cases = [
    [["100C", "F"], "212.0F"],
    [["-40f", "c"], "-40.0C"],
    [["0K", "F"], "-459.7F"],
    [["300k", "f"], "80.3F"],
    [["98.6F", "C"], "37.0C"],
    [["25C", "C"], "25.0C"],
  ];
  for (const [args, want] of cases) {
    const r = run(...args);
    assert.equal(r.status, 0, `${args}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), want, args.join(" "));
  }
});

test("hidden: errors exit with 2", () => {
  for (const args of [["abcC", "F"], ["10X", "C"], ["10C"], ["10C", "Q"], ["-500C", "F"], ["-1K", "C"]]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(" "));
    assert.notEqual(r.stderr.trim(), "", args.join(" "));
  }
});
