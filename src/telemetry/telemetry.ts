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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/** Paths in free text become "…/name", so a report never says where on whose disk. */
function scrub(text: string): string {
  return text.replace(/(?:\/(?:Users|home)\/[^\s/]+|~)(?:\/[^\s/]+)*\/([^\s/]+)/g, "…/$1");
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

/**
 * Send what is in the outbox. A report is removed only once the endpoint took
 * it; with no endpoint, or offline, everything waits for next time.
 */
export async function flush(home: string, fetcher: typeof fetch = fetch): Promise<{ sent: number; waiting: number }> {
  const url = endpoint();
  const files = outbox(home);
  if (!url || files.length === 0) return { sent: 0, waiting: files.length };
  let sent = 0;
  for (const f of files) {
    const path = join(dir(home), "outbox", f);
    try {
      const response = await fetcher(`${url}/v1/report`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-neuromesh-key": INGEST_KEY },
        body: readFileSync(path, "utf8"),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) break;
      rmSync(path);
      sent += 1;
    } catch {
      break;
    }
  }
  return { sent, waiting: files.length - sent };
}

/** For the owner: fetch every report since a time into ~/.neuromesh/telemetry/inbox. */
export async function pull(home: string, token: string, since = "", fetcher: typeof fetch = fetch): Promise<number> {
  const url = endpoint();
  if (!url) throw new Error("No telemetry endpoint set (src/telemetry/config.ts, or NEUROMESH_TELEMETRY_URL).");
  const response = await fetcher(`${url}/v1/reports?since=${encodeURIComponent(since)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The endpoint said ${response.status} ${response.statusText}`);
  const reports = (await response.json()) as { id: string; body: string }[];
  const inbox = join(dir(home), "inbox");
  mkdirSync(inbox, { recursive: true });
  for (const r of reports) writeFileSync(join(inbox, `${r.id}.json`), r.body);
  return reports.length;
}

/** The notice shown before asking. */
export const NOTICE = [
  "Neuromesh is in testing. Would you share how it does on your work with its author?",
  "After each run, a report is sent: the preset and models, tokens, time, estimated cost, how it ended, what you asked, the agents' final reports, and your rating if you give one.",
  "Never your code or diffs, file locations, or who you are (an install is a random id).",
  "Change it any time: /settings, `neuromesh telemetry off`, or NEUROMESH_TELEMETRY=off.",
];
