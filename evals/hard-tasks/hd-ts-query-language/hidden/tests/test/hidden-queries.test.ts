// Queries against the fixed store (support/fixture.ts, today = 2024-05-10). Each expectation is a plain predicate written
// from docs/QUERY.md; it does not use the solution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/index.ts";
import { all, any, ctx, expectQuery as q, has, not, store } from "./support/check.ts";
import { ids, issues } from "./support/fixture.ts";
import type { Issue } from "../src/index.ts";

const status = (s: string) => (i: Issue) => i.status === s;
const assignee = (a: string) => (i: Issue) => i.assignee?.toLowerCase() === a;
const label = (l: string) => (i: Issue) => i.labels.includes(l);
const field = (k: "title" | "body", v: string) => (i: Issue) => i[k].toLowerCase().includes(v.toLowerCase());
const num = (k: "id" | "priority", f: (n: number) => boolean) => (i: Issue) => f(i[k]);
const est = (f: (n: number) => boolean) => (i: Issue) => i.estimate !== null && f(i.estimate);
const created = (f: (d: string) => boolean) => (i: Issue) => f(i.created);
const due = (f: (d: string) => boolean) => (i: Issue) => i.due !== null && f(i.due);
const overdue = (i: Issue) => i.due !== null && i.due < "2024-05-10" && i.status !== "closed";

test("plain words keep their old meaning", () => {
  q("login", has("login"));
  q("LOGIN", has("login"));
  q("log", has("log"));
  q("login crash", all(has("login"), has("crash")));
  q("login   crash", all(has("login"), has("crash")));
  q("login\tcrash", all(has("login"), has("crash")));
  q("login\ncrash", all(has("login"), has("crash")));
  q("Café", has("café"));
  q("CAFÉ", has("café"));
  q("wait...", has("wait..."));
  q("re-open", has("re-open"));
  q("recieve", has("recieve"));
  q("zzz", has("zzz"));
  q("nosuchword", () => false);
});

test("keywords are exactly AND OR NOT; anything else is text", () => {
  q("and", has("and"));
  q("or", has("or"));
  q("not", has("not"));
  q("And", has("and"));
  q("login and crash", all(has("login"), has("and"), has("crash")));
  q("login or dark", all(has("login"), has("or"), has("dark")));
  q('"AND"', has("and"));
  q('"OR"', has("or"));
  q('"NOT"', has("not"));
  q("login AND crash", all(has("login"), has("crash")));
});

test("quoted phrases and their escapes", () => {
  q('"dark mode"', has("dark mode"));
  q('"Dark Mode"', has("dark mode"));
  q('"log out"', has("log out"));
  q('"login crash"', has("login crash"));
  q('"\\"export\\""', has('"export"'));
  q('"C:\\\\temp"', has("C:\\temp"));
  q('"a\\tb"', has("a\tb"));
  q('"a\\nb"', has("a\nb"));
  q('""', () => true);
  q('"(login)"', has("(login)"));
  q('"login OR dark"', has("login or dark"));
  q('"-login"', has("-login"));
});

test("title and body fields", () => {
  q("title:login", field("title", "login"));
  q("title:LOGIN", field("title", "login"));
  q("body:login", field("body", "login"));
  q('title:"dark mode"', field("title", "dark mode"));
  q('body:"R AND D"', field("body", "r and d"));
  q("title:Cache:", field("title", "cache:"));
  q("body:status:open", field("body", "status:open"));
  q("title:crash body:empty", all(field("title", "crash"), field("body", "empty")));
  q('title:"log out"', field("title", "log out"));
});

test("status, assignee and reporter ignore case", () => {
  q("status:open", status("open"));
  q("status:OPEN", status("open"));
  q("status:in-progress", status("in-progress"));
  q("status:In-Progress", status("in-progress"));
  q("status:closed", status("closed"));
  q('status:"closed"', status("closed"));
  q("assignee:ann", assignee("ann"));
  q("assignee:ANN", assignee("ann"));
  q("assignee:none", (i) => i.assignee === null);
  q("assignee:None", (i) => i.assignee === null);
  q('assignee:"ann"', assignee("ann"));
  q("reporter:bob", (i) => i.reporter === "bob");
  q("reporter:Carol", (i) => i.reporter === "carol");
  q("assignee:an", () => false);
});

test("labels are case-sensitive and exact", () => {
  q("label:bug", label("bug"));
  q("label:Bug", label("Bug"));
  q("label:BUG", () => false);
  q("label:docs", label("docs"));
  q("label:Docs", label("Docs"));
  q('label:"good first issue"', label("good first issue"));
  q("label:good", () => false);
  q("label:ui", label("ui"));
  q("label:backend label:bug", all(label("backend"), label("bug")));
});

test("id and priority: equality, comparisons, ranges", () => {
  q("id:5", num("id", (n) => n === 5));
  q('id:"5"', num("id", (n) => n === 5));
  q("id:>20", num("id", (n) => n > 20));
  q("id:>=22", num("id", (n) => n >= 22));
  q("id:<3", num("id", (n) => n < 3));
  q("id:<=2", num("id", (n) => n <= 2));
  q("id:3..6", num("id", (n) => n >= 3 && n <= 6));
  q("id:7..7", num("id", (n) => n === 7));
  q("id:9..3", () => false);
  q("priority:1", num("priority", (n) => n === 1));
  q("priority:001", num("priority", (n) => n === 1));
  q("priority:<=2", num("priority", (n) => n <= 2));
  q("priority:>3", num("priority", (n) => n > 3));
  q("priority:>=4", num("priority", (n) => n >= 4));
  q("priority:<2", num("priority", (n) => n < 2));
  q("priority:2..3", num("priority", (n) => n >= 2 && n <= 3));
  q("priority:5 id:>15", all(num("priority", (n) => n === 5), num("id", (n) => n > 15)));
});

test("estimate: decimals, comparisons, ranges, and no estimate never matches", () => {
  q("estimate:0.5", est((n) => n === 0.5));
  q("estimate:2", est((n) => n === 2));
  q("estimate:2.0", est((n) => n === 2));
  q("estimate:>=5", est((n) => n >= 5));
  q("estimate:>2.5", est((n) => n > 2.5));
  q("estimate:<1", est((n) => n < 1));
  q("estimate:<=1", est((n) => n <= 1));
  q("estimate:1.5..3", est((n) => n >= 1.5 && n <= 3));
  q("estimate:0.5..1", est((n) => n >= 0.5 && n <= 1));
  q("estimate:<1000", est((n) => n < 1000));
  q("estimate:0..100", est(() => true));
  q("NOT estimate:<1000", not(est((n) => n < 1000)));
});

test("created and due: absolute dates", () => {
  q("created:2024-05-10", created((d) => d === "2024-05-10"));
  q("created:2024-02-29", created((d) => d === "2024-02-29"));
  q("created:>2024-05-08", created((d) => d > "2024-05-08"));
  q("created:>=2024-05-08", created((d) => d >= "2024-05-08"));
  q("created:<2024-02-01", created((d) => d < "2024-02-01"));
  q("created:<=2024-02-01", created((d) => d <= "2024-02-01"));
  q("created:2024-04-01..2024-04-30", created((d) => d >= "2024-04-01" && d <= "2024-04-30"));
  q("due:2024-05-10", due((d) => d === "2024-05-10"));
  q("due:<2024-05-01", due((d) => d < "2024-05-01"));
  q("due:>=2024-05-10", due((d) => d >= "2024-05-10"));
  q("due:2024-05-01..2024-05-31", due((d) => d >= "2024-05-01" && d <= "2024-05-31"));
  q("NOT due:<2025-01-01", not(due((d) => d < "2025-01-01")));
});

test("relative dates are counted from the injected clock", () => {
  q("created:@today", created((d) => d === "2024-05-10"));
  q("created:>=@today-7d", created((d) => d >= "2024-05-03"));
  q("created:<@today-30d", created((d) => d < "2024-04-10"));
  q("created:>=@today-2w", created((d) => d >= "2024-04-26"));
  q("created:@today-1w..@today", created((d) => d >= "2024-05-03" && d <= "2024-05-10"));
  q("created:@today-30d..2024-05-01", created((d) => d >= "2024-04-10" && d <= "2024-05-01"));
  q("due:@today", due((d) => d === "2024-05-10"));
  q("due:<@today", due((d) => d < "2024-05-10"));
  q("due:>@today+1w", due((d) => d > "2024-05-17"));
  q("due:@today+1d", due((d) => d === "2024-05-11"));
  q("due:@today+2w", due((d) => d === "2024-05-24"));
  q("due:@today-0d", due((d) => d === "2024-05-10"));
  const later = { ...ctx, clock: () => new Date("2024-05-20T00:00:00Z") };
  q("created:@today", created((d) => d === "2024-05-20"), later);
  q("due:<@today", due((d) => d < "2024-05-20"), later);
  const lateEvening = { ...ctx, clock: () => new Date("2024-05-10T23:59:59Z") };
  q("created:@today", created((d) => d === "2024-05-10"), lateEvening);
});

test("macros", () => {
  q("is:open", (i) => i.status !== "closed");
  q("is:closed", status("closed"));
  q("is:overdue", overdue);
  q("is:mine", assignee("ann"));
  q("is:mine", assignee("carol"), { ...ctx, user: "CAROL" });
  q("is:mine is:open", all(assignee("ann"), (i) => i.status !== "closed"));
  q("is:overdue is:mine", all(overdue, assignee("ann")));
  q("NOT is:open", status("closed"));
  q("-is:overdue", not(overdue));
  q("is:overdue OR is:closed", any(overdue, status("closed")));
});

test("NOT and a leading minus", () => {
  q("NOT login", not(has("login")));
  q("-login", not(has("login")));
  q("NOT NOT login", has("login"));
  q("--login", has("login"));
  q("NOT -login", has("login"));
  q("-NOT login", has("login"));
  q("-status:closed", not(status("closed")));
  q("NOT status:closed", not(status("closed")));
  q('-"dark mode"', not(has("dark mode")));
  q("-(login OR dark)", not(any(has("login"), has("dark"))));
  q("NOT (login OR dark)", not(any(has("login"), has("dark"))));
  q("NOT assignee:ann", not(assignee("ann")));
  q("status:open -label:docs", all(status("open"), not(label("docs"))));
  q("status:open NOT label:docs", all(status("open"), not(label("docs"))));
  q("re-open -wait", all(has("re-open"), not(has("wait"))));
  q("- login", all(has("-"), has("login")));
  q("login -", all(has("login"), has("-")));
});

test("AND, OR and implicit AND", () => {
  q("login OR dark", any(has("login"), has("dark")));
  q("login AND crash", all(has("login"), has("crash")));
  q("login crash", all(has("login"), has("crash")));
  q("login OR dark OR crash", any(has("login"), has("dark"), has("crash")));
  q("login AND crash AND page", all(has("login"), has("crash"), has("page")));
  q("login crash page", all(has("login"), has("crash"), has("page")));
  q("login AND crash page", all(has("login"), has("crash"), has("page")));
  q("status:open priority:1", all(status("open"), num("priority", (n) => n === 1)));
  q("status:open AND priority:1 AND assignee:ann", all(status("open"), num("priority", (n) => n === 1), assignee("ann")));
  q('"dark mode" OR theme', any(has("dark mode"), has("theme")));
  q("login\nOR\ndark", any(has("login"), has("dark")));
});

test("precedence: NOT, then AND, then OR", () => {
  q("login OR dark crash", any(has("login"), all(has("dark"), has("crash"))));
  q("login dark OR crash", any(all(has("login"), has("dark")), has("crash")));
  q("login AND dark OR crash", any(all(has("login"), has("dark")), has("crash")));
  q("login OR dark AND crash", any(has("login"), all(has("dark"), has("crash"))));
  q("NOT login crash", all(not(has("login")), has("crash")));
  q("NOT login OR crash", any(not(has("login")), has("crash")));
  q("-login OR dark", any(not(has("login")), has("dark")));
  q("login OR -dark crash", any(has("login"), all(not(has("dark")), has("crash"))));
  q("status:open OR status:closed priority:1", any(status("open"), all(status("closed"), num("priority", (n) => n === 1))));
  q("status:closed priority:5 OR status:in-progress priority:1", any(all(status("closed"), num("priority", (n) => n === 5)), all(status("in-progress"), num("priority", (n) => n === 1))));
  q("a OR b c OR d", any(has("a"), all(has("b"), has("c")), has("d")));
  q("NOT a OR NOT b", any(not(has("a")), not(has("b"))));
});

test("parentheses", () => {
  q("(login OR dark) crash", all(any(has("login"), has("dark")), has("crash")));
  q("login OR (dark crash)", any(has("login"), all(has("dark"), has("crash"))));
  q("(login)", has("login"));
  q("((login))", has("login"));
  q("(login OR dark) AND NOT assignee:none", all(any(has("login"), has("dark")), not((i) => i.assignee === null)));
  q("(priority:1 OR priority:2) AND NOT assignee:none", all(num("priority", (n) => n <= 2), not((i) => i.assignee === null)));
  q("NOT (status:closed OR status:in-progress)", not(any(status("closed"), status("in-progress"))));
  q("(a OR b) (c OR d)", all(any(has("a"), has("b")), any(has("c"), has("d"))));
  q("((a OR b) AND (c OR d)) OR (e)", any(all(any(has("a"), has("b")), any(has("c"), has("d"))), has("e")));
  q("status:open(label:bug)", all(status("open"), label("bug")));
});

test("tokens can touch parentheses and quotes", () => {
  q("(login)OR(dark)", any(has("login"), has("dark")));
  q("(login)AND(crash)", all(has("login"), has("crash")));
  q("(login)(crash)", all(has("login"), has("crash")));
  q("login(crash)", all(has("login"), has("crash")));
  q("(status:open)(priority:1)", all(status("open"), num("priority", (n) => n === 1)));
  q('log"in"', all(has("log"), has("in")));
  q('"dark"mode', all(has("dark"), has("mode")));
  q('title:login"crash"', all(field("title", "login"), has("crash")));
  q('title:"dark mode"theme', all(field("title", "dark mode"), has("theme")));
  q("NOT(login)", not(has("login")));
  q("-(login)", not(has("login")));
});

test("a quoted value is one plain value, never an operator", () => {
  q('title:">"', field("title", ">"));
  q('title:"a..b"', field("title", "a..b"));
  q('title:"wait..."', field("title", "wait..."));
  q('priority:"2"', num("priority", (n) => n === 2));
  q('created:"2024-05-10"', created((d) => d === "2024-05-10"));
  q('estimate:"0.5"', est((n) => n === 0.5));
  q('label:">3"', () => false);
  q("title:wait", field("title", "wait"));
});

test("empty and blank queries match everything", () => {
  q("", () => true);
  q("   ", () => true);
  q("\n\t ", () => true);
  q("  login  ", has("login"));
});

test("results are in id order whatever order the store was built in", () => {
  const reversed = new Store([...issues].reverse());
  for (const query of ["", "login OR dark", "status:open", "NOT label:bug", "priority:<=3"]) {
    const got = ids(reversed.search(query, ctx));
    assert.deepEqual(got, [...got].sort((a, b) => a - b), query);
    assert.deepEqual(got, ids(store.search(query, ctx)), query);
  }
});

test("a few results written out in full", () => {
  assert.deepEqual(ids(store.search("login", ctx)), [1, 4, 19]);
  assert.deepEqual(ids(store.search("status:closed", ctx)), [3, 10, 12, 18]);
  assert.deepEqual(ids(store.search("priority:1", ctx)), [1, 11, 16, 21]);
  assert.deepEqual(ids(store.search("assignee:none", ctx)), [2, 8, 12, 15, 19, 24]);
  assert.deepEqual(ids(store.search("is:overdue", ctx)), [1, 7, 16, 19, 22]);
  assert.deepEqual(ids(store.search("label:Bug", ctx)), [7]);
  assert.deepEqual(ids(store.search('"dark mode" OR theme', ctx)), [2]);
  assert.deepEqual(ids(store.search("created:>=@today-7d status:open", ctx)), [6, 11, 13, 15, 20, 21, 24, 8].sort((a, b) => a - b));
});

test("the context is optional and a clock-free query does not need it", () => {
  assert.deepEqual(ids(store.search("login")), [1, 4, 19]);
  assert.deepEqual(ids(store.search("status:closed priority:5")), [3, 12, 18]);
});
