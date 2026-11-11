// [F19 tui] The terminal: raw input, the alternate screen, and drawing. Every
// way out (normal quit, an error, a signal) puts the terminal back as it was.
// Key decoding is a pure function so it can be tested without a terminal.

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
        if (final === "~") keys.push({ name: TILDE[params[0]!] ?? "unknown", ...modifiers(params[1]) });
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

export class Terminal {
  private readonly out: NodeJS.WriteStream;
  private readonly input: NodeJS.ReadStream;
  private previous: string[] = [];
  private pending = "";
  private active = false;
  private readonly cleanups: (() => void)[] = [];

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
    this.out.write("\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l");
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  /** Draw a frame: only lines that changed are written, inside one synchronized update. */
  draw(lines: string[], cursor?: { row: number; col: number }): void {
    if (!this.active) return;
    let out = "\x1b[?2026h";
    for (let i = 0; i < lines.length; i++) {
      if (this.previous[i] !== lines[i]) out += `\x1b[${i + 1};1H${lines[i]}\x1b[0m\x1b[K`;
    }
    for (let i = lines.length; i < this.previous.length; i++) out += `\x1b[${i + 1};1H\x1b[0m\x1b[K`;
    out += cursor ? `\x1b[${cursor.row + 1};${cursor.col + 1}H\x1b[?25h` : "\x1b[?25l";
    out += "\x1b[?2026l";
    this.previous = lines;
    this.out.write(out);
  }
}
