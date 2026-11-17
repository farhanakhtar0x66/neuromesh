// Named cases from the rules in docs/FORMAT.md, with the expected rows written out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "./support/run.ts";

const enc = (s: string): Buffer => Buffer.from(s, "utf8");
const bytes = (b: number[]): Buffer => Buffer.from(b);
const oneByteAtATime = (b: Buffer): Buffer[] => Array.from(b, (_, i) => b.subarray(i, i + 1));

test("a multibyte character cut by a chunk end is read whole", async () => {
  const input = enc("name\nZoë\n日本\n😀\n");
  assert.deepEqual(await collect(oneByteAtATime(input)), { rows: [["name"], ["Zoë"], ["日本"], ["😀"]] });
  const cut = input.indexOf(0xc3) + 1; // between the two bytes of ë
  assert.deepEqual(await collect([input.subarray(0, cut), input.subarray(cut)]), { rows: [["name"], ["Zoë"], ["日本"], ["😀"]] });
});

test("a four-byte character cut in three places", async () => {
  const smile = enc("😀");
  assert.deepEqual(await collect([enc("x,"), smile.subarray(0, 1), smile.subarray(1, 3), smile.subarray(3), enc("\n")]), { rows: [["x", "😀"]] });
});

test("a CRLF cut between CR and LF is one line break", async () => {
  assert.deepEqual(await collect([enc("a,b\r"), enc("\nc,d\r\n")]), { rows: [["a", "b"], ["c", "d"]] });
  assert.deepEqual(await collect([enc("a\r\n\r"), enc("\nb")]), { rows: [["a"], [""], ["b"]] });
});

test("a lone CR at a chunk end is still a line break", async () => {
  assert.deepEqual(await collect([enc("a\r"), enc("b\r"), enc("\r\n")]), { rows: [["a"], ["b"], [""]] });
});

test("a doubled quote cut in two is one quote", async () => {
  assert.deepEqual(await collect([enc('"say "'), enc('"hi""",x\n')]), { rows: [['say "hi"', "x"]] });
  assert.deepEqual(await collect([enc('""""'), enc('""\n')]), { rows: [['""']] });
});

test("a closing quote at a chunk end", async () => {
  assert.deepEqual(await collect([enc('"a"'), enc(",b\n")]), { rows: [["a", "b"]] });
  assert.deepEqual(await collect([enc('"a"'), enc("\r"), enc("\n")]), { rows: [["a"]] });
  assert.deepEqual(await collect([enc('"a"')]), { rows: [["a"]] });
});

test("a quoted field spanning chunks keeps its delimiter and line breaks", async () => {
  assert.deepEqual(await collect([enc('"a,'), enc('b\r'), enc('\nc",d\n')]), { rows: [["a,b\r\nc", "d"]] });
});

test("a byte order mark in pieces, or alone in a chunk", async () => {
  assert.deepEqual(await collect([bytes([0xef]), bytes([0xbb]), bytes([0xbf]), enc("id,name\n1,x\n")], {}), { rows: [["id", "name"], ["1", "x"]] });
  assert.deepEqual(await collect([bytes([0xef, 0xbb]), bytes([0xbf, 0x69, 0x64, 0x0a])]), { rows: [["id"]] });
  assert.deepEqual(await collect([enc(""), bytes([0xef, 0xbb, 0xbf]), enc("a\n")]), { rows: [["a"]] });
  assert.deepEqual(await collect(["﻿", "a\n"]), { rows: [["a"]] });
  assert.deepEqual(await collect(["", "﻿a\n"]), { rows: [["a"]] });
});

test("a byte order mark that is not at the start is data", async () => {
  assert.deepEqual(await collect([enc("a\n"), bytes([0xef, 0xbb, 0xbf]), enc("b\n")]), { rows: [["a"], ["﻿b"]] });
  assert.deepEqual(await collect([enc("\n"), bytes([0xef, 0xbb]), bytes([0xbf, 0x61])]), { rows: [[""], ["﻿a"]] });
});

test("the header option over awkward chunks", async () => {
  const parts = [enc("id,na"), enc("me\r"), enc("\n1,Zo"), bytes([0xc3]), bytes([0xab]), enc("\r\n2,"), enc('"B""o"\r\n')];
  assert.deepEqual(await collect(parts, { header: true }), { rows: [{ id: "1", name: "Zoë" }, { id: "2", name: 'B"o' }] });
});

test("empty lines are kept or skipped the same way at any cut", async () => {
  const input = enc("a\r\n\r\n\nb\n");
  assert.deepEqual(await collect(oneByteAtATime(input)), { rows: [["a"], [""], [""], ["b"]] });
  assert.deepEqual(await collect(oneByteAtATime(input), { skipEmptyLines: true }), { rows: [["a"], ["b"]] });
});

test("a character cut off by the end of the input becomes U+FFFD", async () => {
  assert.deepEqual(await collect([bytes([0x61, 0xe6]), bytes([0x97])]), { rows: [["a�"]] });
  assert.deepEqual(await collect([bytes([0x61, 0xff, 0x62, 0x0a])]), { rows: [["a�b"]] });
});

test("an unterminated quoted field: the line where it opened, wherever the input is cut", async () => {
  const input = enc('a\r\nb,"c\r\nd\n');
  const want = { rows: [["a"]], error: "unterminated quoted field starting at line 2" };
  assert.deepEqual(await collect([input]), want);
  assert.deepEqual(await collect(oneByteAtATime(input)), want);
});

test("a character after a closing quote: the line, wherever the input is cut", async () => {
  const input = enc('a\r\n"b\r\nc"x\n');
  const want = { rows: [["a"]], error: 'unexpected character "x" after closing quote at line 3' };
  assert.deepEqual(await collect([input]), want);
  assert.deepEqual(await collect(oneByteAtATime(input)), want);
  assert.deepEqual(await collect([enc('a\n"b"'), enc("\r")], {}), { rows: [["a"], ["b"]] });
  assert.deepEqual(await collect([enc('"b"'), enc("x")]), { rows: [], error: 'unexpected character "x" after closing quote at line 1' });
});

test("records that came before an error are delivered, however the input is cut", async () => {
  const input = enc('a,b\n1,2\n3,"4"5\n6,7\n');
  const want = { rows: [["a", "b"], ["1", "2"]], error: 'unexpected character "5" after closing quote at line 3' };
  assert.deepEqual(await collect([input]), want);
  assert.deepEqual(await collect(oneByteAtATime(input)), want);
});

test("header mode: the error for a long record, and the rows before it", async () => {
  const input = enc("a,b\r\n1,2\r\n3,4,5\r\n6,7\r\n");
  const want = { rows: [{ a: "1", b: "2" }], error: "record 3 has 3 fields but the header has 2" };
  assert.deepEqual(await collect(oneByteAtATime(input), { header: true }), want);
});
