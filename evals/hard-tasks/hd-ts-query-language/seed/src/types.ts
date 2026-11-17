export type Status = "open" | "in-progress" | "closed";

export interface Issue {
  id: number;
  title: string;
  body: string;
  status: Status;
  /** 1 (most urgent) to 5. */
  priority: number;
  assignee: string | null;
  reporter: string;
  labels: string[];
  /** YYYY-MM-DD */
  created: string;
  /** YYYY-MM-DD, or null when there is no due date. */
  due: string | null;
  /** Hours, or null when nobody has estimated it. */
  estimate: number | null;
}

/** What a query may depend on besides the issues. */
export interface SearchContext {
  /** The current time; tests inject a fixed one. */
  clock?: () => Date;
  /** The handle of the person asking (for `is:mine`). */
  user?: string;
}
