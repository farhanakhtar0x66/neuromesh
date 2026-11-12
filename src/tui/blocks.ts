// [F35 tui-agent-boxes] The stream as blocks, drawn from the log.
//
// Each agent's turns make one box, labelled with its role and model; turns of
// the same role one after another share a box (parallel workers list their
// tasks in one). What a box says depends on the verbosity:
//   none    the boxes' labels only, and your messages and the result
//   medium  the orchestrator's and expert's words, the workers' task list and
//           reports, the tester's verdict, and warnings
//   full    every step every agent took, and every note
// A box opened by hand (a click) shows everything whatever the verbosity.

import type { Answer, Question } from "../engine/run.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { Model, Stage } from "./model.ts";
import { ROLE_NAME } from "./model.ts";
import type { Verbosity } from "./store.ts";
import type { Tone } from "./theme.ts";

export interface Line {
  text: string;
  tone?: Tone;
  icon?: string;
  iconTone?: Tone;
  bold?: boolean;
  /** Indent in cells, for nested lines. */
  indent?: number;
}

export type Block =
  | { kind: "you"; id: string; text: string; attachments?: string[] }
  | {
      kind: "agent";
      id: string;
      roleId: string;
      role: string;
      model?: string;
      effort?: string;
      stage: Stage;
      /** Turns started and not yet finished in this box. */
      open: number;
      startedAt: number;
      endedAt?: number;
      failed: boolean;
      /** What medium shows; `full` is everything. */
      brief: Line[];
      full: Line[];
      tasks: string[];
    }
  | { kind: "note"; id: string; lines: Line[]; level: "info" | "warn" }
  | { kind: "ask"; id: string; question: Question; pending: boolean; answer?: Answer }
  | { kind: "diff"; id: string; text: string; lines: string[] }
  | { kind: "final"; id: string; text: string; role: string; model?: string }
  | { kind: "result"; id: string }
  | { kind: "error"; id: string; text: string };

type AgentBlock = Extract<Block, { kind: "agent" }>;

const STAGE_OF: Record<string, Stage> = { orchestrator: "planning", briefer: "planning", worker: "building", escalation: "building", tester: "reviewing" };

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * An agent's step as a person reads it: paths inside the run's own copy of the
 * repository become repository paths, the home folder becomes ~, and an edit
 * reported as JSON becomes the files it touched.
 */
export function tidyStep(text: string): string {
  let t = text;
  // Codex reports edits as [{"path": ..., "kind": ...}]: keep the paths.
  const edit = /^edit \[/.exec(t);
  if (edit) {
    const paths = [...t.matchAll(/"path":\s*"([^"]+)/g)].map((m) => m[1]!);
    if (paths.length) t = `edit ${paths.join(", ")}`;
  }
  // The run's own copy: whole, or cut short in older recorded steps.
  t = t.replace(/\/[^\s"']*?\/runs\/[\w-]+(?:\/tasks(?:\/[\w-]*)?)?(?:\/worktree)?\/?…?/g, "");
  t = t.replace(/^edit\s*(,\s*)*$/, "edit");
  const home = process.env.HOME;
  if (home) t = t.split(home).join("~");
  return t;
}

/** The first sentence-like line of a markdown report: no headings, rules or fences. */
export function gist(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l && !/^(#{1,6}\s|```|~~~|[-*_]{3,}$|\|)/.test(l)) ?? "";
  return line.replace(/^([-*+]|\d+[.)])\s+/, "").slice(0, 300);
}

/** The blocks for the whole log at a verbosity (opened boxes keep their full lines). */
export function buildBlocks(m: Pick<Model, "log" | "ask">, verbose: Verbosity): Block[] {
  const out: Block[] = [];
  let last: AgentBlock | undefined;
  const byTask = new Map<string, { block: AgentBlock; line: Line }>();
  const open = new Map<string, AgentBlock>();
  const note = (id: string, text: string, level: "info" | "warn" = "info", tone?: Tone): void => {
    if (verbose === "none" && level === "info") return;
    const prev = out.at(-1);
    const line: Line = level === "warn" ? { text, tone: "amber", icon: "!", iconTone: "amber" } : { text, tone: tone ?? "muted" };
    if (prev?.kind === "note" && prev.level === level) prev.lines.push(line);
    else out.push({ kind: "note", id, lines: [line], level });
    last = undefined;
  };
  const agentBlock = (id: string, e: NeuromeshEvent): AgentBlock => {
    const roleId = String(e.role ?? "worker");
    // Turns of the same role, one after another, share a box.
    if (last && last.roleId === roleId && out.at(-1) === last) return last;
    const b: AgentBlock = {
      kind: "agent",
      id,
      roleId,
      role: ROLE_NAME[roleId] ?? roleId,
      model: e.model ? String(e.model) : undefined,
      effort: typeof e.effort === "string" ? e.effort : undefined,
      stage: STAGE_OF[roleId] ?? "building",
      open: 0,
      startedAt: 0,
      failed: false,
      brief: [],
      full: [],
      tasks: [],
    };
    out.push(b);
    last = b;
    return b;
  };
  const taskLine = (b: AgentBlock, task: string, title: string): Line => {
    const hit = byTask.get(task);
    if (hit && hit.block === b) return hit.line;
    const line: Line = { text: `${task} ${title}`, icon: "●", iconTone: "blue" };
    b.brief.push(line);
    b.tasks.push(task);
    byTask.set(task, { block: b, line });
    return line;
  };
  const titles = new Map<string, string>();

  for (const [i, entry] of m.log.entries()) {
    const id = `b${i}`;
    if (entry.kind === "you") {
      out.push({ kind: "you", id, text: entry.text, attachments: entry.attachments });
      last = undefined;
      continue;
    }
    if (entry.kind === "note") {
      note(id, entry.text, entry.tone === "amber" || entry.tone === "red" ? "warn" : "info", entry.tone);
      continue;
    }
    if (entry.kind === "error") {
      out.push({ kind: "error", id, text: entry.text });
      last = undefined;
      continue;
    }
    if (entry.kind === "final") {
      out.push({ kind: "final", id, text: entry.text, role: entry.role, model: entry.model });
      last = undefined;
      continue;
    }
    if (entry.kind === "diff") {
      out.push({ kind: "diff", id, text: entry.text, lines: entry.lines });
      last = undefined;
      continue;
    }
    if (entry.kind === "result") {
      out.push({ kind: "result", id });
      last = undefined;
      continue;
    }
    const e = entry.e;
    const key = `${String(e.role ?? "")}:${String(e.task ?? "")}`;
    const task = e.task && e.task !== "main" ? String(e.task) : undefined;
    switch (e.type) {
      case "brief": {
        const s = (e.staffing ?? {}) as { plan?: boolean; rung?: string; tester?: boolean; spec?: boolean };
        const kind = String(e.kind ?? "change");
        const what = kind === "greenfield" ? "Something new" : kind === "other" || kind === "change" ? "" : kind[0]!.toUpperCase() + kind.slice(1);
        const how = [s.spec ? "a spec first" : "", s.plan ? "the orchestrator plans" : "one worker", s.rung === "top" ? "at its strongest setting" : "", s.tester ? "with a reviewer" : "no reviewer"].filter(Boolean).join(", ");
        note(id, what ? `${what} · ${how}` : how[0]!.toUpperCase() + how.slice(1));
        break;
      }
      case "context.ready":
        if (verbose === "full") note(id, `context.md for the agents · about ${Math.max(1, Math.round(Number(e.chars ?? 0) / 4000))}k tokens`);
        break;
      case "route":
        if (verbose === "full") note(id, `Intake: ${String(e.mode)} · ${String(e.reason ?? "")}`);
        break;
      case "checks.finished": {
        const results = (e.results as { name: string; status: string }[] | undefined) ?? [];
        if (results.length === 0) break;
        const text = results.map((r) => `${r.name} ${r.status}`).join(", ");
        const bad = e.ok === false || results.some((r) => r.status !== "passed");
        if (e.phase === "task" && task === undefined && last?.roleId === "worker") {
          last.brief.push({ text: `checks: ${text}`, tone: bad ? "amber" : "muted", icon: bad ? "!" : "✓", iconTone: bad ? "amber" : "jade" });
          last.full.push({ text: `checks: ${text}`, tone: bad ? "amber" : "muted" });
          break;
        }
        const label = e.phase === "baseline" ? "Checks before the change" : e.phase === "final" ? "Checks on the result" : task ? `Checks for ${task}` : "Checks";
        note(id, `${label}: ${text}`, bad && e.phase !== "baseline" ? "warn" : "info");
        break;
      }
      case "agent.started": {
        const b = agentBlock(id, e);
        if (!b.startedAt) b.startedAt = entry.at;
        b.open += 1;
        b.endedAt = undefined;
        b.model = e.model ? String(e.model) : b.model;
        b.effort = typeof e.effort === "string" ? e.effort : b.effort;
        open.set(key, b);
        const kind = String(e.kind ?? "");
        if (b.roleId === "worker" && task) {
          const line = taskLine(b, task, titles.get(task) ?? "");
          line.icon = "●";
          line.iconTone = "blue";
        }
        const turn = kind && !["initial", "plan", "spec", "test"].includes(kind) ? `${kind} turn` : "";
        if (turn || task) b.full.push({ text: `${task ? `${task} · ` : ""}${turn || "started"}${e.resumed ? " (same session)" : ""}`, tone: "subtle" });
        break;
      }
      case "agent.activity": {
        const b = open.get(key);
        if (!b) break;
        const summary = tidyStep(String(e.summary ?? e.activity ?? ""));
        b.full.push({ text: `${task ? `${task} · ` : ""}${summary}`, tone: e.activity === "text" ? "text" : "muted", icon: e.activity === "tool" ? "›" : "·", iconTone: "subtle" });
        break;
      }
      case "agent.finished": {
        const b = open.get(key);
        if (!b) break;
        b.open = Math.max(0, b.open - 1);
        if (b.open === 0) b.endedAt = entry.at;
        open.delete(key);
        const stop = String(e.stop ?? "done");
        const secs = Math.round(Number(e.durationMs ?? 0) / 1000);
        const tokens = ["input", "output", "cacheRead", "cacheWrite"].reduce((n, k) => n + Number((e.usage as Record<string, number> | undefined)?.[k] ?? 0), 0);
        const facts = [`${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`}`, tokens > 0 ? `${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens` : "", typeof e.cost === "number" ? `≈$${e.cost.toFixed(e.cost < 0.1 ? 3 : 2)}` : ""].filter(Boolean).join(" · ");
        b.full.push({ text: `${task ? `${task} · ` : ""}${stop === "done" ? "finished" : stop} · ${facts}`, tone: stop === "done" ? "subtle" : "red" });
        if (stop !== "done") {
          b.failed = true;
          b.brief.push({ text: `${stop}${e.detail ? `: ${String(e.detail).slice(0, 160)}` : ""}`, tone: "red", icon: "✗", iconTone: "red" });
        }
        break;
      }
      case "spec.ready": {
        const b = open.get("briefer:") ?? (last?.roleId === "briefer" ? last : undefined);
        const line: Line = { text: `Spec "${String(e.name)}" · ${plural(Number(e.features), "feature")}, ${plural(Number(e.behaviour), "behaviour rule")}`, icon: "✓", iconTone: "jade" };
        if (b) b.brief.push(line), b.full.push(line);
        else note(id, line.text);
        break;
      }
      case "plan.ready": {
        const b = last?.roleId === "orchestrator" ? last : agentBlock(id, { ...e, role: "orchestrator" });
        const tasks = (e.tasks as { id: string; title: string; owner?: string }[] | undefined) ?? [];
        for (const t of tasks) titles.set(t.id, t.title);
        const lines: Line[] = [{ text: String(e.summary ?? "") }];
        for (const t of tasks) lines.push({ text: `${t.id} ${t.title}${t.owner === "expert" ? " (expert)" : ""}`, icon: "◇", iconTone: "mauve", indent: 2 });
        b.brief.push(...lines);
        b.full.push(...lines);
        break;
      }
      case "task.started": {
        if (task) titles.set(task, String(e.title ?? task));
        break;
      }
      case "task.report": {
        const b = open.get(key) ?? (last?.roleId === e.role ? last : undefined) ?? (task ? byTask.get(task)?.block : undefined);
        const summary = String(e.summary ?? "").trim();
        const blocked = e.status === "blocked";
        if (b && task) {
          const line = taskLine(b, task, titles.get(task) ?? "");
          line.icon = blocked ? "!" : "◆";
          line.iconTone = blocked ? "amber" : "jade";
          // The report goes under its task's line, after anything already there.
          let j = b.brief.indexOf(line) + 1;
          while (j < b.brief.length && (b.brief[j]!.indent ?? 0) > 0) j++;
          b.brief.splice(j, 0, { text: gist(summary), tone: "muted", indent: 2 });
        } else if (b) {
          b.brief.push({ text: gist(summary), icon: blocked ? "!" : "◆", iconTone: blocked ? "amber" : "jade" });
        }
        b?.full.push({ text: summary, tone: "text" });
        if (b && e.notes) b.full.push({ text: String(e.notes), tone: "muted" });
        break;
      }
      case "task.merged": {
        const hit = task ? byTask.get(task) : undefined;
        if (hit) {
          hit.line.icon = "✓";
          hit.line.iconTone = "jade";
        }
        break;
      }
      case "task.failed": {
        const hit = task ? byTask.get(task) : undefined;
        if (hit) {
          hit.line.icon = "✗";
          hit.line.iconTone = "red";
          hit.line.text += ` · ${String(e.reason ?? "").slice(0, 160)}`;
        } else out.push({ kind: "error", id, text: `Task ${String(e.task)} failed: ${String(e.reason ?? "")}` });
        break;
      }
      case "task.climbed": {
        const hit = task ? byTask.get(task) : undefined;
        const text = `moved up to ${String(e.to)}: ${String(e.reason ?? "")}`;
        if (hit) hit.block.brief.push({ text, tone: "amber", icon: "↑", iconTone: "amber", indent: 2 });
        else note(id, `${task ?? "the work"} ${text}`, "warn");
        break;
      }
      case "repair.started":
        if (last && verbose === "full") last.full.push({ text: `repair round ${String(e.round)} (${String(e.kind)})`, tone: "amber" });
        break;
      case "tester.verdict": {
        const b = open.get(key) ?? (last?.roleId === "tester" ? last : agentBlock(id, { ...e, role: "tester" }));
        const pass = e.verdict === "pass";
        const findings = (e.findings as { problem: string }[] | undefined) ?? [];
        const lines: Line[] = [{ text: `${task ? `${task} · ` : ""}${pass ? "passed" : "changes asked"} · ${String(e.summary ?? "")}`, icon: pass ? "✓" : "✗", iconTone: pass ? "jade" : "amber" }];
        for (const f of findings.slice(0, 6)) lines.push({ text: f.problem, tone: "muted", icon: "-", iconTone: "amber", indent: 2 });
        b.brief.push(...lines);
        b.full.push(...lines);
        break;
      }
      case "task.advised": {
        const b = open.get(key) ?? (last?.roleId === "escalation" ? last : agentBlock(id, { ...e, role: "escalation" }));
        const steps = (e.steps as string[] | undefined) ?? [];
        const lines: Line[] = [{ text: `${task ? `${task} · ` : ""}${String(e.diagnosis ?? "")}` }, ...steps.map((s, n) => ({ text: s, icon: `${n + 1}.`, iconTone: "mauve" as Tone, indent: 2 }))];
        b.brief.push(...lines);
        b.full.push(...lines);
        break;
      }
      case "task.escalated": {
        note(id, `The expert takes ${task ?? "the work"} over: ${String(e.reason ?? "")}`, "info", "mauve");
        break;
      }
      case "ask": {
        const q = e.question as Question;
        const pending = m.ask !== undefined && m.log.slice(i + 1).every((x) => !(x.kind === "event" && x.e.type === "answer"));
        out.push({ kind: "ask", id, question: q, pending });
        last = undefined;
        break;
      }
      case "answer": {
        for (let j = out.length - 1; j >= 0; j--) {
          const b = out[j]!;
          if (b.kind === "ask" && !b.answer) {
            b.answer = { ok: Boolean(e.ok), note: e.note ? String(e.note) : undefined };
            b.pending = false;
            break;
          }
        }
        break;
      }
      case "context.compacted":
        note(id, `Compacted: the ${ROLE_NAME[String(e.role)] ?? "agent"}'s next turn started a fresh session`, "info", "cyan");
        break;
      case "note":
        note(id, String(e.message ?? ""), "warn");
        break;
      case "model.exhausted":
        note(id, `${String(e.model)} is out (${String(e.reason)})${e.next ? `; ${String(e.role)} moves to ${String(e.next)}` : ""}`, "warn");
        break;
      case "task.conflict":
        note(id, `Task ${String(e.task)} conflicts with merged work; redoing it on top`, "warn");
        break;
      case "integration.fix":
        note(id, `The expert fixes the merged result: ${((e.failing as string[] | undefined) ?? []).join(", ")} failed`, "warn");
        break;
      case "screens.checked":
        if (verbose === "full") note(id, `Screen check: ran \`${String(e.command)}\` in tmux, ${String(e.screens)} screens${e.stuck ? "; it did not quit" : ""}`);
        break;
      case "feature.failed":
        out.push({ kind: "error", id, text: `Feature ${String(e.feature)} ${String(e.key)} failed: ${String(e.message ?? "")}. ${String(e.hint ?? "")}` });
        last = undefined;
        break;
      default:
    }
  }
  return out;
}

/** The lines a box shows: its full lines when opened or at full verbosity. */
export function shownLines(b: AgentBlock, verbose: Verbosity, opened: boolean): { lines: Line[]; hidden: number } {
  if (opened || verbose === "full") return { lines: b.full.length > 0 ? b.full : b.brief, hidden: 0 };
  if (verbose === "none") return { lines: [], hidden: b.full.length };
  return { lines: b.brief, hidden: Math.max(0, b.full.length - b.brief.length) };
}
