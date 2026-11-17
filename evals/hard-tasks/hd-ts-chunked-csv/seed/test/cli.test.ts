import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function file(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "csvstream-")), "in.csv");
  writeFileSync(path, content);
  return path;
}

test("import writes one JSON line per record", () => {
  const r = run(["import", file("id,name\n1,Ann\n2,Bo\n"), "--header"]);
  assert.equal(r.out, '{"id":"1","name":"Ann"}\n{"id":"2","name":"Bo"}\n');
  assert.equal(r.err, "imported 2 records\n");
  assert.equal(r.code, 0);
});

test("import reads standard input for -", () => {
  const r = run(["import", "-", "--delimiter", "tab"], "a\tb\n");
  assert.equal(r.out, '["a","b"]\n');
});

test("bad input: the message and exit status 1", () => {
  const r = run(["import", file('a\n"b\n')]);
  assert.equal(r.err, "csvstream: unterminated quoted field starting at line 2\n");
  assert.equal(r.code, 1);
});

test("bad usage: exit status 2", () => {
  assert.equal(run(["import"]).code, 2);
  assert.equal(run(["import", "x.csv", "--nope"]).err, "unknown option --nope\n");
});
