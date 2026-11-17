// The same input cut into chunks 200 different ways must give what reading the whole thing at once gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "./support/run.ts";
import { chunking, mulberry32, oracle } from "./support/oracle.ts";
import { fixtures } from "./support/fixtures.ts";

const all = fixtures();

all.forEach((f, index) => {
  test(`fixture ${String(index + 1).padStart(2, "0")} (${f.label}) read in 200 chunkings`, async () => {
    const want = oracle(f.bytes, f.options);
    const rng = mulberry32(1000 + index);
    for (let r = 0; r < 200; r++) {
      const chunks = chunking(f.bytes, r, rng);
      const got = await collect(chunks, f.options);
      assert.deepEqual(got, want, `chunk sizes ${JSON.stringify(chunks.map((c) => c.length))} of ${JSON.stringify(f.bytes.toString("latin1"))}`);
    }
  });
});
