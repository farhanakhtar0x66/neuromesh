import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/cli.js";

function fresh() {
  process.env.TODO_FILE = join(mkdtempSync(join(tmpdir(), "todo-")), "todos.json");
  const out = [];
  const err = [];
  return { out, err, run: (...args) => run(args, (l) => out.push(l), (l) => err.push(l)) };
}

test("add and list", () => {
  const t = fresh();
  assert.equal(t.run("add", "buy", "milk"), 0);
  assert.equal(t.run("list"), 0);
  assert.deepEqual(t.out, ["Added 1: buy milk", "[ ] 1 buy milk"]);
});

test("done marks a todo", () => {
  const t = fresh();
  t.run("add", "x");
  assert.equal(t.run("done", "1"), 0);
  assert.equal(t.run("done", "9"), 1);
  assert.deepEqual(t.err, ["No todo with id 9"]);
});
