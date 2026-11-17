import { mulberry32 } from "./oracle.ts";
import type { Opts } from "./oracle.ts";

export interface Fixture {
  label: string;
  bytes: Buffer;
  options: Opts;
}

const enc = (s: string): Buffer => Buffer.from(s, "utf8");
const BOM = "﻿";

// Hand-written inputs: each one has something that lives at a chunk boundary when it is cut in the wrong place.
const handwritten: [string, string | Buffer, Opts][] = [
  ["plain records", "id,name,city\n1,Ann,Oslo\n2,Bo,Rome\n3,Cy,Lima\n", {}],
  ["accents and CJK", "name,city\nZoë,Zürich\n田中,東京\nÅsa,Malmö\nİpek,İstanbul\n", {}],
  ["emoji", "n,face\n1,😀\n2,🎉🎉\n3,👨‍👩‍👧\n", {}],
  ["CRLF file", "a,b\r\nc,d\r\ne,f\r\n", {}],
  ["CRLF with BOM, as Excel writes it", `${BOM}id,name\r\n1,Zoë\r\n2,Ana\r\n`, { header: true }],
  ["lone CR and LF mixed", "a\rb\nc\r\nd\r\r\ne", {}],
  ["quoted fields with delimiters", '"a,b","c,d,e",f\n"g","h,i",j\n', {}],
  ["quoted line breaks", '"line1\nline2","x\r\ny"\n"p\rq",z\r\n', {}],
  ["doubled quotes", '"say ""hi""","""",""""""\n"a""b",c\n', {}],
  ["quote then delimiter", '"a","b","c"\n"d","e","f"\n', {}],
  ["empty fields everywhere", ",,\n,\n,a,\n,,,b\n", {}],
  ["empty lines kept", "a\n\n\nb\r\n\r\nc\n", {}],
  ["empty lines skipped", "\n\na\n\n\r\nb\r\n\n", { skipEmptyLines: true }],
  ["semicolons and single quotes", "a;'b;c';d\n'e''f';g;h\n", { delimiter: ";", quote: "'" }],
  ["tabs", "a\tb\n1\t\"two words\"\n", { delimiter: "\t" }],
  ["header with short and long rows", "a,b,c\n1\n2,3\n4,5,6\n7,8,9,10\n", { header: true }],
  ["header and quoted names", '"first name","last,name"\nAnn,Lee\n', { header: true }],
  ["unterminated at the end", 'a,b\n1,"never closed\nstill\n', {}],
  ["junk after a closing quote", 'a\n"b"c\nd\n', {}],
  ["junk after a closing quote at a line start", '"a"\r\n"b"\r', {}],
  ["no trailing newline, trailing delimiter", "a,b\nc,", {}],
  ["only a BOM", BOM, {}],
  ["BOM then empty lines", `${BOM}\n\na\n`, {}],
  ["BOM inside the data", `a,b\n${BOM}c,d${BOM}\n`, {}],
  ["invalid bytes", Buffer.from([0x61, 0x2c, 0xff, 0x0a, 0xc3, 0x28, 0x2c, 0xe6, 0x97, 0x0a, 0xf0, 0x9f, 0x98]), {}],
  ["a truncated character at the end", Buffer.from([0x61, 0x2c, 0xe6, 0x97]), {}],
];

const PIECES = ["a", "bc", "é", "日本", "😀", "Zoë", "x y", "", "1", "O'Neil", "ü"];
const NEEDS_QUOTES = ['"', ",", "\n", "\r\n", "\r", ";"];

function structured(rng: () => number, n: number): Fixture {
  const rows = 1 + Math.floor(rng() * 8);
  const cols = 1 + Math.floor(rng() * 5);
  const useSemicolon = rng() < 0.3;
  const delimiter = useSemicolon ? ";" : ",";
  const eol = rng() < 0.4 ? "\r\n" : rng() < 0.2 ? "\r" : "\n";
  let out = rng() < 0.4 ? BOM : "";
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      let value = "";
      const parts = Math.floor(rng() * 4);
      for (let p = 0; p < parts; p++) value += rng() < 0.3 ? NEEDS_QUOTES[Math.floor(rng() * NEEDS_QUOTES.length)]! : PIECES[Math.floor(rng() * PIECES.length)]!;
      const mustQuote = [delimiter, '"', "\n", "\r"].some((ch) => value.includes(ch));
      cells.push(mustQuote || rng() < 0.2 ? `"${value.replaceAll('"', '""')}"` : value);
    }
    out += cells.join(delimiter) + (r < rows - 1 || rng() < 0.7 ? eol : "");
  }
  return { label: `generated table ${n}`, bytes: enc(out), options: { delimiter, header: rng() < 0.4, skipEmptyLines: rng() < 0.3 } };
}

const RAW = ["a", "b", ",", '"', '"', "\r", "\n", "\r\n", "é", " ", "😀", BOM, ";", "日"];

function raw(rng: () => number, n: number): Fixture {
  const len = 4 + Math.floor(rng() * 40);
  let s = "";
  for (let i = 0; i < len; i++) s += RAW[Math.floor(rng() * RAW.length)]!;
  return { label: `generated raw text ${n}`, bytes: enc(s), options: { header: rng() < 0.3, skipEmptyLines: rng() < 0.3, ...(rng() < 0.25 ? { delimiter: ";" } : {}) } };
}

const BYTES = [0x61, 0x62, 0x2c, 0x22, 0x22, 0x0a, 0x0d, 0xc3, 0xa9, 0xe6, 0x97, 0xa5, 0xff, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbb, 0xbf];

function rawBytes(rng: () => number, n: number): Fixture {
  const len = 4 + Math.floor(rng() * 40);
  return { label: `generated raw bytes ${n}`, bytes: Buffer.from(Array.from({ length: len }, () => BYTES[Math.floor(rng() * BYTES.length)]!)), options: { skipEmptyLines: rng() < 0.3 } };
}

/** 50 fixtures; the generated ones come from a fixed seed, so the set never changes. */
export function fixtures(): Fixture[] {
  const out: Fixture[] = handwritten.map(([label, data, options]) => ({ label, bytes: typeof data === "string" ? enc(data) : data, options }));
  const rng = mulberry32(20261117);
  for (let n = 1; out.length < 36; n++) out.push(structured(rng, n));
  for (let n = 1; out.length < 46; n++) out.push(raw(rng, n));
  for (let n = 1; out.length < 50; n++) out.push(rawBytes(rng, n));
  return out;
}
