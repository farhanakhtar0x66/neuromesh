import { pathToFileURL } from "node:url";
const items = [];
const item = (n, ok) => items.push([n, !!ok]);
const done = () => {
  for (const [n, ok] of items) console.log((ok ? "PASS " : "FAIL ") + n);
  const p = items.filter(([, ok]) => ok).length;
  console.log(`SCORE ${p}/${items.length}`);
  process.exit(p === items.length ? 0 : 1);
};
let parse;
try {
  parse = (await import(pathToFileURL(process.cwd() + "/csv_stream.mjs").href)).parseCsvStream;
} catch {}
item("csv_stream.mjs exports parseCsvStream", typeof parse === "function");
if (typeof parse !== "function") done();

async function* feed(chunks) { for (const c of chunks) { await null; yield c; } }
async function collect(chunks) { const out = []; for await (const r of parse(feed(chunks))) out.push(r); return out; }
async function outcome(chunks) {
  try { return { rows: await collect(chunks) }; } catch (e) { return { err: e }; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const slices = (s, n) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; };
const chars = (s) => Array.from(s);

const payload = 'name,desc,n\r\n"Smith, J","He said ""hi""\r\nthere",3\r\n, ,x\r\n"",y,"line1\nline2"\r\n';
const want = [
  ["name", "desc", "n"],
  ["Smith, J", 'He said "hi"\r\nthere', "3"],
  ["", " ", "x"],
  ["", "y", "line1\nline2"],
];

{ // 1: plain rows, trailing newline ignored
  const a = await outcome(["a,b\r\nc,d\r\n"]);
  const b = await outcome(["a,b\nc,d\n"]);
  const c = await outcome(["a,b\nc,d"]);
  const d = await outcome([]);
  const e = await outcome(["a,\n"]);
  const f = await outcome(["a,b\n\nc,d\n"]);
  item("standard rows; a trailing CRLF or LF adds no row", same(a.rows, [["a", "b"], ["c", "d"]]) && same(b.rows, [["a", "b"], ["c", "d"]]) && same(c.rows, [["a", "b"], ["c", "d"]]) && same(d.rows, []));
  item("a trailing empty field and an interior blank line are kept", same(e.rows, [["a", ""]]) && same(f.rows, [["a", "b"], [""], ["c", "d"]]));
}
{ // 2: every split of a hard payload gives the same rows
  const whole = await outcome([payload]);
  const one = await outcome(chars(payload));
  const two = await outcome(slices(payload, 2));
  const three = await outcome(slices(payload, 3));
  item("quoted commas, newlines, CRLF and doubled quotes parse", same(whole.rows, want));
  item("1-character chunks split CRLF and \"\" and give the same rows", same(one.rows, want) && same(two.rows, want) && same(three.rows, want));
}
{ // 3: bytes split inside multi-byte characters
  const text = 'a,₹\r\n🎉,"b ₹"\n';
  const bytes = Buffer.from(text, "utf8");
  const wantU = [["a", "₹"], ["🎉", "b ₹"]];
  const perByte = await outcome(Array.from(bytes, (b) => new Uint8Array([b])));
  const mid = await outcome([bytes.subarray(0, 4), bytes.subarray(4, 11), bytes.subarray(11)]);
  const mixed = await outcome(["a,", bytes.subarray(2, 5), bytes.subarray(5)]);
  item("Uint8Array chunks split inside ₹ and 🎉 still decode", same(perByte.rows, wantU) && same(mid.rows, wantU) && same(mixed.rows, [["a", "₹"], ["🎉", "b ₹"]]));
}
{ // 4: unclosed quote
  const a = await outcome(['a,"b,c\n']);
  const b = await outcome(chars('"abc'));
  item("an unclosed quote at EOF throws SyntaxError", a.err instanceof SyntaxError && b.err instanceof SyntaxError);
}
{ // 5: stray quotes
  const a = await outcome(['a"b,c\n']);
  const b = await outcome(['"ab"c,d\n']);
  const c = await outcome(chars('x,"ab"c\n'));
  item("an unescaped quote mid-field or text after a closing quote throws SyntaxError", a.err instanceof SyntaxError && b.err instanceof SyntaxError && c.err instanceof SyntaxError);
}
done();
