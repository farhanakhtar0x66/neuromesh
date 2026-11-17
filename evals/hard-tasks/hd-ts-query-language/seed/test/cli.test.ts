import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

const data = new URL("../data/issues.json", import.meta.url).pathname;

function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

test("list prints every issue and a count", () => {
  const r = cli(["list", "--data", data]);
  assert.equal(r.code, 0);
  assert.equal(r.out.length, 6);
  assert.equal(r.out[0], "#1 [open] P1 @ann Login page crashes on submit");
  assert.equal(r.out[1], "#2 [open] P3 @- Add dark mode");
  assert.equal(r.out[5], "5 issues");
});

test("--search with plain words", () => {
  const r = cli(["list", "--data", data, "--search", "login crash"]);
  assert.deepEqual(r.out, ["#1 [open] P1 @ann Login page crashes on submit", "1 issue"]);
});

test("a search with no result", () => {
  assert.deepEqual(cli(["list", "--data", data, "--search", "zzz"]).out, ["0 issues"]);
});

test("usage errors exit 2", () => {
  assert.equal(cli([]).code, 2);
  assert.equal(cli(["list", "--bogus", "x"]).err[0], "unknown option --bogus");
  assert.equal(cli(["list", "--today", "May 1"]).err[0], "--today must be a date YYYY-MM-DD");
});

test("an unreadable data file exits 1", () => {
  const r = cli(["list", "--data", "/no/such/file.json"]);
  assert.equal(r.code, 1);
  assert.equal(r.err[0], "track: cannot read issues from /no/such/file.json");
});
