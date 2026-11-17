import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError, parseCsv } from "../src/index.ts";
import { collect, enc } from "./helpers.ts";

test("an unterminated quoted field names the line where it opened", async () => {
  assert.deepEqual(await collect([enc('a,b\n1,"two\nlines\n')]), { rows: [["a", "b"]], error: "unterminated quoted field starting at line 2" });
});

test("a character after a closing quote", async () => {
  assert.deepEqual(await collect([enc('a\n"b"x,c\n')]), { rows: [["a"]], error: 'unexpected character "x" after closing quote at line 2' });
});

test("records before the error are delivered", async () => {
  const r = await collect([enc('a\nb\n"c"d\ne\n')]);
  assert.deepEqual(r.rows, [["a"], ["b"]]);
  assert.equal(r.error, 'unexpected character "d" after closing quote at line 3');
});

test("header: too many fields", async () => {
  const r = await collect([enc("a,b\n1,2\n3,4,5\n")], { header: true });
  assert.deepEqual(r, { rows: [{ a: "1", b: "2" }], error: "record 3 has 3 fields but the header has 2" });
});

test("option checks", () => {
  assert.throws(() => parseCsv("a", { delimiter: ";;" }), { name: "CsvError", message: "delimiter must be a single character" });
  assert.throws(() => parseCsv("a", { quote: "" }), { message: "quote must be a single character" });
  assert.throws(() => parseCsv("a", { delimiter: '"' }), { message: "delimiter and quote must differ and must not be line breaks" });
  assert.throws(() => parseCsv("a", { delimiter: "\n" }), CsvError);
});
