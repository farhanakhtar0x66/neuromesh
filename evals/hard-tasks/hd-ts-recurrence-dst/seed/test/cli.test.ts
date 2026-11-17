import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

const example = new URL("../examples/standup.json", import.meta.url).pathname;

function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

test("next prints local time with offset, then the instant", () => {
  const r = cli(["next", example, "--from", "2026-01-09T00:00:00Z", "--count", "3"]);
  assert.deepEqual(r.out, [
    "2026-01-09 09:00 -05:00  2026-01-09T14:00:00.000Z",
    "2026-01-12 09:00 -05:00  2026-01-12T14:00:00.000Z",
    "2026-01-13 09:00 -05:00  2026-01-13T14:00:00.000Z",
  ]);
  assert.equal(r.code, 0);
});

test("usage errors exit 2", () => {
  assert.equal(cli(["next"]).code, 2);
  assert.equal(cli(["next", example]).err[0], "--from needs an ISO instant such as 2026-03-01T00:00:00Z");
});

test("a missing file exits 2", () => {
  assert.equal(cli(["next", "/no/such.json", "--from", "2026-01-01T00:00:00Z"]).code, 2);
});
