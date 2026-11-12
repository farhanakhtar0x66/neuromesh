// [F19 tui] Screens as pure functions: model and terminal size in, a canvas out.
//
// The look follows the owner's sketch. A raised bar at the top (the brand, the
// project, the status), a bar at the bottom (menu, commands, files, the
// folder), and three panes between them on a darker base:
//   left    projects and their sessions, then recent sessions elsewhere
//   middle  the pipeline as buttons, one box per agent, the prompt
//   right   the project, the team as a graph, context, changes, cost
// [F32 tui-layers] Layers are shades of the terminal's background; in
// transparent mode nothing is filled and boxes are drawn with lines.
// [F33 tui-mouse] Everything that can be clicked registers a region.

import { isOn } from "../features.ts";
import { ease, progress, scramble, sweep } from "./anim.ts";
import { buildBlocks, shownLines } from "./blocks.ts";
import type { Block, Line } from "./blocks.ts";
import { Canvas, rect } from "./canvas.ts";
import type { Rect, Region } from "./canvas.ts";
import { COMMANDS } from "./commands.ts";
import { NOTICE } from "../telemetry/telemetry.ts";
import { renderMarkdown, wrapInline } from "./markdown.ts";
import type { MdRow, Span } from "./markdown.ts";
import type { Composer } from "./composer.ts";
import { diffRows, gutterWidth } from "./diff.ts";
import { nowOf, pipeline, prettyModel, shortEffort } from "./model.ts";
import type { AgentView, Choice, Model, SessionView } from "./model.ts";
import { graphemes, truncate, width, wrap } from "./text.ts";
import { ATTR, DEFAULT, colourOn, isTransparent, mix, solid, surface, tone } from "./theme.ts";
import type { Surface, Tone } from "./theme.ts";

export interface Frame {
  canvas: Canvas;
  cursor?: { row: number; col: number };
  regions: Region[];
  /** Stream scroll positions that bring a stage's first box into view. */
  anchors: Record<string, number>;
  /** The stream's height and visible rows, for scrolling by the app. */
  stream?: { total: number; view: number };
  /** Styled rows, for tests and plain output. */
  readonly lines: string[];
}

// The owner's logos: a wide one, and a small one for narrower panes.
export const LOGO_WIDE: string[] = [
  "      ::::    ::: :::::::::: :::    ::: :::::::::   ::::::::    :::   :::   :::::::::: ::::::::  :::    :::",
  "     :+:+:   :+: :+:        :+:    :+: :+:    :+: :+:    :+:  :+:+: :+:+:  :+:       :+:    :+: :+:    :+: ",
  "    :+:+:+  +:+ +:+        +:+    +:+ +:+    +:+ +:+    +:+ +:+ +:+:+ +:+ +:+       +:+        +:+    +:+  ",
  "   +#+ +:+ +#+ +#++:++#   +#+    +:+ +#++:++#:  +#+    +:+ +#+  +:+  +#+ +#++:++#  +#++:++#++ +#++:++#++   ",
  "  +#+  +#+#+# +#+        +#+    +#+ +#+    +#+ +#+    +#+ +#+       +#+ +#+              +#+ +#+    +#+    ",
  " #+#   #+#+# #+#        #+#    #+# #+#    #+# #+#    #+# #+#       #+# #+#       #+#    #+# #+#    #+#     ",
  "###    #### ##########  ########  ###    ###  ########  ###       ### ########## ########  ###    ###      ",
];
// [F48 tui-theme] A smaller NEUROMESH for narrower panes, in the big logo's own
// style: each letter five rows high, light at the top (":") and heavy at the
// bottom ("#").
const LETTERS: Record<string, string[]> = {
  N: ["X...X", "XX..X", "X.X.X", "X..XX", "X...X"],
  E: ["XXXXX", "X....", "XXXX.", "X....", "XXXXX"],
  U: ["X...X", "X...X", "X...X", "X...X", ".XXX."],
  R: ["XXXX.", "X...X", "XXXX.", "X..X.", "X...X"],
  O: [".XXX.", "X...X", "X...X", "X...X", ".XXX."],
  M: ["X...X", "XX.XX", "X.X.X", "X...X", "X...X"],
  S: [".XXXX", "X....", ".XXX.", "....X", "XXXX."],
  H: ["X...X", "X...X", "XXXXX", "X...X", "X...X"],
};
const DENSITY = [":", ":+", "+", "+#", "#"];
export const LOGO_MID: string[] = [0, 1, 2, 3, 4].map((row) =>
  [..."NEUROMESH"]
    .map((ch, li) =>
      [...LETTERS[ch]![row]!].map((c, ci) => (c === "X" ? DENSITY[row]![(li + ci) % DENSITY[row]!.length]! : " ")).join(""),
    )
    .join("  "),
);

const T = tone;
const layered = (): boolean => !isTransparent() && isOn("tui-layers");
const bgOf = (s: Surface): number => (layered() ? surface(s) : DEFAULT);
const pen = (t: Tone, bold = false, bg?: number): { fg: number; attrs: number; bg?: number } => ({ fg: T(t), attrs: bold ? ATTR.bold : 0, ...(bg !== undefined ? { bg } : {}) });

export const ROLE_TONE: Record<string, Tone> = { orchestrator: "mauve", escalation: "mauve", briefer: "cyan", worker: "blue", tester: "amber" };
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const money = (n: number): string => (n === 0 ? "$0.00" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
const kTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));

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

// ---------------------------------------------------------------------------
// Drawing helpers.

export interface FrameOpts {
  /** The frame's line colour; the theme's border colour when left out. */
  edge?: Tone;
  /** Set into the top edge, after "╭─ ". */
  title?: string;
  titleTone?: Tone;
  /** Set into the top edge at the right, before " ─╮". */
  right?: string;
  rightTone?: Tone;
}

/**
 * [F48 tui-theme] A frame: rounded lines, with a title set into the top edge,
 * as in btop; the look that is Neuromesh's own. Inside it the pane's own
 * background shows (a popup passes its surface). Returns the area inside: two
 * cells in from the sides and one row in from the edges.
 */
function box(cv: Canvas, r: Rect, s: Surface = "panel", opts: FrameOpts = {}): Rect {
  if (r.w < 4 || r.h < 2) return rect(r.x, r.y, 0, 0);
  cv.fill(r, layered() ? surface(s) : DEFAULT);
  const line = { fg: T(opts.edge ?? "border") };
  cv.text(r.x, r.y, `╭${"─".repeat(r.w - 2)}╮`, line);
  cv.text(r.x, r.y + r.h - 1, `╰${"─".repeat(r.w - 2)}╯`, line);
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    cv.set(r.x, y, "│", line);
    cv.set(r.x + r.w - 1, y, "│", line);
  }
  let used = 0;
  if (opts.title) used = cv.text(r.x + 2, r.y, ` ${opts.title} `, pen(opts.titleTone ?? "muted", true), r.w - 6);
  if (opts.right) {
    const rw = width(opts.right) + 2;
    if (rw + used + 6 <= r.w) cv.text(r.x + r.w - 3 - rw, r.y, ` ${opts.right} `, pen(opts.rightTone ?? "subtle"));
  }
  return rect(r.x + 2, r.y + 1, r.w - 4, r.h - 2);
}

/** A divider across a frame, with a title: ├─ title ───┤ */
function divider(cv: Canvas, x: number, y: number, w: number, title: string, edge: Tone = "border"): void {
  cv.text(x, y, `├${"─".repeat(w - 2)}┤`, { fg: T(edge) });
  cv.text(x + 3, y, ` ${title} `, pen("muted", true), w - 6);
}

/** A button: text on a filled block (in both looks), hover-lit; returns its width. */
function button(cv: Canvas, x: number, y: number, label: string, id: string | undefined, m: Model, opts: { tone?: Tone; fill?: Surface; key?: string; strong?: boolean } = {}): number {
  const hovered = id !== undefined && m.hover === id;
  const fill = solid(hovered ? "hover" : (opts.fill ?? "button"));
  const t = opts.tone ?? "text";
  let used = 0;
  if (!colourOn()) {
    const text = `[${opts.key ? `${opts.key} ` : ""}${label}]`;
    used = cv.text(x, y, text, { attrs: hovered ? ATTR.reverse : 0 });
  } else {
    if (opts.key) used += cv.text(x, y, ` ${opts.key} `, { fg: T(t), bg: mix(fill, T(t), 0.22), attrs: ATTR.bold });
    used += cv.text(x + used, y, ` ${label} `, { fg: T(t), bg: fill, attrs: opts.strong ? ATTR.bold : 0 });
  }
  if (id) cv.region(id, rect(x, y, used, 1));
  return used;
}

/** Text with a light running along it, left to right: for working labels and the brand. */
function shimmer(cv: Canvas, x: number, y: number, text: string, base: Tone, now: number, period = 1_600, bold = true, max = Infinity): number {
  const gs = graphemes(text);
  const n = gs.length;
  const head = ((now % period) / period) * (n + 8) - 4;
  let used = 0;
  for (const [i, g] of gs.entries()) {
    if (used >= max) break;
    const d = Math.abs(i - head);
    const k = d < 1 ? 1 : d < 3 ? 0.55 * (1 - (d - 1) / 2) : 0;
    const c = k > 0 && colourOn() ? mix(T(base), T("text"), k * 0.85) : T(base);
    used += cv.text(x + used, y, g, { fg: c, attrs: bold ? ATTR.bold : 0 }, max - used);
  }
  return used;
}

/** [F37 tui-scroll] Fade the rows at an edge where more is hidden, as btop's lists do. */
function fadeEdges(cv: Canvas, r: Rect, above: boolean, below: boolean): void {
  if (!isOn("tui-scroll")) return;
  const steps = [0.55, 0.25];
  for (const [i, k] of steps.entries()) {
    if (below && r.h > 4) cv.fade(rect(r.x, r.y + r.h - 1 - i, r.w, 1), k);
    if (above && r.h > 4) cv.fade(rect(r.x, r.y + i, r.w, 1), k);
  }
}

/** [F37 tui-scroll] A scrollbar at the right edge, only while scrolling (then it fades). */
function scrollbar(cv: Canvas, r: Rect, total: number, offset: number, at: number | undefined, now: number): void {
  if (!isOn("tui-scroll") || at === undefined || total <= r.h) return;
  const age = now - at;
  if (age > 1_500) return;
  const k = age < 1_100 ? 0 : (age - 1_100) / 400;
  const thumb = Math.max(1, Math.round((r.h * r.h) / total));
  const top = Math.round(((r.h - thumb) * offset) / Math.max(1, total - r.h));
  const x = r.x + r.w - 1;
  for (let y = 0; y < r.h; y++) {
    const on = y >= top && y < top + thumb;
    const base = on ? T("muted") : T("subtle");
    const under = cv.bg[(r.y + y) * cv.w + x] ?? DEFAULT;
    cv.set(x, r.y + y, on ? "┃" : "│", { fg: colourOn() && under >= 0 ? mix(base, under, k) : base });
  }
}

// ---------------------------------------------------------------------------
// Layout.

export interface Layout {
  side?: Rect;
  main: Rect;
  info?: Rect;
}

export function layoutOf(m: Model, cols: number, rows: number): Layout {
  // The sidebar and the info pane are the same width.
  const paneW = cols >= 180 ? 34 : 30;
  const sideW = m.showSidebar && isOn("tui-projects") && cols >= 120 ? paneW : 0;
  const infoW = m.showInfo && cols >= 100 ? paneW : 0;
  const gap = 1;
  const mainX = sideW ? sideW + gap : 0;
  const mainW = cols - mainX - (infoW ? infoW + gap : 0);
  return {
    side: sideW ? rect(0, 1, sideW, rows - 2) : undefined,
    main: rect(mainX, 1, mainW, rows - 2),
    info: infoW ? rect(cols - infoW, 1, infoW, rows - 2) : undefined,
  };
}

/** How wide the prompt's text is, so the app moves the cursor up and down the same lines. */
export function composerWidth(m: Model, cols: number, rows: number): number {
  const w = layoutOf(m, cols, rows).main.w - 4;
  return Math.max(10, (m.log.length === 0 ? Math.min(w, 80) : w) - 6);
}

// ---------------------------------------------------------------------------

export function render(m: Model, c: Composer, cols: number, rows: number): Frame {
  const cv = new Canvas(cols, rows, bgOf("base"));
  const anchors: Record<string, number> = {};
  const frame: Frame = {
    canvas: cv,
    regions: cv.regions,
    anchors,
    get lines() {
      return cv.toLines();
    },
  };
  if (cols < 60 || rows < 16) {
    const msg = [`Too small: ${cols}×${rows}`, "Needs 60×16.", "A run keeps going.", "Ctrl+Q quits."];
    const top = Math.max(0, Math.floor((rows - msg.length) / 2));
    for (const [i, t] of msg.entries()) cv.text(Math.max(0, Math.floor((cols - width(t)) / 2)), top + i, truncate(t, cols), pen(i === 0 ? "text" : "muted"));
    return frame;
  }
  const L = layoutOf(m, cols, rows);
  topBar(m, cv, cols);
  bottomBar(m, cv, cols, rows);
  if (L.side) sidebar(m, cv, L.side);
  if (L.info) infoPane(m, cv, L.info);
  if (m.focus === "diff" && m.diff) pager(m, cv, L.main);
  else {
    const out = mainPane(m, c, cv, L.main);
    frame.cursor = out.cursor;
    frame.stream = out.stream;
    Object.assign(anchors, out.anchors);
  }
  // Popups, over everything; a click outside one closes it.
  if (m.picker || m.palette || m.dialog) cv.region("popup:outside", rect(0, 0, cols, rows));
  if (m.picker) pickerPopup(m, cv);
  else if (m.palette) palettePopup(m, cv);
  if (m.dialog) {
    const cur = dialogPopup(m, cv);
    if (cur) frame.cursor = cur;
    else if (m.dialog.kind !== "form") frame.cursor = undefined;
  }
  if (m.picker || m.palette) frame.cursor = undefined;
  return frame;
}

// ---------------------------------------------------------------------------
// Bars.

function statusOf(m: Model): { text: string; tone: Tone; live: boolean } {
  const running = !m.run && m.stage !== "idle";
  if (m.ask) return { text: m.ask.question.kind === "plan" ? "? approve the plan" : "? call the expert", tone: "amber", live: true };
  if (running) {
    const s = m.startedAt ? nowOf(m) - m.startedAt : 0;
    return { text: `● ${m.stage} ${clock(s)}`, tone: "blue", live: true };
  }
  const status = m.run?.status;
  if (status === "applied") return { text: "✓ applied", tone: "jade", live: false };
  if (status === "discarded") return { text: "– discarded", tone: "muted", live: false };
  if (m.stage === "finished") return { text: "✓ ready to review", tone: "jade", live: false };
  if (m.stage === "stopped" || m.stage === "paused") return { text: `○ ${m.stage}`, tone: "amber", live: false };
  if (m.stage === "failed") return { text: "✗ failed", tone: "red", live: false };
  return { text: "ready", tone: "muted", live: false };
}

function topBar(m: Model, cv: Canvas, cols: number): void {
  const now = nowOf(m);
  cv.fill(rect(0, 0, cols, 1), bgOf("bar"));
  // The brand: idle, except a shimmer when clicked or when a run ends.
  const brandFill = solid(m.hover === "brand" ? "hover" : "button");
  const shining = m.motion && m.brandAt !== undefined && now - m.brandAt < 1_100;
  cv.fill(rect(1, 0, 11, 1), colourOn() ? brandFill : DEFAULT);
  if (shining) shimmer(cv, 2, 0, "NEUROMESH", "jade", now - m.brandAt!, 1_100, true);
  else cv.text(2, 0, "NEUROMESH", pen("jade", true));
  cv.region("brand", rect(1, 0, 11, 1));

  // The status, on the right.
  const st = statusOf(m);
  const label = ` ${st.text} `;
  const sw = width(label);
  const sx = cols - sw - 1;
  const enter = m.motion ? ease(progress(m.statusAt, 380, now)) : 1;
  let sfill = solid(m.hover === "status" ? "hover" : "button");
  // A new status lights up in its colour, then settles.
  if (colourOn() && enter < 1) sfill = mix(mix(sfill, T(st.tone), 0.45), sfill, enter);
  if (colourOn() && st.live && m.motion) sfill = mix(sfill, T(st.tone), 0.08 + 0.08 * Math.sin(now / 420));
  cv.fill(rect(sx, 0, sw, 1), colourOn() ? sfill : DEFAULT);
  const shown = enter < 1 ? graphemes(label).slice(0, Math.ceil(graphemes(label).length * enter)).join("") : label;
  if (st.live && m.motion && enter >= 1) shimmer(cv, sx, 0, label, st.tone, now, 2_400, true);
  else cv.text(sx, 0, shown, pen(st.tone, true));
  cv.region("status", rect(sx, 0, sw, 1));

  // The project, in the middle; a long name scrolls instead of growing the box.
  const name = m.projectName ?? m.repo ?? "no project";
  const maxW = Math.max(8, Math.min(28, Math.floor(cols / 4)));
  const nw = width(name);
  const boxW = Math.min(nw, maxW) + 4;
  const bx = Math.max(13, Math.floor((cols - boxW) / 2));
  if (bx + boxW < sx - 1) {
    cv.fill(rect(bx, 0, boxW, 1), colourOn() ? solid(m.hover === "project-name" ? "hover" : "button") : DEFAULT);
    let shownName = name;
    if (nw > maxW) {
      const loop = `${name}   ·   `;
      const gs = graphemes(loop);
      const off = m.motion ? Math.floor((now - (m.introAt ?? 0)) / 250) % gs.length : 0;
      shownName = [...gs.slice(off), ...gs.slice(0, off)].join("");
    }
    cv.text(bx + 2, 0, shownName, pen("text", true), maxW);
    cv.region("project-name", rect(bx, 0, boxW, 1));
  }
}

function bottomBar(m: Model, cv: Canvas, cols: number, rows: number): void {
  const y = rows - 1;
  const now = nowOf(m);
  cv.fill(rect(0, y, cols, 1), bgOf("bar"));
  const running = !m.run && m.stage !== "idle";
  const keys: [string, string, string][] = running
    ? [["ctrl+p", "menu", "bar:menu"], ["ctrl+o", m.verbose, "bar:verbose"], ["esc", "stop", "bar:stop"]]
    : [["ctrl+p", "menu", "bar:menu"], ["/", "commands", "bar:commands"], ["@", "files", "bar:files"]];
  let x = 1;
  for (const [k, what, id] of keys) {
    if (x + width(k) + width(what) + 6 > cols * 0.6) break;
    x += button(cv, x, y, what, id, m, { key: k, tone: "muted", fill: "bar" }) + 1;
  }
  // The folder, on the right.
  const cwd = shortPath(m.cwd, Math.max(10, Math.floor(cols * 0.35)));
  const cx = cols - width(cwd) - 2;
  cv.text(cx, y, cwd, pen("muted"));
  cv.region("bar:cwd", rect(cx, y, width(cwd), 1));
  // A message between them.
  const t = m.toast && m.toast.until > now ? m.toast : undefined;
  if (t) {
    const room = cx - x - 4;
    if (room > 8) {
      const p = m.motion ? progress(t.at, 220, now) : 1;
      const text = truncate(t.text, room);
      const gs = graphemes(text);
      const fading = m.motion && t.until - now < 500;
      cv.text(x + 2, y, gs.slice(0, Math.ceil(gs.length * p)).join(""), pen(fading ? "muted" : t.tone));
    }
  }
}

// ---------------------------------------------------------------------------
// [F34 tui-projects] The sidebar: projects and their sessions, then recents.

const STATUS_MARK: Record<string, [string, Tone]> = {
  running: ["●", "blue"],
  applied: ["✓", "jade"],
  finished: ["◆", "amber"],
  failed: ["✗", "red"],
  discarded: ["–", "subtle"],
  interrupted: ["○", "amber"],
  paused: ["○", "amber"],
};

interface SideRow {
  id: string;
  draw: (cv: Canvas, x: number, y: number, w: number) => void;
}

/** The sidebar's rows, as ids in order (for the keyboard). */
export function sidebarRows(m: Model): string[] {
  const ids: string[] = ["side:head:projects"];
  if (!m.folded.has("projects")) {
    for (const p of m.projects) {
      ids.push(`side:project:${p.path}`);
      if (!m.folded.has(p.path)) for (const s of p.sessions) ids.push(`side:session:${s.dir}`);
    }
  }
  ids.push("side:head:recents");
  if (!m.folded.has("recents")) for (const s of m.recents) ids.push(`side:session:${s.dir}`);
  return ids;
}

function sidebar(m: Model, cv: Canvas, r: Rect): void {
  const now = nowOf(m);
  box(cv, r);
  const x = r.x + 1;
  const w = r.w - 2;
  const sel = (id: string): boolean => m.hover === id || m.hover?.startsWith(`${id}:`) === true || (m.focus === "sidebar" && m.sideSel === id);
  const rowBg = (id: string, current: boolean): number | undefined =>
    sel(id) ? solid("hover") : current ? (layered() ? surface("selected") : solid("selected")) : undefined;

  // The section headers are set into the frame's edges: ╭─ Projects ── ▾ + ─╮ and ├─ Recents ─┤.
  const header = (id: "projects" | "recents", label: string, y: number): void => {
    const folded = m.folded.has(id);
    const hid = `side:head:${id}`;
    const lit = sel(hid);
    if (id === "projects") cv.text(r.x, y, `╭${"─".repeat(r.w - 2)}╮`, { fg: T("border") });
    else cv.text(r.x, y, `├${"─".repeat(r.w - 2)}┤`, { fg: T("border") });
    cv.text(r.x + 2, y, ` ${label} `, { fg: T(lit ? "text" : "muted"), attrs: ATTR.bold });
    // Fold and new, always there, in the edge.
    const plusX = r.x + r.w - 4;
    const foldX = r.x + r.w - 7;
    cv.text(foldX - 1, y, ` ${folded ? "▸" : "▾"} `, pen(m.hover === `side:fold:${id}` ? "text" : "muted"));
    cv.text(plusX - 1, y, " + ", pen(m.hover === `side:new:${id}` ? "jade" : "muted", true));
    cv.region(hid, rect(r.x, y, r.w, 1));
    cv.region(`side:fold:${id}`, rect(foldX - 1, y, 3, 1));
    cv.region(`side:new:${id}`, rect(plusX - 1, y, 3, 1));
  };

  const sessionRow = (s: SessionView, indent: number): SideRow => ({
    id: `side:session:${s.dir}`,
    draw: (c, rx, ry, rw) => {
      const id = `side:session:${s.dir}`;
      const current = s.id === m.runId || (m.runId !== undefined && s.runs?.some((d) => d.endsWith(`/${m.runId}`)) === true);
      const b = rowBg(id, current);
      if (b !== undefined) c.fill(rect(rx, ry, rw, 1), b);
      const [mark, mt] = STATUS_MARK[s.status] ?? ["○", "muted"];
      const live = s.status === "running" && m.motion;
      c.text(rx + indent, ry, live ? SPIN[Math.floor(now / 90) % SPIN.length]! : mark, pen(mt));
      const hovered = sel(id);
      const right = hovered ? "×" : ago(s.at, now);
      const rightW = width(right);
      c.text(rx + indent + 2, ry, s.title, pen(current ? "text" : "text", current), rw - indent - 4 - rightW);
      c.text(rx + rw - rightW - 1, ry, right, pen(hovered && m.hover === `side:delete:${s.dir}` ? "red" : "subtle"));
      c.region(id, rect(rx, ry, rw, 1));
      if (hovered) c.region(`side:delete:${s.dir}`, rect(rx + rw - 3, ry, 3, 1));
    },
  });

  const projectRows: SideRow[] = [];
  for (const p of m.projects) {
    const id = `side:project:${p.path}`;
    projectRows.push({
      id,
      draw: (c, rx, ry, rw) => {
        const current = p.path === m.repoRoot;
        const b = rowBg(id, false);
        if (b !== undefined) c.fill(rect(rx, ry, rw, 1), b);
        const open = !m.folded.has(p.path);
        c.text(rx + 1, ry, open ? "▾" : "▸", pen("muted"));
        const hovered = sel(id);
        const tail = hovered ? "+  ×" : String(p.sessions.length || "");
        c.text(rx + 3, ry, p.name, pen(current ? "jade" : "text", true), rw - 6 - width(tail));
        c.text(rx + rw - width(tail) - 1, ry, tail, pen("subtle"));
        c.region(id, rect(rx, ry, rw, 1));
        if (hovered) {
          c.region(`side:newin:${p.path}`, rect(rx + rw - 5, ry, 2, 1));
          c.region(`side:remove:${p.path}`, rect(rx + rw - 2, ry, 2, 1));
        }
      },
    });
    if (!m.folded.has(p.path)) for (const s of p.sessions) projectRows.push(sessionRow(s, 3));
  }
  const recentRows = m.recents.map((s) => sessionRow(s, 1));

  // Room: projects take what they need, up to about half, when recents are there too.
  const body = r.h;
  const projFolded = m.folded.has("projects");
  const recFolded = m.folded.has("recents");
  const projNeed = projFolded ? 0 : Math.max(1, projectRows.length);
  const recNeed = recFolded ? 0 : Math.max(1, recentRows.length);
  const fixed = 3; // the top edge, the divider and the bottom edge
  let projH = projNeed;
  let recH = recNeed;
  const room = body - fixed;
  if (projH + recH > room) {
    projH = recFolded ? room : Math.min(projNeed, Math.max(3, Math.floor(room * 0.55)));
    recH = Math.max(0, room - projH);
  }

  let y = r.y;
  header("projects", "Projects", y);
  y += 1;
  const list = (rows: SideRow[], h: number, key: "projects" | "recents", empty: string): void => {
    if (h <= 0) return;
    const area = rect(x, y, w, h);
    if (rows.length === 0) {
      cv.text(x + 1, y, empty, pen("subtle"), w - 2);
      y += h;
      return;
    }
    const max = Math.max(0, rows.length - h);
    // Keep the keyboard selection in view.
    const selAt = m.focus === "sidebar" ? rows.findIndex((row) => row.id === m.sideSel) : -1;
    if (selAt >= 0) {
      if (selAt < m.sideScroll[key]) m.sideScroll[key] = selAt;
      if (selAt >= m.sideScroll[key] + h) m.sideScroll[key] = selAt - h + 1;
    }
    m.sideScroll[key] = Math.max(0, Math.min(m.sideScroll[key], max));
    const off = m.sideScroll[key];
    const prev = cv.clip(area);
    for (let i = 0; i < h && off + i < rows.length; i++) rows[off + i]!.draw(cv, x, y + i, w);
    // The list's own region (for the wheel) sits behind its rows'.
    cv.regions.unshift({ id: `side:list:${key}`, ...area });
    cv.unclip(prev);
    fadeEdges(cv, area, off > 0, off < max);
    scrollbar(cv, area, rows.length, off, m.sideScrollAt, now);
    y += h;
  };
  list(projectRows, projH, "projects", "+ adds a project");
  header("recents", "Recents", y);
  y += 1;
  list(recentRows, recH, "recents", "no other sessions");
}

// ---------------------------------------------------------------------------
// The middle pane.

function mainPane(m: Model, c: Composer, cv: Canvas, r: Rect): { cursor?: { row: number; col: number }; anchors: Record<string, number>; stream?: { total: number; view: number } } {
  const now = nowOf(m);
  cv.fill(r, bgOf("panel"));
  const x = r.x + 2;
  const w = r.w - 4;
  const running = !m.run && m.stage !== "idle";
  const empty = m.log.length === 0;

  // The prompt: one framed box; its buttons sit in its bottom edge.
  const attachRow = m.attachments.length > 0 ? 1 : 0;
  const textW = Math.max(10, (empty ? Math.min(w, 80) : w) - 6);
  const lay = c.layout(textW);
  const visible = Math.max(1, Math.min(6, lay.lines.length));
  const boxH = visible + attachRow + 2;
  let promptY = r.y + r.h - 1 - boxH;

  if (empty) {
    // Landing: the logo, and the prompt under it, in the middle.
    // The big logo wherever it fits; the smaller one drawn in its style, then the word.
    const logo = r.w >= width(LOGO_WIDE[0]!) + 2 && r.h >= 22 ? LOGO_WIDE : r.w >= width(LOGO_MID[0]!) + 2 && r.h >= 16 ? LOGO_MID : ["NEUROMESH"];
    const blockH = logo.length + 2 + boxH + 1;
    const top = r.y + Math.max(1, Math.floor((r.h - blockH) / 2));
    const p = m.motion && isOn("tui-intro") ? progress(m.introAt, 1_300, now) : 1;
    const lw = width(logo[0]!);
    const lx = r.x + Math.max(0, Math.floor((r.w - lw) / 2));
    // [F48 tui-theme] A light runs across the logo, slowly, all the time.
    const span = lw + logo.length * 2 + 24;
    const head = m.motion ? ((now % 4_200) / 4_200) * span - 12 : -100;
    for (const [i, raw] of logo.entries()) {
      const line = p >= 1 ? raw : buildLine(raw, i, logo.length, p);
      let col = 0;
      for (const g of graphemes(line)) {
        const t: Tone = g === ":" ? "subtle" : "jade";
        if (g !== " ") {
          const d = Math.abs(col + i * 2 - head);
          const k = d < 7 ? (1 - d / 7) ** 2 : 0;
          const fgc = k > 0 && colourOn() ? mix(T(t), T("text"), k * 0.9) : T(t);
          cv.text(lx + col, top + i, g, { fg: fgc, attrs: g === "#" || logo.length === 1 || k > 0.6 ? ATTR.bold : 0 });
        }
        col += 1;
      }
    }
    promptY = top + logo.length + 2;
  }

  // On the landing screen the prompt is narrower, centred under the logo.
  const pw = empty ? Math.min(w, 80) : w;
  const px = empty ? r.x + Math.floor((r.w - pw) / 2) : x;
  const cursor = promptBox(m, c, cv, rect(px, promptY, pw, boxH), lay, visible, running);
  if (m.suggest) suggestPopup(m, cv, rect(px, promptY, pw, boxH));
  if (empty) {
    if (m.repoError) cv.text(x, r.y + r.h - 1, truncate(m.repoError, w), pen("red"));
    return { cursor, anchors: {} };
  }

  // The pipeline, framed, at the top.
  let top = r.y + 1;
  if (isOn("tui-pipeline-box")) {
    pipelineBox(m, cv, rect(x, top, w, 3));
    top += 4;
  } else {
    pipelineLine(m, cv, x, top, w);
    top += 2;
  }

  // The working line, just above the prompt.
  let bottom = promptY - 1;
  if (running) {
    workingLine(m, cv, x, bottom, w);
    bottom -= 2;
  }
  const area = rect(x, top, w, Math.max(1, bottom - top + 1));
  const out = stream(m, cv, area);
  return { cursor, anchors: out.anchors, stream: { total: out.total, view: area.h } };
}

/** [F30 tui-intro] The logo building up from the left. */
function buildLine(line: string, row: number, rows: number, p: number): string {
  return [...line]
    .map((ch, x) => {
      if (ch === " ") return ch;
      const start = (x / line.length) * 0.65 + (row / Math.max(1, rows)) * 0.1;
      const local = Math.max(0, Math.min(1, (p - start) / 0.25));
      return local <= 0 ? " " : local < 0.34 ? ":" : local < 0.67 && ch !== ":" ? "+" : ch;
    })
    .join("");
}

function promptBox(m: Model, c: Composer, cv: Canvas, r: Rect, lay: ReturnType<Composer["layout"]>, visible: number, running: boolean): { row: number; col: number } | undefined {
  const focused = m.focus === "composer" && !m.dialog && !m.palette && !m.picker;
  const inner = box(cv, r, "input", { edge: focused ? "jade" : "border" });
  cv.region("prompt:box", r);
  let y = inner.y;
  // Attached files, as small chips.
  if (m.attachments.length > 0) {
    let ax = inner.x;
    for (const [i, a] of m.attachments.entries()) {
      const label = `📎 ${truncate(a.name, 24)} ×`;
      if (ax + width(label) + 2 > inner.x + inner.w) break;
      ax += button(cv, ax, y, label, `prompt:unattach:${i}`, m, { tone: "cyan" }) + 1;
    }
    y += 1;
  }
  const first = Math.max(0, Math.min(lay.row - visible + 1, lay.lines.length - visible));
  const outcome = m.focus === "outcome" && m.run;
  const placeholder = outcome
    ? "i or a click to type · a apply · d diff · x discard"
    : running
      ? "Draft the next instruction…"
      : m.log.length === 0
        ? "What should we build?"
        : "Give another instruction…";
  cv.text(inner.x, y, "›", pen(focused ? "jade" : "subtle", true));
  if (c.isEmpty) cv.text(inner.x + 2, y, placeholder, pen("subtle"), inner.w - 2);
  else for (let i = 0; i < visible; i++) cv.text(inner.x + 2, y + i, lay.lines[first + i] ?? "", pen("text"), inner.w - 2);

  // In the bottom edge: attach, Normal or Turbo, and the preset.
  const by = r.y + r.h - 1;
  let bx = r.x + 2;
  bx += button(cv, bx, by, "+", "prompt:attach", m, { tone: "jade", strong: true }) + 1;
  const turbo = m.access === "turbo";
  button(cv, bx, by, turbo ? "⚡ Turbo" : "● Normal", "prompt:access", m, { tone: turbo ? "amber" : "blue", strong: true });
  const px = r.x + r.w - width(m.preset) - 4;
  cv.text(px - 1, by, ` ${m.preset} `, pen(m.hover === "prompt:preset" ? "text" : "mauve"));
  cv.region("prompt:preset", rect(px - 1, by, width(m.preset) + 2, 1));
  if (!focused || outcome) return undefined;
  return { row: y + (lay.row - first), col: inner.x + 2 + lay.col };
}

function suggestPopup(m: Model, cv: Canvas, prompt: Rect): void {
  const s = m.suggest;
  if (!s || s.items.length === 0) return;
  const h = s.items.length + 2;
  const r = rect(prompt.x, Math.max(1, prompt.y - h), Math.min(prompt.w, 72), h);
  const inner = box(cv, r, "popup");
  const labelW = Math.min(Math.max(...s.items.map((i) => width(i.label))) + 2, Math.floor(inner.w * 0.5));
  for (const [i, it] of s.items.entries()) {
    const on = i === s.index;
    const y = inner.y + i;
    if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 1), solid("hover"));
    cv.text(inner.x, y, truncate(it.label, labelW - 1), pen(on ? "jade" : "text", on));
    cv.text(inner.x + labelW, y, it.detail ?? "", pen("muted"), inner.w - labelW);
    cv.region(`suggest:${i}`, rect(r.x, y, r.w, 1));
  }
}

// [F20 tui-working] The working line: a pulsing glyph and a verb for the stage.
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

function workingLine(m: Model, cv: Canvas, x: number, y: number, w: number): void {
  const now = nowOf(m);
  const elapsed = m.startedAt ? now - m.startedAt : 0;
  if (m.ask) {
    cv.text(x, y, "? Waiting for your answer above", pen("amber", true), w);
    return;
  }
  const frame = Math.floor(now / 110);
  const word = verbFor(m.stage, elapsed);
  const phase = elapsed % 4_500;
  const verb = `${m.motion && elapsed > 4_500 && phase < 420 ? scramble(word, phase / 420, frame) : word}…`;
  const tokens = [...m.agents.values()].reduce((n, a) => n + a.tokens, 0);
  cv.text(x, y, GLYPH[frame % GLYPH.length]!, pen("amber"));
  const used = m.motion ? shimmer(cv, x + 2, y, verb, "amber", now, 1_800, false) : cv.text(x + 2, y, verb, pen("amber"));
  cv.text(x + 2 + used, y, `  ${clock(elapsed)}${tokens > 0 ? ` · ${kTokens(tokens)} tokens` : ""}`, pen("muted"), w - used - 2);
}

// [F36 tui-pipeline-box] Plan → Build → Check → Review, as buttons, centred in a frame.
function pipelineBox(m: Model, cv: Canvas, r: Rect): void {
  const now = nowOf(m);
  const inner = box(cv, r);
  const stages = pipeline(m);
  const y = inner.y;
  const gapW = Math.max(3, Math.min(8, Math.floor((inner.w - 44) / 3)));
  const labels = stages.map((s) => {
    const active = s.state === "active";
    const icon = s.state === "done" ? "✓" : active ? SPIN[Math.floor(now / 90) % SPIN.length]! : s.state === "failed" ? "✗" : s.state === "skipped" ? "–" : "○";
    return ` ${icon} ${s.label} `;
  });
  const total = labels.reduce((n, l) => n + width(l), 0) + (stages.length - 1) * (gapW + 1);
  let x = inner.x + Math.max(0, Math.floor((inner.w - total) / 2));
  for (const [i, s] of stages.entries()) {
    const active = s.state === "active";
    const t: Tone = s.state === "done" ? "jade" : active ? "blue" : s.state === "failed" ? "red" : "muted";
    const id = `step:${s.stage}`;
    let fill = solid(m.hover === id ? "hover" : "button");
    if (colourOn() && (s.state === "done" || active || s.state === "failed")) fill = mix(fill, T(t), active ? 0.22 + (m.motion ? 0.06 * Math.sin(now / 300) : 0) : 0.12);
    const label = labels[i]!;
    if (x + width(label) > inner.x + inner.w) break;
    if (colourOn()) cv.fill(rect(x, y, width(label), 1), fill);
    cv.text(x, y, label, { fg: T(s.state === "todo" || s.state === "skipped" ? "muted" : t), attrs: active ? ATTR.bold : 0 });
    cv.region(id, rect(x, y, width(label), 1));
    x += width(label);
    if (i < stages.length - 1) {
      // The line after a finished step grows into an arrow.
      const done = s.state === "done" || s.state === "skipped";
      const next = stages[i + 1]!;
      const grow = done && m.motion && m.stageAt !== undefined && next.state === "active" ? ease(progress(m.stageAt, 600, now)) : 1;
      let link: string;
      if (done) {
        const n = Math.max(1, Math.round((gapW - 1) * grow));
        link = ` ${"─".repeat(Math.max(0, n - 1))}${grow >= 1 ? "▶" : "─"}`.padEnd(gapW + 1);
      } else link = ` ${"╌".repeat(gapW - 1)} `;
      cv.text(x, y, link, pen(done ? "jade" : "subtle"));
      x += width(link);
    }
  }
}

function pipelineLine(m: Model, cv: Canvas, x: number, y: number, w: number): void {
  const parts = pipeline(m).map((s) => `${s.state === "done" ? "✓" : s.state === "active" ? "●" : s.state === "failed" ? "✗" : "○"} ${s.label.toLowerCase()}`);
  cv.text(x, y, parts.join(" ─ "), pen("muted"), w);
}

// ---------------------------------------------------------------------------
// [F35 tui-agent-boxes] The stream.

interface Placed {
  h: number;
  stage?: string;
  draw: (cv: Canvas, x: number, y: number, w: number) => void;
}

type WrappedRow = { spans: Span[]; line: Line; first: boolean };

/** Lines wrapped to `w`, with their inline markdown (**bold**, `code`) drawn rather than shown. */
function wrapLines(lines: Line[], w: number): WrappedRow[] {
  const out: WrappedRow[] = [];
  for (const l of lines) {
    const indent = (l.indent ?? 0) + (l.icon ? width(l.icon) + 1 : 0);
    const room = Math.max(8, w - indent);
    const parts = isOn("tui-markdown") ? wrapInline(l.text, room, { tone: l.tone, bold: l.bold }) : wrap(l.text, room).map((t) => [{ text: t, tone: l.tone, bold: l.bold }]);
    for (const [i, spans] of parts.entries()) out.push({ spans, line: l, first: i === 0 });
  }
  return out;
}

function drawLines(cv: Canvas, rows: WrappedRow[], x: number, y: number, w: number): void {
  for (const [i, r] of rows.entries()) {
    const l = r.line;
    let cx = x + (l.indent ?? 0);
    if (l.icon) {
      if (r.first) cv.text(cx, y + i, l.icon, pen(l.iconTone ?? "subtle", true));
      cx += width(l.icon) + 1;
    }
    for (const s of r.spans) {
      const attrs = (s.bold ? ATTR.bold : 0) | (s.italic ? ATTR.italic : 0) | (s.underline ? ATTR.underline : 0);
      cx += cv.text(cx, y + i, s.text, { fg: T(s.tone ?? "text"), attrs }, x + w - cx);
    }
  }
}

const MAX_BOX_LINES = 14;

function placeBlock(m: Model, b: Block, w: number): Placed {
  const now = nowOf(m);
  switch (b.kind) {
    case "you": {
      const lines = wrap(b.text, Math.max(8, w - 6));
      const att = b.attachments?.length ? 1 : 0;
      return {
        h: lines.length + att + 2,
        draw: (cv, x, y, bw) => {
          const inner = box(cv, rect(x, y, bw, lines.length + att + 2), "panel", { title: "you", titleTone: "jade" });
          for (const [i, t] of lines.entries()) cv.text(inner.x, inner.y + i, t, pen("text", true), inner.w);
          if (att) cv.text(inner.x, inner.y + lines.length, `📎 ${b.attachments!.map((a) => a.split("/").at(-1)).join(", ")}`, pen("cyan"), inner.w);
        },
      };
    }
    case "agent": {
      const opened = m.expanded.has(b.id);
      const { lines, hidden } = shownLines(b, m.verbose, opened);
      const working = b.open > 0;
      // While it works, what it is doing right now.
      const live = working ? [...m.agents.values()].filter((a) => a.working && a.roleId === b.roleId && a.last) : [];
      const extra: Line[] = live.slice(0, 3).map((a) => ({ text: `${a.task && a.task !== "main" ? `${a.task} · ` : ""}${a.last}`, tone: "muted", icon: SPIN[Math.floor(now / 90) % SPIN.length], iconTone: ROLE_TONE[b.roleId] ?? "blue" }));
      if (working && lines.length === 0 && extra.length === 0) extra.push({ text: "starting…", tone: "subtle", icon: SPIN[Math.floor(now / 90) % SPIN.length], iconTone: "subtle" });
      const all = m.verbose === "none" && !opened ? [] : [...lines, ...(m.verbose === "full" || opened ? [] : extra)];
      if ((m.verbose === "full" || opened) && working) all.push(...extra);
      let rows = wrapLines(all, w - 4);
      let cut = 0;
      if (!opened && rows.length > MAX_BOX_LINES) {
        cut = rows.length - MAX_BOX_LINES;
        rows = rows.slice(-MAX_BOX_LINES);
      }
      const footer = !opened && (hidden > 0 || cut > 0) ? `▸ ${hidden + cut} more · click to open` : opened ? "▾ click to close" : "";
      const bodyH = rows.length + (footer ? 1 : 0);
      const hasBox = bodyH > 0;
      return {
        h: hasBox ? bodyH + 2 : 1,
        stage: b.stage,
        draw: (cv, x, y, bw) => {
          const t = ROLE_TONE[b.roleId] ?? "blue";
          const hovered = m.hover === `box:${b.id}`;
          const right = working ? `${SPIN[Math.floor(now / 90) % SPIN.length]} ${clock(now - b.startedAt)}` : b.failed ? "✗" : b.endedAt && b.startedAt ? clock(b.endedAt - b.startedAt) : "";
          if (hasBox) {
            const inner = box(cv, rect(x, y, bw, bodyH + 2), "panel", { edge: hovered ? "muted" : "border", right, rightTone: working ? t : b.failed ? "red" : "subtle" });
            drawLines(cv, rows, inner.x, inner.y, inner.w);
            if (footer) cv.text(inner.x, inner.y + rows.length, footer, pen(hovered ? "muted" : "subtle"));
          } else {
            // Verbosity none: one ruled line with the label.
            cv.text(x, y, "─".repeat(bw), { fg: T("border") });
            if (right) cv.text(x + bw - width(right) - 4, y, ` ${right} `, pen(working ? t : "subtle"));
          }
          // The label sits in the top edge, and shimmers while the agent works.
          const lx = x + 3;
          cv.text(lx - 1, y, " ", {});
          const used = working && m.motion ? shimmer(cv, lx, y, b.role, t, now - b.startedAt, 1_500) : cv.text(lx, y, b.role, pen(t, true));
          const model = `${b.model ? ` · ${prettyModel(b.model)}${b.effort ? ` ${shortEffort(b.effort)}` : ""}` : ""} `;
          cv.text(lx + used, y, model, pen("muted"), Math.max(0, bw - used - width(right) - 12));
          cv.region(`box:${b.id}`, rect(x, y, bw, hasBox ? bodyH + 2 : 1));
        },
      };
    }
    case "note": {
      const rows = wrapLines(
        b.lines.map((l) => ({ ...l, icon: l.icon ?? "·", iconTone: l.iconTone ?? "subtle" })),
        w - 2,
      );
      return { h: rows.length, draw: (cv, x, y, bw) => drawLines(cv, rows, x + 1, y, bw - 1) };
    }
    case "error": {
      const rows = wrap(b.text, w - 6);
      return {
        h: rows.length + 2,
        draw: (cv, x, y, bw) => {
          const inner = box(cv, rect(x, y, bw, rows.length + 2), "panel", { edge: "red", title: "error", titleTone: "red" });
          for (const [i, t] of rows.entries()) cv.text(inner.x, inner.y + i, `${i === 0 ? "✗ " : "  "}${t}`, pen("red"), inner.w);
        },
      };
    }
    case "ask":
      return placeAsk(m, b, w);
    case "diff":
      return placeDiff(m, b, w);
    case "result":
      return placeResult(m, w);
    case "final":
      return placeFinal(m, b, w);
  }
}

/** [F47 tui-markdown] The final report, rendered as markdown in a box of its own. */
function placeFinal(m: Model, b: Extract<Block, { kind: "final" }>, w: number): Placed {
  const rows: MdRow[] = isOn("tui-markdown") ? renderMarkdown(b.text, Math.max(10, w - 4)) : wrap(b.text, Math.max(10, w - 4)).map((t) => ({ spans: [{ text: t }] }));
  const h = rows.length + 2;
  return {
    h,
    stage: "final",
    draw: (cv, x, y, bw) => {
      const who = `${b.role === "escalation" ? "Expert" : b.role === "orchestrator" ? "Orchestrator" : "Worker"}${b.model ? ` · ${prettyModel(b.model)}` : ""}`;
      const inner = box(cv, rect(x, y, bw, h), "panel", { edge: "jade", title: "Final report", titleTone: "jade", right: who });
      const code = colourOn() ? solid("raised") : undefined;
      for (const [i, r] of rows.entries()) {
        const ry = inner.y + i;
        if (r.block && code !== undefined) cv.fill(rect(inner.x - 1, ry, inner.w + 2, 1), code);
        let cx = inner.x;
        for (const s of r.spans) {
          const attrs = (s.bold ? ATTR.bold : 0) | (s.italic ? ATTR.italic : 0) | (s.underline ? ATTR.underline : 0);
          const bg = s.code && !r.block && code !== undefined ? code : undefined;
          cx += cv.text(cx, ry, s.text, { fg: T(s.tone ?? "text"), attrs, ...(bg !== undefined ? { bg } : {}) }, inner.x + inner.w - cx);
        }
      }
    },
  };
}

function placeAsk(m: Model, b: Extract<Block, { kind: "ask" }>, w: number): Placed {
  const q = b.question;
  const text =
    q.kind === "plan"
      ? `The orchestrator's plan has ${q.tasks.length} task${q.tasks.length === 1 ? "" : "s"}. Carry it out?`
      : `Call in the expert for ${q.task}${q.title ? ` (${q.title})` : ""}? ${q.reason[0]!.toUpperCase()}${q.reason.slice(1)}.`;
  const lines = wrap(text, w - 6);
  const answered = b.answer ? (b.answer.ok ? "✓ yes" : b.answer.note ? `✎ change asked: ${b.answer.note}` : "■ no") : b.pending ? "" : "– not answered";
  const h = lines.length + 2 + 2;
  return {
    h,
    draw: (cv, x, y, bw) => {
      const inner = box(cv, rect(x, y, bw, h), "panel", { edge: "amber", title: q.kind === "plan" ? "Your call · the plan" : "Your call · the expert", titleTone: "amber" });
      for (const [i, t] of lines.entries()) cv.text(inner.x, inner.y + i, t, pen("text"), inner.w);
      const by = inner.y + lines.length + 1;
      if (b.pending) {
        let bx = inner.x;
        if (q.kind === "plan") {
          bx += button(cv, bx, by, "Approve", "ask:yes", m, { key: "y", tone: "jade", strong: true }) + 2;
          bx += button(cv, bx, by, "Change…", "ask:change", m, { key: "c", tone: "blue" }) + 2;
          button(cv, bx, by, "Stop", "ask:no", m, { key: "n", tone: "red" });
        } else {
          bx += button(cv, bx, by, "Call the expert", "ask:yes", m, { key: "y", tone: "mauve", strong: true }) + 2;
          button(cv, bx, by, "Not now", "ask:no", m, { key: "n", tone: "muted" });
        }
      } else cv.text(inner.x, by, answered, pen("muted"), inner.w);
    },
  };
}

const DIFF_ROWS_INLINE = 40;

/** Diff rows for reading: a file's note ("new file") joins its header, and its first hunk needs no separator. */
function readableDiff(lines: string[]): (ReturnType<typeof diffRows>[number] & { note?: string })[] {
  const all = diffRows(lines);
  const rows: (ReturnType<typeof diffRows>[number] & { note?: string })[] = [];
  for (const [i, d] of all.entries()) {
    const prev = all[i - 1];
    if (d.kind === "meta" && prev?.kind === "file") {
      rows.at(-1)!.note = d.text;
      continue;
    }
    if (d.kind === "hunk" && (prev?.kind === "file" || prev?.kind === "meta") && !d.text) continue;
    rows.push({ ...d });
  }
  return rows;
}

function placeDiff(m: Model, b: Extract<Block, { kind: "diff" }>, w: number): Placed {
  const rows = readableDiff(b.lines);
  const shown = rows.slice(0, DIFF_ROWS_INLINE);
  const more = rows.length - shown.length;
  const g = gutterWidth(rows);
  const h = shown.length + (more > 0 ? 1 : 0) + 2;
  return {
    h,
    draw: (cv, x, y, bw) => {
      const r = rect(x, y, bw, h);
      const open = "open the diff ↗";
      const inner = box(cv, r, "panel", { title: `Changes ${b.text.replace(/^Changes:\s*/, "· ")}`, titleTone: "text", right: open, rightTone: m.hover === "diff:open" ? "blue" : "subtle" });
      cv.region("diff:open", rect(x + bw - 5 - width(open), y, width(open) + 2, 1));
      for (const [i, d] of shown.entries()) {
        const ry = inner.y + i;
        const text = d.text.replace(/\t/g, "    ");
        if (d.kind === "file") {
          cv.spans(inner.x, ry, [["▸ ", pen("blue")], [text, pen("text", true)], [d.note ? `  ${d.note}` : "", pen("subtle")]], inner.w);
          continue;
        }
        if (d.kind === "hunk" || d.kind === "meta") {
          cv.text(inner.x + g * 2 + 2, ry, d.kind === "hunk" ? `⋯ ${text}` : text, pen("subtle"), inner.w - g * 2 - 2);
          continue;
        }
        const add = d.kind === "add";
        const del = d.kind === "del";
        if ((add || del) && layered()) cv.fill(rect(r.x + 1, ry, r.w - 2, 1), mix(surface("panel"), T(add ? "jade" : "red"), 0.12));
        const num = (n: number | undefined): string => (n === undefined ? " ".repeat(g) : String(n).padStart(g));
        cv.text(inner.x, ry, `${num(d.old)} ${num(d.new)}`, pen("subtle"));
        cv.text(inner.x + g * 2 + 2, ry, add ? "+" : del ? "-" : " ", pen(add ? "jade" : del ? "red" : "subtle", true));
        cv.text(inner.x + g * 2 + 4, ry, text, pen(add ? "jade" : del ? "red" : "text"), inner.w - g * 2 - 4);
      }
      if (more > 0) cv.text(inner.x, inner.y + shown.length, `… ${more} more lines · d for the whole diff`, pen("subtle"), inner.w);
    },
  };
}

function placeResult(m: Model, w: number): Placed {
  const r = m.run;
  if (!r) return { h: 0, draw: () => {} };
  const o = r.outcome;
  const took = m.startedAt && m.endedAt ? clock(m.endedAt - m.startedAt) : "";
  const headTone: Tone = r.status === "applied" ? "jade" : m.stage === "finished" ? "jade" : m.stage === "stopped" || m.stage === "paused" ? "amber" : "red";
  const head =
    r.status === "applied" ? "Applied to your repository"
    : r.status === "discarded" ? "Discarded"
    : m.stage === "finished" ? "Finished · the project's checks pass"
    : m.stage === "failed" && r.status === "finished" ? "Finished · but the project's checks fail"
    : m.stage === "stopped" ? "Stopped · the run can be resumed"
    : m.stage === "paused" ? "Paused at a subscription limit · resume when it resets"
    : "The run failed";
  const size = o ? `${o.files.length} file${o.files.length === 1 ? "" : "s"} (+${o.insertions} −${o.deletions})` : "no changes";
  const cost = m.costUnknown && m.cost === 0 ? "cost unknown" : `≈${money(m.cost)} API estimate${m.expertCost > 0 ? ` (expert ${money(m.expertCost)})` : ""}`;
  const canApply = r.status === "finished" && (o?.files.length ?? 0) > 0;
  const canResume = ["interrupted", "paused", "failed"].includes(r.status);
  const reason = r.reason ? wrap(r.reason, w - 6).slice(0, 3) : [];
  // The buttons sit in the card's bottom edge, as the prompt's do.
  const h = 2 + 2 + reason.length;
  return {
    h,
    draw: (cv, x, y, bw) => {
      const inner = box(cv, rect(x, y, bw, h), "panel", { edge: headTone });
      const now = nowOf(m);
      const twinkle = m.motion && m.stage === "finished" && r.status === "finished" && m.endedAt !== undefined && now - m.endedAt < 2_600 ? ` ${["✦", "✧", "⋆", "✧"][Math.floor(now / 160) % 4]}` : "";
      cv.spans(inner.x, inner.y, [[head, pen(headTone, true)], [twinkle, pen("amber")]], inner.w);
      cv.text(inner.x, inner.y + 1, [size, cost, took].filter(Boolean).join("  ·  "), pen("muted"), inner.w);
      for (const [i, t] of reason.entries()) cv.text(inner.x, inner.y + 2 + i, t, pen(r.failure === "engine" ? "red" : "amber"), inner.w);
      const by = y + h - 1;
      let bx = x + 2;
      const room = (label: string): boolean => bx + width(label) + 8 < inner.x + inner.w;
      if (canApply) {
        bx += button(cv, bx, by, "Apply", "act:apply", m, { key: "a", tone: "jade", strong: true }) + 2;
        bx += button(cv, bx, by, "Diff", "act:diff", m, { key: "d", tone: "blue" }) + 2;
        bx += button(cv, bx, by, "Discard", "act:discard", m, { key: "x", tone: "red" }) + 2;
      }
      if (canResume) bx += button(cv, bx, by, "Resume", "act:resume", m, { key: "r", tone: "amber", strong: true }) + 2;
      if (room("Rate 1 2 3 4 5")) {
        bx += cv.text(bx, by, m.rating ? ` rated ${m.rating} ` : " rate ", pen("mauve"));
        for (let n = 1; n <= 5; n++) bx += button(cv, bx, by, String(n), `rate:${n}`, m, { tone: m.rating === n ? "mauve" : "muted", strong: m.rating === n });
      }
    },
  };
}

function stream(m: Model, cv: Canvas, area: Rect): { total: number; anchors: Record<string, number> } {
  const now = nowOf(m);
  const blocks = buildBlocks(m, m.verbose);
  // Only the newest result card is drawn: it is the one its buttons act on.
  const lastResult = blocks.findLastIndex((b) => b.kind === "result");
  const placed = blocks.filter((b, i) => b.kind !== "result" || i === lastResult).map((b) => placeBlock(m, b, area.w)).filter((p) => p.h > 0);
  const GAP = 1;
  const total = placed.reduce((n, p) => n + p.h, 0) + Math.max(0, placed.length - 1) * GAP;
  const maxScroll = Math.max(0, total - area.h);
  m.scroll = Math.max(0, Math.min(m.scroll, maxScroll));
  // The newest sits just above the prompt; older ones move up.
  const startY = area.y + (total <= area.h ? area.h - total : -(maxScroll - m.scroll));
  const anchors: Record<string, number> = {};
  const prev = cv.clip(area);
  let y = startY;
  let offset = 0;
  for (const p of placed) {
    // One blank row above the block, so the fade at the edge never dims its first line.
    if (p.stage && (anchors[p.stage] === undefined || p.stage === "final")) anchors[p.stage] = Math.max(0, Math.min(maxScroll, maxScroll - offset + 1));
    if (y + p.h > area.y && y < area.y + area.h) p.draw(cv, area.x, y, area.w);
    y += p.h + GAP;
    offset += p.h + GAP;
  }
  cv.unclip(prev);
  // [F47 tui-markdown] A new final report: start reading from its first line.
  if (m.readFrom && anchors[m.readFrom] !== undefined) {
    m.scroll = anchors[m.readFrom]!;
    m.readFrom = undefined;
    return stream(m, cv, area);
  }
  const hiddenAbove = total > area.h && m.scroll < maxScroll;
  fadeEdges(cv, area, hiddenAbove, m.scroll > 0);
  scrollbar(cv, rect(area.x + 1, area.y, area.w + 1, area.h), total, maxScroll - m.scroll, m.scrollAt, now);
  if (m.scroll > 0) {
    const label = ` ↓ ${m.scroll} more · end `;
    const lx = area.x + area.w - width(label);
    button(cv, lx, area.y + area.h - 1, label.trim(), "stream:end", m, { tone: "muted" });
  }
  // The stream's own region (for the wheel) sits behind its boxes and buttons.
  cv.regions.unshift({ id: "stream", ...area });
  return { total, anchors };
}

/** The whole diff (or context.md), full screen in the middle pane. */
function pager(m: Model, cv: Canvas, r: Rect): void {
  const d = m.diff!;
  cv.fill(r, bgOf("panel"));
  const x = r.x + 2;
  const w = r.w - 4;
  const isDiff = d.lines.some((l) => l.startsWith("diff --git") || l.startsWith("@@"));
  const rows = isDiff ? diffRows(d.lines) : [];
  const g = gutterWidth(rows);
  const body = isDiff ? rows.length : d.lines.length;
  const h = r.h - 4;
  d.scroll = Math.max(0, Math.min(d.scroll, Math.max(0, body - h)));
  cv.text(x, r.y + 1, d.title, pen("text", true), w - 20);
  const pct = body <= h ? "all" : `${Math.round(((d.scroll + h) / body) * 100)}%`;
  cv.text(x + w - width(pct), r.y + 1, pct, pen("muted"));
  const area = rect(x, r.y + 3, w, h);
  for (let i = 0; i < h; i++) {
    const y = area.y + i;
    if (!isDiff) {
      const t = d.lines[d.scroll + i];
      if (t !== undefined) cv.text(x, y, t.replace(/\t/g, "    "), pen("text"), w);
      continue;
    }
    const row = rows[d.scroll + i];
    if (!row) break;
    const text = row.text.replace(/\t/g, "    ");
    if (row.kind === "file") cv.spans(x, y, [["▸ ", pen("blue")], [text, pen("text", true)]], w);
    else if (row.kind === "hunk" || row.kind === "meta") cv.text(x + g * 2 + 2, y, row.kind === "hunk" ? `⋯ ${text}` : text, pen("subtle"), w);
    else {
      const add = row.kind === "add";
      const del = row.kind === "del";
      if ((add || del) && layered()) cv.fill(rect(r.x, y, r.w, 1), mix(surface("panel"), T(add ? "jade" : "red"), 0.13));
      const num = (n: number | undefined): string => (n === undefined ? " ".repeat(g) : String(n).padStart(g));
      cv.text(x, y, `${num(row.old)} ${num(row.new)} ${add ? "+" : del ? "-" : " "} `, pen(add ? "jade" : del ? "red" : "subtle"));
      cv.text(x + g * 2 + 4, y, text, pen(add ? "jade" : del ? "red" : "text"), w - g * 2 - 4);
    }
  }
  scrollbar(cv, rect(r.x, area.y, r.w - 1, h), body, d.scroll, m.scrollAt, nowOf(m));
  cv.region("pager", area);
  let bx = x;
  const by = r.y + r.h - 1;
  for (const [k, what, id] of [["j/k", "scroll", "pager:down"], ["space", "page", "pager:page"], ["q", "back", "pager:back"]] as const) bx += button(cv, bx, by, what, id, m, { key: k, tone: "muted" }) + 1;
}

// ---------------------------------------------------------------------------
// The right pane.

function infoPane(m: Model, cv: Canvas, r: Rect): void {
  cv.fill(r, bgOf("panel"));
  const x = r.x;
  const w = r.w;
  let y = r.y;
  const end = r.y + r.h;
  // A card: a frame with its title in the top edge; dropped when it does not fit.
  const card = (bodyH: number, opts: FrameOpts, fn: (inner: Rect) => void): void => {
    const h = bodyH + 2;
    if (y + h > end) return;
    const inner = box(cv, rect(x, y, w, h), "panel", opts);
    fn(inner);
    y += h;
  };

  // The project: its name, branch and folder.
  card(3, { title: "Project" }, (a) => {
    cv.text(a.x, a.y, m.projectName ?? m.repo ?? "no project", pen("text", true), a.w);
    cv.text(a.x, a.y + 1, m.branch ? `⑂ ${m.branch}` : "⑂ no branch", pen("cyan"), a.w);
    cv.text(a.x, a.y + 2, shortPath(m.repoRoot ?? m.cwd, a.w), pen("subtle"), a.w);
  });

  if (isOn("tui-agent-graph")) {
    const reported = usageModels(m).filter((model) => quotaFor(m, model));
    card(11 + reported.length, { title: "Agents" }, (a) => agentGraph(m, cv, a, reported));
  }

  if (isOn("tui-context")) {
    const label = m.compactAsked ? "compact ✓" : "compact";
    card(8, { title: "context.md" }, (a) => {
      // The compact button sits in the top edge.
      const bw = width(label) + 2;
      button(cv, x + w - 3 - bw, a.y - 1, label, "ctx:compact", m, { tone: m.compactAsked ? "jade" : "cyan" });
      cv.region("ctx:open", rect(x + 3, a.y - 1, 12, 1));
      contextCard(m, cv, a);
    });
  }

  // Changes, with the buttons that act on them.
  const o = m.run?.outcome;
  card(2, { title: "Changes" }, (a) => {
    if (!o || o.files.length === 0) {
      cv.text(a.x, a.y, !m.run && m.stage !== "idle" ? "± being made…" : "± none yet", pen("subtle"), a.w);
      return;
    }
    cv.spans(a.x, a.y, [["± ", pen("muted")], [`+${o.insertions.toLocaleString("en-US")}`, pen("jade", true)], [" ", {}], [`−${o.deletions.toLocaleString("en-US")}`, pen("red", true)], [`  ${o.files.length} file${o.files.length === 1 ? "" : "s"}`, pen("subtle")]], a.w);
    let bx = a.x;
    bx += button(cv, bx, a.y + 1, "Diff", "act:diff", m, { tone: "blue" }) + 1;
    if (m.run?.status === "finished") button(cv, bx, a.y + 1, "Apply", "act:apply", m, { tone: "jade", strong: true });
  });

  // Cost: estimates at API list prices.
  card(m.budgetUsd !== undefined || m.costUnknown ? 2 : 1, { title: "Cost · API estimate" }, (a) => {
    const noPrices = m.costUnknown && m.cost === 0;
    const total = m.agents.size === 0 ? "–" : noPrices ? "unknown" : `${m.costUnknown ? "≥ " : ""}≈${money(m.cost)}`;
    cv.text(a.x, a.y, "this run", pen("muted"));
    cv.text(a.x + a.w - width(total), a.y, total, pen(noPrices || m.agents.size === 0 ? "subtle" : "text", !noPrices));
    if (m.budgetUsd !== undefined) {
      const frac = Math.min(1, m.expertCost / m.budgetUsd);
      const label = ` ${money(m.expertCost)}/${money(m.budgetUsd)}`;
      const bw = Math.max(3, a.w - width("expert ") - width(label));
      cv.text(a.x, a.y + 1, "expert ", pen("muted"));
      bar(cv, a.x + 7, a.y + 1, bw, frac, frac >= 1 ? "red" : "mauve");
      cv.text(a.x + 7 + bw, a.y + 1, label, pen("muted"));
    } else if (m.costUnknown && !noPrices) cv.text(a.x, a.y + 1, "some turns have no price", pen("subtle"), a.w);
  });
}

function bar(cv: Canvas, x: number, y: number, w: number, frac: number, t: Tone): void {
  const full = Math.round(Math.max(0, Math.min(1, frac)) * w);
  cv.text(x, y, "▰".repeat(full), pen(t));
  cv.text(x + full, y, "▱".repeat(Math.max(0, w - full)), pen("subtle"));
}

/** Models in the team or at work. */
function usageModels(m: Model): string[] {
  const seen: string[] = [];
  for (const a of m.agents.values()) if (!seen.includes(a.model)) seen.push(a.model);
  for (const t of m.team) {
    const model = t.model.split(" ")[0]!;
    if (!seen.some((s) => s === model || s.endsWith(`/${model}`))) seen.push(model);
  }
  return seen.slice(0, 4);
}

/**
 * [F40 tui-agent-graph] The team as a chain, top to bottom: Lead, Worker,
 * Tester, and the Expert (called in when the work is stuck). The one working
 * now is lit, and light runs down the line into it; a tester sending work back
 * runs it upwards. Each shows its model and its subscription usage where the
 * tool reports it, else its estimated cost.
 */
function agentGraph(m: Model, cv: Canvas, a: Rect, reported: string[]): void {
  const now = nowOf(m);
  const labels: Record<string, string> = { orchestrator: "lead", briefer: "spec", worker: "worker", tester: "tester", escalation: "expert" };
  const teamModel = (roles: string[]): string | undefined => {
    for (const r of roles) {
      const live = [...m.agents.values()].find((ag) => ag.roleId === r);
      if (live) return live.model;
    }
    for (const r of roles) {
      const t = m.team.find((tt) => tt.role === labels[r]);
      if (t) return t.model.split(" ")[0];
    }
    return undefined;
  };
  const agentsOf = (roles: string[]): AgentView[] => [...m.agents.values()].filter((ag) => roles.includes(ag.roleId));
  const active = (roles: string[]): boolean => agentsOf(roles).some((ag) => ag.working);
  const nodes: [string, string[]][] = [
    ["Lead", ["orchestrator", "briefer"]],
    ["Worker", ["worker"]],
    ["Tester", ["tester"]],
    ["Expert", ["escalation"]],
  ];
  const repairing = m.handoff?.from === "tester" && m.handoff.to === "worker" && active(["worker"]);
  let y = a.y;
  for (const [i, [label, roles]] of nodes.entries()) {
    if (i > 0) {
      // The line into this node: light runs down it while this node works.
      const into = active(roles);
      const back = i === 2 && repairing;
      const dotted = label === "Expert";
      const lit = (into || back) && m.motion && Math.floor(now / 160) % 2 === 0;
      cv.text(a.x + 1, y, back ? "▲" : lit ? "┃" : dotted ? "┊" : "│", { fg: T(into ? (ROLE_TONE[roles[0]!] ?? "blue") : back ? "amber" : "border"), attrs: lit ? ATTR.bold : 0 });
      if (dotted) cv.text(a.x + 3, y, "when stuck", pen("subtle"));
      y += 1;
    }
    const model = teamModel(roles);
    const ags = agentsOf(roles);
    const working = ags.some((ag) => ag.working);
    const t = ROLE_TONE[roles[0]!] ?? "blue";
    const id = `node:${roles[0]}`;
    const lit = m.hover === id || m.focusAgent === roles[0];
    if (colourOn() && (working || lit)) {
      let fill = solid(lit ? "hover" : "raised");
      if (working) fill = mix(fill, T(t), 0.14 + (m.motion ? 0.08 * (0.5 + 0.5 * Math.sin(now / 260)) : 0.08));
      cv.fill(rect(a.x - 1, y, a.w + 2, 2), fill);
    }
    const mark = working ? SPIN[Math.floor(now / 90) % SPIN.length]! : ags.some((ag) => ag.failed) ? "✗" : ags.length ? "✓" : model ? "○" : "·";
    cv.text(a.x, y, mark, pen(working ? t : ags.some((ag) => ag.failed) ? "red" : ags.length ? "jade" : "subtle", true));
    cv.text(a.x + 2, y, label, pen(model ? t : "subtle", true));
    cv.text(a.x + 10, y, model ? prettyModel(model) : "none", pen(model ? "muted" : "subtle"), a.w - 10);
    // Second line: usage, or the estimated cost, or tokens.
    const q = model ? quotaFor(m, model) : undefined;
    if (q) {
      const right = `${Math.round(q.used * 100)}% ${q.window}`;
      bar(cv, a.x + 2, y + 1, Math.max(3, a.w - 3 - width(right)), q.used, q.used > 0.85 ? "red" : q.used > 0.6 ? "amber" : t);
      cv.text(a.x + a.w - width(right), y + 1, right, pen("muted"));
    } else {
      const cost = ags.reduce((n, ag) => (ag.cost === undefined ? n : (n ?? 0) + ag.cost), undefined as number | undefined);
      const tokens = ags.reduce((n, ag) => n + ag.tokens, 0);
      const info = cost !== undefined ? `≈${money(cost)}` : tokens > 0 ? `${kTokens(tokens)} tokens` : model ? "usage not reported" : "not in this team";
      cv.text(a.x + 2, y + 1, info, pen("subtle"), a.w - 2);
    }
    cv.region(id, rect(a.x - 1, y, a.w + 2, 2));
    y += 2;
  }
  // Under the chain: each reported window, with when it resets.
  for (const model of reported) {
    const q = quotaFor(m, model)!;
    cv.text(a.x, y, `${truncate(prettyModel(model), 12)} · ${q.window}${q.resets ? ` resets ${q.resets}` : ""}`, pen("subtle"), a.w);
    y += 1;
  }
}

/** The fullest reported window of a model: how much is used, which window, and when it resets. */
function quotaFor(m: Model, model: string): { used: number; window: string; resets?: string } | undefined {
  const q = m.quotas.get(model) ?? [...m.quotas.entries()].find(([k]) => k.endsWith(model) || model.endsWith(k))?.[1];
  if (!q) return undefined;
  const [win, used] = Object.entries(q.used).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (win === undefined || used === undefined) return undefined;
  const at = q.resets?.[win];
  const resets = at ? new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined;
  const label = win === "five_hour" ? "5h" : win === "seven_day" ? "7d" : win.replace(/_/g, " ");
  return { used, window: label, resets };
}

/** [F41 tui-context] What the chosen agent's last turn was made of, as a grid. */
function contextCard(m: Model, cv: Canvas, a: Rect): void {
  const now = nowOf(m);
  const agents = [...m.agents.values()];
  const chosen =
    (m.focusAgent && agents.filter((ag) => ag.roleId === m.focusAgent).sort((p, q) => (q.startedAt ?? 0) - (p.startedAt ?? 0))[0]) ||
    agents.find((ag) => ag.working) ||
    agents.filter((ag) => ag.lastUsage).sort((p, q) => (q.doneAt ?? 0) - (p.doneAt ?? 0))[0];
  const cols = Math.max(4, Math.floor((a.w + 1) / 2));
  const rowsN = 3;
  const cells = cols * rowsN;
  const u = chosen?.lastUsage;
  const promptTok = (chosen?.promptChars ?? 0) / 4;
  const ctxTok = (chosen?.contextChars ?? 0) / 4;
  const inputAll = u ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0;
  const parts: [string, number, Tone][] = [
    ["context.md", ctxTok, "jade"],
    ["instructions", Math.max(0, promptTok - ctxTok), "blue"],
    ["reading, tools", Math.max(0, inputAll - promptTok), "mauve"],
    ["output", u?.output ?? 0, "amber"],
  ];
  const total = parts.reduce((n, p) => n + p[1], 0);
  const counts = parts.map((p) => (total > 0 && p[1] > 0 ? Math.max(1, Math.round((p[1] / total) * cells)) : 0));
  while (counts.reduce((n, c) => n + c, 0) > cells) counts[counts.indexOf(Math.max(...counts))]! -= 1;
  const reveal = m.motion ? Math.ceil(cells * ease(progress(m.contextAt, 700, now))) : cells;
  let k = 0;
  for (const [pi, n] of counts.entries()) {
    for (let i = 0; i < n; i++, k++) cv.set(a.x + (k % cols) * 2, a.y + Math.floor(k / cols), k < reveal ? "■" : "□", { fg: T(k < reveal ? parts[pi]![2] : "border") });
  }
  for (; k < cells; k++) cv.set(a.x + (k % cols) * 2, a.y + Math.floor(k / cols), "□", { fg: T("border") });
  cv.region("ctx:grid", rect(a.x, a.y, a.w, rowsN));
  // The legend, one to a row, with the numbers on the right.
  for (const [i, [name, n, t]] of parts.entries()) {
    const ly = a.y + rowsN + i;
    const num = total > 0 ? kTokens(n) : "–";
    cv.spans(a.x, ly, [["■ ", pen(t)], [name, pen("muted")]], a.w - width(num) - 1);
    cv.text(a.x + a.w - width(num), ly, num, pen("text"));
  }
  const caption = chosen
    ? `${chosen.role}${chosen.task && chosen.task !== "main" ? ` ${chosen.task}` : ""}${chosen.working ? " (now)" : ""} · ${total > 0 ? `${kTokens(total)} tokens` : "–"}`
    : "no agent has worked yet";
  cv.text(a.x, a.y + rowsN + 4, caption, pen("subtle"), a.w);
}

// ---------------------------------------------------------------------------
// Popups.

function popupFrame(m: Model, cv: Canvas, w: number, h: number, openedAt: number | undefined): Rect {
  const now = nowOf(m);
  const p = m.motion ? ease(progress(openedAt, 170, now)) : 1;
  const hh = Math.max(3, Math.round(h * p));
  const r = rect(Math.floor((cv.w - w) / 2), Math.max(1, Math.floor((cv.h - h) / 2)) + Math.floor((h - hh) / 2), w, hh);
  box(cv, r, "popup", { edge: "muted" });
  cv.region("popup:inside", r);
  return r;
}

function popupTitle(cv: Canvas, r: Rect, title: string, m: Model): void {
  cv.text(r.x + 2, r.y + 1, title, pen("text", true));
  const esc = "esc";
  button(cv, r.x + r.w - width(esc) - 4, r.y + 1, esc, "popup:close", m, { tone: "muted" });
}

function palettePopup(m: Model, cv: Canvas): void {
  const w = Math.min(78, cv.w - 6);
  const index = ((m.palette!.index % COMMANDS.length) + COMMANDS.length) % COMMANDS.length;
  const slashW = Math.max(...COMMANDS.map((c) => width(c.slash ?? ""))) + 2;
  const keysW = Math.max(...COMMANDS.map((c) => width(c.keys))) + 2;
  const lines: { group?: string; at?: number }[] = [];
  let group = "";
  for (const [n, cmd] of COMMANDS.entries()) {
    if (cmd.group !== group) {
      if (group) lines.push({});
      lines.push({ group: cmd.group });
      group = cmd.group;
    }
    lines.push({ at: n });
  }
  const room = Math.max(4, cv.h - 10);
  const sel = lines.findIndex((l) => l.at === index);
  const start = Math.max(0, Math.min(sel - Math.floor(room / 2), lines.length - room));
  const shown = lines.slice(start, start + room);
  const r = popupFrame(m, cv, w, shown.length + 5, m.palette!.at);
  popupTitle(cv, r, "Commands", m);
  const prev = cv.clip(rect(r.x + 1, r.y + 2, r.w - 2, r.h - 3));
  for (const [i, l] of shown.entries()) {
    const y = r.y + 3 + i;
    if (l.group) {
      cv.text(r.x + 2, y, l.group.toUpperCase(), { fg: T("subtle"), attrs: ATTR.bold });
      continue;
    }
    if (l.at === undefined) continue;
    const cmd = COMMANDS[l.at]!;
    const on = l.at === index || m.hover === `pal:${l.at}`;
    if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 1), solid("hover"));
    cv.text(r.x + 2, y, on ? "›" : " ", pen("jade", true));
    cv.text(r.x + 4, y, cmd.slash ?? "", pen(on ? "jade" : "blue"));
    cv.text(r.x + 4 + slashW, y, cmd.keys, pen("muted"));
    cv.text(r.x + 4 + slashW + keysW, y, cmd.label, pen("text", on), r.w - 6 - slashW - keysW);
    cv.region(`pal:${l.at}`, rect(r.x + 1, y, r.w - 2, 1));
  }
  cv.unclip(prev);
}

/** [F24 tui-sessions] [F25 tui-presets] A list with a filter typed at the top. */
export function pickerChoices(m: Model): Choice[] {
  const p = m.picker!;
  if (!p.query) return p.all;
  const q = p.query.toLowerCase();
  return p.all.filter((c) => `${c.label} ${c.detail ?? ""}`.toLowerCase().includes(q));
}

function pickerPopup(m: Model, cv: Canvas): void {
  const p = m.picker!;
  const w = Math.min(86, cv.w - 6);
  const items = pickerChoices(m);
  p.index = Math.max(0, Math.min(p.index, items.length - 1));
  const room = Math.max(2, Math.floor((cv.h - 12) / 2));
  const start = Math.max(0, Math.min(p.index - Math.floor(room / 2), items.length - room));
  const shown = items.slice(start, start + room);
  const r = popupFrame(m, cv, w, 6 + Math.max(1, shown.length) * 2, p.at);
  popupTitle(cv, r, p.title, m);
  const prev = cv.clip(rect(r.x + 1, r.y + 2, r.w - 2, r.h - 3));
  cv.spans(r.x + 2, r.y + 3, [["› ", pen("jade", true)], [p.query || "type to filter", pen(p.query ? "text" : "subtle")]], r.w - 4);
  if (items.length === 0) cv.text(r.x + 4, r.y + 5, "nothing matches", pen("subtle"));
  for (const [i, it] of shown.entries()) {
    const y = r.y + 5 + i * 2;
    const on = start + i === p.index || m.hover === `pick:${start + i}`;
    if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 2), solid("hover"));
    cv.text(r.x + 2, y, on ? "›" : " ", pen("jade", true));
    cv.text(r.x + 4, y, it.label, pen(on ? "text" : (it.tone ?? "text"), on), r.w - 6);
    cv.text(r.x + 4, y + 1, it.detail ?? "", pen("muted"), r.w - 6);
    cv.region(`pick:${start + i}`, rect(r.x + 1, y, r.w - 2, 2));
  }
  cv.unclip(prev);
}

export const SETTINGS_ROWS: { key: string; label: string; values: string[]; describe: (v: string) => string }[] = [
  { key: "transparent", label: "Background", values: ["false", "true"], describe: (v) => (v === "true" ? "transparent: the terminal's own" : "the theme's") },
  { key: "theme", label: "Theme", values: ["neuromesh-dark", "terminal", "github"], describe: (v) => (v === "github" ? "GitHub dark high contrast" : v === "terminal" ? "your terminal's colours" : "neuromesh-dark") },
  { key: "motion", label: "Animations", values: ["true", "false"], describe: (v) => (v === "true" ? "on" : "off") },
  { key: "fps", label: "Frame rate", values: ["60", "120"], describe: (v) => `${v} Hz while something moves` },
  { key: "verbose", label: "Verbosity", values: ["medium", "full", "none"], describe: (v) => v },
  { key: "access", label: "Agents", values: ["normal", "turbo"], describe: (v) => (v === "turbo" ? "Turbo: go ahead on their own" : "Normal: ask before plan and expert") },
  { key: "mouse", label: "Mouse", values: ["true", "false"], describe: (v) => (v === "true" ? "on (hold Shift to select text)" : "off") },
  { key: "sidebar", label: "Sidebar", values: ["true", "false"], describe: (v) => (v === "true" ? "shown (ctrl+b)" : "hidden (ctrl+b)") },
  { key: "telemetry", label: "Share reports", values: ["on", "off"], describe: (v) => (v === "on" ? "on: run reports go to Neuromesh's author" : v === "off" ? "off" : "not asked yet") },
  { key: "info", label: "Info pane", values: ["true", "false"], describe: (v) => (v === "true" ? "shown (ctrl+g)" : "hidden (ctrl+g)") },
];

function dialogPopup(m: Model, cv: Canvas): { row: number; col: number } | undefined {
  const d = m.dialog!;
  if (d.kind === "settings") {
    const w = Math.min(70, cv.w - 6);
    const r = popupFrame(m, cv, w, SETTINGS_ROWS.length + 6, d.at);
    popupTitle(cv, r, "Settings", m);
    const values = m.settings;
    for (const [i, s] of SETTINGS_ROWS.entries()) {
      const y = r.y + 3 + i;
      const on = i === d.index || m.hover === `set:${s.key}`;
      if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 1), solid("hover"));
      cv.text(r.x + 2, y, on ? "›" : " ", pen("jade", true));
      cv.text(r.x + 4, y, s.label, pen("text", on));
      const v = String(values[s.key] ?? s.values[0]);
      cv.spans(r.x + 18, y, [["◂ ", pen("subtle")], [s.describe(v), pen(on ? "jade" : "muted")], [" ▸", pen("subtle")]], r.w - 20);
      cv.region(`set:${s.key}`, rect(r.x + 1, y, r.w - 2, 1));
    }
    cv.text(r.x + 2, r.y + r.h - 2, "↑↓ choose · ←→ or click to change · saved as you go", pen("subtle"), r.w - 4);
    return undefined;
  }
  if (d.kind === "confirm") {
    const w = Math.min(64, cv.w - 6);
    const body = d.body.flatMap((t) => wrap(t, w - 6));
    const r = popupFrame(m, cv, w, body.length + 7, d.at);
    popupTitle(cv, r, d.title, m);
    for (const [i, t] of body.entries()) cv.text(r.x + 2, r.y + 3 + i, t, pen("muted"), r.w - 4);
    const by = r.y + r.h - 2;
    let bx = r.x + 2;
    bx += button(cv, bx, by, d.yes, "dlg:yes", m, { key: "enter", tone: d.danger ? "red" : "jade", strong: true }) + 2;
    button(cv, bx, by, "Cancel", "dlg:no", m, { key: "esc", tone: "muted" });
    return undefined;
  }
  if (d.kind === "team") {
    // [F51 tui-teams] A model (or none) for each place; Enter on a row opens the list.
    const w = Math.min(70, cv.w - 6);
    const r = popupFrame(m, cv, w, 13 + (d.error ? 1 : 0), d.at);
    popupTitle(cv, r, "Custom team", m);
    cv.text(r.x + 2, r.y + 2, "A model for each place, or none (not all three).", pen("subtle"), r.w - 4);
    const rows: [string, "expert" | "worker" | "tester", string][] = [
      ["Expert", "expert", "plans, writes the spec, steps in when stuck"],
      ["Worker", "worker", "builds"],
      ["Tester", "tester", "reviews the work"],
    ];
    for (const [i, [label, role, what]] of rows.entries()) {
      const y = r.y + 4 + i * 2;
      const on = d.index === i || m.hover === `team:${role}`;
      if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 2), solid("hover"));
      cv.text(r.x + 2, y, on ? "›" : " ", pen("jade", true));
      cv.text(r.x + 4, y, label, pen(ROLE_TONE[role === "expert" ? "orchestrator" : role] ?? "text", true));
      const id = d.team[role];
      cv.text(r.x + 14, y, id === "none" ? "none" : (d.labels[id] ?? id), pen(id === "none" ? "subtle" : "text", id !== "none"), r.w - 18);
      cv.text(r.x + 14, y + 1, id === "none" ? "" : id.split("/")[0] === "opencode" ? "opencode" : what, pen("subtle"), r.w - 18);
      cv.region(`team:${role}`, rect(r.x + 1, y, r.w - 2, 2));
    }
    if (d.error) cv.text(r.x + 2, r.y + r.h - 3, d.error, pen("red"), r.w - 4);
    const by = r.y + r.h - 2;
    let bx = r.x + 2;
    bx += button(cv, bx, by, "Save and use", "team:save", m, { key: "s", tone: "jade", strong: true }) + 2;
    button(cv, bx, by, "Cancel", "dlg:no", m, { key: "esc", tone: "muted" });
    return undefined;
  }
  if (d.kind === "connect") {
    // [F50 opencode] The four tools, each signed in with its own login.
    const tools: [string, string, string][] = [
      ["codex", "Codex", "GPT-6 Luna, GPT-6.1 Sol"],
      ["claude", "Claude Code", "Opus, Fable, Sonnet, Haiku"],
      ["agy", "Antigravity", "Gemini 3.8 Flash"],
      ["opencode", "opencode", "any provider; API keys too"],
    ];
    const w = Math.min(76, cv.w - 6);
    const r = popupFrame(m, cv, w, tools.length * 2 + 8, d.at);
    popupTitle(cv, r, "Connections", m);
    cv.text(r.x + 2, r.y + 2, "Neuromesh uses your own subscriptions through these tools.", pen("subtle"), r.w - 4);
    for (const [i, [id, name, models]] of tools.entries()) {
      const y = r.y + 4 + i * 2;
      const on = d.index === i || m.hover === `conn:${id}`;
      if (on) cv.fill(rect(r.x + 1, y, r.w - 2, 2), solid("hover"));
      cv.text(r.x + 2, y, on ? "›" : " ", pen("jade", true));
      const st = d.status[id] ?? { state: "checking…", tone: "muted" as Tone };
      cv.spans(r.x + 4, y, [[name, pen("text", true)], [st.version ? `  ${st.version}` : "", pen("subtle")]], r.w - 30);
      cv.text(r.x + 4, y + 1, models, pen("subtle"), r.w - 30);
      cv.text(r.x + r.w - 26, y, st.state, pen(st.tone), 24);
      const label = id === "opencode" ? "Log in / API key" : "Log in";
      button(cv, r.x + r.w - 26, y + 1, label, `conn:${id}`, m, { tone: "blue" });
    }
    cv.text(r.x + 2, r.y + r.h - 2, "enter signs in with the tool's own login · r checks again", pen("subtle"), r.w - 4);
    return undefined;
  }
  if (d.kind === "consent") {
    // [F52 telemetry] Asked once, plainly.
    const w = Math.min(74, cv.w - 6);
    const body = NOTICE.flatMap((t, i) => [...wrap(t, w - 6), ...(i < NOTICE.length - 1 ? [""] : [])]);
    const r = popupFrame(m, cv, w, body.length + 7, d.at);
    cv.text(r.x + 2, r.y + 1, "Help test Neuromesh?", pen("text", true));
    for (const [i, t] of body.entries()) cv.text(r.x + 2, r.y + 3 + i, t, pen(i === 0 ? "text" : "muted"), r.w - 4);
    const by = r.y + r.h - 2;
    let bx = r.x + 2;
    bx += button(cv, bx, by, "Share reports", "consent:yes", m, { key: "y", tone: "jade", strong: true }) + 2;
    button(cv, bx, by, "Don't share", "consent:no", m, { key: "n", tone: "muted" });
    return undefined;
  }
  // A form: labelled fields, a browse button for folders, and submit.
  const w = Math.min(72, cv.w - 6);
  const r = popupFrame(m, cv, w, d.fields.length * 3 + 6 + (d.error ? 1 : 0), d.at);
  popupTitle(cv, r, d.title, m);
  let cursor: { row: number; col: number } | undefined;
  for (const [i, f] of d.fields.entries()) {
    const y = r.y + 3 + i * 3;
    const focused = i === d.focus;
    cv.text(r.x + 2, y, f.label, pen(focused ? "text" : "muted", focused));
    const browseW = f.browse ? 11 : 0;
    const fw = r.w - 4 - browseW;
    const field = rect(r.x + 2, y + 1, fw, 1);
    cv.fill(field, colourOn() ? solid(focused ? "input" : "button") : DEFAULT);
    if (!colourOn()) cv.text(field.x, field.y, "[", {});
    const shownValue = f.value ? truncate(f.value.length > fw - 3 ? `…${f.value.slice(-(fw - 4))}` : f.value, fw - 2) : "";
    cv.text(field.x + 1, field.y, shownValue || f.placeholder || "", pen(f.value ? "text" : "subtle"), fw - 2);
    cv.region(`dlg:field:${i}`, field);
    if (f.browse) button(cv, field.x + fw + 1, field.y, "Browse…", `dlg:browse:${i}`, m, { tone: "blue" });
    if (focused) cursor = { row: field.y, col: field.x + 1 + Math.min(width(shownValue), fw - 3) };
  }
  if (d.error) cv.text(r.x + 2, r.y + r.h - 3, d.error, pen("red"), r.w - 4);
  const by = r.y + r.h - 2;
  let bx = r.x + 2;
  bx += button(cv, bx, by, d.submit, "dlg:yes", m, { key: "enter", tone: "jade", strong: true }) + 2;
  button(cv, bx, by, "Cancel", "dlg:no", m, { key: "esc", tone: "muted" });
  return cursor;
}

/** [F46 tui-fps] How fast to draw: "fast" while something moves, "slow" for a scrolling name, else "none". */
export function motionNeeded(m: Model, cols: number): "fast" | "slow" | "none" {
  if (!m.motion) return !m.run && m.stage !== "idle" ? "slow" : "none";
  const now = nowOf(m);
  const recent = (at: number | undefined, ms: number): boolean => at !== undefined && now - at < ms;
  if (!m.run && m.stage !== "idle") return "fast";
  // The landing logo's light keeps moving.
  if (m.log.length === 0 && isOn("tui-theme")) return "fast";
  if (
    recent(m.introAt, 1_400) ||
    recent(m.brandAt, 1_200) ||
    recent(m.statusAt, 500) ||
    recent(m.stageAt, 700) ||
    recent(m.scrollAt, 1_600) ||
    recent(m.sideScrollAt, 1_600) ||
    recent(m.contextAt, 800) ||
    recent(m.palette?.at, 250) ||
    recent(m.picker?.at, 250) ||
    recent(m.dialog?.at, 250) ||
    recent(m.endedAt, 2_700) ||
    (m.toast !== undefined && m.toast.until > now - 100)
  )
    return "fast";
  const name = m.projectName ?? m.repo ?? "";
  if (width(name) > Math.max(8, Math.min(28, Math.floor(cols / 4)))) return "slow";
  return "none";
}
