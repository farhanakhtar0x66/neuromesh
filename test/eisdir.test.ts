// Regression for F12 context-packet and F100 start-here crashing with EISDIR
// (ansible__molecule-4534): `git ls-files` lists a submodule or a symbolic
// link to a folder as a path, and both read every listed path as a file.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildPacket, regularFileSize, scanRepo, startHere } from "../src/context/packet.ts";

function awkwardRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "nm-eisdir-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/molecule.py"), "def compactNotes(notes, limit):\n    return notes[:limit]\n");
  // A symbolic link to a folder, and one that points nowhere: git tracks both as links.
  symlinkSync("src", join(dir, "linked"));
  symlinkSync("missing-target", join(dir, "broken"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  // A submodule entry (gitlink) whose folder exists on disk.
  mkdirSync(join(dir, "vendored"));
  execFileSync("git", ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendored`], { cwd: dir });
  return dir;
}

test("regularFileSize is defined only for regular files", () => {
  const dir = awkwardRepo();
  assert.ok((regularFileSize(join(dir, "src/molecule.py")) ?? 0) > 0);
  assert.equal(regularFileSize(join(dir, "src")), undefined);
  assert.equal(regularFileSize(join(dir, "linked")), undefined);
  assert.equal(regularFileSize(join(dir, "broken")), undefined);
  assert.equal(regularFileSize(join(dir, "vendored")), undefined);
  assert.equal(regularFileSize(join(dir, "nothing-here")), undefined);
});

test("F12 and F100 skip folders, submodules and broken links instead of crashing", () => {
  const dir = awkwardRepo();
  const paths = scanRepo(dir).map((f) => f.path);
  assert.deepEqual(paths, ["src/molecule.py"]);
  assert.doesNotThrow(() => buildPacket(dir, "compactNotes keeps too many entries"));
  const lead = startHere(dir, "compactNotes keeps too many entries: bound it at the limit");
  assert.ok(lead?.files.includes("src/molecule.py"), JSON.stringify(lead));
});
