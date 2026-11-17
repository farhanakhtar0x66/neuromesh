import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { issues } from "./support/fixture.ts";
import type { Issue } from "../src/index.ts";

const data = join(mkdtempSync(join(tmpdir(), "track-hidden-")), "issues.json");
writeFileSync(data, JSON.stringify(issues));

function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(["list", "--data", data, "--today", "2024-05-10", ...args], (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

const line = (i: Issue): string => `#${i.id} [${i.status}] P${i.priority} @${i.assignee ?? "-"} ${i.title}`;
/** What `track list` prints for the issues a predicate picks: the lines in id order, then the count. */
const listing = (pick: (i: Issue) => boolean): string[] => {
  const picked = issues.filter(pick);
  return [...picked.map(line), `${picked.length} ${picked.length === 1 ? "issue" : "issues"}`];
};

test("list --search with a boolean query", () => {
  const r = cli(["--search", "status:open priority:<=1 -label:docs"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, listing((i) => i.status === "open" && i.priority <= 1 && !i.labels.includes("docs")));
  assert.equal(r.out.at(-1), "3 issues");
});

test("list --search with fields, a phrase and a negation", () => {
  const r = cli(["--search", '(assignee:none OR reporter:dave) AND NOT "dark mode" AND priority:>=3']);
  const dark = (i: Issue) => `${i.title} ${i.body}`.toLowerCase().includes("dark mode");
  assert.deepEqual(r.out, listing((i) => (i.assignee === null || i.reporter === "dave") && !dark(i) && i.priority >= 3));
  assert.equal(r.out.at(-1), "6 issues");
});

test("relative dates use --today, macros use --user", () => {
  assert.deepEqual(cli(["--search", "created:>=@today-1d"]).out, listing((i) => i.created >= "2024-05-09"));
  assert.deepEqual(cli(["--search", "is:mine is:overdue", "--user", "ann"]).out, listing((i) => i.assignee === "ann" && i.due !== null && i.due < "2024-05-10" && i.status !== "closed"));
  assert.deepEqual(cli(["--search", "due:@today", "--today", "2024-05-06"]).out, listing((i) => i.due === "2024-05-06"));
});

test("plain words give the same list as before", () => {
  assert.deepEqual(cli(["--search", "login crash"]).out, listing((i) => i.id === 1));
  assert.deepEqual(cli(["--search", "zzzz"]).out, ["0 issues"]);
});

test("a bad query: message, the query and a caret, status 2, nothing on standard output", () => {
  const r = cli(["--search", "foo:bar"]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.out, []);
  assert.deepEqual(r.err, ['track: unknown field "foo"', "  foo:bar", "  ^"]);
});

test("the caret sits under the column", () => {
  const caret = (query: string, column: number): string => `  ${" ".repeat(column - 1)}^`;
  const check = (query: string, message: string, column: number): void => {
    assert.deepEqual(cli(["--search", query]).err, [`track: ${message}`, `  ${query}`, caret(query, column)], query);
  };
  check("login AND", "unexpected end of query", 10);
  check("status:open created:>=2024-13-01", 'invalid date "2024-13-01"', 23);
  check("(login", 'missing ")"', 1);
  check('title:"abc', "unterminated quoted string", 7);
  check("a b ) c", 'unexpected ")"', 5);
});

test("is:mine without --user is a bad query", () => {
  const r = cli(["--search", "is:mine"]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.err, ["track: no current user for is:mine", "  is:mine", "     ^"]);
});
