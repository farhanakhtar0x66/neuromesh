// [F95 stub-gate] The stub scanner on unified diffs: no engine, no model calls.

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStubs, findStubs } from "../src/checks/stubs.ts";

const patch = (file: string, lines: string[]): string =>
  `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

test("unambiguous stand-ins in added source lines are found, with file and line", () => {
  const stubs = findStubs(
    patch("src/pool.py", ["class Pool:", "    def rotate(self, key):", "        raise NotImplementedError", "", "    def drain(self):", "        pass", "", "    async def fetch(self):", "        ..."]) +
      patch("src/lib.rs", ["pub fn push(&self, v: T) {", "    unimplemented!()", "}", "fn pop() -> T { todo!() }"]) +
      patch("src/client.ts", ["export function retry() {", '  throw new Error("Not implemented yet");', "}", "// TODO: implement token rotation", "function x() { /* implementation goes here */ }"]) +
      patch("main.go", ['func Run() { panic("todo") }']),
  );
  assert.deepEqual(stubs.map((s) => `${s.file}:${s.line}`), [
    "src/pool.py:3", "src/pool.py:6", "src/pool.py:9",
    "src/lib.rs:2", "src/lib.rs:4",
    "src/client.ts:2", "src/client.ts:4", "src/client.ts:5",
    "main.go:1",
  ]);
  assert.match(describeStubs(stubs), /src\/pool\.py:3: raise NotImplementedError/);
});

test("legitimate code is not a stub: plain TODOs, mock names, empty callbacks, abstract methods, tests, docs", () => {
  const stubs = findStubs(
    patch("src/http.ts", ["// TODO: tune timeout in prod", "const mock_response = { ok: true };", "el.addEventListener('x', () => {});", "try { a() } catch {}"]) +
      patch("src/base.py", ["from abc import ABC, abstractmethod", "class Store(ABC):", "    @abstractmethod", "    def get(self, k):", "        raise NotImplementedError", "", "    @abstractmethod", "    def put(self, k, v):", "        pass", "    def keys(self):", "        return []"]) +
      patch("tests/test_pool.py", ["def test_rotate():", "    pass", "    raise NotImplementedError"]) +
      patch("src/pool.test.ts", ['throw new Error("not implemented")']) +
      patch("README.md", ["TODO: implement the docs"]) +
      patch("src/loop.py", ["while True:", "    pass", "for x in y:", "    pass"]),
  );
  assert.deepEqual(stubs, []);
});

test("only added lines count: a stub the project already had, in context or removed, is not the developer's", () => {
  const diff = `diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1,3 +1,3 @@\n def old():\n     raise NotImplementedError\n-    # TODO: implement this\n+    # done\n`;
  assert.deepEqual(findStubs(diff), []);
});
