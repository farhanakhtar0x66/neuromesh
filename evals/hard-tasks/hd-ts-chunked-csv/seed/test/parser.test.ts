import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/index.ts";

test("plain records", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("the last record needs no line break", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("a line break at the end does not start another record", () => {
  assert.deepEqual(parseCsv("a\n"), [["a"]]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n"), [[""]]);
});

test("CRLF, LF and lone CR all end a record", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\ne,f\rg,h"), [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
});

test("empty fields", () => {
  assert.deepEqual(parseCsv(",,\n,a,\n"), [["", "", ""], ["", "a", ""]]);
  assert.deepEqual(parseCsv("a,"), [["a", ""]]);
});

test("quoted fields hold delimiters, line breaks and doubled quotes", () => {
  assert.deepEqual(parseCsv('"a,b","line1\nline2","say ""hi"""\n'), [["a,b", "line1\nline2", 'say "hi"']]);
});

test("a quoted CRLF stays CRLF", () => {
  assert.deepEqual(parseCsv('"a\r\nb",c\r\n'), [["a\r\nb", "c"]]);
});

test("a quote inside an unquoted field is data", () => {
  assert.deepEqual(parseCsv('ab"cd,5" nail\n'), [['ab"cd', '5" nail']]);
});

test("a quoted empty field", () => {
  assert.deepEqual(parseCsv('"",a\n""\n'), [["", "a"], [""]]);
});

test("empty lines are records unless skipped", () => {
  assert.deepEqual(parseCsv("a\n\nb\n"), [["a"], [""], ["b"]]);
  assert.deepEqual(parseCsv("a\n\nb\n", { skipEmptyLines: true }), [["a"], ["b"]]);
  assert.deepEqual(parseCsv('a\n""\nb\n', { skipEmptyLines: true }), [["a"], [""], ["b"]]);
});

test("other delimiters and quote characters", () => {
  assert.deepEqual(parseCsv("a;b;'c;d'\n", { delimiter: ";", quote: "'" }), [["a", "b", "c;d"]]);
  assert.deepEqual(parseCsv("a\tb\n", { delimiter: "\t" }), [["a", "b"]]);
});

test("text outside the ASCII range", () => {
  assert.deepEqual(parseCsv("Zoë,日本語,😀\n"), [["Zoë", "日本語", "😀"]]);
});

test("a byte order mark at the start is dropped, one in the middle is not", () => {
  assert.deepEqual(parseCsv("﻿id,name\n1,﻿x\n"), [["id", "name"], ["1", "﻿x"]]);
  assert.deepEqual(parseCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id\n")])), [["id"]]);
});
