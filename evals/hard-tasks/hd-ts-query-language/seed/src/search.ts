import type { Issue } from "./types.ts";

/**
 * The search track has always had: every whitespace-separated word of `text` must appear (ignoring case) in the title or in
 * the body. An empty text matches everything.
 */
export function searchSubstring(issues: Issue[], text: string): Issue[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return issues.filter((issue) => {
    const title = issue.title.toLowerCase();
    const body = issue.body.toLowerCase();
    return words.every((w) => title.includes(w) || body.includes(w));
  });
}
