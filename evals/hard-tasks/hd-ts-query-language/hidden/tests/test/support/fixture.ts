// The store every hidden query runs against, and the clock. Today is 2024-05-10 (a Friday), 15:30 UTC.

import type { Issue } from "../../src/index.ts";

type Row = [id: number, title: string, body: string, status: Issue["status"], priority: number, assignee: string | null, reporter: string, labels: string[], created: string, due: string | null, estimate: number | null];

const rows: Row[] = [
  [1, "Login page crashes on submit", "Clicking Sign in with an empty password throws a TypeError.", "open", 1, "ann", "bob", ["bug", "auth"], "2024-04-01", "2024-04-15", 4],
  [2, "Add dark mode", "Users keep asking for a dark theme in the settings.", "open", 3, null, "carol", ["feature", "ui"], "2024-04-20", null, 8],
  [3, "Fix typo in README", "The word recieve is misspelled in the install section.", "closed", 5, "bob", "ann", ["docs"], "2024-03-02", "2024-03-05", 0.5],
  [4, "Upgrade the login library", "Security fix, see the advisory from last week.", "in-progress", 2, "ann", "carol", ["security", "auth"], "2024-05-01", "2024-05-20", 2],
  [5, "Slow search on large projects", "Searching a project with 10k issues takes several seconds.", "open", 4, "carol", "bob", ["performance"], "2024-02-11", null, null],
  [6, "Logout button misaligned", "On mobile the Log out button overlaps the footer.", "open", 4, "bob", "dave", ["bug", "ui"], "2024-05-08", "2024-05-12", 1],
  [7, "Cache: stale entries after deploy", "Entries are served from the old cache for up to an hour. See the R AND D notes.", "in-progress", 2, "dave", "ann", ["bug", "Bug", "backend"], "2024-05-09", "2024-05-09", 3],
  [8, "Wait... what does re-open do?", "Either A OR B should happen, the docs do not say.", "open", 3, null, "carol", ["question", "docs"], "2024-05-03", null, 1.5],
  [9, 'Quote "smart" handling', 'Typographic quotes break the "export" step; the path C:\\temp is also wrong.', "open", 2, "ann", "dave", ["bug", "good first issue"], "2024-04-28", "2024-05-30", 2.5],
  [10, "Café menu translation", "The word Café is shown as Cafe in the French locale.", "closed", 4, "carol", "ann", ["i18n", "Docs"], "2024-01-15", "2024-02-01", 1],
  [11, "Email notifications duplicated", "Two emails per comment; reported by support.", "open", 1, "ann", "carol", ["bug", "backend"], "2024-05-10", "2024-05-11", 6],
  [12, "Update dependencies", "Routine update of the dev dependencies and the lock file.", "closed", 5, null, "bob", ["chore"], "2024-05-02", null, 0.5],
  [13, "Rate limiter off by one", "The limiter allows 101 requests per minute instead of 100; and tests are flaky.", "open", 2, "bob", "ann", ["bug", "backend", "security"], "2024-05-07", "2024-05-10", 3],
  [14, "Dashboard widgets reorder", "Drag and drop does not persist.", "open", 3, "carol", "dave", ["feature", "ui"], "2024-03-20", "2024-06-01", 13],
  [15, "Typo: recieve vs receive", "Same as the README one, in the settings page.", "open", 5, null, "ann", ["docs", "good first issue"], "2024-05-06", null, 0.5],
  [16, "Export to CSV fails for emoji", "Rows with emoji raise an encoding error. Mentions OR in the filter docs.", "in-progress", 1, "ann", "bob", ["bug"], "2024-05-04", "2024-05-06", 5],
  [17, "Audit log retention", "Keep audit logs for 400 days; legal asked on 2024-02-29 (leap day).", "open", 3, "dave", "carol", ["compliance"], "2024-02-29", "2024-12-31", 20],
  [18, "Printer driver note", "Not related to the product; this is to test not matching anything unusual: zzz.", "closed", 5, "bob", "bob", [], "2023-12-31", null, null],
  [19, "login with SSO", "Support single sign-on; the login flow needs a redirect.", "open", 2, null, "dave", ["feature", "auth"], "2024-04-10", "2024-04-30", 10],
  [20, "Docs: query language", "Document the AND OR NOT operators and the `-` prefix, e.g. -label:docs.", "open", 4, "ann", "carol", ["docs"], "2024-05-09", null, 2],
  [21, "Crash when title is empty", "App crashes. Steps: create an issue with an empty title.", "open", 1, "bob", "ann", ["bug"], "2024-05-10", "2024-05-10", 0.5],
  [22, "Mobile app: crash on rotate", "Crash happens only on Android; the iOS app is fine.", "open", 2, "carol", "bob", ["bug", "mobile"], "2024-04-15", "2024-05-01", 5],
  [23, "Offline mode", "Cache issues locally for offline use.", "open", 3, "ann", "carol", ["feature"], "2024-01-05", null, 21],
  [24, "Rename 'status' labels", "status:open style labels confuse the importer.", "open", 4, null, "ann", ["chore", "status"], "2024-05-05", "2024-05-15", 1],
];

export const issues: Issue[] = rows.map(([id, title, body, status, priority, assignee, reporter, labels, created, due, estimate]) => ({
  id, title, body, status, priority, assignee, reporter, labels, created, due, estimate,
}));

export const TODAY = "2024-05-10";
export const clock = (): Date => new Date("2024-05-10T15:30:00Z");

export const ids = (list: Issue[]): number[] => list.map((i) => i.id);
