// readCsv asks for the next chunk only when it has to, and hands over each record when it is complete (docs/FORMAT.md, "Streaming").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readCsv } from "../src/index.ts";

const enc = (s: string): Buffer => Buffer.from(s, "utf8");

test("the first record arrives before the source has been read to its end", async () => {
  let pulled = 0;
  async function* source() {
    for (let i = 1; i <= 5000; i++) {
      pulled++;
      yield enc(`row${i},x\n`);
    }
  }
  const it = readCsv(source());
  for (let i = 1; i <= 3; i++) {
    const r = await it.next();
    assert.deepEqual(r.value, [`row${i}`, "x"]);
    assert.equal(pulled, i, `after ${i} records the source had been asked for ${pulled} chunks`);
  }
  await it.return(undefined);
});

test("a record ended by a lone CR at the chunk end is handed over without reading on", async () => {
  let pulled = 0;
  async function* source() {
    pulled++;
    yield enc("a,b\r");
    pulled++;
    yield enc("\nc,d\n");
  }
  const it = readCsv(source());
  assert.deepEqual((await it.next()).value, ["a", "b"]);
  assert.equal(pulled, 1);
  assert.deepEqual((await it.next()).value, ["c", "d"]);
  assert.equal((await it.next()).done, true);
});

test("a record cut in the middle waits for the chunk that completes it", async () => {
  let pulled = 0;
  async function* source() {
    for (const part of ["al", "ph", "a,be", "ta\ngam", "ma\n"]) {
      pulled++;
      yield enc(part);
    }
  }
  const it = readCsv(source());
  assert.deepEqual((await it.next()).value, ["alpha", "beta"]);
  assert.equal(pulled, 4);
  assert.deepEqual((await it.next()).value, ["gamma"]);
  assert.equal(pulled, 5);
});

test("a source that fails after some records: those records come first, then the failure", async () => {
  async function* source() {
    yield enc("a\nb\n");
    throw new Error("disk went away");
  }
  const got: unknown[] = [];
  await assert.rejects(async () => {
    for await (const row of readCsv(source())) got.push(row);
  }, { message: "disk went away" });
  assert.deepEqual(got, [["a"], ["b"]]);
});

test("the same rows when the source is a plain array of chunks, or of strings", async () => {
  const rows: unknown[] = [];
  for await (const row of readCsv([enc("a,"), enc("b\n")])) rows.push(row);
  for await (const row of readCsv(["c,", "d\n"])) rows.push(row);
  assert.deepEqual(rows, [["a", "b"], ["c", "d"]]);
});
