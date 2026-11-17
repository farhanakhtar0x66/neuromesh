import { QueryError } from "../errors.ts";
import type { Issue, SearchContext } from "../types.ts";

export type Predicate = (issue: Issue) => boolean;

const STATUSES = ["open", "in-progress", "closed"];
const TEXT_FIELDS = new Set(["title", "body", "status", "assignee", "reporter", "label", "is"]);
type Kind = "integer" | "number" | "date";
const NUMERIC: Record<string, Kind> = { id: "integer", priority: "integer", estimate: "number", created: "date", due: "date" };
export const FIELD_NAMES = new Set([...TEXT_FIELDS, ...Object.keys(NUMERIC)]);

const lower = (s: string): string => s.toLowerCase();

export interface Env {
  /** Today's UTC date, YYYY-MM-DD. */
  today: string;
  user: string | undefined;
}

export function envFor(context: SearchContext): Env {
  return { today: (context.clock?.() ?? new Date()).toISOString().slice(0, 10), user: context.user };
}

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d); // not Date.UTC: it reads the years 0 to 99 as 1900 to 1999
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** One end of a comparison or range, parsed for the kind of field. */
function scalar(kind: Kind, text: string, col: number, env: Env): string | number {
  if (kind === "integer") {
    if (!/^\d+$/.test(text)) throw new QueryError(`invalid integer "${text}"`, col);
    return Number(text);
  }
  if (kind === "number") {
    if (!/^\d+(\.\d+)?$/.test(text)) throw new QueryError(`invalid number "${text}"`, col);
    return Number(text);
  }
  if (isDate(text)) return text;
  const rel = /^@today(?:([+-])(\d+)([dw]))?$/.exec(text);
  if (rel) {
    if (!rel[1]) return env.today;
    const days = Number(rel[2]) * (rel[3] === "w" ? 7 : 1) * (rel[1] === "-" ? -1 : 1);
    const t = Date.parse(`${env.today}T00:00:00Z`) + days * 86_400_000;
    if (Number.isFinite(t) && Math.abs(t) < 8.64e15) return new Date(t).toISOString().slice(0, 10);
  }
  throw new QueryError(`invalid date "${text}"`, col);
}

type Op = "=" | ">" | ">=" | "<" | "<=";

function compare(op: Op, a: string | number, b: string | number): boolean {
  return op === "=" ? a === b : op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
}

function valueOf(issue: Issue, field: string): string | number | null {
  switch (field) {
    case "id": return issue.id;
    case "priority": return issue.priority;
    case "estimate": return issue.estimate;
    case "created": return issue.created;
    default: return issue.due;
  }
}

/** The predicate for `name:value`, or the QueryError that says what is wrong with it. */
export function filterPredicate(name: string, nameCol: number, colonCol: number, value: string, valueCol: number, quoted: boolean, env: Env): Predicate {
  if (!FIELD_NAMES.has(name)) throw new QueryError(`unknown field "${name}"`, name === "" ? colonCol : nameCol);
  if (value === "" && !quoted) throw new QueryError(`missing value for field "${name}"`, colonCol + 1);
  const numeric = NUMERIC[name];
  if (numeric) {
    let op: Op = "=";
    let low: string | number;
    let high: string | number | undefined;
    const m = quoted ? null : /^(>=|>|<=|<)/.exec(value);
    if (m) {
      op = m[1] as Op;
      low = scalar(numeric, value.slice(m[1]!.length), valueCol + m[1]!.length, env);
    } else if (!quoted && value.includes("..")) {
      const at = value.indexOf("..");
      low = scalar(numeric, value.slice(0, at), valueCol, env);
      high = scalar(numeric, value.slice(at + 2), valueCol + at + 2, env);
    } else {
      low = scalar(numeric, value, valueCol, env);
    }
    return (issue) => {
      const v = valueOf(issue, name);
      if (v === null) return false;
      return high === undefined ? compare(op, v, low) : v >= low && v <= high;
    };
  }
  if (!quoted && (/^[<>]/.test(value) || value.includes(".."))) throw new QueryError(`operator not allowed for field "${name}"`, valueCol);
  const v = lower(value);
  switch (name) {
    case "title": return (i) => lower(i.title).includes(v);
    case "body": return (i) => lower(i.body).includes(v);
    case "status":
      if (!STATUSES.includes(v)) throw new QueryError(`invalid value "${value}" for status`, valueCol);
      return (i) => i.status === v;
    case "assignee": return v === "none" ? (i) => i.assignee === null : (i) => i.assignee !== null && lower(i.assignee) === v;
    case "reporter": return (i) => lower(i.reporter) === v;
    case "label": return (i) => i.labels.includes(value);
    default: return macro(value, valueCol, env);
  }
}

function macro(value: string, col: number, env: Env): Predicate {
  switch (value) {
    case "open": return (i) => i.status !== "closed";
    case "closed": return (i) => i.status === "closed";
    case "mine": {
      const user = env.user;
      if (user === undefined) throw new QueryError("no current user for is:mine", col);
      return (i) => i.assignee !== null && lower(i.assignee) === lower(user);
    }
    case "overdue": return (i) => i.due !== null && i.due < env.today && i.status !== "closed";
    default: throw new QueryError(`unknown macro "${value}"`, col);
  }
}
