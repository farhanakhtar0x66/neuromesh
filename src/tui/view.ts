// [F19 tui] Screens as pure functions: model and terminal size in, lines out.
//
// Landing: the logo and a prompt box, nothing else. Workspace: sessions on the
// left (wide terminals), one stream in the middle (no tabs; diffs appear in it),
// and what a person running agents needs on the right. One bottom bar
// everywhere: the key for the command popup, the preset and the working folder.

import { isOn } from "../features.ts";
import { COMMANDS } from "./commands.ts";
import type { Composer } from "./composer.ts";
import { diffRows, gutterWidth } from "./diff.ts";
import { buildUp, countUp, ease, progress, scramble, sweep, typed } from "./anim.ts";
import { nowOf, pipeline } from "./model.ts";
import type { AgentView, Choice, Item, Model } from "./model.ts";
import { cellWidth, graphemes, truncate, width, wrap } from "./text.ts";
import { border, canvas, fg } from "./theme.ts";
import type { Tone } from "./theme.ts";

export interface Frame {
  lines: string[];
  cursor?: { row: number; col: number };
}

type Part = [text: string, tone?: Tone | "bold" | "plain"];

/** One line from styled parts, cut to `cells`. Widths are measured on the plain text. */
export function row(parts: Part[], cells: number, fill = true): string {
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

const blank = (cells: number): string => " ".repeat(Math.max(0, cells));

/** A styled line padded (never cut) to `cells`. */
function padTo(line: string, cells: number): string {
  const w = width(line);
  return w < cells ? line + blank(cells - w) : line;
}

// The owner's logos: a wide one, and a small one for narrower terminals.
const LOGO_WIDE: string[] = [
  "      ::::    ::: :::::::::: :::    ::: :::::::::   ::::::::    :::   :::   :::::::::: ::::::::  :::    :::",
  "     :+:+:   :+: :+:        :+:    :+: :+:    :+: :+:    :+:  :+:+: :+:+:  :+:       :+:    :+: :+:    :+: ",
  "    :+:+:+  +:+ +:+        +:+    +:+ +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+       +:+        +:+    +:+  ",
  "   +#+ +:+ +#+ +#++:++#   +#+    +:+ +#++:++#:  +#+    +:+ +#+  +:+  +#+ +#++:++#  +#++:++#++ +#++:++#++   ",
  "  +#+  +#+#+# +#+        +#+    +#+ +#+    +#+ +#+    +#+ +#+       +#+ +#+              +#+ +#+    +#+    ",
  " #+#   #+#+# #+#        #+#    #+# #+#    #+# #+#    #+# #+#       #+# #+#       #+#    #+# #+#    #+#     ",
  "###    #### ##########  ########  ###    ###  ########  ###       ### ########## ########  ###    ###      ",
];
const LOGO_SMALL: string[] = [" /|/_     __  _ _  _   _/_", "/ |/_'/_///_// / //_'_\\/ /"];

/** The wide logo shaded by density: ":" quiet, "+" green, "#" bright. */
function shade(line: string): string {
  let out = "";
  let run = "";
  let tone: Tone | "bold" | "" = "";
  const flush = (): void => {
    if (run) out += tone === "" ? run : tone === "bold" ? fg("text", run, true) : fg(tone, run);
    run = "";
  };
  for (const ch of line) {
    const t = ch === ":" ? "muted" : ch === "+" ? "jade" : ch === "#" ? "bold" : "";
    if (t !== tone && ch !== " ") {
      flush();
      tone = t;
    }
    run += ch;
  }
  flush();
  return out;
}

function logo(m: Model, cols: number, rows: number): string[] {
  // [F30 tui-intro] On opening, the logo builds up by density from the left.
  const p = m.motion && isOn("tui-intro") ? progress(m.introAt, 1_300, nowOf(m)) : 1;
  const build = (lines: string[]): string[] => (p >= 1 ? lines : lines.map((l, i) => buildUp(l, i, lines.length, p)));
  if (cols >= width(LOGO_WIDE[0]!) + 4 && rows >= 22) return build(LOGO_WIDE).map(shade);
  if (cols >= 30) return build(LOGO_SMALL).map((l) => fg("jade", l, true));
  return [fg("jade", "NEUROMESH", true)];
}

/** A prompt box with a rounded border: the text, wrapped, and nothing else. */
function promptBox(c: Composer, boxW: number, placeholder: string, maxRows: number, lit = false): { lines: string[]; cursorRow: number; cursorCol: number } {
  const edge = (t: string): string => (lit ? fg("jade", t) : border(t));
  const inner = boxW - 6;
  const { lines: text, row: crow, col: ccol } = c.layout(inner);
  const visible = Math.max(1, Math.min(maxRows, text.length));
  const first = Math.max(0, Math.min(crow - visible + 1, text.length - visible));
  const empty = c.text === "";
  const shown = empty ? [placeholder] : text.slice(first, first + visible);
  const lines = [edge(`╭${"─".repeat(boxW - 2)}╮`)];
  for (const [i, t] of shown.entries()) {
    lines.push(edge("│ ") + row([[i === 0 ? "› " : "  ", "jade"], [t, empty ? "muted" : "plain"]], boxW - 4) + edge(" │"));
  }
  lines.push(edge(`╰${"─".repeat(boxW - 2)}╯`));
  return { lines, cursorRow: 1 + (crow - first), cursorCol: 4 + ccol };
}

/** [F21 tui-slash] [F22 tui-mentions] The dropdown of suggestions, drawn just above the prompt box. */
function suggestLines(m: Model, boxW: number): string[] {
  const s = m.suggest;
  if (!s || s.items.length === 0) return [];
  const labelW = Math.min(Math.max(...s.items.map((i) => width(i.label))) + 2, Math.floor(boxW * 0.6));
  return s.items.map((it, i) => {
    const on = i === s.index;
    return row([["  "], [on ? "› " : "  ", "jade"], [truncate(it.label, labelW - 2).padEnd(labelW), on ? "jade" : "plain"], [it.detail ?? "", on ? "plain" : "muted"]], boxW);
  });
}

/** A folder path that fits: home as ~, and middle folders dropped first ("~/…/app/src"). */
export function shortPath(path: string, max: number): string {
  const home = process.env.HOME ?? "";
  const p = home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
  if (width(p) <= max) return p;
  const parts = p.split("/");
  const head = parts[0] ?? "";
  let tail = parts.at(-1)!;
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}/${tail}`;
    if (width(`${head}/…/${next}`) > max) break;
    tail = next;
  }
  const short = `${head}/…/${tail}`;
  return width(short) <= max ? short : truncate(parts.at(-1)!, max);
}

/** The bottom bar: a hint (or a message) on the left, preset and working folder on the right. */
function bottomBar(m: Model, cols: number, hint: Part[]): string {
  const rightMax = Math.floor(cols * 0.55);
  const cwd = shortPath(m.cwd, Math.max(8, rightMax - width(m.preset) - 3));
  const right: Part[] = [[m.preset, "mauve"], [`  ${cwd} `, "muted"]];
  const rightW = Math.min(rightMax, width(m.preset) + width(cwd) + 3);
  const now = nowOf(m);
  const toast = m.toast && m.toast.until > now ? m.toast : undefined;
  // [F29 tui-motion] A message types in, then dims just before it goes.
  const text = toast && m.motion ? typed(toast.text, progress(toast.at, 220, now)) : toast?.text;
  const tone: Tone | undefined = toast && m.motion && toast.until - now < 500 ? "muted" : toast?.tone;
  const left: Part[] = toast ? [[` ${text}`, tone]] : [[" "], ...hint];
  return row(left, cols - rightW) + row(right, rightW);
}

const HINT: Part[] = [["ctrl+p", "plain"], [" commands", "muted"]];

function centerText(text: string, cells: number): string {
  const w = width(text);
  if (w >= cells) return text;
  const left = Math.floor((cells - w) / 2);
  return blank(left) + text + blank(cells - w - left);
}

function tooSmall(cols: number, rows: number): Frame {
  const lines = Array.from({ length: rows }, () => canvas());
  const msg = [`Too small: ${cols}×${rows}`, "Needs 40×12.", "A run keeps going.", "Ctrl+Q quits."];
  const top = Math.max(0, Math.floor((rows - msg.length) / 2));
  for (const [i, m] of msg.entries()) if (top + i < rows) lines[top + i] = canvas() + centerText(truncate(m, cols), cols);
  return { lines };
}

export function render(m: Model, c: Composer, cols: number, rows: number): Frame {
  if (cols < 40 || rows < 12) return tooSmall(cols, rows);
  const frame = m.focus === "diff" && m.diff ? diffView(m, cols, rows) : m.screen === "landing" ? landing(m, c, cols, rows) : workspace(m, c, cols, rows);
  if (m.picker) return { lines: pickerOverlay(m, frame.lines, cols, rows) };
  if (m.palette) return { lines: paletteOverlay(m, frame.lines, cols, rows) };
  return frame;
}

function landing(m: Model, c: Composer, cols: number, rows: number): Frame {
  const boxW = Math.min(76, cols - 6);
  const mark = logo(m, cols, rows);
  const box = promptBox(c, boxW, "What should we build?", Math.max(1, Math.min(8, rows - mark.length - 9)), m.motion && !c.isEmpty);
  const drop = suggestLines(m, boxW);
  const block = [...mark, "", "", ...box.lines, ...drop];
  const top = Math.max(0, Math.floor((rows - 1 - block.length) / 2));
  const lines = Array.from({ length: rows }, () => canvas());
  const left = Math.max(0, Math.floor((cols - boxW) / 2));
  for (const [i, l] of block.entries()) {
    const y = top + i;
    if (y >= rows - 1) break;
    const isBox = i >= mark.length + 2;
    lines[y] = canvas() + (isBox ? blank(left) + l : centerText(l, cols));
  }
  if (m.repoError) lines[rows - 2] = canvas() + row([[" "], [m.repoError, "red"]], cols);
  lines[rows - 1] = canvas() + bottomBar(m, cols, HINT);
  return { lines, cursor: { row: top + mark.length + 2 + box.cursorRow, col: left + box.cursorCol } };
}

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const money = (n: number): string => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

// ---------------------------------------------------------------------------
// [F20 tui-working] The working line: a pulsing glyph and a verb for what the
// team is doing, with a light sweeping across it, then time, tokens and how to
// stop. One line per active agent beneath, as Claude Code does.

const GLYPH = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
export const VERBS: Record<string, string[]> = {
  planning: ["Planning", "Sketching", "Scheming", "Mapping it out", "Thinking it through"],
  building: ["Cooking", "Building", "Wiring", "Crafting", "Hammering", "Brewing", "Tinkering"],
  checking: ["Testing", "Checking", "Verifying", "Running the checks"],
  reviewing: ["Reviewing", "Inspecting", "Scrutinising", "Poking at it"],
};

/** The verb for the moment: changes every few seconds, the same on every redraw in between. */
export function verbFor(stage: string, elapsedMs: number): string {
  const list = VERBS[stage] ?? VERBS.building!;
  return list[Math.floor(elapsedMs / 4_500) % list.length]!;
}

function shimmer(text: string, frame: number, tone: Tone): string {
  const chars = [...text];
  const at = (frame % (chars.length + 8)) - 4;
  let out = "";
  for (const [i, ch] of chars.entries()) out += Math.abs(i - at) <= 1 ? fg("text", ch, true) : fg(tone, ch);
  return out;
}

function workingLines(m: Model, cells: number, frame: number): string[] {
  const live = [...m.agents.values()].filter((a) => a.working);
  if (!isOn("tui-working")) {
    return live.slice(0, 3).map((a) => row([["  "], [`${SPIN[frame % SPIN.length]} `, "blue"], [a.role, "plain"], [` · ${a.model}`, "muted"], [a.last ? ` · ${a.last}` : "", "muted"]], cells));
  }
  const elapsed = m.startedAt ? nowOf(m) - m.startedAt : 0;
  const word = verbFor(m.stage, elapsed);
  // [F29 tui-motion] When the verb changes, it decodes into the new one.
  const phase = elapsed % 4_500;
  const verb = `${m.motion && elapsed > 4_500 && phase < 420 ? scramble(word, phase / 420, frame) : word}…`;
  const tokens = [...m.agents.values()].reduce((n, a) => n + a.tokens, 0);
  const meta = ` (${clock(elapsed)}${tokens > 0 ? ` · ${Math.round(tokens / 1000)}k tokens` : ""} · esc esc to stop)`;
  const glyph = fg("amber", GLYPH[frame % GLYPH.length]!);
  const head = padTo(`  ${glyph} ${shimmer(verb, frame, "amber")}${fg("muted", truncate(meta, Math.max(0, cells - width(verb) - 6)))}`, cells);
  const subs = live.slice(0, 4).map((a) => row([["    ⎿ ", "muted"], [`${a.role}${a.task && a.task !== "main" ? ` ${a.task}` : ""}`, "plain"], [` · ${a.model}`, "muted"], [a.last ? ` · ${a.last}` : " · starting", "muted"]], cells));
  return [head, ...subs];
}

// ---------------------------------------------------------------------------
// The stream.

const DIFF_ROWS_INLINE = 60;

/** [F27 tui-diff-numbers] Diff rows with old and new line numbers. */
function diffLines(lines: string[], cells: number, limit?: number): string[] {
  if (!isOn("tui-diff-numbers")) {
    return lines.slice(0, limit).map((l) => row([[l, l.startsWith("+") ? "jade" : l.startsWith("-") ? "red" : l.startsWith("@@") ? "mauve" : "muted"]], cells));
  }
  const rows = diffRows(lines);
  const g = gutterWidth(rows);
  const out: string[] = [];
  for (const r of limit === undefined ? rows : rows.slice(0, limit)) {
    const num = (n: number | undefined): string => (n === undefined ? " ".repeat(g) : String(n).padStart(g));
    const text = r.text.replace(/\t/g, "    ");
    if (r.kind === "file") out.push("", row([["▸ ", "blue"], [text, "bold"]], cells));
    else if (r.kind === "hunk") out.push(row([[" ".repeat(g * 2 + 2), "muted"], ["⋯ ", "mauve"], [text, "muted"]], cells));
    else if (r.kind === "meta") out.push(row([[" ".repeat(g * 2 + 2)], [text, "muted"]], cells));
    else {
      const tone: Tone | "plain" = r.kind === "add" ? "jade" : r.kind === "del" ? "red" : "plain";
      const sign = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
      out.push(row([[`${num(r.old)} ${num(r.new)} `, "muted"], [`${sign} `, tone], [text, tone]], cells));
    }
  }
  return out;
}

function itemLines(item: Item, cells: number, details: boolean, now = 0, motion = false): string[] {
  const w = Math.max(10, cells);
  // [F29 tui-motion] What just arrived is bright for a moment.
  const fresh = motion && item.at !== undefined && now - item.at < 650;
  switch (item.kind) {
    case "you":
      return ["", ...wrap(item.text, w - 2).map((t, i) => row([[i === 0 ? "› " : "  ", "jade"], [t, "bold"]], w)), ""];
    case "neuromesh":
      return wrap(item.text, w - 2).map((t, i) => row([[i === 0 ? "◆ " : "  ", item.tone ?? "jade"], [t, fresh ? "bold" : (item.tone ?? "plain")]], w));
    case "activity":
      return wrap(item.text, w - 2).map((t) => row([["  "], [t, item.tone ?? (fresh ? "plain" : "muted")]], w));
    case "detail":
      return details ? wrap(item.text, w - 6).map((t, i) => row([[i === 0 ? "    ⎿ " : "      ", "muted"], [t, "muted"]], w)) : [];
    case "error":
      return wrap(item.text, w - 2).map((t, i) => row([[i === 0 ? "! " : "  ", "red"], [t, "red"]], w));
    case "diff": {
      const lines = item.lines ?? [];
      let rows = diffLines(lines, w - 2, DIFF_ROWS_INLINE).map((l) => "  " + l);
      // [F29 tui-motion] The change unrolls line by line as the run ends.
      if (motion && item.at !== undefined) rows = rows.slice(0, Math.ceil(rows.length * ease(progress(item.at, 900, now))));
      const total = isOn("tui-diff-numbers") ? diffRows(lines).length : lines.length;
      const more = total > DIFF_ROWS_INLINE ? [row([["  "], [`… ${total - DIFF_ROWS_INLINE} more lines · d for the whole diff`, "muted"]], w)] : [];
      return ["", row([["◆ ", "jade"], [item.text, "bold"]], w), ...rows, ...more];
    }
    case "outcome":
      return ["", ...wrap(item.text, w - 2).map((t) => row([["  "], [t, item.tone ?? "plain"]], w))];
    default:
      return wrap(item.text, w - 2).map((t) => row([["  "], [t, item.tone ?? (fresh ? "plain" : "muted")]], w));
  }
}

function sessionsPane(m: Model, cells: number, height: number): string[] {
  const pulse = m.motion && !m.run && m.stage !== "idle" && Math.floor(nowOf(m) / 500) % 2 === 0;
  const out: string[] = [row([[" Sessions", "bold"]], cells - 7) + row([["ctrl+s", "muted"]], 7), ""];
  if (m.sessions.length === 0) out.push(row([[" none yet in this folder", "muted"]], cells));
  for (const s of m.sessions) {
    if (out.length + 3 > height) break;
    const current = s.id === m.runId;
    const mark: Part =
      s.status === "running" ? ["● ", "blue"]
      : s.status === "applied" ? ["✓ ", "jade"]
      : s.status === "finished" ? ["◆ ", "amber"]
      : s.status === "failed" ? ["✗ ", "red"]
      : s.status === "discarded" ? ["– ", "muted"]
      : ["○ ", "amber"];
    const label = s.status === "finished" ? "ready to review" : s.status;
    out.push(row([[current ? "▌" : " ", current && pulse ? "bold" : "jade"], mark, [s.title, current ? "bold" : "plain"]], cells));
    out.push(row([["   "], [`${label} · ${ago(s.at)}${s.files ? ` · ${s.files} file${s.files === 1 ? "" : "s"}` : ""}`, "muted"]], cells), "");
  }
  while (out.length < height) out.push(blank(cells));
  return out.slice(0, height);
}

function agentRows(a: AgentView, cells: number, frame: number, now = 0, motion = false): string[] {
  const flash = motion && !a.working && !a.failed && a.doneAt !== undefined && now - a.doneAt < 700;
  const mark: Part = a.working ? [`${SPIN[frame % SPIN.length]} `, "blue"] : a.failed ? ["✗ ", "red"] : ["✓ ", flash ? "bold" : "jade"];
  const name = `${a.role}${a.task && a.task !== "main" ? ` ${a.task}` : ""}`;
  const state = a.working ? "active" : a.failed ? "stopped" : "done";
  const top = row([mark, [name, a.role === "Expert" || a.role === "Planner" ? "mauve" : "plain"]], cells - state.length) + row([[state, a.working ? "blue" : a.failed ? "red" : "muted"]], state.length);
  const detail = `${a.model} · ${a.turns} turn${a.turns === 1 ? "" : "s"} · ${Math.round(a.tokens / 1000)}k tok · ${a.cost === undefined ? "cost unknown" : `≈${money(a.cost)}`}`;
  return [top, row([["  "], [detail, "muted"]], cells)];
}

/** What someone running agents needs to see at a glance. */
function infoPane(m: Model, cells: number, height: number, frame: number): string[] {
  const out: string[] = [];
  const head = (t: string): void => void out.push(row([[t, "muted"]], cells));
  const gap = (): void => void out.push("");
  const running = !m.run && m.stage !== "idle";
  const r = m.run;

  // What needs the person comes first.
  if (r && r.status === "finished" && (r.outcome?.files.length ?? 0) > 0) {
    head("WAITING FOR YOU");
    out.push(row([["a", "bold"], [" apply  ", "muted"], ["d", "bold"], [" diff  ", "muted"], ["x", "bold"], [" discard", "muted"]], cells));
    gap();
  } else if (r && ["interrupted", "paused", "failed"].includes(r.status)) {
    head("WAITING FOR YOU");
    out.push(row([["r", "bold"], [" resume the run", "muted"]], cells));
    gap();
  }

  head("STATUS");
  const stageTone: Tone = running ? "blue" : m.stage === "finished" ? "jade" : m.stage === "idle" ? "muted" : "amber";
  const took = m.startedAt ? clock((m.endedAt ?? Date.now()) - m.startedAt) : "";
  out.push(row([[m.stage === "idle" ? "ready" : m.stage, stageTone], [took ? `  ${took}` : "", "muted"]], cells));
  if (r?.reason) for (const t of wrap(r.reason, cells).slice(0, 3)) out.push(row([[t, r.failure === "engine" ? "red" : "amber"]], cells));
  gap();

  if (m.agents.size === 0) {
    head("TEAM");
    for (const t of m.team) out.push(row([[t.role.padEnd(9), "muted"], [t.model, "plain"]], cells));
  } else {
    head("AGENTS");
    for (const a of m.agents.values()) out.push(...agentRows(a, cells, frame, nowOf(m), m.motion));
  }
  gap();

  if (m.checks.size > 0) {
    head("CHECKS");
    for (const [name, status] of m.checks) {
      const tone: Tone = status.startsWith("passed") ? "jade" : status.startsWith("failed") || status.startsWith("timeout") ? "red" : "muted";
      out.push(row([[name, "plain"], [`  ${status}`, tone]], cells));
    }
    gap();
  }

  if (m.verdict) {
    head("REVIEW");
    out.push(row([[m.verdict.verdict === "pass" ? "✓ passed" : "✗ changes asked", m.verdict.verdict === "pass" ? "jade" : "amber"]], cells));
    for (const t of wrap(m.verdict.summary, cells).slice(0, 2)) out.push(row([[t, "muted"]], cells));
    gap();
  }

  const o = r?.outcome;
  if (o && o.files.length > 0) {
    head(`CHANGES  +${o.insertions} −${o.deletions}`);
    for (const f of o.files.slice(0, 8)) {
      const stat = f.binary ? "binary" : `+${f.insertions} −${f.deletions}`;
      out.push(row([[f.path, "plain"]], cells - stat.length - 1) + " " + row([[stat, "muted"]], stat.length));
    }
    if (o.files.length > 8) out.push(row([[`and ${o.files.length - 8} more`, "muted"]], cells));
    gap();
  }

  head("COST  estimated");
  const costLine = (label: string, value: string, tone: Tone | "plain"): string => row([[label, "muted"]], cells - width(value)) + row([[value, tone]], width(value));
  // [F29 tui-motion] The total counts up to its new value.
  const shown = m.motion ? countUp(m.costFrom, m.cost, m.costAt, 700, nowOf(m)) : m.cost;
  out.push(costLine("all models", m.costUnknown && m.cost === 0 ? "unknown" : money(shown), "plain"));
  out.push(costLine("expert", money(m.expertCost), "mauve"));
  if (m.budgetUsd !== undefined) out.push(costLine("expert budget", `${Math.round((m.expertCost / m.budgetUsd) * 100)}% of ${money(m.budgetUsd)}`, m.expertCost >= m.budgetUsd ? "red" : "muted"));
  if (m.costUnknown) out.push(row([["some turns unpriced", "amber"]], cells));
  gap();

  const failed = r?.featureErrors ?? [];
  if (failed.length > 0) {
    head("FEATURES THAT FAILED");
    for (const f of failed) out.push(row([[`${f.id} ${f.key}`, "red"]], cells));
    gap();
  }
  if (m.runId) out.push(row([[m.runId, "muted"]], cells));
  while (out.length < height) out.push(blank(cells));
  return out.slice(0, height).map((l) => padTo(l, cells));
}

function outcomeCard(m: Model, cells: number): string[] {
  const r = m.run;
  if (!r) return [];
  const o = r.outcome;
  const took = m.startedAt && m.endedAt ? clock(m.endedAt - m.startedAt) : "";
  const headTone: Tone = m.stage === "finished" ? "jade" : m.stage === "stopped" || m.stage === "paused" ? "amber" : "red";
  const head =
    r.status === "applied" ? "Applied to your repository"
    : r.status === "discarded" ? "Discarded"
    : m.stage === "finished" ? "Finished, the project's checks pass"
    : m.stage === "failed" && r.status === "finished" ? "Finished, but the project's checks fail"
    : m.stage === "stopped" ? "Stopped; the run can be resumed"
    : m.stage === "paused" ? "Paused at a subscription limit; resume when it resets"
    : "The run failed";
  const size = o ? `${o.files.length} file${o.files.length === 1 ? "" : "s"} (+${o.insertions} −${o.deletions})` : "no changes";
  const canApply = r.status === "finished" && (o?.files.length ?? 0) > 0;
  const canResume = ["interrupted", "paused", "failed"].includes(r.status);
  const keys: Part[] = [
    ...(canApply ? ([["a", "bold"], [" apply  ", "muted"], ["d", "bold"], [" diff  ", "muted"], ["x", "bold"], [" discard  ", "muted"]] as Part[]) : []),
    ...(canResume ? ([["r", "bold"], [" resume  ", "muted"]] as Part[]) : []),
    ["1-5", "bold"],
    [m.rating ? ` rated ${m.rating}  ` : " rate  ", "muted"],
    ["i", "bold"],
    [" new instruction", "muted"],
  ];
  const took2 = took ? `  ·  ${took}` : "";
  const now = nowOf(m);
  // [F29 tui-motion] A little sparkle for a run that went well.
  const twinkle = m.motion && m.stage === "finished" && r.status === "finished" && m.endedAt !== undefined && now - m.endedAt < 2_600 ? ` ${["✦", "✧", "⋆", "✧"][Math.floor(now / 160) % 4]}` : "";
  const lines = [row([[head, headTone], [twinkle, "amber"]], cells - 4), row([[`${size}  ·  ≈${money(m.cost)} (expert ${money(m.expertCost)})${took2}`, "muted"]], cells - 4), row(keys, cells - 4)];
  const card = [border(`╭${"─".repeat(cells - 2)}╮`), ...lines.map((l) => border("│ ") + l + border(" │")), border(`╰${"─".repeat(cells - 2)}╯`)];
  // [F29 tui-motion] The card drops in from the top as the run ends.
  if (!m.motion) return card;
  const shownRows = Math.ceil(card.length * ease(progress(m.endedAt, 420, now)));
  return card.map((l, i) => (i < shownRows ? l : blank(cells)));
}

function workspace(m: Model, c: Composer, cols: number, rows: number): Frame {
  const now = nowOf(m);
  const frame = Math.floor(now / 120);
  const three = cols >= 150 && rows >= 24;
  const leftW = three ? 30 : 0;
  const rightW = cols >= 110 && rows >= 20 ? Math.min(40, Math.max(34, Math.floor(cols * 0.22))) : 0;
  const centerW = cols - (leftW ? leftW + 1 : 0) - (rightW ? rightW + 1 : 0);
  const pad = 2;
  const readW = Math.min(centerW - pad * 2, 100);
  const running = !m.run && m.stage !== "idle";
  const bodyRows = rows - 1;

  // Center: title and pipeline, the stream, the working line, then the prompt or the outcome.
  const title = row([[" "], [m.repo ?? "", "bold"], [m.details ? "   details on" : "", "muted"]], centerW);
  const steps: Part[] = [[" "]];
  const stages = pipeline(m);
  const activeAt = stages.findIndex((s) => s.state === "active");
  for (const [i, s] of stages.entries()) {
    if (i > 0) steps.push([" ─ ", "muted"]);
    // [F29 tui-motion] The active step pulses; the one just finished flashes.
    const pulse = m.motion && s.state === "active" && Math.floor(now / 520) % 2 === 1;
    const justDone = m.motion && s.state === "done" && i === activeAt - 1 && m.stageAt !== undefined && now - m.stageAt < 900;
    const icon = s.state === "done" ? "✓" : s.state === "active" ? (pulse ? "◉" : "●") : s.state === "failed" ? "✗" : s.state === "skipped" ? "–" : "○";
    const tone: Tone | "bold" = justDone ? "bold" : s.state === "done" ? "jade" : s.state === "active" ? (pulse ? "bold" : "blue") : s.state === "failed" ? "red" : "muted";
    steps.push([`${icon} ${s.label.toLowerCase()}`, tone]);
  }
  // [F29 tui-motion] While the team works, a light sweeps along under the pipeline.
  const scanner = (): string => {
    const track = Math.max(10, Math.min(centerW - 2, 60));
    const at = sweep(now, track);
    let line = " ";
    for (let x = 0; x < track; x++) {
      const d = Math.abs(x - at);
      line += d === 0 ? fg("text", "━", true) : d <= 2 ? fg("jade", "━") : d <= 5 ? fg("muted", "─") : border("─");
    }
    return line;
  };
  const top = [title, row(steps, centerW), running && m.motion ? scanner() : ""];

  const working = running ? workingLines(m, centerW, frame) : [];
  const boxW = Math.min(centerW - pad * 2, readW + 2);
  const showCard = m.focus === "outcome" && m.run;
  const box = showCard ? { lines: outcomeCard(m, boxW), cursorRow: 0, cursorCol: 0 } : promptBox(c, boxW, running ? "Draft the next instruction…" : "Give another instruction…  (/ for commands, @ for files)", Math.max(1, Math.min(6, bodyRows - 12)), m.motion && !c.isEmpty);
  const drop = showCard ? [] : suggestLines(m, boxW);

  const all = m.items.flatMap((it) => itemLines(it, readW, m.details, now, m.motion)).map((l) => blank(pad) + l);
  const fixed = top.length + working.length + box.lines.length + drop.length + (working.length ? 1 : 0);
  let height = Math.max(1, bodyRows - fixed);
  const maxScroll = Math.max(0, all.length - height);
  m.scroll = Math.min(m.scroll, maxScroll);
  // [F20] When scrolled up, a line says how much is below.
  const scrollHint = m.scroll > 0 ? [row([["  "], [`↓ ${m.scroll} more line${m.scroll === 1 ? "" : "s"} below · pgdn`, "muted"]], centerW)] : [];
  height = Math.max(1, height - scrollHint.length);
  const end = all.length - m.scroll;
  const middle = all.slice(Math.max(0, end - height), end);
  while (middle.length < height) middle.push("");
  const bottom = [...scrollHint, ...(working.length ? ["", ...working] : []), ...box.lines.map((l) => blank(pad) + l), ...drop.map((l) => blank(pad) + l)];
  const center = [...top, ...middle, ...bottom].slice(0, bodyRows);

  const left = leftW ? sessionsPane(m, leftW - 1, bodyRows) : [];
  const right = rightW ? infoPane(m, rightW - 2, bodyRows, frame) : [];
  const sep = border("│");
  const lines = center.map((l, i) => canvas() + (leftW ? padTo(left[i] ?? "", leftW) + sep : "") + padTo(l, centerW) + (rightW ? sep + " " + padTo(right[i] ?? "", rightW - 1) : ""));
  const hint: Part[] = running ? [["ctrl+p", "plain"], [" commands  ", "muted"], ["ctrl+o", "plain"], [" details", "muted"]] : HINT;
  lines.push(canvas() + bottomBar(m, cols, hint));
  const boxTop = top.length + height + scrollHint.length + (working.length ? working.length + 1 : 0);
  const cursor = showCard ? undefined : { row: boxTop + box.cursorRow, col: (leftW ? leftW + 1 : 0) + pad + box.cursorCol };
  return { lines, cursor };
}

function diffView(m: Model, cols: number, rows: number): Frame {
  const d = m.diff!;
  const height = rows - 2;
  const body = diffLines(d.lines, cols - 2);
  d.scroll = Math.max(0, Math.min(d.scroll, Math.max(0, body.length - height)));
  const head = row([[" Diff", "bold"], [`  ${m.run?.outcome ? `${m.run.outcome.files.length} files  +${m.run.outcome.insertions} −${m.run.outcome.deletions}` : ""}`, "muted"]], cols);
  const shown = body.slice(d.scroll, d.scroll + height).map((l) => " " + l);
  while (shown.length < height) shown.push("");
  const pct = body.length <= height ? "all" : `${Math.round(((d.scroll + height) / body.length) * 100)}%`;
  const bar = row([[" j/k", "plain"], [" scroll  ", "muted"], ["space", "plain"], [" page  ", "muted"], ["q", "plain"], [" back  ", "muted"], [pct, "muted"]], cols);
  return { lines: [head, ...shown, bar].map((l) => canvas() + padTo(l, cols)) };
}

// ---------------------------------------------------------------------------
// Popups drawn over the screen.

/** Draw `insert` (styled, `insertW` cells) over `line` at cell `col`, keeping the line's colours on both sides. */
export function overlay(line: string, col: number, insert: string, insertW: number): string {
  let out = "";
  let held = "";
  let cell = 0;
  let inserted = false;
  const put = (): void => {
    if (inserted) return;
    out += `\x1b[0m${canvas()}${insert}\x1b[0m${canvas()}`;
    inserted = true;
  };
  for (const tok of line.match(/\x1b\[[0-9;?]*[ -/]*[@-~]|[^\x1b]+/g) ?? []) {
    if (tok.startsWith("\x1b")) {
      // Colour changes inside the covered part take effect after it.
      if (cell >= col && cell < col + insertW) held += tok;
      else out += tok;
      continue;
    }
    for (const g of graphemes(tok)) {
      const w = cellWidth(g);
      if (cell + w <= col) out += g;
      else if (cell < col) out += " ";
      else if (cell >= col + insertW) {
        if (held) {
          out += held;
          held = "";
        }
        out += g;
      } else put();
      cell += w;
      if (cell >= col) put();
    }
  }
  if (!inserted) {
    out += blank(col - cell);
    put();
  }
  return out + held;
}

function popup(base: string[], cols: number, rows: number, w: number, body: string[], open = 1): string[] {
  const inner = w - 4;
  // [F29 tui-motion] A popup unfolds from its middle as it opens.
  if (open < 1) {
    const keep = Math.max(1, Math.ceil(body.length * ease(open)));
    const from = Math.floor((body.length - keep) / 2);
    body = body.slice(from, from + keep);
  }
  const box = [border(`╭${"─".repeat(w - 2)}╮`), ...body.map((l) => border("│ ") + padTo(l, inner) + border(" │")), border(`╰${"─".repeat(w - 2)}╯`)];
  const top = Math.max(0, Math.floor((rows - box.length) / 2));
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const out = [...base];
  for (const [i, l] of box.entries()) {
    const y = top + i;
    if (y < rows) out[y] = overlay(out[y] ?? "", left, l, w);
  }
  return out;
}

function paletteOverlay(m: Model, base: string[], cols: number, rows: number): string[] {
  const w = Math.min(72, cols - 4);
  const inner = w - 4;
  const index = ((m.palette!.index % COMMANDS.length) + COMMANDS.length) % COMMANDS.length;
  const lines: { text: string; at?: number }[] = [];
  let group = "";
  for (const [n, cmd] of COMMANDS.entries()) {
    if (cmd.group !== group) {
      lines.push({ text: "" }, { text: row([[cmd.group, "muted"]], inner) });
      group = cmd.group;
    }
    const on = n === index;
    lines.push({ text: row([[on ? "› " : "  ", "jade"], [(cmd.slash ?? "").padEnd(10), on ? "jade" : "blue"], [cmd.keys.padEnd(11), "muted"], [cmd.label, on ? "bold" : "plain"]], inner), at: n });
  }
  // Keep the selected row in view on short terminals.
  const room = Math.max(3, rows - 6);
  const sel = lines.findIndex((l) => l.at === index);
  const start = Math.max(0, Math.min(sel - Math.floor(room / 2), lines.length - room));
  const body = [row([["Commands", "bold"]], inner - 3) + row([["esc", "muted"]], 3), ...lines.slice(start, start + room).map((l) => l.text), "", row([["↑↓ choose · enter run · type / in the prompt for these too", "muted"]], inner)];
  return popup(base, cols, rows, w, body, m.motion ? progress(m.palette!.at, 170, nowOf(m)) : 1);
}

/** [F24 tui-sessions] [F25 tui-presets] A list with a filter typed at the top. */
export function pickerChoices(m: Model): Choice[] {
  const p = m.picker!;
  if (!p.query) return p.all;
  const q = p.query.toLowerCase();
  return p.all.filter((c) => `${c.label} ${c.detail ?? ""}`.toLowerCase().includes(q));
}

function pickerOverlay(m: Model, base: string[], cols: number, rows: number): string[] {
  const p = m.picker!;
  const w = Math.min(84, cols - 4);
  const inner = w - 4;
  const items = pickerChoices(m);
  p.index = Math.max(0, Math.min(p.index, items.length - 1));
  const room = Math.max(2, Math.floor((rows - 9) / 2));
  const start = Math.max(0, Math.min(p.index - Math.floor(room / 2), items.length - room));
  const body = [row([[p.title, "bold"]], inner - 3) + row([["esc", "muted"]], 3), row([["› ", "jade"], [p.query || "type to filter", p.query ? "plain" : "muted"]], inner), ""];
  if (items.length === 0) body.push(row([["nothing matches", "muted"]], inner));
  for (const [i, it] of items.slice(start, start + room).entries()) {
    const on = start + i === p.index;
    body.push(row([[on ? "› " : "  ", "jade"], [it.label, on ? "bold" : (it.tone ?? "plain")]], inner));
    body.push(row([["    "], [it.detail ?? "", "muted"]], inner));
  }
  body.push("", row([["↑↓ choose · enter open · esc close", "muted"]], inner));
  return popup(base, cols, rows, w, body, m.motion ? progress(p.at, 170, nowOf(m)) : 1);
}
