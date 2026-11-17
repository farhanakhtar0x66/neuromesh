// Every error message of docs/QUERY.md with its column, and the order in which problems are found.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryError } from "../src/index.ts";
import { ctx, expectError as e, store } from "./support/check.ts";

test("quoted strings: unterminated and bad escapes", () => {
  e('"abc', "unterminated quoted string", 1);
  e('login "abc', "unterminated quoted string", 7);
  e('title:"abc', "unterminated quoted string", 7);
  e('-"abc', "unterminated quoted string", 2);
  e('"abc\\', "unterminated quoted string", 1);
  e('"abc\\"', "unterminated quoted string", 1);
  e('"a\\qb"', 'invalid escape "\\q"', 3);
  e('login "a\\xb"', 'invalid escape "\\x"', 9);
  e('title:"a\\qb"', 'invalid escape "\\q"', 9);
  e('"ok" "a\\ b"', 'invalid escape "\\ "', 8);
});

test("unknown fields and missing values", () => {
  e("foo:bar", 'unknown field "foo"', 1);
  e("login foo:bar", 'unknown field "foo"', 7);
  e("-foo:bar", 'unknown field "foo"', 2);
  e("(foo:bar)", 'unknown field "foo"', 2);
  e("Status:open", 'unknown field "Status"', 1);
  e("labels:bug", 'unknown field "labels"', 1);
  e(":abc", 'unknown field ""', 1);
  e("a :b", 'unknown field ""', 3);
  e('foo:"bar"', 'unknown field "foo"', 1);
  e("foo:", 'unknown field "foo"', 1);
  e("status:", 'missing value for field "status"', 8);
  e("status: open", 'missing value for field "status"', 8);
  e("login status:", 'missing value for field "status"', 14);
  e("(status:)", 'missing value for field "status"', 9);
  e("(created:", 'missing value for field "created"', 10);
  e("title:(a)", 'missing value for field "title"', 7);
});

test("status values", () => {
  e("status:done", 'invalid value "done" for status', 8);
  e("login status:done", 'invalid value "done" for status', 14);
  e('status:"in progress"', 'invalid value "in progress" for status', 8);
  e("status:openn", 'invalid value "openn" for status', 8);
  e("status:Done", 'invalid value "Done" for status', 8);
});

test("dates", () => {
  e("created:yesterday", 'invalid date "yesterday"', 9);
  e("created:2023-02-29", 'invalid date "2023-02-29"', 9);
  e("created:2024-02-30", 'invalid date "2024-02-30"', 9);
  e("created:2024-5-1", 'invalid date "2024-5-1"', 9);
  e("created:>=2024-13-01", 'invalid date "2024-13-01"', 11);
  e("created:>2024-13-01", 'invalid date "2024-13-01"', 10);
  e("due:@today-x", 'invalid date "@today-x"', 5);
  e("due:@today+3m", 'invalid date "@today+3m"', 5);
  e("due:@today+d", 'invalid date "@today+d"', 5);
  e("due:@tomorrow", 'invalid date "@tomorrow"', 5);
  e("due:@today-7d0", 'invalid date "@today-7d0"', 5);
  e("created:2024-01-01..bogus", 'invalid date "bogus"', 21);
  e("created:bad..bogus", 'invalid date "bad"', 9);
  e('created:"yesterday"', 'invalid date "yesterday"', 9);
  e('created:"2024-01-01..2024-02-01"', 'invalid date "2024-01-01..2024-02-01"', 9);
  e("created:@today-1w..@today+x", 'invalid date "@today+x"', 20);
});

test("integers and numbers", () => {
  e("priority:high", 'invalid integer "high"', 10);
  e("priority:2.5", 'invalid integer "2.5"', 10);
  e("priority:-1", 'invalid integer "-1"', 10);
  e("priority:>=x", 'invalid integer "x"', 12);
  e("priority:<x", 'invalid integer "x"', 11);
  e("priority:1..x", 'invalid integer "x"', 13);
  e("priority:x..1", 'invalid integer "x"', 10);
  e("priority:..3", 'invalid integer ""', 10);
  e('priority:">=3"', 'invalid integer ">=3"', 10);
  e("id:1.5", 'invalid integer "1.5"', 4);
  e("id:>=1..3", 'invalid integer "1..3"', 6);
  e("login id:abc", 'invalid integer "abc"', 10);
  e("estimate:abc", 'invalid number "abc"', 10);
  e("estimate:-1", 'invalid number "-1"', 10);
  e("estimate:.5", 'invalid number ".5"', 10);
  e("estimate:1.", 'invalid number "1."', 10);
  e("estimate:1..", 'invalid number ""', 13);
  e("estimate:1.5..x", 'invalid number "x"', 15);
  e("estimate:>=", 'invalid number ""', 12);
  e("estimate:1...3", 'invalid number ".3"', 13);
});

test("operators where they are not allowed, and macros", () => {
  e("title:>x", 'operator not allowed for field "title"', 7);
  e("title:<=x", 'operator not allowed for field "title"', 7);
  e("body:a..b", 'operator not allowed for field "body"', 6);
  e("status:>open", 'operator not allowed for field "status"', 8);
  e("assignee:>ann", 'operator not allowed for field "assignee"', 10);
  e("reporter:a..b", 'operator not allowed for field "reporter"', 10);
  e("label:a..b", 'operator not allowed for field "label"', 7);
  e("login label:<x", 'operator not allowed for field "label"', 13);
  e("is:>3", 'operator not allowed for field "is"', 4);
  e("is:foo", 'unknown macro "foo"', 4);
  e("is:Open", 'unknown macro "Open"', 4);
  e("is:", 'missing value for field "is"', 4);
  e('is:"nope"', 'unknown macro "nope"', 4);
  e("login is:overduee", 'unknown macro "overduee"', 10);
});

test("is:mine needs a user", () => {
  e("is:mine", "no current user for is:mine", 4, { clock: ctx.clock });
  e("login is:mine", "no current user for is:mine", 10, { clock: ctx.clock });
  e("-is:mine", "no current user for is:mine", 5, {});
});

test("parentheses", () => {
  e(")", 'unexpected ")"', 1);
  e("login)", 'unexpected ")"', 6);
  e("(login))", 'unexpected ")"', 8);
  e("()", 'unexpected ")"', 2);
  e("a OR )", 'unexpected ")"', 6);
  e("NOT )", 'unexpected ")"', 5);
  e("login -)", 'unexpected ")"', 8);
  e("(login", 'missing ")"', 1);
  e("a (b (c)", 'missing ")"', 3);
  e("((a)", 'missing ")"', 1);
  e("(a OR (b AND c)", 'missing ")"', 1);
  e("status:open (a", 'missing ")"', 13);
});

test("keywords in the wrong place, and a query that ends too soon", () => {
  e("AND login", 'unexpected "AND"', 1);
  e("OR", 'unexpected "OR"', 1);
  e("login AND OR dark", 'unexpected "OR"', 11);
  e("login OR OR", 'unexpected "OR"', 10);
  e("login OR AND", 'unexpected "AND"', 10);
  e("NOT AND", 'unexpected "AND"', 5);
  e("(OR a)", 'unexpected "OR"', 2);
  e("login AND AND crash", 'unexpected "AND"', 11);
  e("login OR", "unexpected end of query", 9);
  e("login AND", "unexpected end of query", 10);
  e("login AND  ", "unexpected end of query", 12);
  e("NOT", "unexpected end of query", 4);
  e("-login OR NOT", "unexpected end of query", 14);
  e("(login AND", "unexpected end of query", 11);
  e('"a" AND', "unexpected end of query", 8);
  e("(NOT", "unexpected end of query", 5);
});

test("only the first problem is reported, reading from the left, one term at a time", () => {
  e('created:foo "unterminated', 'invalid date "foo"', 9);
  e('status:bad "x', 'invalid value "bad" for status', 8);
  e('(a b "x', "unterminated quoted string", 6);
  e("foo:1 priority:x", 'unknown field "foo"', 1);
  e("priority:x foo:1", 'invalid integer "x"', 10);
  e("login ) foo:bar", 'unexpected ")"', 7);
  e("(a foo:bar", 'unknown field "foo"', 4);
  e("a AND foo:bar OR", 'unknown field "foo"', 7);
  e("OR foo:bar", 'unexpected "OR"', 1);
  e("login OR created:nope AND", 'invalid date "nope"', 18);
  e('NOT created:foo "x', 'invalid date "foo"', 13);
  e("title:>x label:a..b", 'operator not allowed for field "title"', 7);
  e("status:>x", 'operator not allowed for field "status"', 8);
});

test("QueryError: a real Error subclass with a 1-based column", () => {
  try {
    store.search("login AND", ctx);
    assert.fail("accepted");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err instanceof QueryError);
    assert.equal((err as QueryError).name, "QueryError");
    assert.equal((err as QueryError).column, 10);
    assert.equal((err as QueryError).message, "unexpected end of query");
  }
});

test("a good query does not throw, however odd", () => {
  for (const query of ["a", "-", "- -", "a - b", "(a)", 'a"b"', "title:x:y", "a-b", "x:y".replace("x", "title"), '""', "NOT NOT NOT a", "((((a))))", "a\\b", "100%", "+", "*", "a,b"]) {
    assert.doesNotThrow(() => store.search(query, ctx), query);
  }
});
