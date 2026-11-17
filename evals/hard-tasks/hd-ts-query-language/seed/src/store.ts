import { searchSubstring } from "./search.ts";
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

  /** Issues matching `text`, in id order. `text` is a list of words, all of which must appear in the title or the body. */
  search(text: string, _context: SearchContext = {}): Issue[] {
    return searchSubstring(this.issues, text);
  }
}
