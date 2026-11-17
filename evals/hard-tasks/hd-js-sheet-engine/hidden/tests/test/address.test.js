import test from "node:test";
import assert from "node:assert/strict";
import { columnToNumber, formatAddress, numberToColumn, parseAddress } from "../src/address.js";

test("columns convert both ways", () => {
  assert.equal(columnToNumber("A"), 1);
  assert.equal(columnToNumber("Z"), 26);
  assert.equal(columnToNumber("AA"), 27);
  assert.equal(columnToNumber("zz"), 702);
  assert.equal(numberToColumn(27), "AA");
  assert.equal(numberToColumn(702), "ZZ");
});

test("addresses are parsed and normalised", () => {
  assert.deepEqual(parseAddress("b12"), { col: 2, row: 12, key: "B12" });
  assert.equal(parseAddress("ZZ100000")?.key, "ZZ100000");
  assert.equal(formatAddress(28, 3), "AB3");
});

test("bad addresses are refused", () => {
  for (const bad of ["A0", "A01", "AAA1", "A100001", "1A", "", "A1 ", " A1", "A", "12", null, 5]) assert.equal(parseAddress(bad), null, String(bad));
});
