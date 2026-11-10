import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.js";

const file = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
writeFileSync(file, JSON.stringify({ port: 4000, host: "file-host" }));

test("hidden: typed overrides and precedence", () => {
  const cfg = loadConfig(file, { APP_PORT: "8080", APP_VERBOSE: "TRUE", APP_MAX_RETRIES: "0", APP_LOG_LEVEL: "debug", UNRELATED: "x" });
  assert.deepEqual(cfg, { port: 8080, host: "file-host", logLevel: "debug", maxRetries: 0, verbose: true });
  assert.equal(loadConfig(file, {}).port, 4000);
  assert.equal(loadConfig("nope.json", { APP_VERBOSE: "1" }).verbose, true);
  assert.equal(loadConfig("nope.json", { APP_VERBOSE: "false" }).verbose, false);
  assert.deepEqual(loadConfig("nope.json", {}), DEFAULTS);
});

test("hidden: invalid values name the variable", () => {
  assert.throws(() => loadConfig("nope.json", { APP_PORT: "eighty" }), /APP_PORT/);
  assert.throws(() => loadConfig("nope.json", { APP_VERBOSE: "maybe" }), /APP_VERBOSE/);
  assert.throws(() => loadConfig("nope.json", { APP_MAX_RETRIES: "Infinity" }), /APP_MAX_RETRIES/);
});
