// [F113 bad-run-report] `neuromesh report [run] [--note "..."]`: a tester's way to
// report a bad run in one command (plan item B5). It writes
// ~/.neuromesh/reports/<run-id>.md, a file the tester reads and pastes into a
// GitHub issue. Nothing is sent anywhere by this code.
//
// What the file holds: the version, OS, Node and preset and models; how the run
// ended and which features failed; the run's event timeline (types, tiers,
// models, stop reasons, durations, token counts, check names with pass or
// fail); the agents' final reports; the request; and the tester's note.
//
// What it never holds: code, diffs, file locations, the person's or the
// machine's name, emails, hosts, keys. Every piece of text goes through
// `redact` (src/telemetry/telemetry.ts), the redactor F52 uses for tester
// reports, and the whole file goes through it once more at the end. The timeline
// is built from a short list of fields per event, not from the event as it was
// logged, so a field added to an event later cannot leak into a report.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform, release, userInfo } from "node:os";
import { basename, join } from "node:path";
import { runPaths } from "../engine/store.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { entryFor } from "../usage/log.ts";
import type { UsageEntry } from "../usage/log.ts";
import { classify } from "./summary.ts";
import type { RunView } from "./summary.ts";
import { packageVersion, redact } from "./telemetry.ts";
import type { RedactStats } from "./telemetry.ts";

/** About 30 KB: small enough to paste into an issue. */
export const REPORT_MAX_BYTES = 30_000;

/** Space kept for the banner, which is made after the body (it says what the redaction took out). */
const BANNER_ROOM = 700;

export const ISSUES_URL = "https://github.com/farhanakhtar0x66/neuromesh/issues/new";

export interface Environment {
  version: string;
  os: string;
  node: string;
}

export function environment(): Environment {
  return { version: packageVersion(), os: `${platform()} ${release()} ${arch()}`, node: process.version };
}

/** Words that say who or where, and what to put in their place. Short ones are left alone (they would eat ordinary words). */
export function identityNames(repo: string): [string, string][] {
  const names: [string, string][] = [];
  const add = (word: string | undefined, as: string): void => {
    if (word && word.length >= 3) names.push([word, as]);
  };
  try {
    add(userInfo().username, "<user>");
  } catch {
    // No user entry for this process: the home folder's name is tried below.
  }
  add(basename(homedir()), "<user>");
  const host = hostname();
  add(host, "<host>");
  add(host.split(".")[0], "<host>");
  add(basename(repo), "<repo>");
  return names;
}

export function readEvents(path: string): { events: NeuromeshEvent[]; unreadable: number } {
  const events: NeuromeshEvent[] = [];
  let unreadable = 0;
  if (!existsSync(path)) return { events, unreadable };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as unknown;
      if (typeof e === "object" && e !== null && typeof (e as { type?: unknown }).type === "string") events.push(e as NeuromeshEvent);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { events, unreadable };
}

export function reportPath(home: string, runId: string): string {
  return join(home, "reports", `${runId}.md`);
}

// --- the timeline -------------------------------------------------------------------------

const oneLine = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};
const count = (v: number | undefined): string => (v === undefined ? "unknown" : v.toLocaleString("en-US"));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function duration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  const r = Math.round(s);
  if (r < 60) return `${r}s`;
  const m = Math.floor(r / 60);
  return m < 60 ? `${m}m ${String(r % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Fields of an event shown as `name=value` when they are a short string, a number or a boolean. */
const PLAIN = ["feature", "key", "task", "role", "kind", "surface", "tier", "cascadeTier", "backend", "effort", "stop", "phase", "round", "step", "status", "verdict", "stage", "mode", "preset", "ok", "method", "files", "turn"];
/** Fields of an event shown as quoted text, redacted and cut: what went wrong, in the tool's own words. */
const TEXT = ["message", "detail", "reason", "problem", "error"];
/** Events that are what an agent ran or read: shown only as a count. */
const LEFT_OUT = new Set(["agent.activity", "agent.preamble"]);

export interface Timeline {
  lines: string[];
  /** Events not given a line (agents' own activity). */
  leftOut: number;
}

export function timeline(events: NeuromeshEvent[], clean: (text: string) => string): Timeline {
  const first = Date.parse(events[0]?.t ?? "");
  const lines: string[] = [];
  let leftOut = 0;
  const model = (v: unknown): string | undefined => {
    if (typeof v !== "string" || v === "") return undefined;
    // A model id is short and has no spaces; "provider/model" is one. Anything else is redacted like text.
    return /^[A-Za-z0-9][\w.:+-]*(?:\/[\w.:+-]+){0,2}$/.test(v) && v.length <= 80 && !/\.(?:ts|js|json|md|py)$/.test(v) ? v : clean(v);
  };
  for (const e of events) {
    if (LEFT_OUT.has(e.type)) {
      leftOut += 1;
      continue;
    }
    const parts: string[] = [];
    for (const k of PLAIN) {
      const v = e[k];
      if (typeof v === "string" && v !== "") parts.push(`${k}=${oneLine(clean(v), 60)}`);
      else if (isNum(v) || typeof v === "boolean") parts.push(`${k}=${v}`);
    }
    const m = model(e.model);
    if (m) parts.push(`model=${m}`);
    for (const k of ["worker", "orchestrator"]) {
      const r = e[k] as { backend?: unknown; model?: unknown; effort?: unknown } | undefined;
      if (r && typeof r === "object") parts.push(`${k}=${[r.backend, model(r.model), r.effort].filter((x) => typeof x === "string" && x !== "").join(":")}`);
    }
    if (isNum(e.confidence)) parts.push(`confidence=${e.confidence.toFixed(2)}`);
    if (isNum(e.durationMs)) parts.push(duration(e.durationMs));
    if (e.type === "agent.finished" || (e.usage && !Array.isArray(e.usage) && typeof e.usage === "object")) {
      const u = (e.usage ?? {}) as Record<string, unknown>;
      const t = [`in ${count(isNum(u.input) ? u.input : undefined)}`, `out ${count(isNum(u.output) ? u.output : undefined)}`];
      if (isNum(u.cacheRead)) t.push(`cache-read ${count(u.cacheRead)}`);
      if (isNum(u.cacheWrite)) t.push(`cache-write ${count(u.cacheWrite)}`);
      parts.push(`tokens ${t.join(" ")}`);
    }
    if (isNum(e.cost)) parts.push(`est. cost $${e.cost.toFixed(e.cost < 0.1 ? 3 : 2)}`);
    // Check names with pass or fail; never their output.
    for (const k of ["results", "checks"]) {
      const list = e[k];
      if (Array.isArray(list) && list.length > 0 && list.every((c) => typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string")) {
        parts.push(`checks ${list.map((c: { name: string; status?: unknown }) => `${oneLine(clean(c.name), 40)}${typeof c.status === "string" ? `:${c.status}` : ""}`).join(", ")}`);
      }
    }
    if (Array.isArray(e.tasks) && e.tasks.length > 0 && e.type === "plan.ready") {
      parts.push(`tasks ${(e.tasks as { id?: unknown; owner?: unknown }[]).map((t) => `${String(t.id)}:${String(t.owner)}`).join(" ")}`);
    }
    const outcome = e.outcome as { checks?: unknown; files?: unknown[]; insertions?: unknown; deletions?: unknown } | undefined;
    if (outcome && typeof outcome === "object") parts.push(`checks=${String(outcome.checks)} files=${Array.isArray(outcome.files) ? outcome.files.length : "unknown"} +${isNum(outcome.insertions) ? outcome.insertions : "?"} -${isNum(outcome.deletions) ? outcome.deletions : "?"}`);
    if (Array.isArray(e.findings)) parts.push(`findings=${e.findings.length}`);
    for (const k of ["from", "to"]) if (typeof e[k] === "string") parts.push(`${k}=${oneLine(clean(e[k] as string), 40)}`);
    for (const k of TEXT) {
      const v = e[k];
      if (typeof v === "string" && v.trim() !== "") parts.push(`${k}: "${oneLine(clean(v), 160)}"`);
    }
    const at = Date.parse(e.t);
    const rel = Number.isFinite(at) && Number.isFinite(first) ? Math.max(0, Math.round((at - first) / 1000)) : undefined;
    const stamp = rel === undefined ? "  ?  " : `+${String(Math.floor(rel / 60)).padStart(2, "0")}:${String(rel % 60).padStart(2, "0")}`;
    lines.push(`${stamp}  ${e.type}${parts.length ? `  ${parts.join("  ")}` : ""}`);
  }
  return { lines, leftOut };
}

// --- the file -----------------------------------------------------------------------------

export interface ReportInput {
  state: RunState;
  events: NeuromeshEvent[];
  /** Event lines that could not be read. */
  unreadable?: number;
  entry: UsageEntry;
  note?: string;
  env: Environment;
  names: [string, string][];
  now?: Date;
}

export interface BuiltReport {
  text: string;
  /** What the redaction took out, by kind. */
  removed: RedactStats;
  eventsShown: number;
  eventsTotal: number;
  bytes: number;
}

const WORD: Record<string, [string, string]> = {
  path: ["path", "paths"],
  email: ["email", "emails"],
  secret: ["key or token", "keys or tokens"],
  url: ["URL", "URLs"],
  host: ["host name", "host names"],
  name: ["personal or machine name", "personal or machine names"],
  code: ["block of code or diff", "blocks of code or diffs"],
};

function removedText(removed: RedactStats): string {
  const parts = Object.entries(removed)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${(WORD[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(", ") : "nothing needed removing";
}

export function buildReport(input: ReportInput, maxBytes = REPORT_MAX_BYTES): BuiltReport {
  const { state, entry, env } = input;
  const removed: RedactStats = {};
  const clean = (text: string): string => redact(text, { paths: "drop", names: input.names }, removed);
  const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

  const request = oneLineKeep(clean((state.request ?? state.prompt ?? "").trim()), 4_000);
  const note = input.note?.trim() ? oneLineKeep(clean(input.note.trim()), 2_000) : "(none given; next time add --note \"what went wrong\")";

  // How the run ended, and a guess at the kind of failure by F111's fixed rules.
  const view: RunView = { install: "-", id: state.id, at: state.updatedAt, version: env.version, run: { ...entry, request: entry.request, mode: state.mode, failure: state.failure, reason: state.reason } as RunView["run"] };
  const verdict = classify(view);
  const ended = [`status ${state.status}`, `checks ${entry.checks}`];
  if (state.reason) ended.push(`reason: "${oneLine(clean(state.reason), 400)}"`);
  const failure = state.failure === "engine" ? "engine failure (Neuromesh itself failed)" : state.failure === "agent" ? "task failure (the model's work was wrong or incomplete)" : "not stated by the run";
  const kind = verdict.bad ? `${verdict.kind} (a guess by fixed rules; the run's own label is: ${failure})` : `not bad by the rules (the run ${state.status}, checks ${entry.checks}); your note says what is wrong`;

  const failed = new Map<string, string>();
  for (const f of state.featureErrors ?? []) failed.set(`${f.id} ${f.key}`, f.message);
  for (const e of input.events) if (e.type === "feature.failed" && typeof e.feature === "string") failed.set(`${e.feature} ${String(e.key ?? "")}`.trim(), String(e.message ?? ""));
  const failedLines = [...failed].slice(0, 10).map(([id, message]) => `- ${id}: ${oneLine(clean(message), 200)}`);
  if (failed.size > 10) failedLines.push(`- ...and ${failed.size - 10} more`);

  const roles = Object.entries(state.roles).map(([role, chain]) => `- ${role}: ${(chain ?? []).map((c) => [c.backend, c.model, c.effort ? `effort ${c.effort}` : undefined].filter(Boolean).join(" ")).join("  then  ")}`);
  const used = entry.models.slice(0, 8).map((m) => `- ${m.model} (${m.tier}; ${m.roles.join(", ")}): ${m.turns} turn${m.turns === 1 ? "" : "s"}, ${count(m.tokens)} tokens, ${m.cost === undefined ? "cost unknown" : `est. $${m.cost.toFixed(m.cost < 0.1 ? 3 : 2)}`}`);
  if (entry.models.length > 8) used.push(`- ...and ${entry.models.length - 8} more`);

  const head = [
    "## What went wrong (the tester's note)",
    "",
    note,
    "",
    "## Run",
    "",
    `- Run: ${state.id}`,
    `- Neuromesh ${env.version}; ${env.os}; Node ${env.node}`,
    `- Preset: ${state.preset} (${state.mode})`,
    "- Models the preset calls:",
    ...roles.map((l) => `  ${l}`),
    "- Models used:",
    ...(used.length ? used.map((l) => `  ${l}`) : ["  none (no agent turn ran)"]),
    `- Ended: ${ended.join("; ")}`,
    `- Kind: ${kind}`,
    `- Time ${entry.minutes} min; ${entry.turns} agent turn${entry.turns === 1 ? "" : "s"}; escalated ${entry.escalated ? "yes" : "no"}; changed ${entry.files} file${entry.files === 1 ? "" : "s"} (+${entry.insertions} -${entry.deletions})`,
    `- Tokens: expert ${count(entry.tokens.expert)}, worker ${count(entry.tokens.worker)}; est. cost ${entry.cost === undefined ? "unknown" : `$${entry.cost.toFixed(2)}`} (an estimate at API list prices, not money spent)`,
    "- Features that failed:",
    ...(failedLines.length ? failedLines.map((l) => `  ${l}`) : ["  none recorded"]),
    "",
  ].join("\n");

  // The agents' final reports share a budget, so many tasks cannot crowd the timeline out.
  const tasks = state.tasks ?? [];
  const each = Math.max(400, Math.floor(9_000 / Math.max(1, tasks.length)));
  const reports = tasks.flatMap((t) => {
    const r = t.report;
    const lines = [`### Task ${t.id}: ${oneLine(clean(t.title ?? ""), 80)} (owner ${t.owner}, ${t.status}${t.escalated ? ", escalated" : ""})`];
    if (t.error) lines.push(`Error: ${oneLine(clean(t.error), 300)}`);
    if (!r) return [...lines, "No report from the agent.", ""];
    lines.push(`Status: ${r.status}`, "", oneLineKeep(clean(r.summary ?? ""), each));
    for (const [label, text] of [["Notes", r.notes], ["Choices it made alone", r.choices], ["Left open", r.open]] as const) if (text?.trim()) lines.push("", `${label}: ${oneLineKeep(clean(text), Math.floor(each / 3))}`);
    return [...lines, ""];
  });
  const tail = ["## The agents' final reports", "", ...(reports.length ? reports : ["No agent made a report.", ""]), "## The request", "", request, ""].join("\n");

  const t = timeline(input.events, clean);
  const frame = (shown: string[], cut: number): string => {
    const notes =
      (cut > 0 ? `The first ${cut} of ${t.lines.length} events are left out to keep this file small; the end of the run is kept.\n` : "") +
      (t.leftOut > 0 ? `${t.leftOut} events of what the agents ran or read are left out on purpose.\n` : "") +
      (input.unreadable ? `${input.unreadable} lines of the event log could not be read.\n` : "");
    return ["## Timeline", "", `Time is minutes and seconds from the run's first event. Tokens are what the tool reported; "unknown" means it did not say.`, notes, "```text", ...shown, "```", ""].join("\n");
  };
  // Keep the end of the timeline: take events from the back while they fit. The room left is what the
  // cap allows less the banner, the sections around the timeline and a margin for the last redaction.
  const room = Math.floor((maxBytes - BANNER_ROOM - bytes(head) - bytes(tail) - bytes(frame([], t.lines.length))) * 0.97);
  let from = t.lines.length;
  for (let used = 0; from > 0; from--) {
    used += bytes(t.lines[from - 1]!) + 1;
    if (used > room) break;
  }
  // The last redaction is on the sections and on the timeline's lines, not on the timeline's code fence:
  // the redactor takes fenced blocks out, and the fence is this file's own.
  const last = (text: string): string => redact(text, { paths: "drop", names: input.names }, removed);
  const body = [last(head), frame(t.lines.slice(from).map(last), from), last(tail)].join("\n");
  let text = `${banner(state.id, removedText(removed), input.now)}${body}`;
  // If even an empty timeline does not fit (a huge head or tail), cut the end: the file stays under the cap.
  if (bytes(text) > maxBytes) {
    const marker = "\n\n[cut here to keep the file small]\n";
    let cut = text.slice(0, Math.max(0, maxBytes - bytes(marker)));
    while (bytes(cut) > maxBytes - bytes(marker)) cut = cut.slice(0, -1);
    text = cut + marker;
  }
  return { text, removed, eventsShown: t.lines.length - from, eventsTotal: t.lines.length, bytes: bytes(text) };
}

/** Keep line breaks (a report is read as paragraphs), but cut to a length. */
function oneLineKeep(text: string, limit: number): string {
  const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
}

function banner(run: string, removed: string, now = new Date()): string {
  return [
    `# Neuromesh bad-run report: ${run}`,
    "",
    `Made by \`neuromesh report\` on ${now.toISOString().slice(0, 10)}. Nothing was sent anywhere: this is a file on your computer.`,
    `Removed before writing it: ${removed}.`,
    "Read it before you share it. It holds no code, diffs, file paths, names, emails or keys, but you know your work best.",
    "",
    "",
  ].join("\n");
}

/** Write the report for a run; returns where, and what it holds. */
export function writeReport(home: string, state: RunState, note: string | undefined, sessionTotals: (backend: string) => boolean, now = new Date()): BuiltReport & { path: string; unreadable: number } {
  const { events, unreadable } = readEvents(runPaths(state.dir).events);
  const entry = entryFor(state, sessionTotals);
  const built = buildReport({ state, events, unreadable, entry, note, env: environment(), names: identityNames(state.repo), now });
  const path = reportPath(home, state.id);
  mkdirSync(join(home, "reports"), { recursive: true });
  writeFileSync(path, built.text);
  return { ...built, path, unreadable };
}
