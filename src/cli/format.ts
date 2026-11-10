// Human-readable output. Progress goes to stderr, the final summary to stdout.

import type { Usage } from "../backends/types.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { usageByModel } from "../engine/run.ts";
import type { EvalReport } from "../eval/eval.ts";
import { summarize, totalTokens } from "../eval/eval.ts";

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string): string => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");

export function n(value: number | undefined): string {
  return value === undefined ? "unknown" : value.toLocaleString("en-US");
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function usageText(usage: Usage): string {
  const parts = [`input ${n(usage.input)}`];
  if (usage.cacheRead !== undefined) parts.push(`cache read ${n(usage.cacheRead)}`);
  if (usage.cacheWrite !== undefined) parts.push(`cache write ${n(usage.cacheWrite)}`);
  parts.push(`output ${n(usage.output)}`);
  return parts.join(", ");
}

function statusColor(status: string): (text: string) => string {
  if (status === "passed" || status === "done" || status === "finished" || status === "applied") return green;
  if (status === "failed" || status === "timeout" || status === "error") return red;
  return yellow;
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + "…" : flat;
}

/** One line of progress per event; undefined for events not worth showing. */
export function formatEvent(event: NeuromeshEvent): string | undefined {
  switch (event.type) {
    case "run.started": {
      const worker = event.worker as { backend: string; model?: string };
      return `${bold(`Run ${event.run}`)} · preset ${event.preset} · ${worker.backend} ${worker.model ?? "(default model)"}`;
    }
    case "run.resumed":
      return `${bold(`Resuming run ${event.run}`)} from ${event.from}, at step "${event.step}"`;
    case "note":
      return yellow(`! ${String(event.message)}`);
    case "workspace.ready": {
      const prepared = event.prepared as string[];
      return dim(`Workspace ready${prepared.length ? ` (copied ${prepared.join(", ")})` : ""}`);
    }
    case "checks.detected": {
      const checks = event.checks as { name: string; command: string }[];
      return checks.length === 0
        ? yellow("No project checks found; results will rest on the agent's own testing.")
        : dim(`Checks: ${checks.map((c) => `${c.name} (${c.command.length > 40 ? c.command.slice(0, 39) + "…" : c.command})`).join(", ")}`);
    }
    case "checks.finished": {
      const results = event.results as { name: string; status: string; durationMs: number }[];
      if (results.length === 0) return undefined;
      const label = event.phase === "baseline" ? "Checks before the agent" : `Checks after round ${String(event.round)}`;
      return `${label}: ${results.map((r) => `${r.name} ${statusColor(r.status)(r.status)}`).join(", ")}`;
    }
    case "agent.started":
      return `${bold("Agent")} ${String(event.kind)} turn · ${String(event.backend)} ${String(event.model ?? "")}${event.resumed ? " (same session)" : ""}`;
    case "agent.activity":
      return dim(`  · ${oneLine(String(event.summary), 110)}`);
    case "agent.finished": {
      const stop = String(event.stop);
      const detail = stop === "done" ? "" : ` — ${oneLine(String(event.detail ?? ""), 160)}`;
      return `Agent ${statusColor(stop)(stop)} in ${duration(Number(event.durationMs))} · ${usageText(event.usage as Usage)}${detail}`;
    }
    case "repair.started":
      return `${bold(`Repair round ${String(event.round)}`)}: ${(event.failing as string[]).join(", ")} failed`;
    default:
      return undefined;
  }
}

export function formatSummary(state: RunState): string {
  const lines: string[] = [];
  lines.push(`${bold(`Run ${state.id}`)} · ${statusColor(state.status)(state.status)}`);
  lines.push(`  Request: ${oneLine(state.prompt, 100)}`);
  if (state.reason) lines.push(`  Reason:  ${state.failure === "engine" ? red("[engine] ") : ""}${oneLine(state.reason, 300)}`);
  if (state.report) {
    lines.push(`  Agent:   ${statusColor(state.report.status)(state.report.status)} · ${oneLine(state.report.summary, 200)}`);
    if (state.report.notes) lines.push(`  Notes:   ${oneLine(state.report.notes, 300)}`);
  }
  if (state.latest && state.latest.length > 0) {
    const parts = state.latest.map((r) => {
      const before = state.baseline?.find((b) => b.name === r.name)?.status;
      return `${r.name} ${statusColor(r.status)(r.status)}${before && before !== r.status ? dim(` (was ${before})`) : ""}`;
    });
    lines.push(`  Checks:  ${parts.join(", ")}`);
  } else if (state.status === "finished" && state.checks.length === 0) {
    lines.push(`  Checks:  ${yellow("none found")}`);
  }
  if (state.outcome) {
    const o = state.outcome;
    lines.push(`  Changes: ${o.files.length} file${o.files.length === 1 ? "" : "s"}, +${o.insertions} −${o.deletions}`);
    for (const f of o.files.slice(0, 12)) {
      lines.push(dim(`    ${f.path}  ${f.binary ? "binary" : `+${f.insertions} −${f.deletions}`}`));
    }
    if (o.files.length > 12) lines.push(dim(`    … and ${o.files.length - 12} more`));
  }
  for (const u of usageByModel(state.attempts)) {
    const cost = u.costUsdEquivalent !== undefined ? ` · API-equivalent ≈ $${u.costUsdEquivalent.toFixed(2)} (estimate)` : "";
    lines.push(`  Usage:   ${u.backend} ${u.model} · ${u.turns} turn${u.turns === 1 ? "" : "s"} · ${duration(u.durationMs)} · ${usageText(u.usage)}${cost}`);
  }
  const id = state.id;
  if (state.status === "finished") {
    lines.push(`  Next:    neuromesh diff ${id}  ·  neuromesh apply ${id}  ·  neuromesh discard ${id}`);
  } else if (state.status === "paused" || state.status === "interrupted" || state.status === "failed") {
    lines.push(`  Next:    neuromesh resume ${id}  ·  neuromesh discard ${id}`);
  }
  return lines.join("\n");
}

export function formatRunList(runs: RunState[]): string {
  if (runs.length === 0) return "No runs yet for this repository.";
  return runs
    .map((r) => {
      const checks = r.outcome?.checks ?? "-";
      const files = r.outcome ? `${r.outcome.files.length}f` : "-";
      return `${r.id}  ${statusColor(r.status)(r.status.padEnd(11))} ${r.preset.padEnd(14)} checks ${checks.padEnd(6)} ${files.padEnd(4)} ${oneLine(r.prompt, 60)}`;
    })
    .join("\n");
}

// ---- eval tables ----

function k(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : `${Math.round(tokens / 1000)}k`;
}

export function formatEvalReport(report: EvalReport): string {
  const lines = [`${bold(`Eval ${report.name}`)} · preset ${report.preset}`];
  lines.push(dim("task                  kind        status      checks  hidden  turns  time     tokens (expert / worker)"));
  for (const r of Object.values(report.results).sort((a, b) => a.task.localeCompare(b.task))) {
    const hidden = r.hidden === "pass" ? green("pass") : r.hidden === "fail" ? red("fail") : yellow("—");
    lines.push(
      `${r.task.padEnd(21)} ${r.kind.padEnd(11)} ${r.status.padEnd(11)} ${r.checks.padEnd(7)} ${hidden.padEnd(useColor ? 15 : 6)}  ${String(r.turns).padEnd(6)} ${duration(r.wallMs).padEnd(8)} ${k(r.expertTokens)} / ${k(r.workerTokens)}` +
        (r.failure === "engine" ? red("  [engine failure]") : ""),
    );
  }
  const s = summarize(report);
  lines.push("");
  lines.push(
    `Passed ${s.passed}/${s.tasks}` +
      ` · engine failures ${s.engineFailures}` +
      (s.paused ? ` · ${s.paused} paused (quota)` : "") +
      ` · time ${duration(s.wallMs)}` +
      ` · tokens ${k(s.expertTokens + s.workerTokens)}` +
      ` · expert share ${s.expertShare === undefined ? "unknown" : `${(s.expertShare * 100).toFixed(0)}%`}` +
      (s.usageIncomplete ? yellow(" (some usage unreported)") : ""),
  );
  return lines.join("\n");
}

export function formatComparison(reports: EvalReport[]): string {
  const tasks = [...new Set(reports.flatMap((r) => Object.keys(r.results)))].sort();
  const width = 14;
  const head = "task".padEnd(22) + reports.map((r) => r.preset.slice(0, width - 1).padEnd(width)).join("");
  const lines = [bold(head)];
  for (const t of tasks) {
    const cells = reports.map((r) => {
      const res = r.results[t];
      if (!res) return dim("—".padEnd(width));
      const mark = res.hidden === "pass" ? "pass" : res.hidden === "fail" ? "fail" : res.status;
      const cell = `${mark} ${k(totalTokens({ input: res.expertTokens + res.workerTokens }))}`.padEnd(width);
      return res.hidden === "pass" ? green(cell) : red(cell);
    });
    lines.push(t.padEnd(22) + cells.join(""));
  }
  const common = tasks.filter((t) => reports.every((r) => r.results[t]));
  lines.push("");
  lines.push(dim(`Totals over the ${common.length} tasks every eval ran:`));
  for (const r of reports) {
    const s = summarize(r, common);
    lines.push(
      `  ${r.preset.padEnd(16)} passed ${String(s.passed).padStart(2)}/${s.tasks}` +
        `  tokens ${k(s.expertTokens + s.workerTokens).padStart(7)}` +
        `  expert ${k(s.expertTokens).padStart(7)}` +
        `  expert share ${s.expertShare === undefined ? "unknown" : `${(s.expertShare * 100).toFixed(0)}%`.padStart(4)}` +
        `  time ${duration(s.wallMs)}` +
        `  engine failures ${s.engineFailures}`,
    );
  }
  return lines.join("\n");
}
