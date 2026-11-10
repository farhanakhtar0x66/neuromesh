import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const cli = (file, ...args) =>
  spawnSync(process.execPath, ["src/cli.js", ...args], { env: { ...process.env, TODO_FILE: file }, encoding: "utf8" });

test("hidden: remove through the real command line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "todo-hidden-")), "todos.json");
  cli(file, "add", "one");
  cli(file, "add", "two");
  const removed = cli(file, "remove", "1");
  assert.equal(removed.status, 0);
  assert.equal(removed.stdout.trim(), "Removed 1");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).map((t) => t.id), [2]);
  const missing = cli(file, "remove", "7");
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "No todo with id 7");
  assert.match(readFileSync("README.md", "utf8"), /todo remove <id>/);
});
