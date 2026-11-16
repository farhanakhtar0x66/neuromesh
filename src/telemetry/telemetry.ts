// [F52 telemetry] Reports from testers to the owner, so presets and the
// architecture are judged on real work from many people, not only the owner's.
//
// Nothing is sent without the person's consent: the TUI asks once, before the
// first run (`neuromesh telemetry on|off` changes it). With consent, after each
// real run (never a demo run) one report is written to an outbox in
// ~/.neuromesh/telemetry/outbox and posted to the owner's endpoint; reports
// that cannot be sent yet stay there and go next time.
//
// A report holds the run's numbers (preset, models, efforts, turns, tokens,
// time, estimated cost, outcome, checks, escalations, features that failed),
// what was asked, the agents' final reports, and the person's rating. Never
// the code or the diff, file paths, the repository's location, or who the
// person is: an install is a random id.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { platform, release } from "node:os";
import { join } from "node:path";
import type { RunState } from "../engine/types.ts";
import type { UsageEntry } from "../usage/log.ts";
import { ENDPOINT, INGEST_KEY } from "./config.ts";

export const SCHEMA = 1;

const dir = (home: string): string => join(home, "telemetry");

/**
 * The endpoint: NEUROMESH_TELEMETRY_URL ("off" for none), else the one this
 * build ships with. Under Node's test runner the shipped one is never used,
 * so tests (and CI) cannot send reports to the real endpoint.
 */
export function endpoint(): string | undefined {
  const set = process.env.NEUROMESH_TELEMETRY_URL;
  if (set === "off") return undefined;
  const url = set ?? (process.env.NODE_TEST_CONTEXT ? undefined : ENDPOINT);
  return url && /^https:\/\//.test(url) ? url.replace(/\/$/, "") : undefined;
}

/** A random id for this install, made once. Not tied to the person. */
export function installId(home: string): string {
  const path = join(dir(home), "install-id");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dir(home), { recursive: true });
  const id = randomUUID();
  writeFileSync(path, `${id}\n`);
  return id;
}

/** Off by the environment (NEUROMESH_TELEMETRY=off) whatever was agreed. */
export function allowed(consent: string): boolean {
  return consent === "on" && process.env.NEUROMESH_TELEMETRY !== "off";
}

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface RedactOptions {
  /** "name": a path becomes "…/name" (F52, read in aggregate by the owner). "drop": it becomes "<path>" (F113, a report a person pastes in public). */
  paths?: "name" | "drop";
  /** Words that identify this machine or person (user name, host name, repository name) and what to put instead. */
  names?: [string, string][];
}

/** How many of each kind of thing a redaction took out, for the person to see. */
export type RedactStats = Record<string, number>;

// [F113 bad-run-report] Secrets: keys and tokens by their well-known shapes, then by length.
const SECRETS: RegExp[] = [
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{7,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  // Long base64-looking runs with both letters and digits.
  /(?<![A-Za-z0-9+/_])(?=[A-Za-z0-9+/_]{40,}(?![A-Za-z0-9+/_]))(?=[A-Za-z0-9+/_]*\d)(?=[A-Za-z0-9+/_]*[A-Za-z])[A-Za-z0-9+/_]{40,}={0,2}/g,
];
// name=value where the name says it is a secret and the value is not just a number.
const SECRET_ASSIGN = /(\b[\w-]*(?:api[_-]?key|token|secret|passw(?:or)?d|credential)[\w-]*["']?\s*[:=]\s*["']?)(?!\d+\b|<secret>)[^\s"',;]{8,}/gi;
// Each pattern below starts only at the start of a run of word characters (a lookbehind), so one very long
// token is read once, not once per character: a report may hold a 50,000-character line.
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /\b(?:https?|ftp|ssh|git|file):\/\/[^\s"'`<>)\]]+/g;
const HOST = /(?<![\w.-])(?:(?:[a-z0-9-]+\.){1,8}(?:local|lan|internal|home|corp|localdomain|com|net|org|io|dev|app|ai|cloud)|\d{1,3}(?:\.\d{1,3}){3})(?![\w-])/gi;
const EXT = "ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|sh|zsh|bash|css|scss|html|yml|yaml|toml|lock|txt|log|sql|ini|cfg|xml|csv|patch|diff|vue|svelte";
const WIN_PATH = /\b[A-Za-z]:\\(?:[^\s"'`<>|\\]+\\)*[^\s"'`<>|\\]*/g;
const HOME_PATH = /\/(?:Users|home)\/[^\s/]+(?:\/[^\s"'`<>()|,;]*)*/g;
const ABS_PATH = /(?<![\w.~/:@-])\/[\w.@+\-]+(?:\/[\w.@+\-]*)*(?::\d+){0,2}/g;
const TILDE_PATH = /(?<!\w)~(?:\/[\w.@+\-]*)+/g;
const REL_PATH = /(?<![\w./@-])(?:\.{1,2}\/)?[\w.@+\-]+(?:\/[\w.@+\-]+)+\/?(?::\d+){0,2}/g;
const FILE_NAME = new RegExp(`(?<![\\w/@.-])(?:[\\w@.-]*\\w)?\\.(?:${EXT})\\b(?::\\d+){0,2}`, "g");
const DOT_ENV = /(?<![\w/-])\.env(?:\.[\w-]+)?\b/g;
const TOP_DIRS = /^(?:\.{1,2}\/)?(?:src|test|tests|lib|app|apps|packages|docs|evals|bin|scripts|node_modules|dist|build|public|pkg|cmd|internal)\//;
const FRAMEWORKS = /^(?:node|next|vue|react|three|d3|express|nuxt|chart|alpine|backbone|ember)\.js$/i;

/** Code the model or a tool printed: fenced blocks and diff hunks. Neither belongs in a report. */
function stripCode(text: string, stats?: RedactStats): string {
  const count = (): void => void (stats && (stats.code = (stats.code ?? 0) + 1));
  const out: string[] = [];
  let inDiff = false;
  for (const line of text.replace(/```[\s\S]*?(?:```|$)/g, () => (count(), "<code removed>")).split("\n")) {
    const header = /^(?:diff --git |@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|--- (?:a\/|\/dev\/null)|\+\+\+ (?:b\/|\/dev\/null))/.test(line);
    if (header && !inDiff) {
      inDiff = true;
      count();
      out.push("<diff removed>");
      continue;
    }
    if (inDiff && /^(?:[+\- \\]|@@|diff |index |new file|deleted file|old mode|new mode|similarity|rename |Binary files)/.test(line) && line !== "") continue;
    inDiff = false;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * [F52 telemetry] [F113 bad-run-report] The one redactor. Takes out what a
 * report must not hold: code (fenced blocks and diff hunks), keys and tokens,
 * emails, URLs and host names, the person's and machine's names, and file
 * locations (as "…/name" or "<path>"). The text comes back with the same words
 * around the holes, so it still reads. `stats` counts what was taken out.
 */
export function redact(text: string, options: RedactOptions = {}, stats?: RedactStats): string {
  const mode = options.paths ?? "name";
  const swap = (kind: string, to: string) => (): string => ((stats && (stats[kind] = (stats[kind] ?? 0) + 1)), to);
  let t = stripCode(text, stats);
  t = t.replace(EMAIL, swap("email", "<email>"));
  for (const re of SECRETS) t = t.replace(re, swap("secret", "<secret>"));
  t = t.replace(SECRET_ASSIGN, (_all, head: string) => (swap("secret", "")(), `${head}<secret>`));
  if (mode === "name") return t.replace(/(?:\/(?:Users|home)\/[^\s/]+|~)(?:\/[^\s/]+)*\/([^\s/]+)/g, "…/$1");
  t = t.replace(URL_RE, swap("url", "<url>"));
  // A path ends where the sentence's punctuation starts: "in src/a.ts." keeps its full stop.
  const path = (m: string): string => ((stats && (stats.path = (stats.path ?? 0) + 1)), `<path>${/[.,;:]+$/.exec(m)?.[0] ?? ""}`);
  t = t.replace(WIN_PATH, path).replace(HOME_PATH, path).replace(TILDE_PATH, path).replace(ABS_PATH, path);
  t = t.replace(REL_PATH, (m) => {
    const segments = m.split("/").filter(Boolean);
    const named = segments.some((s) => /\.[A-Za-z]{1,6}(?::\d+)*[.,;:]*$/.test(s));
    const deep = segments.length >= 3 && segments.some((s) => /[A-Za-z]/.test(s));
    return named || deep || TOP_DIRS.test(m) ? path(m) : m;
  });
  t = t.replace(FILE_NAME, (m) => (FRAMEWORKS.test(m) ? m : (swap("path", "<path>")(), "<path>")));
  t = t.replace(DOT_ENV, swap("path", "<path>"));
  t = t.replace(HOST, swap("host", "<host>"));
  // The person's, machine's and repository's names last: a path holding them is already one <path>.
  for (const [word, as] of options.names ?? []) {
    if (word.length < 3) continue;
    t = t.replace(new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "gi"), swap("name", as));
  }
  return t;
}

/** [F52 telemetry] What a tester's run report holds of free text: paths keep their last name, the rest is as `redact`. */
function scrub(text: string): string {
  return redact(text, { paths: "name" });
}

export function packageVersion(): string {
  return version();
}

export interface RunReport {
  schema: number;
  type: "run";
  install: string;
  version: string;
  os: string;
  at: string;
  run: Omit<UsageEntry, "repo"> & { request: string; finalReport?: string; mode?: string; failure?: string; reason?: string; follows?: boolean };
}

export interface RatingReport {
  schema: number;
  type: "rating";
  install: string;
  version: string;
  at: string;
  run: string;
  score: number;
  note?: string;
}

/** What a run's report says. */
export function runReport(home: string, state: RunState, entry: UsageEntry): RunReport {
  const { repo: _repo, ...rest } = entry;
  void _repo;
  const finalReport = (state.tasks ?? [])
    .map((t) => t.report?.summary?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8_000);
  return {
    schema: SCHEMA,
    type: "run",
    install: installId(home),
    version: version(),
    os: `${platform()} ${release()}`,
    at: new Date().toISOString(),
    run: {
      ...rest,
      request: scrub(entry.request).slice(0, 4_000),
      finalReport: finalReport ? scrub(finalReport) : undefined,
      mode: state.mode,
      failure: state.failure,
      reason: state.reason ? scrub(state.reason).slice(0, 500) : undefined,
      follows: state.follows !== undefined,
    },
  };
}

export function ratingReport(home: string, run: string, score: number, note?: string): RatingReport {
  return { schema: SCHEMA, type: "rating", install: installId(home), version: version(), at: new Date().toISOString(), run, score, note: note ? scrub(note).slice(0, 2_000) : undefined };
}

/** Keep a report until it is sent. */
export function queue(home: string, report: RunReport | RatingReport): string {
  const out = join(dir(home), "outbox");
  mkdirSync(out, { recursive: true });
  const name = `${report.at.replace(/[:.]/g, "-")}-${report.type}-${randomUUID().slice(0, 8)}.json`;
  writeFileSync(join(out, name), JSON.stringify(report));
  return name;
}

export function outbox(home: string): string[] {
  const out = join(dir(home), "outbox");
  return existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".json")).sort() : [];
}

/** What the endpoint's answer means for a tester, in words that say what to do. */
function problemFor(status: number): string {
  if (status === 401) return "the endpoint did not accept this build's key (401): update Neuromesh, then it will be sent";
  if (status === 429 || status >= 500) return `the endpoint is busy or down (${status}); it will be sent next time`;
  return `the endpoint refused a report (${status})`;
}

/**
 * Send what is in the outbox. A report is removed only once the endpoint took
 * it; with no endpoint, or offline, everything waits for next time. A report
 * the endpoint refuses for good (400 not a report, 413 too large) is moved to
 * ~/.neuromesh/telemetry/rejected so it cannot block the ones behind it.
 * `problem` says why anything is still waiting, for the person to read.
 */
export async function flush(home: string, fetcher: typeof fetch = fetch): Promise<{ sent: number; waiting: number; rejected?: number; problem?: string }> {
  const url = endpoint();
  const files = outbox(home);
  if (!url || files.length === 0) return { sent: 0, waiting: files.length };
  let sent = 0;
  let rejected = 0;
  let problem: string | undefined;
  for (const f of files) {
    const path = join(dir(home), "outbox", f);
    try {
      const response = await fetcher(`${url}/v1/report`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-neuromesh-key": INGEST_KEY },
        body: readFileSync(path, "utf8"),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        rmSync(path);
        sent += 1;
      } else if (response.status === 400 || response.status === 413) {
        mkdirSync(join(dir(home), "rejected"), { recursive: true });
        renameSync(path, join(dir(home), "rejected", f));
        rejected += 1;
        problem = problemFor(response.status);
      } else {
        problem = problemFor(response.status);
        break;
      }
    } catch {
      problem = "could not reach the endpoint (offline?); it will be sent next time";
      break;
    }
  }
  return { sent, waiting: files.length - sent - rejected, ...(rejected ? { rejected } : {}), ...(problem ? { problem } : {}) };
}

/** For the owner: fetch every report since a time into ~/.neuromesh/telemetry/inbox. */
export async function pull(home: string, token: string, since = "", fetcher: typeof fetch = fetch): Promise<number> {
  const url = endpoint();
  if (!url) throw new Error("No telemetry endpoint set (src/telemetry/config.ts, or NEUROMESH_TELEMETRY_URL).");
  const inbox = join(dir(home), "inbox");
  mkdirSync(inbox, { recursive: true });
  let total = 0;
  // The endpoint gives at most 1000 reports a call, oldest first: go on from the last one's time.
  for (;;) {
    const response = await fetcher(`${url}/v1/reports?since=${encodeURIComponent(since)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (response.status === 401) throw new Error("The endpoint did not accept the admin token (401). Use the one telemetry-endpoint/deploy.sh kept in ~/.neuromesh/telemetry/admin-token, or set NEUROMESH_TELEMETRY_ADMIN.");
    if (!response.ok) throw new Error(`The endpoint said ${response.status} ${response.statusText}`.trim());
    const reports = (await response.json()) as { id: string; received?: string; body: string }[];
    for (const r of reports) writeFileSync(join(inbox, `${r.id}.json`), r.body);
    total += reports.length;
    const last = reports[reports.length - 1]?.received;
    if (reports.length < 1000 || !last || last === since) break;
    since = last;
  }
  return total;
}

/** The notice shown before asking. */
export const NOTICE = [
  "Neuromesh is in testing. Would you share how it does on your work with its author?",
  "After each run, a report is sent: the preset and models, tokens, time, estimated cost, how it ended, what you asked, the agents' final reports, and your rating if you give one.",
  "Never your code or diffs, file locations, or who you are (an install is a random id).",
  "Change it any time: /settings, `neuromesh telemetry off`, or NEUROMESH_TELEMETRY=off.",
];
