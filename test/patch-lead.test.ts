// [F127 patch-lead] The expert's edits, applied with no model call.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyEdits } from "../src/engine/run.ts";
import { parsePatch } from "../src/engine/prompts.ts";
import type { AgentResult } from "../src/backends/types.ts";

const dir = mkdtempSync(join(tmpdir(), "nm-patch-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("an edit replaces its search text once; an empty search creates a file", () => {
  writeFileSync(join(dir, "a.py"), "def f():\n    return 1\n\ndef g():\n    return 1\n");
  const r = applyEdits(dir, [{ path: "a.py", search: "def f():\n    return 1", replace: "def f():\n    return 2" }, { path: "pkg/new.py", search: "", replace: "x = 1\n" }], []);
  assert.deepEqual(r, { applied: ["a.py", "pkg/new.py"], errors: [] });
  assert.equal(readFileSync(join(dir, "a.py"), "utf8"), "def f():\n    return 2\n\ndef g():\n    return 1\n");
  assert.equal(readFileSync(join(dir, "pkg/new.py"), "utf8"), "x = 1\n");
});

test("a search that is missing, repeated, or a path that leaves the repository is refused", () => {
  writeFileSync(join(dir, "b.py"), "return 1\nreturn 1\n");
  const r = applyEdits(dir, [
    { path: "b.py", search: "return 1", replace: "return 2" },
    { path: "b.py", search: "absent", replace: "x" },
    { path: "../outside.py", search: "", replace: "x" },
    { path: ".git/config", search: "", replace: "x" },
    { path: "a.py", search: "", replace: "overwrite" },
    { path: "kept/x.py", search: "", replace: "x" },
  ], ["kept"]);
  assert.deepEqual(r.applied, []);
  assert.equal(r.errors.length, 6);
  assert.match(r.errors[0]!, /occurs 2 times/);
  assert.equal(existsSync(join(dir, "..", "outside.py")), false);
});

const answer = (structured: unknown): AgentResult => ({ stop: "done", finalText: "", structured }) as AgentResult;

test("the patch answer is read defensively", () => {
  assert.deepEqual(parsePatch(answer({ need: ["./src/x.py", ""], edits: [], summary: "" })).need, ["src/x.py"]);
  assert.equal(parsePatch(answer({ need: [], edits: [{ path: "a.py", search: "x", replace: "y" }, { path: "", search: "", replace: "" }], summary: "s" })).edits.length, 1);
  assert.throws(() => parsePatch(answer({ need: [], edits: [], summary: "" })));
});

import { requestNames } from "../src/engine/run.ts";

test("names a request may point at code with", () => {
  const n = requestNames("`Response.unset_cookie` takes samesite; see falcon/response.py and the same_site argument of MediaRestore, not ValueError.");
  for (const x of ["Response.unset_cookie", "falcon/response.py", "same_site", "MediaRestore"]) assert.ok(n.includes(x), x);
});
