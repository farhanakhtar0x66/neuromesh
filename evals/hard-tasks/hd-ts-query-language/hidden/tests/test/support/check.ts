import assert from "node:assert/strict";
import { QueryError, Store } from "../../src/index.ts";
import type { Issue, SearchContext } from "../../src/index.ts";
import { clock, ids, issues } from "./fixture.ts";

export const store = new Store(issues);
export const ctx: SearchContext = { clock, user: "ann" };

/** Lower-cased substring of the title or the body: what a bare word means (docs/QUERY.md, "What a term matches"). */
export const has = (text: string) => (i: Issue): boolean => i.title.toLowerCase().includes(text.toLowerCase()) || i.body.toLowerCase().includes(text.toLowerCase());
export const not = (p: (i: Issue) => boolean) => (i: Issue): boolean => !p(i);
export const all = (...ps: ((i: Issue) => boolean)[]) => (i: Issue): boolean => ps.every((p) => p(i));
export const any = (...ps: ((i: Issue) => boolean)[]) => (i: Issue): boolean => ps.some((p) => p(i));

/** The query must select exactly the issues the predicate picks (in id order). */
export function expectQuery(query: string, predicate: (i: Issue) => boolean, context: SearchContext = ctx): void {
  const want = ids(issues.filter(predicate));
  let got: number[];
  try {
    got = ids(store.search(query, context));
  } catch (e) {
    assert.fail(`${JSON.stringify(query)} threw ${(e as Error).name}: ${(e as Error).message}`);
  }
  assert.deepEqual(got, want, `query ${JSON.stringify(query)}`);
}

/** The query must be rejected with this message at this column. */
export function expectError(query: string, message: string, column: number, context: SearchContext = ctx): void {
  try {
    store.search(query, context);
  } catch (e) {
    assert.ok(e instanceof QueryError, `${JSON.stringify(query)} threw ${(e as Error).name}, not QueryError`);
    assert.deepEqual({ message: e.message, column: e.column }, { message, column }, `query ${JSON.stringify(query)}`);
    return;
  }
  assert.fail(`${JSON.stringify(query)} was accepted; wanted ${message} at column ${column}`);
}
