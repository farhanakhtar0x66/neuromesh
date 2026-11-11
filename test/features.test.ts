import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES, FeatureError, disable, feature, hint, inFeature, isOn, resetFeatures, tag } from "../src/features.ts";

test("every feature has a unique id and key, a main file and a description", () => {
  const ids = new Set(FEATURES.map((f) => f.id));
  const keys = new Set(FEATURES.map((f) => f.key));
  assert.equal(ids.size, FEATURES.length);
  assert.equal(keys.size, FEATURES.length);
  for (const f of FEATURES) {
    assert.match(f.id, /^F\d\d$/);
    assert.ok(f.files.length > 0 && f.what.length > 0, f.key);
  }
  assert.equal(tag("f04"), "F04 screen-check");
  assert.equal(feature("screen-check").id, "F04");
});

test("features are switched off by id or key, and reset to the environment", () => {
  resetFeatures();
  assert.equal(isOn("screen-check"), true);
  disable("F04, context-packet ,nonsense");
  assert.equal(isOn("screen-check"), false);
  assert.equal(isOn("F12"), false);
  process.env.NEUROMESH_DISABLE = "spec-step";
  resetFeatures();
  assert.equal(isOn("screen-check"), true);
  assert.equal(isOn("spec-step"), false);
  delete process.env.NEUROMESH_DISABLE;
  resetFeatures();
});

test("errors inside a feature carry its id, synchronously and asynchronously", async () => {
  assert.throws(
    () => inFeature("brief-engine", () => { throw new Error("boom"); }),
    (e: unknown) => e instanceof FeatureError && e.feature.id === "F01" && e.message === "[F01 brief-engine] boom",
  );
  await assert.rejects(inFeature("spec-step", async () => { throw new Error("late"); }), /\[F02 spec-step\] late/);
  assert.equal(inFeature("brief-engine", () => 7), 7);
  assert.match(hint(feature("F04")), /--disable screen-check/);
  process.env.NEUROMESH_FAULT = "screen-check";
  assert.throws(() => inFeature("F04", () => 1), /injected fault/);
  delete process.env.NEUROMESH_FAULT;
});
