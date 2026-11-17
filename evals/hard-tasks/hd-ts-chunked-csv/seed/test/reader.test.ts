import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, enc } from "./helpers.ts";

test("one chunk", async () => {
  assert.deepEqual(await collect([enc("a,b\n1,2\n")]), { rows: [["a", "b"], ["1", "2"]] });
});

test("chunks that end at line breaks", async () => {
  assert.deepEqual(await collect([enc("a,b\n"), enc("1,2\n"), enc("3,4\n")]), { rows: [["a", "b"], ["1", "2"], ["3", "4"]] });
});

test("a field cut in the middle continues in the next chunk", async () => {
  assert.deepEqual(await collect([enc("alp"), enc("ha,be"), enc("ta\n")]), { rows: [["alpha", "beta"]] });
});

test("a chunk of characters above ASCII, cut between characters", async () => {
  assert.deepEqual(await collect([enc("Zoë,"), enc("日本語\n")]), { rows: [["Zoë", "日本語"]] });
});

test("string chunks", async () => {
  assert.deepEqual(await collect(["a,b\n1,", "2\n"]), { rows: [["a", "b"], ["1", "2"]] });
});

test("empty chunks are ignored", async () => {
  assert.deepEqual(await collect([enc(""), enc("a\n"), enc(""), enc("b\n")]), { rows: [["a"], ["b"]] });
});

test("a byte order mark in the first chunk is dropped", async () => {
  assert.deepEqual(await collect([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), enc("id,name\n")]), enc("1,x\n")]), { rows: [["id", "name"], ["1", "x"]] });
});

test("header: rows become objects", async () => {
  assert.deepEqual(await collect([enc("id,name\n1,Ann\n2,Bo\n")], { header: true }), { rows: [{ id: "1", name: "Ann" }, { id: "2", name: "Bo" }] });
});

test("header: a short record is filled with empty strings", async () => {
  assert.deepEqual(await collect([enc("a,b,c\n1\n")], { header: true }), { rows: [{ a: "1", b: "", c: "" }] });
});

test("header: skipped empty lines before the header", async () => {
  assert.deepEqual(await collect([enc("\n\na,b\n1,2\n")], { header: true, skipEmptyLines: true }), { rows: [{ a: "1", b: "2" }] });
});

test("the first record is yielded before the next chunk is read", async () => {
  let pulled = 0;
  async function* source() {
    pulled++;
    yield enc("a,b\n1,2\n3");
    pulled++;
    yield enc(",4\n");
  }
  const { readCsv } = await import("../src/index.ts");
  const it = readCsv(source());
  assert.deepEqual((await it.next()).value, ["a", "b"]);
  assert.equal(pulled, 1);
  assert.deepEqual((await it.next()).value, ["1", "2"]);
  assert.deepEqual((await it.next()).value, ["3", "4"]);
  assert.equal(pulled, 2);
});
