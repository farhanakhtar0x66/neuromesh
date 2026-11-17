import type { Issue } from "./types.ts";

/** "#12 [open] P2 @ann Fix the login crash" ("@-" when nobody is assigned). */
export function formatIssue(issue: Issue): string {
  return `#${issue.id} [${issue.status}] P${issue.priority} @${issue.assignee ?? "-"} ${issue.title}`;
}

export function formatList(issues: Issue[]): string[] {
  return [...issues.map(formatIssue), `${issues.length} ${issues.length === 1 ? "issue" : "issues"}`];
}
