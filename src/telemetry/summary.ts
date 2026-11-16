// [F111 telemetry-summary] The owner's weekly reader for testers' reports:
// `neuromesh telemetry summary [--since 7d]`. It reads the reports saved in
// ~/.neuromesh/telemetry/inbox (fetched by `telemetry pull`) and prints, in
// one screen: runs by preset, how they were rated, which runs went wrong and
// of what kind, which features failed, and the five worst-rated runs with what
// was asked and what came back. No model is called: the kind of a failure is
// decided by fixed rules over fields a report already has (status, checks,
// failure, reason, final report, the tester's note).
//
// The kinds follow docs/22-path-to-the-goal.md (L5): each has its own remedy.
//   engine           Neuromesh itself failed: a crash, a hang, a lost run, a feature error.
//   environment      The tester's setup: signed out, a limit reached, a missing tool, no network.
//   wrong code       The models wrote something that failed the checks or the review.
//   unclear request  The request, or the tester's note, says it was ambiguous or misread.
//   unknown          None of the above can be told from the report.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RatingReport, RunReport } from "./telemetry.ts";

export type Kind = "engine" | "environment" | "wrong code" | "unclear request" | "unknown";
export const KINDS: Kind[] = ["engine", "environment", "wrong code", "unclear request", "unknown"];

/** One run, with its rating if the tester gave one. */
export interface RunView {
  install: string;
  id: string;
  at: string;
  version: string;
  run: RunReport["run"];
  rating?: { score: number; note?: string };
}

export interface Verdict {
  /** The run did not go well: it failed, paused, failed its checks or was rated 1 or 2. */
  bad: boolean;
  kind?: Kind;
  why?: string;
}

const ENVIRONMENT = /signed in|not logged in|log(?:ged)? in again|authenticat|oauth|subscription limit|usage limit|rate.?limit|quota|\b429\b|cooling down|environment:|not installed|command not found|ENOENT|no such file or directory|execvp|no space left|permission denied|ECONN|ENOTFOUND|network|install(?:ing)? (?:failed|the dependencies)/i;
const ENGINE = /^engine error|engine error in|did not finish|timed? ?out|\bidle\b|crash|\bhung\b|killed|lost run|leftover|orphan|\bspawn\b|exited with|no longer running/i;
const UNCLEAR = /\bunclear\b|ambigu|\bvague\b|not (?:clear|sure what)|underspecified|clarif|misunderst|misread|not what i (?:asked|wanted)|which (?:one|file|framework|language) (?:do you|should)|needs? (?:more )?(?:info|information|details)|can(?:'|no)t tell what/i;
const WRONG_CODE = /checks? still fail|failed|did not pass|review|stuck|escalation|expert budget|never started|conflict/i;

const cut = (text: string, n: number): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** Whether a run went badly, and if so of what kind. Fixed rules, in this order. */
export function classify(v: RunView): Verdict {
  const r = v.run;
  const score = v.rating?.score;
  const lowRating = score !== undefined && score <= 2;
  const bad = r.status === "failed" || r.status === "paused" || r.checks === "failed" || lowRating;
  if (!bad) return { bad: false };
  const reason = r.reason ?? "";
  const evidence = `${reason}\n${r.finalReport ?? ""}\n${v.rating?.note ?? ""}`;
  const note = v.rating?.note ? ` (tester: ${cut(v.rating.note, 100)})` : "";
  const reasonOrFirst = cut(reason || (r.checks === "failed" ? "the checks failed" : lowRating ? `rated ${score} though the checks ${r.checks === "passed" ? "passed" : "did not fail"}` : "no reason given"), 140) + note;
  if (ENVIRONMENT.test(reason)) return { bad, kind: "environment", why: reasonOrFirst };
  if (r.failure === "engine" || ENGINE.test(reason) || (r.status === "failed" && (r.featureErrors ?? []).length > 0)) return { bad, kind: "engine", why: reasonOrFirst };
  if (UNCLEAR.test(evidence)) return { bad, kind: "unclear request", why: reasonOrFirst };
  if (r.checks === "failed" || (r.status === "failed" && (r.failure === "agent" || WRONG_CODE.test(reason)))) return { bad, kind: "wrong code", why: reasonOrFirst };
  return { bad, kind: "unknown", why: reasonOrFirst };
}

/** Every report in the inbox, and how many files could not be read. */
export function readInbox(home: string): { reports: unknown[]; unreadable: number } {
  const dir = join(home, "telemetry", "inbox");
  const reports: unknown[] = [];
  let unreadable = 0;
  if (!existsSync(dir)) return { reports, unreadable };
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      reports.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      unreadable += 1;
    }
  }
  return { reports, unreadable };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Runs with their ratings. A run reported again (resumed) counts once, by its
 * latest report; a rating is matched by install and run id, the latest wins.
 * Anything that is not a run or a rating report is left out.
 */
export function runViews(reports: unknown[]): RunView[] {
  const runs = new Map<string, RunView>();
  const ratings = new Map<string, RatingReport>();
  for (const x of reports) {
    if (!isObject(x) || typeof x.install !== "string") continue;
    if (x.type === "run" && isObject(x.run) && typeof x.run.run === "string") {
      const key = `${x.install}/${x.run.run}`;
      const at = typeof x.at === "string" ? x.at : "";
      const before = runs.get(key);
      if (!before || at >= before.at) runs.set(key, { install: x.install, id: x.run.run, at, version: typeof x.version === "string" ? x.version : "unknown", run: x.run as unknown as RunReport["run"] });
    } else if (x.type === "rating" && typeof x.run === "string" && typeof x.score === "number") {
      const key = `${x.install}/${x.run}`;
      const before = ratings.get(key);
      if (!before || String(x.at ?? "") >= before.at) ratings.set(key, x as unknown as RatingReport);
    }
  }
  for (const [key, v] of runs) {
    const rating = ratings.get(key);
    if (rating) v.rating = { score: rating.score, note: rating.note };
  }
  return [...runs.values()];
}

/** "7d", "24h", "2w" back from now; a date; or "all". */
export function parseSince(text: string, now = new Date()): Date {
  const t = text.trim().toLowerCase();
  if (t === "all") return new Date(0);
  const span = /^(\d+)\s*([hdw])$/.exec(t);
  if (span) return new Date(now.getTime() - Number(span[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[span[2] as "h" | "d" | "w"]);
  const date = Date.parse(text);
  if (!Number.isNaN(date) && /^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(date);
  throw new Error(`--since takes a span like 7d, 24h or 2w, a date like 2026-11-09, or "all" (got "${text}")`);
}

export interface PresetRow {
  preset: string;
  runs: number;
  ok: number;
  bad: number;
  stopped: number;
  ratings: number[];
  minutes: number;
  /** Runs whose cost the tool could price, and what they add up to (an estimate at API list prices). */
  priced: number;
  cost: number;
}

export interface Summary {
  since: Date;
  runs: RunView[];
  installs: number;
  versions: string[];
  presets: PresetRow[];
  spread: number[];
  rated: number;
  kinds: Map<Kind, RunView[]>;
  verdicts: Map<RunView, Verdict>;
  featureFailures: { id: string; key: string; runs: number; example: string }[];
  lowest: RunView[];
}

export function summarize(views: RunView[], since: Date): Summary {
  // A report with no readable time stays in: better a run too many than a run lost.
  const runs = views.filter((v) => !v.at || Date.parse(v.at) >= since.getTime()).sort((a, b) => b.at.localeCompare(a.at));
  const verdicts = new Map<RunView, Verdict>();
  const rows = new Map<string, PresetRow>();
  const spread = [0, 0, 0, 0, 0];
  const kinds = new Map<Kind, RunView[]>(KINDS.map((k) => [k, []]));
  const features = new Map<string, { id: string; key: string; runs: number; example: string }>();
  for (const v of runs) {
    const verdict = classify(v);
    verdicts.set(v, verdict);
    const name = v.run.preset ?? "unknown";
    const row = rows.get(name) ?? { preset: name, runs: 0, ok: 0, bad: 0, stopped: 0, ratings: [], minutes: 0, priced: 0, cost: 0 };
    rows.set(name, row);
    row.runs += 1;
    if (verdict.bad) row.bad += 1;
    else if (v.run.status === "interrupted") row.stopped += 1;
    else row.ok += 1;
    if (v.rating) {
      row.ratings.push(v.rating.score);
      if (v.rating.score >= 1 && v.rating.score <= 5) spread[Math.round(v.rating.score) - 1]! += 1;
    }
    row.minutes += typeof v.run.minutes === "number" ? v.run.minutes : 0;
    if (typeof v.run.cost === "number") {
      row.priced += 1;
      row.cost += v.run.cost;
    }
    if (verdict.bad && verdict.kind) kinds.get(verdict.kind)!.push(v);
    // Errors read "F56 env-blocked: message".
    const seen = new Set<string>();
    for (const e of v.run.featureErrors ?? []) {
      const m = /^(F\d+)\s+(\S+?):\s*(.*)$/s.exec(e);
      const id = m?.[1] ?? "unknown";
      if (seen.has(id)) continue;
      seen.add(id);
      const f = features.get(id) ?? { id, key: m?.[2] ?? "", runs: 0, example: cut(m?.[3] ?? e, 120) };
      f.runs += 1;
      features.set(id, f);
    }
  }
  const rated = runs.filter((v) => v.rating).length;
  const lowest = runs
    .filter((v) => v.rating)
    .sort((a, b) => a.rating!.score - b.rating!.score || b.at.localeCompare(a.at))
    .slice(0, 5);
  return {
    since,
    runs,
    installs: new Set(runs.map((v) => v.install)).size,
    versions: [...new Set(runs.map((v) => v.version))].sort(),
    presets: [...rows.values()].sort((a, b) => b.runs - a.runs || a.preset.localeCompare(b.preset)),
    spread,
    rated,
    kinds,
    verdicts,
    featureFailures: [...features.values()].sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id)),
    lowest,
  };
}

const mean = (xs: number[]): string => (xs.length === 0 ? "-" : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
const money = (n: number): string => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const day = (iso: string): string => iso.slice(0, 10) || "unknown date";
const pad = (s: string, n: number): string => s.padEnd(n);
const num = (n: number, w: number): string => String(n).padStart(w);
const short = (id: string): string => id.slice(0, 8);
// A run id is a date, a time and four hex digits: the whole id is what `neuromesh status` takes.

/** The text the owner reads. `unreadable` counts inbox files that were not valid JSON. */
export function formatTesterSummary(s: Summary, unreadable = 0, now = new Date()): string {
  const out: string[] = [];
  const span = s.since.getTime() === 0 ? "all reports" : `since ${day(s.since.toISOString())}`;
  out.push(`Testers' reports, ${span} (read ${now.toISOString().slice(0, 16).replace("T", " ")} UTC)`);
  if (s.runs.length === 0) {
    out.push("No run reports in this period.");
    out.push("Fetch the newest with `neuromesh telemetry pull` (needs the admin token); widen with --since 30d or --since all.");
    if (unreadable) out.push(`${unreadable} file${unreadable === 1 ? "" : "s"} in the inbox could not be read.`);
    return out.join("\n") + "\n";
  }
  out.push(`${s.runs.length} run${s.runs.length === 1 ? "" : "s"} from ${s.installs} install${s.installs === 1 ? "" : "s"}, ${s.rated} rated, ${s.runs.length - s.rated} not rated. Versions: ${s.versions.join(", ")}.`);
  if (unreadable) out.push(`${unreadable} file${unreadable === 1 ? "" : "s"} in the inbox could not be read and are left out.`);

  out.push("", "Runs by preset (ok = finished and not bad; bad = failed, paused, checks failed or rated 1-2; stopped = ended by the tester)");
  const w = Math.max(6, ...s.presets.map((p) => p.preset.length));
  out.push(`  ${pad("preset", w)}  runs   ok  bad  stopped  rating  avg min  est. cost*`);
  for (const p of s.presets) {
    const cost = p.priced === 0 ? "unknown" : `${money(p.cost)}${p.priced < p.runs ? ` (${p.priced} of ${p.runs} priced)` : ""}`;
    out.push(`  ${pad(p.preset, w)}  ${num(p.runs, 4)}  ${num(p.ok, 3)}  ${num(p.bad, 3)}  ${num(p.stopped, 7)}  ${pad(p.ratings.length ? `${mean(p.ratings)} (${p.ratings.length})` : "-", 6)}  ${num(p.runs ? Math.round((p.minutes / p.runs) * 10) / 10 : 0, 7)}  ${cost}`);
  }
  out.push("  * an estimate at API list prices, not money spent; \"unknown\" where the tool did not report enough to price.");

  out.push("", "Rating spread (1 much worse ... 5 much better than the tester's usual way)");
  const top = Math.max(1, ...s.spread);
  for (let i = 4; i >= 0; i--) out.push(`  ${i + 1}  ${"█".repeat(Math.round((s.spread[i]! / top) * 20)).padEnd(20)} ${s.spread[i]}`);
  const all = s.runs.flatMap((v) => (v.rating ? [v.rating.score] : []));
  out.push(all.length ? `  mean ${mean(all)} over ${all.length} rating${all.length === 1 ? "" : "s"}` : "  no ratings yet");

  const bad = [...s.verdicts.values()].filter((v) => v.bad).length;
  out.push("", `Bad runs: ${bad} of ${s.runs.length}` + (bad ? `  (${KINDS.map((k) => `${k} ${s.kinds.get(k)!.length}`).join(", ")})` : ""));
  const listed: string[] = [];
  for (const k of KINDS) for (const v of s.kinds.get(k)!) listed.push(`  [${k}] ${v.run.preset ?? "?"} ${v.id} (install ${short(v.install)}): ${s.verdicts.get(v)!.why}`);
  out.push(...listed.slice(0, 15));
  if (listed.length > 15) out.push(`  ...and ${listed.length - 15} more`);

  out.push("", "Features that failed (a failed optional feature is switched off for the rest of its run)");
  if (s.featureFailures.length === 0) out.push("  none");
  for (const f of s.featureFailures) out.push(`  ${f.id} ${f.key}: ${f.runs} run${f.runs === 1 ? "" : "s"}, e.g. ${f.example}`);

  out.push("", `The ${s.lowest.length === 5 ? "five " : ""}lowest-rated run${s.lowest.length === 1 ? "" : "s"}`);
  if (s.lowest.length === 0) out.push("  none rated yet");
  s.lowest.forEach((v, i) => {
    const verdict = s.verdicts.get(v)!;
    out.push(`  ${i + 1}. rated ${v.rating!.score}  ${v.run.preset ?? "?"}  ${v.run.status}, checks ${v.run.checks}  ${verdict.bad ? `[${verdict.kind}]` : "[not bad by the rules]"}  ${day(v.at)}  run ${v.id}, install ${short(v.install)}`);
    out.push(`     asked:  ${cut(v.run.request ?? "", 240) || "(nothing recorded)"}`);
    out.push(`     result: ${cut(v.run.finalReport ?? v.run.reason ?? "", 500) || "(no final report)"}`);
    if (v.rating!.note) out.push(`     note:   ${cut(v.rating!.note, 240)}`);
  });
  return out.join("\n") + "\n";
}
