// [F19 tui] Screens as pure functions: model and terminal size in, lines out.
// Layout follows the Signal design: one calm landing canvas; then a workspace
// that gains a right-hand rail of agents and cost when the terminal is wide.

import type { Composer } from "./composer.ts";
import { pipeline } from "./model.ts";
import type { AgentView, Item, Model } from "./model.ts";
import { center, padEnd, truncate, width, wrap } from "./text.ts";
import { canvas, fg, hairline, surface } from "./theme.ts";
import type { Tone } from "./theme.ts";

export interface Frame {
  lines: string[];
  cursor?: { row: number; col: number };
}

type Part = [text: string, tone?: Tone | "bold" | "plain"];

/** One line from styled parts, cut to `cells`. Widths are measured on the plain text. */
function row(parts: Part[], cells: number, fill = true): string {
  let out = "";
  let left = cells;
  for (const [text, tone] of parts) {
    if (left <= 0) break;
    const t = width(text) > left ? truncate(text, left) : text;
    left -= width(t);
    out += tone === undefined || tone === "plain" ? t : tone === "bold" ? fg("text", t, true) : fg(tone, t);
  }
  return out + (fill ? " ".repeat(Math.max(0, left)) : "");
}

// The owner's logos: a wide one, and a small one for narrower terminals.
const LOGO_WIDE: string[] = ["      ::::    ::: :::::::::: :::    ::: :::::::::   ::::::::    :::   :::   :::::::::: ::::::::  :::    :::", "     :+:+:   :+: :+:        :+:    :+: :+:    :+: :+:    :+:  :+:+: :+:+:  :+:       :+:    :+: :+:    :+: ", "    :+:+:+  +:+ +:+        +:+    +:+ +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+       +:+        +:+    +:+  ", "   +#+ +:+ +#+ +#++:++#   +#+    +:+ +#++:++#:  +#+    +:+ +#+  +:+  +#+ +#++:++#  +#++:++#++ +#++:++#++   ", "  +#+  +#+#+# +#+        +#+    +#+ +#+    +#+ +#+    +#+ +#+       +#+ +#+              +#+ +#+    +#+    ", " #+#   #+#+# #+#        #+#    #+# #+#    #+# #+#    #+# #+#       #+# #+#       #+#    #+# #+#    #+#     ", "###    #### ##########  ########  ###    ###  ########  ###       ### ########## ########  ###    ###      "];
const LOGO_SMALL: string[] = [" /|/_     __  _ _  _   _/_", "/ |/_'/_///_// / //_'_\\/ /"];

/** The wide logo shaded by density: ":" quiet, "+" jade, "#" bright. */
function shade(line: string): string {
  let out = "";
  let run = "";
  let tone: "muted" | "jade" | "text" | "" = "";
  const flush = (): void => {
    if (run) out += tone === "" ? run : fg(tone, run, tone === "text");
    run = "";
  };
  for (const ch of line) {
    const t = ch === ":" ? "muted" : ch === "+" ? "jade" : ch === "#" ? "text" : "";
    if (t !== tone && ch !== " ") {
      flush();
      tone = t;
    }
    run += ch;
  }
  flush();
  return out;
}

function wordmark(cols: number, rows: number): string[] {
  if (cols >= LOGO_WIDE[0]!.length + 4 && rows >= 26) return LOGO_WIDE.map(shade);
  if (cols >= LOGO_SMALL[0]!.length + 4) return LOGO_SMALL.map((l) => fg("jade", l, true));
  return [fg("jade", "NEUROMESH", true)];
}

/** The composer box: surface background, wrapped text, and a meta line. */
function composerBox(c: Composer, boxW: number, placeholder: string, meta: Part[], action: Part, maxRows: number): { lines: string[]; cursorRow: number; cursorCol: number } {
  const inner = boxW - 4;
  const { lines: text, row: crow, col: ccol } = c.layout(inner);
  const visible = Math.max(1, Math.min(maxRows, text.length));
  const first = Math.max(0, Math.min(crow - visible + 1, text.length - visible));
  const shown = c.isEmpty && c.text === "" ? [placeholder] : text.slice(first, first + visible);
  const body = (content: string): string => `${surface()}  ${content}  ${canvas()}`;
  const lines = [body(" ".repeat(inner))];
  for (const [i, t] of shown.entries()) {
    const prompt = i === 0 ? "› " : "  ";
    const tone: Tone | "plain" = c.isEmpty && c.text === "" ? "muted" : "plain";
    lines.push(body(row([[prompt, "jade"], [t, tone]], inner)));
  }
  lines.push(body(" ".repeat(inner)));
  const metaW = inner - width(action[0]);
  lines.push(body(row(meta, metaW) + row([action], width(action[0]))));
  return { lines, cursorRow: 1 + (crow - first), cursorCol: 4 + ccol };
}

function tooSmall(cols: number, rows: number): Frame {
  const lines = Array.from({ length: rows }, () => canvas());
  const msg = [`Too small: ${cols}×${rows}`, "Needs 40×12.", "A run keeps going.", "Ctrl+Q quits."];
  const top = Math.max(0, Math.floor((rows - msg.length) / 2));
  for (const [i, m] of msg.entries()) if (top + i < rows) lines[top + i] = canvas() + center(truncate(m, cols), cols);
  return { lines };
}

export function render(m: Model, c: Composer, cols: number, rows: number): Frame {
  if (cols < 40 || rows < 12) return tooSmall(cols, rows);
  if (m.focus === "diff" && m.diff) return diffView(m, cols, rows);
  return m.screen === "landing" ? landing(m, c, cols, rows) : workspace(m, c, cols, rows);
}

function landing(m: Model, c: Composer, cols: number, rows: number): Frame {
  const boxW = Math.min(78, cols - 6);
  const mark = wordmark(cols, rows);
  const subtitle = "Cheap agents build. One expert decides. You check the diff.";
  const meta: Part[] = m.repoError ? [[m.repoError, "red"]] : [[`${m.preset}`, "mauve"], [`  ·  ${m.repo ?? ""}`, "muted"]];
  const box = composerBox(c, boxW, "What should we build?", meta, ["Enter build ↵", "jade"], Math.max(1, Math.min(8, rows - 16)));
  const hints = "Alt+Enter newline  ·  Ctrl+U clear  ·  Ctrl+Q quit";
  const block = [...mark, "", fg("muted", truncate(subtitle, cols - 2)), "", ...box.lines, "", fg("muted", truncate(hints, cols - 2))];
  const top = Math.max(0, Math.floor((rows - block.length) / 2) - 1);
  const lines = Array.from({ length: rows }, () => canvas());
  const left = Math.max(0, Math.floor((cols - boxW) / 2));
  for (const [i, l] of block.entries()) {
    const y = top + i;
    if (y >= rows) break;
    const isBox = i >= mark.length + 3 && i < mark.length + 3 + box.lines.length;
    lines[y] = canvas() + (isBox ? " ".repeat(left) + l : center(l, cols));
  }
  const footer = row([[` ${m.toast && m.toast.until > Date.now() ? m.toast.text : ""}`, m.toast?.tone ?? "muted"]], cols - 10) + row([[`${cols}×${rows} `, "muted"]], 10);
  lines[rows - 1] = canvas() + footer;
  return { lines, cursor: { row: top + mark.length + 3 + box.cursorRow, col: left + box.cursorCol } };
}

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const money = (n: number): string => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

function itemLines(item: Item, cells: number): string[] {
  const w = Math.max(10, cells);
  switch (item.kind) {
    case "you":
      return ["", row([["YOU", "muted"]], w), ...wrap(item.text, w - 2).map((t) => `${surface()} ${row([[t, "bold"]], w - 2)} ${canvas()}`)];
    case "neuromesh":
      return wrap(item.text, w - 2).map((t, i) => row([[i === 0 ? "◆ " : "  ", item.tone ?? "jade"], [t, item.tone ?? "plain"]], w));
    case "activity":
      return wrap(item.text, w - 4).map((t, i) => row([[i === 0 ? "  · " : "    ", "muted"], [t, item.tone ?? "muted"]], w));
    case "error":
      return wrap(item.text, w - 2).map((t, i) => row([[i === 0 ? "! " : "  ", "red"], [t, "red"]], w));
    case "outcome":
      return ["", ...wrap(item.text, w - 2).map((t) => row([["  "], [t, item.tone ?? "plain"]], w))];
    default:
      return wrap(item.text, w - 2).map((t) => row([["  "], [t, item.tone ?? "muted"]], w));
  }
}

function agentRows(a: AgentView, cells: number, frame: number): string[] {
  const mark: Part = a.working ? [`${SPIN[frame % SPIN.length]} `, "blue"] : a.failed ? ["✗ ", "red"] : ["✓ ", "jade"];
  const name = `${a.role}${a.task && a.task !== "main" ? ` ${a.task}` : ""}`;
  const state = a.working ? "active" : a.failed ? "stopped" : "done";
  const top = row([mark, [name, a.role === "Expert" || a.role === "Planner" ? "mauve" : "plain"]], cells - state.length) + row([[state, a.working ? "blue" : a.failed ? "red" : "muted"]], state.length);
  const detail = `${a.model} · ${a.turns} turn${a.turns === 1 ? "" : "s"} · ${Math.round(a.tokens / 1000)}k tok · ${a.cost === undefined ? "cost unknown" : `≈${money(a.cost)}`}`;
  return [top, row([["  "], [detail, "muted"]], cells)];
}

function rail(m: Model, cells: number, height: number, frame: number): string[] {
  const out: string[] = [];
  out.push(row([["AGENTS", "jade"]], cells));
  if (m.agents.size === 0) out.push(row([["none yet", "muted"]], cells));
  for (const a of m.agents.values()) out.push(...agentRows(a, cells, frame), "");
  out.push(row([["COST, ESTIMATED", "jade"]], cells));
  out.push(row([["All models", "muted"]], cells - 10) + row([[m.costUnknown && m.cost === 0 ? "unknown" : money(m.cost), "plain"]], 10));
  out.push(row([["Expert", "muted"]], cells - 10) + row([[money(m.expertCost), "mauve"]], 10));
  if (m.costUnknown) out.push(row([["some turns unpriced", "amber"]], cells));
  out.push(row([["At API list prices; nothing is paid per token.", "muted"]], cells));
  out.push("");
  out.push(row([["RUN", "jade"]], cells));
  out.push(row([[m.runId ?? "starting", "muted"]], cells));
  out.push(row([[m.preset, "mauve"]], cells));
  const failed = m.run?.featureErrors ?? [];
  if (failed.length > 0) {
    out.push("", row([["FEATURES THAT FAILED", "red"]], cells));
    for (const f of failed) out.push(row([[`${f.id} ${f.key}`, "red"]], cells));
  }
  return out.slice(0, height).concat(Array.from({ length: Math.max(0, height - out.length) }, () => " ".repeat(cells)));
}

function outcomeCard(m: Model, cells: number): string[] {
  const r = m.run;
  if (!r) return [];
  const o = r.outcome;
  const took = m.startedAt && m.endedAt ? clock(m.endedAt - m.startedAt) : "";
  const headTone: Tone = m.stage === "finished" ? "jade" : m.stage === "stopped" || m.stage === "paused" ? "amber" : "red";
  const head =
    m.stage === "finished" ? "Finished, the project's checks pass"
    : m.stage === "failed" && r.status === "finished" ? "Finished, but the project's checks fail"
    : m.stage === "stopped" ? "Stopped; the run can be resumed"
    : m.stage === "paused" ? "Paused at a subscription limit; resume when it resets"
    : "The run failed";
  const size = o ? `${o.files.length} file${o.files.length === 1 ? "" : "s"} (+${o.insertions} −${o.deletions})` : "no changes";
  const lines = [row([[head, headTone]], cells), row([[`${size}  ·  ≈${money(m.cost)} estimated (expert ${money(m.expertCost)})  ·  ${took}`, "muted"]], cells)];
  if (r.reason) for (const t of wrap(r.reason, cells).slice(0, 3)) lines.push(row([[t, r.failure === "engine" ? "red" : "amber"]], cells));
  const canApply = r.status === "finished" && (o?.files.length ?? 0) > 0;
  const actions: Part[] = [
    ...(canApply ? ([["a", "jade"], [" apply  ", "muted"], ["d", "jade"], [" diff  ", "muted"], ["x", "jade"], [" discard  ", "muted"]] as Part[]) : []),
    ["1–5", "jade"],
    [m.rating ? ` rated ${m.rating}  ` : " rate vs your usual way  ", "muted"],
    ["i", "jade"],
    [" new instruction", "muted"],
  ];
  lines.push(row(actions, cells));
  return lines.map((l) => `${surface()}  ${l}  ${canvas()}`);
}

function workspace(m: Model, c: Composer, cols: number, rows: number): Frame {
  const frame = Math.floor(Date.now() / 120);
  const railW = cols >= 110 && rows >= 20 ? Math.min(40, Math.max(32, Math.floor(cols * 0.24))) : 0;
  const centerW = cols - (railW > 0 ? railW + 1 : 0);
  const pad = 2;
  const readW = Math.min(centerW - pad * 2, 100);
  const running = !m.run && m.stage !== "idle";

  // Header and pipeline.
  const status = running ? `${m.stage.toUpperCase()}  ${m.startedAt ? clock(Date.now() - m.startedAt) : ""}` : m.stage.toUpperCase();
  const header = row([[" NEUROMESH", "bold"], [` / ${m.repo ?? ""}`, "muted"]], centerW - width(status) - 2) + row([[status, running ? "blue" : m.stage === "finished" ? "jade" : "amber"]], width(status) + 2);
  const steps: Part[] = [[" "]];
  for (const [i, s] of pipeline(m).entries()) {
    if (i > 0) steps.push([" ── ", "muted"]);
    const icon = s.state === "done" ? "✓" : s.state === "active" ? "●" : s.state === "failed" ? "✗" : s.state === "skipped" ? "–" : "○";
    const tone: Tone = s.state === "done" ? "jade" : s.state === "active" ? "blue" : s.state === "failed" ? "red" : "muted";
    steps.push([`${icon} ${s.label}`, tone]);
  }
  const top = [header, row(steps, centerW), hairline("─".repeat(centerW))];

  // Bottom: live agents, then the outcome card or the composer, then the footer.
  const live = [...m.agents.values()].filter((a) => a.working);
  const liveLines = live.slice(0, 3).map((a) => row([["  "], [`${SPIN[frame % SPIN.length]} `, "blue"], [`${a.role}${a.task && a.task !== "main" ? ` ${a.task}` : ""}`, "plain"], [` · ${a.model}`, "muted"], [a.last ? ` · ${a.last}` : " · working", "muted"]], centerW));
  const boxW = Math.min(centerW - pad * 2, readW + 4);
  const showCard = m.focus === "outcome" && m.run;
  const placeholder = running ? "Draft the next instruction while this runs…" : "Give another instruction…";
  const box = showCard
    ? { lines: outcomeCard(m, boxW - 4), cursorRow: 0, cursorCol: 0 }
    : composerBox(c, boxW, placeholder, [[running ? "Enter sends once the run ends" : m.preset, "muted"]], ["Enter send", "jade"], Math.max(1, Math.min(6, rows - 14)));
  const toastText = m.toast && m.toast.until > Date.now() ? m.toast.text : "";
  const hints = m.focus === "outcome" ? "i compose · Ctrl+Q quit" : running ? "Esc stop · PgUp/PgDn scroll · Ctrl+Q quit" : "Enter send · Alt+Enter newline · PgUp/PgDn scroll · Ctrl+Q quit";
  const footer = row([[` ${toastText || hints}`, toastText ? (m.toast?.tone ?? "jade") : "muted"]], centerW - 10) + row([[`${cols}×${rows} `, "muted"]], 10);
  const bottom = [...liveLines, "", ...box.lines.map((l) => " ".repeat(pad) + l), footer];

  // The transcript fills the middle, pinned to the newest line unless scrolled.
  const height = Math.max(1, rows - top.length - bottom.length);
  const all = m.items.flatMap((it) => itemLines(it, readW)).map((l) => " ".repeat(pad) + l);
  const maxScroll = Math.max(0, all.length - height);
  m.scroll = Math.min(m.scroll, maxScroll);
  const end = all.length - m.scroll;
  const middle = all.slice(Math.max(0, end - height), end);
  while (middle.length < height) middle.push("");

  const centerLines = [...top, ...middle, ...bottom].slice(0, rows);
  const railLines = railW > 0 ? rail(m, railW - 2, rows, frame) : [];
  const lines = centerLines.map((l, i) => {
    const base = canvas() + padTo(l, centerW);
    return railW > 0 ? base + hairline("│") + " " + railLines[i] + " " : base;
  });
  const boxTop = top.length + height + liveLines.length + 1;
  const cursor = showCard ? undefined : { row: boxTop + box.cursorRow, col: pad + box.cursorCol };
  return { lines, cursor };
}

/** Pad a styled line to `cells` (measured without escape codes), cutting if needed. */
function padTo(line: string, cells: number): string {
  const w = width(line);
  return w <= cells ? line + " ".repeat(cells - w) : line;
}

function diffView(m: Model, cols: number, rows: number): Frame {
  const d = m.diff!;
  const height = rows - 2;
  d.scroll = Math.max(0, Math.min(d.scroll, Math.max(0, d.lines.length - height)));
  const head = row([[" DIFF", "jade"], [`  ${m.runId ?? ""}  ·  ${d.lines.length} lines`, "muted"]], cols - 30) + row([["j/k PgUp/PgDn scroll · q back ", "muted"]], 30);
  const body = d.lines.slice(d.scroll, d.scroll + height).map((l) => {
    const tone: Part[1] = l.startsWith("+++") || l.startsWith("---") ? "bold" : l.startsWith("+") ? "jade" : l.startsWith("-") ? "red" : l.startsWith("@@") ? "mauve" : l.startsWith("diff ") ? "blue" : "plain";
    return row([[" "], [l.replace(/\t/g, "    "), tone]], cols);
  });
  while (body.length < height) body.push("");
  const pct = d.lines.length <= height ? "all" : `${Math.round(((d.scroll + height) / d.lines.length) * 100)}%`;
  return { lines: [head, ...body, row([[` ${pct}`, "muted"]], cols)].map((l) => canvas() + padTo(l, cols)) };
}

export { padEnd };
