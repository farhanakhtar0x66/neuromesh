// [F19 tui] The terminal: raw input, the alternate screen, and drawing. Every
// way out (normal quit, an error, a signal) puts the terminal back as it was.
// Key decoding is a pure function so it can be tested without a terminal.

import { cellWidth, graphemes } from "./text.ts";

export interface Key {
  name: string;
  /** The typed text, for "char" and "paste". */
  text?: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const TILDE: Record<string, string> = { "1": "home", "2": "insert", "3": "delete", "4": "end", "5": "pageup", "6": "pagedown", "7": "home", "8": "end", "15": "f5", "17": "f6", "18": "f7", "19": "f8", "20": "f9", "21": "f10", "23": "f11", "24": "f12" };
const FINAL: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4", Z: "tab" };

function modifiers(param: string | undefined): Pick<Key, "ctrl" | "alt" | "shift"> {
  const m = Number.parseInt(param ?? "1", 10) - 1;
  if (!(m > 0)) return {};
  const out: Pick<Key, "ctrl" | "alt" | "shift"> = {};
  if (m & 1) out.shift = true;
  if (m & 2) out.alt = true;
  if (m & 4) out.ctrl = true;
  return out;
}

function single(ch: string, alt = false): Key {
  const code = ch.codePointAt(0)!;
  const a = alt ? { alt: true } : {};
  if (ch === "\r" || ch === "\n") return { name: "enter", ...a };
  if (ch === "\t") return { name: "tab", ...a };
  if (ch === "\x7f" || ch === "\b") return { name: "backspace", ...a };
  if (ch === "\x1b") return { name: "esc" };
  if (code === 0) return { name: "space", ctrl: true };
  if (code < 32) return { name: String.fromCharCode(code + 96), ctrl: true, ...a };
  if (ch === " ") return { name: "space", text: " ", ...a };
  return { name: "char", text: ch, ...a };
}

/**
 * Decode terminal input into keys. `pending` carries a bracketed paste that
 * spans several reads; pass the returned value into the next call.
 */
export function parseKeys(input: string, pending = ""): { keys: Key[]; pending: string } {
  const keys: Key[] = [];
  let s = pending + input;
  let i = 0;
  if (pending.startsWith(PASTE_START)) {
    const end = s.indexOf(PASTE_END);
    if (end < 0) return { keys, pending: s };
    keys.push({ name: "paste", text: s.slice(PASTE_START.length, end) });
    s = s.slice(end + PASTE_END.length);
  }
  while (i < s.length) {
    if (s.startsWith(PASTE_START, i)) {
      const end = s.indexOf(PASTE_END, i);
      if (end < 0) return { keys, pending: s.slice(i) };
      keys.push({ name: "paste", text: s.slice(i + PASTE_START.length, end) });
      i = end + PASTE_END.length;
      continue;
    }
    const ch = s[i]!;
    if (ch === "\x1b") {
      const next = s[i + 1];
      if (next === undefined) {
        keys.push({ name: "esc" });
        i += 1;
        continue;
      }
      if (next === "[") {
        // CSI: parameters, then one final byte.
        let j = i + 2;
        while (j < s.length && /[0-9;:?<=>]/.test(s[j]!)) j++;
        const final = s[j];
        if (final === undefined) {
          keys.push({ name: "esc" });
          i += 1;
          continue;
        }
        const params = s.slice(i + 2, j).split(";");
        // [F31 tui-screensaver] SGR mouse reports (\x1b[<b;x;yM), only sent while tracking is on.
        if (params[0]?.startsWith("<") && (final === "M" || final === "m")) keys.push({ name: "mouse" });
        else if (final === "~") keys.push({ name: TILDE[params[0]!] ?? "unknown", ...modifiers(params[1]) });
        else if (final === "u") {
          // Keyboard protocol: code;modifiers u (kitty and others), e.g. Shift+Enter.
          const code = Number.parseInt(params[0] ?? "", 10);
          const base = Number.isFinite(code) ? single(String.fromCodePoint(code)) : { name: "unknown" };
          keys.push({ ...base, ...modifiers(params[1]) });
        } else if (final === "Z") keys.push({ name: "tab", shift: true });
        else keys.push({ name: FINAL[final] ?? "unknown", ...modifiers(params[1]) });
        i = j + 1;
        continue;
      }
      if (next === "O") {
        const final = s[i + 2];
        keys.push({ name: (final && FINAL[final]) ?? "unknown" });
        i += final ? 3 : 2;
        continue;
      }
      // Alt plus a key.
      const cp = s.codePointAt(i + 1)!;
      const len = cp > 0xffff ? 2 : 1;
      keys.push(single(s.slice(i + 1, i + 1 + len), true));
      i += 1 + len;
      continue;
    }
    const cp = s.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    keys.push(single(s.slice(i, i + len)));
    i += len;
  }
  // Consecutive typed characters become one key, so a fast burst is one update.
  const merged: Key[] = [];
  for (const k of keys) {
    const last = merged.at(-1);
    if (k.name === "char" && !k.alt && last?.name === "char" && !last.alt) last.text += k.text!;
    else merged.push(k);
  }
  return { keys: merged, pending: "" };
}

export interface Size {
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// Frames as grids of cells. Drawing compares cells, not lines, so a spinner or
// a light sweeping across a word rewrites those few cells only; rewriting the
// whole row on every animation frame made rows flicker in some terminals.

/** One screen cell: its text ("" for the second half of a wide character) and its style. */
export interface Cell {
  ch: string;
  style: string;
}

interface Pen {
  weight: string;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
  fg: string;
  bg: string;
}

const PLAIN: Pen = { weight: "", italic: false, underline: false, reverse: false, fg: "", bg: "" };

function applySgr(pen: Pen, params: string): Pen {
  const p = { ...pen };
  const nums = params === "" ? ["0"] : params.split(";");
  for (let i = 0; i < nums.length; i++) {
    const n = Number(nums[i]);
    if (n === 0) Object.assign(p, PLAIN);
    else if (n === 1 || n === 2) p.weight = String(n);
    else if (n === 22) p.weight = "";
    else if (n === 3) p.italic = true;
    else if (n === 23) p.italic = false;
    else if (n === 4) p.underline = true;
    else if (n === 24) p.underline = false;
    else if (n === 7) p.reverse = true;
    else if (n === 27) p.reverse = false;
    else if (n === 39) p.fg = "";
    else if (n === 49) p.bg = "";
    else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) p.fg = String(n);
    else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) p.bg = String(n);
    else if (n === 38 || n === 48) {
      const mode = nums[i + 1];
      const take = mode === "2" ? 5 : mode === "5" ? 3 : 1;
      const value = nums.slice(i, i + take).join(";");
      if (n === 38) p.fg = value;
      else p.bg = value;
      i += take - 1;
    }
  }
  return p;
}

function penCode(p: Pen): string {
  const parts = ["0"];
  if (p.weight) parts.push(p.weight);
  if (p.italic) parts.push("3");
  if (p.underline) parts.push("4");
  if (p.reverse) parts.push("7");
  if (p.fg) parts.push(p.fg);
  if (p.bg) parts.push(p.bg);
  return `\x1b[${parts.join(";")}m`;
}

/** A styled line as exactly `cols` cells; the rest of the row takes the line's last background. */
export function toCells(line: string, cols: number): Cell[] {
  const out: Cell[] = [];
  let pen = PLAIN;
  let style = penCode(pen);
  for (const tok of line.match(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|[^\x1b]+|\x1b/g) ?? []) {
    if (tok.startsWith("\x1b")) {
      if (tok.endsWith("m") && tok.startsWith("\x1b[")) {
        pen = applySgr(pen, tok.slice(2, -1));
        style = penCode(pen);
      }
      continue;
    }
    for (const g of graphemes(tok)) {
      const w = cellWidth(g);
      if (w === 0) {
        const last = out.at(-1);
        if (last && last.ch !== "") last.ch += g;
        continue;
      }
      if (out.length + w > cols) return out.concat(Array.from({ length: cols - out.length }, () => ({ ch: " ", style })));
      out.push({ ch: g, style });
      if (w === 2) out.push({ ch: "", style });
    }
  }
  while (out.length < cols) out.push({ ch: " ", style });
  return out;
}

/** What to write to turn the screen `prev` into `next`: only the cells that differ. */
export function diffFrame(prev: Cell[][], next: Cell[][]): string {
  let out = "";
  let pen = "";
  for (let y = 0; y < next.length; y++) {
    const a = prev[y];
    const b = next[y]!;
    let x = 0;
    while (x < b.length) {
      if (a && a[x]?.ch === b[x]!.ch && a[x]?.style === b[x]!.style) {
        x++;
        continue;
      }
      // A run of changes; short unchanged gaps are rewritten rather than skipped over.
      let start = x;
      if (b[start]!.ch === "" && start > 0) start--;
      let end = x;
      let same = 0;
      for (let i = x; i < b.length; i++) {
        const changed = !a || a[i]?.ch !== b[i]!.ch || a[i]?.style !== b[i]!.style;
        if (changed) {
          end = i;
          same = 0;
        } else if (++same > 4) break;
      }
      if (b[end + 1]?.ch === "") end++;
      out += `\x1b[${y + 1};${start + 1}H`;
      for (let i = start; i <= end; i++) {
        const c = b[i]!;
        if (c.ch === "") continue;
        if (c.style !== pen) {
          out += c.style;
          pen = c.style;
        }
        out += c.ch;
      }
      x = end + 1;
    }
  }
  return pen ? `${out}\x1b[0m` : out;
}

export class Terminal {
  private readonly out: NodeJS.WriteStream;
  private readonly input: NodeJS.ReadStream;
  private previous: Cell[][] = [];
  private pending = "";
  private active = false;
  private readonly cleanups: (() => void)[] = [];
  private onData: ((data: string) => void) | undefined;

  constructor(input: NodeJS.ReadStream = process.stdin, out: NodeJS.WriteStream = process.stdout) {
    this.input = input;
    this.out = out;
  }

  size(): Size {
    return { cols: this.out.columns || 80, rows: this.out.rows || 24 };
  }

  start(onKeys: (keys: Key[]) => void, onResize: () => void): void {
    this.active = true;
    this.input.setRawMode?.(true);
    this.input.setEncoding("utf8");
    this.input.resume();
    // Alternate screen, hidden cursor, bracketed paste, cursor keys in normal mode.
    this.out.write("\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[H\x1b[2J");
    const onData = (data: string): void => {
      const { keys, pending } = parseKeys(data, this.pending);
      this.pending = pending;
      if (keys.length > 0) onKeys(keys);
    };
    const resize = (): void => {
      this.previous = [];
      onResize();
    };
    this.onData = onData;
    this.input.on("data", onData);
    this.out.on("resize", resize);
    this.cleanups.push(() => this.input.off("data", onData), () => this.out.off("resize", resize));
    // Whatever happens, the terminal comes back.
    const restore = (): void => this.stop();
    const fatal = (error: unknown): void => {
      this.stop();
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(1);
    };
    const signal = (): void => {
      this.stop();
      process.exit(130);
    };
    process.on("exit", restore);
    process.on("uncaughtException", fatal);
    process.on("unhandledRejection", fatal);
    process.on("SIGTERM", signal);
    process.on("SIGHUP", signal);
    this.cleanups.push(
      () => process.off("exit", restore),
      () => process.off("uncaughtException", fatal),
      () => process.off("unhandledRejection", fatal),
      () => process.off("SIGTERM", signal),
      () => process.off("SIGHUP", signal),
    );
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const c of this.cleanups.splice(0)) c();
    this.out.write("\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l");
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  /**
   * [F31 tui-screensaver] Report mouse movement (any-motion, SGR). Only while
   * the screensaver shows: with tracking on, the terminal's own text selection
   * needs Shift, so it stays off the rest of the time.
   */
  mouse(on: boolean): void {
    if (this.active) this.out.write(on ? "\x1b[?1003h\x1b[?1006h" : "\x1b[?1003l\x1b[?1006l");
  }

  /** [F28 tui-notify] The terminal window or tab title. */
  title(text: string): void {
    if (this.active) this.out.write(`\x1b]0;${text.replace(/[\x00-\x1f]/g, " ")}\x07`);
  }

  /** [F28 tui-notify] Ring the terminal bell (most terminals flash or badge the tab). */
  bell(): void {
    if (this.active) this.out.write("\x07");
  }

  /**
   * [F31 tui-screensaver] Hand the terminal to another program for a while
   * (the owner's external screensaver), then take it back with resume().
   */
  suspend(): void {
    if (!this.active || !this.onData) return;
    this.input.off("data", this.onData);
    this.out.write("\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m");
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  resume(): void {
    if (!this.active || !this.onData) return;
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on("data", this.onData);
    this.out.write("\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[H\x1b[2J");
    this.previous = [];
  }

  /** Forget the last frame, so the next one is drawn in full (after a theme change). */
  invalidate(): void {
    this.previous = [];
  }

  /** Draw a frame: only cells that changed are written, inside one synchronized update. */
  draw(lines: string[], cursor?: { row: number; col: number }): void {
    if (!this.active) return;
    const { cols, rows } = this.size();
    const next = lines.slice(0, rows).map((l) => toCells(l, cols));
    while (next.length < rows) next.push(toCells("", cols));
    const fresh = this.previous.length === 0;
    let out = "\x1b[?2026h\x1b[?25l";
    if (fresh) out += "\x1b[0m\x1b[H\x1b[2J";
    out += diffFrame(this.previous, next);
    out += cursor ? `\x1b[${cursor.row + 1};${cursor.col + 1}H\x1b[?25h` : "";
    out += "\x1b[?2026l";
    this.previous = next;
    this.out.write(out);
  }
}
