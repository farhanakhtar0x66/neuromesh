import { compileQuery } from "./query/parser.ts";
import type { Issue, SearchContext } from "./types.ts";

/** An in-memory collection of issues, always in ascending id order. */
export class Store {
  private issues: Issue[];

  constructor(issues: Issue[]) {
    this.issues = [...issues].sort((a, b) => a.id - b.id);
  }

  all(): Issue[] {
    return [...this.issues];
  }

  get(id: number): Issue | undefined {
    return this.issues.find((i) => i.id === id);
  }

  /** Issues matching the query (docs/QUERY.md), in id order. Plain words still mean: in the title or the body. Throws QueryError. */
  search(query: string, context: SearchContext = {}): Issue[] {
    return this.issues.filter(compileQuery(query, context));
  }
}
