// The import command on files bigger than one read, where the read size cuts the data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;

function run(args: string[], input?: Buffer) {
  const r = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function fileOf(content: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), "csvstream-hidden-")), "in.csv");
  writeFileSync(path, content);
  return path;
}

/** Rows of plain ASCII, then one filler row, so that the next byte written is at offset `at` of the file. */
function padTo(at: number, eol: string): { text: string; rows: string[][] } {
  const rows: string[][] = [["id", "name"]];
  let text = `id,name${eol}`;
  for (let i = 1; text.length < at - 200; i++) {
    rows.push([`r${i}`, "plain text"]);
    text += `r${i},plain text${eol}`;
  }
  const filler = at - text.length - 2 - eol.length; // the row is "f," + filler + eol
  assert.ok(filler >= 0);
  rows.push(["f", "x".repeat(filler)]);
  text += `f,${"x".repeat(filler)}${eol}`;
  assert.equal(text.length, at);
  return { text, rows };
}

const lines = (rows: unknown[]): string => rows.map((r) => `${JSON.stringify(r)}\n`).join("");

test("import: a multibyte character that straddles the 64 KiB read boundary", () => {
  const { text, rows } = padTo(65535 - "9,Zo".length, "\n");
  const content = Buffer.from(`${text}9,Zoë-and-ünïcode\n7,日本語\n`, "utf8");
  assert.equal(content.indexOf(Buffer.from("ë"), 65000), 65535, "layout: the first byte of ë is the last byte of the first read");
  rows.push(["9", "Zoë-and-ünïcode"], ["7", "日本語"]);
  const r = run(["import", fileOf(content)]);
  assert.equal(r.out, lines(rows));
  assert.equal(r.err, `imported ${rows.length} records\n`);
  assert.equal(r.code, 0);
});

test("import: a three-byte character cut at the boundary", () => {
  const { text, rows } = padTo(65535, "\n");
  const content = Buffer.from(`${text}日本語,x\n`, "utf8"); // 日 starts at byte 65535: one byte before the boundary, two after
  assert.equal(content.indexOf(Buffer.from("日"), 65000), 65535);
  rows.push(["日本語", "x"]);
  assert.equal(run(["import", fileOf(content)]).out, lines(rows));
});

test("import: a CRLF whose CR is the last byte of a read", () => {
  const { text, rows } = padTo(65537, "\r\n"); // the last row's CR is byte 65535, its LF byte 65536
  const content = Buffer.from(`${text}last,row\r\n`, "utf8");
  assert.equal(content[65535], 0x0d);
  rows.push(["last", "row"]);
  assert.equal(run(["import", fileOf(content)]).out, lines(rows));
});

test("import: a quoted field that spans the read boundary", () => {
  const { text, rows } = padTo(65530, "\n");
  const content = Buffer.from(`${text}"a,b\nc ""q"" d",e\nz,z\n`, "utf8");
  rows.push(['a,b\nc "q" d', "e"], ["z", "z"]);
  assert.equal(run(["import", fileOf(content)]).out, lines(rows));
});

test("import: a byte order mark with one byte per read", () => {
  const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id,name\r\n1,Zoë\r\n2,\"B\"\"o\"\r\n", "utf8")]);
  const r = run(["import", fileOf(content), "--header", "--chunk-size", "1"]);
  assert.equal(r.out, lines([{ id: "1", name: "Zoë" }, { id: "2", name: 'B"o' }]));
  assert.equal(r.code, 0);
});

test("import: the same output for every read size", () => {
  const content = Buffer.from('id;name\r\n1;"Zoë; the ""first"""\r\n\r\n2;日本語\r\n', "utf8");
  const path = fileOf(content);
  const whole = run(["import", path, "--delimiter", ";", "--chunk-size", "100000"]).out;
  assert.equal(whole, lines([["id", "name"], ["1", 'Zoë; the "first"'], [""], ["2", "日本語"]]));
  for (const size of [1, 2, 3, 5, 7, 11]) assert.equal(run(["import", path, "--delimiter", ";", "--chunk-size", String(size)]).out, whole, `chunk size ${size}`);
});

test("import: an error found late in a big file names the right line", () => {
  const { text } = padTo(65535, "\n");
  const lineCount = text.split("\n").length - 1;
  const content = Buffer.from(`${text}"ok"x\n`, "utf8");
  const r = run(["import", fileOf(content)]);
  assert.equal(r.err, `csvstream: unexpected character "x" after closing quote at line ${lineCount + 1}\n`);
  assert.equal(r.code, 1);
});
