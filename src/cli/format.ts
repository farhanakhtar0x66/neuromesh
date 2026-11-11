// Human-readable output. Progress goes to stderr, the final summary to stdout.

import type { Usage } from "../backends/types.ts";
import { usageByModel } from "../engine/run.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import type { EvalReport } from "../eval/eval.ts";
import { summarize } from "../eval/eval.ts";

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string): string => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");
export const magenta = paint("35");
export const blue = paint("34");

export function n(value: number | undefined): string {
  return value === undefined ? "unknown" : value.toLocaleString("en-US");
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function usageText(usage: Usage): string {
  const parts = [`input ${n(usage.input)}`];
  if (usage.cacheRead !== undefined) parts.push(`cache read ${n(usage.cacheRead)}`);
  if (usage.cacheWrite !== undefined) parts.push(`cache write ${n(usage.cacheWrite)}`);
  parts.push(`output ${n(usage.output)}`);
  return parts.join(", ");
}

function statusColor(status: string): (text: string) => string {
  if (["passed", "pass", "done", "finished", "applied", "merged"].includes(status)) return green;
  if (["failed", "fail", "timeout", "error"].includes(status)) return red;
  return yellow;
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + "…" : flat;
}

const ROLE_LABEL: Record<string, string> = { orchestrator: "Expert (plan)", escalation: "Expert", worker: "Worker", tester: "Tester" };
// An advice turn is the expert reading, not editing.

function who(event: NeuromeshEvent): string {
  const role = String(event.role ?? "worker");
  const label = ROLE_LABEL[role] ?? role;
  const colored = role === "orchestrator" || role === "escalation" ? magenta(label) : role === "tester" ? yellow(label) : blue(label);
  return event.task ? `${colored} ${dim(`[${String(event.task)}]`)}` : colored;
}

/** One line of progress per event; undefined for events not worth showing. */
export function formatEvent(event: NeuromeshEvent): string | undefined {
  switch (event.type) {
    case "run.started": {
      const worker = event.worker as { backend: string; model?: string } | undefined;
      const orch = event.orchestrator as { backend: string; model?: string } | undefined;
      const team = orch ? ` · expert ${orch.backend} ${orch.model ?? ""}` : "";
      return `${bold(`Run ${event.run}`)} · ${event.preset} (${event.mode})${team} · worker ${worker?.backend ?? "?"} ${worker?.model ?? ""}`;
    }
    case "run.resumed":
      return `${bold(`Resuming run ${event.run}`)} from ${event.from}, at step "${event.step}"`;
    case "route":
      return dim(`Intake: ${event.mode} — ${event.reason}`);
    case "note":
      return yellow(`! ${String(event.message)}`);
    case "model.exhausted":
      return yellow(`! ${String(event.model)} is out (${event.reason})${event.next ? `; switching ${event.role} to ${event.next}` : `; no ${event.role} model left`}`);
    case "workspace.ready": {
      const prepared = event.prepared as string[];
      return dim(`Workspace ready${prepared.length ? ` (copied ${prepared.join(", ")})` : ""}`);
    }
    case "checks.detected": {
      const checks = event.checks as { name: string; command: string }[];
      return checks.length === 0
        ? yellow("No project checks found; results will rest on the agents' own testing.")
        : dim(`Checks: ${checks.map((c) => `${c.name} (${c.command.length > 40 ? c.command.slice(0, 39) + "…" : c.command})`).join(", ")}`);
    }
    case "checks.finished": {
      const results = event.results as { name: string; status: string }[];
      if (results.length === 0) return undefined;
      const label = event.phase === "baseline" ? "Checks before any change" : event.phase === "final" ? "Checks on the merged result" : `Checks ${dim(`[${String(event.task)}]`)}`;
      return `${label}: ${results.map((r) => `${r.name} ${statusColor(r.status)(r.status)}`).join(", ")}`;
    }
    case "plan.ready": {
      const tasks = event.tasks as { id: string; title: string; owner: string; dependsOn: string[] }[];
      const lines = tasks.map((t) => `   ${t.id}: ${t.title}${t.owner === "expert" ? magenta(" (expert)") : ""}${t.dependsOn.length ? dim(` after ${t.dependsOn.join(", ")}`) : ""}`);
      return `${magenta("Plan")}: ${oneLine(String(event.summary), 120)}\n${lines.join("\n")}`;
    }
    case "task.started":
      return `${bold(`Task ${String(event.task)}`)}: ${String(event.title)}`;
    case "agent.started":
      return `${who(event)} ${String(event.kind)} turn · ${String(event.backend)} ${String(event.model ?? "")}${event.resumed ? dim(" (same session)") : ""}`;
    case "agent.activity":
      return dim(`  · ${oneLine(String(event.summary), 110)}`);
    case "agent.finished": {
      const stop = String(event.stop);
      const detail = stop === "done" ? "" : ` — ${oneLine(String(event.detail ?? ""), 160)}`;
      return `${who(event)} ${statusColor(stop)(stop)} in ${duration(Number(event.durationMs))} · ${usageText(event.usage as Usage)}${detail}`;
    }
    case "tester.verdict": {
      const findings = (event.findings as { problem: string }[]) ?? [];
      return `${yellow("Tester")} ${dim(`[${String(event.task)}]`)}: ${statusColor(String(event.verdict))(String(event.verdict))} · ${oneLine(String(event.summary), 120)}${findings.map((f) => `\n   - ${oneLine(f.problem, 140)}`).join("")}`;
    }
    case "repair.started":
      return `${bold("Repair")} ${dim(`[${String(event.task)}]`)} round ${String(event.round)} (${String(event.kind)})`;
    case "task.climbed":
      return `${blue("Climbed")} ${dim(`[${String(event.task)}]`)} ${String(event.from)} → ${String(event.to)}: ${String(event.reason)}`;
    case "task.advised": {
      const steps = (event.steps as string[]) ?? [];
      return `${magenta("Expert advice")} ${dim(`[${String(event.task)}]`)} (${String(event.reason)}): ${oneLine(String(event.diagnosis), 150)}${steps.map((st, i) => `\n   ${i + 1}. ${oneLine(st, 140)}`).join("")}`;
    }
    case "task.escalated":
      return `${magenta("Escalated")} ${dim(`[${String(event.task)}]`)} to the expert: ${String(event.reason)}`;
    case "task.conflict":
      return yellow(`! Task ${String(event.task)} conflicts with merged work; redoing it on top`);
    case "task.merged":
      return `${green("Merged")} task ${String(event.task)}${event.escalated ? magenta(" (expert)") : ""}`;
    case "task.failed":
      return `${red("Task failed")} ${dim(`[${String(event.task)}]`)}: ${oneLine(String(event.reason), 160)}`;
    case "integration.fix":
      return `${magenta("Expert")} fixing the merged result: ${(event.failing as string[]).join(", ")} failed`;
    default:
      return undefined;
  }
}

export function formatSummary(state: RunState): string {
  const lines: string[] = [];
  lines.push(`${bold(`Run ${state.id}`)} · ${statusColor(state.status)(state.status)} · ${state.preset} (${state.mode ?? "solo"})`);
  lines.push(`  Request: ${oneLine(state.prompt, 100)}`);
  if (state.reason) lines.push(`  Reason:  ${state.failure === "engine" ? red("[engine] ") : ""}${oneLine(state.reason, 300)}`);
  for (const t of state.tasks ?? []) {
    const label = state.tasks.length === 1 ? "Agent:  " : `Task ${t.id}:`;
    const summary = t.report ? oneLine(t.report.summary, 160) : t.error ? oneLine(t.error, 160) : t.status;
    const extra = [t.escalated ? magenta("expert") : "", t.verdict ? `tester ${t.verdict.verdict}` : ""].filter(Boolean).join(", ");
    lines.push(`  ${label} ${statusColor(t.status)(t.status)}${extra ? ` (${extra})` : ""} · ${summary}`);
    if (t.report?.notes) lines.push(dim(`           ${oneLine(t.report.notes, 200)}`));
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
    for (const f of o.files.slice(0, 12)) lines.push(dim(`    ${f.path}  ${f.binary ? "binary" : `+${f.insertions} −${f.deletions}`}`));
    if (o.files.length > 12) lines.push(dim(`    … and ${o.files.length - 12} more`));
  }
  for (const u of usageByModel(state.attempts)) {
    const cost = u.costUsdEquivalent !== undefined ? ` · API-equivalent ≈ $${u.costUsdEquivalent.toFixed(2)} (estimate)` : "";
    const tag = u.tier === "expert" ? magenta("expert") : blue("worker");
    lines.push(`  Usage:   ${tag} ${u.backend} ${u.model} (${u.roles.join(", ")}) · ${u.turns} turn${u.turns === 1 ? "" : "s"} · ${duration(u.durationMs)} · ${usageText(u.usage)}${cost}`);
  }
  const id = state.id;
  if (state.status === "finished") {
    lines.push(`  Next:    neuromesh diff ${id}  ·  neuromesh apply ${id}  ·  neuromesh discard ${id}`);
  } else if (state.status === "paused" || state.status === "interrupted" || state.status === "failed") {
    lines.push(`  Next:    neuromesh resume ${id}  ·  neuromesh diff ${id}  ·  neuromesh discard ${id}`);
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
  lines.push(dim("task                  kind        mode  status      checks  hidden  turns  time     tokens (expert / worker)"));
  for (const r of Object.values(report.results).sort((a, b) => a.task.localeCompare(b.task))) {
    const hidden = r.hidden === "pass" ? green("pass".padEnd(6)) : r.hidden === "fail" ? red("fail".padEnd(6)) : yellow("—".padEnd(6));
    lines.push(
      `${r.task.padEnd(21)} ${r.kind.padEnd(11)} ${(r.mode ?? "solo").padEnd(5)} ${r.status.padEnd(11)} ${r.checks.padEnd(7)} ${hidden}  ${String(r.turns).padEnd(6)} ${duration(r.wallMs).padEnd(8)} ${k(r.expertTokens)} / ${k(r.workerTokens)}` +
        (r.escalations ? magenta(` esc ${r.escalations}`) : "") +
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
  const width = 16;
  const head = "task".padEnd(22) + reports.map((r) => r.name.slice(0, width - 1).padEnd(width)).join("");
  const lines = [bold(head)];
  for (const t of tasks) {
    const cells = reports.map((r) => {
      const res = r.results[t];
      if (!res) return dim("—".padEnd(width));
      const mark = res.hidden === "pass" ? "pass" : res.hidden === "fail" ? "fail" : res.status;
      const cell = `${mark} ${k(res.expertTokens + res.workerTokens)}`.padEnd(width);
      return res.hidden === "pass" ? green(cell) : red(cell);
    });
    lines.push(t.padEnd(22) + cells.join(""));
  }
  const common = tasks.filter((t) => reports.every((r) => r.results[t] && r.results[t].status !== "paused"));
  lines.push("");
  lines.push(dim(`Totals over the ${common.length} tasks every eval completed:`));
  for (const r of reports) {
    const s = summarize(r, common);
    lines.push(
      `  ${r.name.padEnd(22)} passed ${String(s.passed).padStart(2)}/${s.tasks}` +
        `  tokens ${k(s.expertTokens + s.workerTokens).padStart(7)}` +
        `  expert ${k(s.expertTokens).padStart(7)}` +
        `  expert share ${s.expertShare === undefined ? "unknown" : `${(s.expertShare * 100).toFixed(0)}%`.padStart(4)}` +
        `  time ${duration(s.wallMs)}` +
        `  engine failures ${s.engineFailures}`,
    );
  }
  return lines.join("\n");
}
