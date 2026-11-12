// [F19 tui] [F32 tui-layers] Colours.
//
// The palette starts from the terminal's own colours: at start the TUI asks the
// terminal for its foreground, background and 16 palette colours (OSC 10, 11
// and 4), so Neuromesh looks like the rest of the terminal, as opencode and
// Claude Code do. When the terminal does not answer, GitHub Dark High Contrast
// stands in. The other theme is GitHub Dark High Contrast itself.
//
// From the background come the layers: the base, panes a step up, bars and
// cards above those, popups on top, and a shadow below. In transparent mode
// (settings) no background is painted at all and boxes are drawn with lines.
// NO_COLOR turns colour off and implies transparent. State is always shown in
// words or symbols too, never by colour alone.

export type Tone = "text" | "muted" | "subtle" | "jade" | "blue" | "mauve" | "amber" | "red" | "cyan";
export type Surface = "base" | "panel" | "bar" | "raised" | "button" | "hover" | "input" | "inputBar" | "popup" | "shadow" | "selected";
export type ThemeName = "terminal" | "github";
export type Rgb = [number, number, number];

/** A colour as 0xRRGGBB, or DEFAULT for the terminal's own. */
export const DEFAULT = -1;

const GITHUB = {
  fg: [0xf0, 0xf3, 0xf6] as Rgb,
  bg: [0x0a, 0x0c, 0x10] as Rgb,
  // black, red, green, yellow, blue, magenta, cyan, white, then the bright ones
  ansi: [
    [0x7a, 0x82, 0x8e], [0xff, 0x94, 0x92], [0x26, 0xcd, 0x4d], [0xf0, 0xb7, 0x2f], [0x71, 0xb7, 0xff], [0xcb, 0x9e, 0xff], [0x39, 0xc5, 0xcf], [0xd9, 0xde, 0xe3],
    [0x9e, 0xa7, 0xb3], [0xff, 0xb1, 0xaf], [0x4a, 0xe1, 0x68], [0xf7, 0xc8, 0x43], [0x91, 0xcb, 0xff], [0xdb, 0xb7, 0xff], [0x56, 0xd4, 0xdd], [0xff, 0xff, 0xff],
  ] as Rgb[],
};

export interface TerminalColours {
  fg?: Rgb;
  bg?: Rgb;
  ansi?: (Rgb | undefined)[];
}

let theme: ThemeName = process.env.NEUROMESH_THEME === "github" ? "github" : "terminal";
let queried: TerminalColours = {};
let transparent = false;
let depth: "none" | "256" | "true" = process.env.NO_COLOR
  ? "none"
  : /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || /ghostty|iTerm|WezTerm|vscode|kitty|alacritty/i.test(`${process.env.TERM_PROGRAM ?? ""} ${process.env.TERM ?? ""}`)
    ? "true"
    : "256";

let fgs: Record<Tone, number>;
let bgs: Record<Surface, number>;
let lightBg = false;

const pack = (c: Rgb): number => (c[0] << 16) | (c[1] << 8) | c[2];
export const unpack = (n: number): Rgb => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Mix two packed colours: t=0 is `a`, t=1 is `b`. */
export function mix(a: number, b: number, t: number): number {
  if (a < 0 || b < 0) return a;
  const x = unpack(a);
  const y = unpack(b);
  return pack([0, 1, 2].map((i) => Math.round(x[i]! + (y[i]! - x[i]!) * t)) as Rgb);
}

function luminance(c: Rgb): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

function rebuild(): void {
  const useTerminal = theme === "terminal";
  const fg = (useTerminal && queried.fg) || GITHUB.fg;
  const bg = (useTerminal && queried.bg) || GITHUB.bg;
  const ansi = (i: number): Rgb => (useTerminal && queried.ansi?.[i]) || GITHUB.ansi[i]!;
  lightBg = luminance(bg) > 0.5;
  const F = pack(fg);
  const B = pack(bg);
  // The terminal's own green, blue... unless they are unreadable on its background.
  const accent = (i: number, bright: number): number => {
    const c = ansi(i);
    return Math.abs(luminance(c) - luminance(bg)) < 0.18 ? pack(ansi(bright)) : pack(c);
  };
  fgs = {
    text: F,
    muted: mix(F, B, 0.4),
    subtle: mix(F, B, 0.62),
    jade: accent(2, 10),
    blue: accent(4, 12),
    mauve: accent(5, 13),
    amber: accent(3, 11),
    red: accent(1, 9),
    cyan: accent(6, 14),
  };
  // Layers step towards the foreground; the shadow steps away from it.
  const up = (t: number): number => mix(B, F, t);
  bgs = {
    base: B,
    panel: up(0.045),
    bar: up(0.08),
    raised: up(0.095),
    input: up(0.1),
    inputBar: up(0.15),
    button: up(0.16),
    hover: up(0.23),
    popup: up(0.12),
    shadow: mix(B, 0x000000, lightBg ? 0.14 : 0.6),
    selected: mix(up(0.075), fgs.blue, 0.22),
  };
}
rebuild();

export function setTheme(name: ThemeName): void {
  theme = name;
  rebuild();
}

export function themeName(): ThemeName {
  return theme;
}

/** What the terminal said its colours are (from term.queryColours). */
export function setTerminalColours(c: TerminalColours): void {
  queried = c;
  rebuild();
}

export function terminalColoursKnown(): boolean {
  return queried.bg !== undefined;
}

export function setTransparent(on: boolean): void {
  transparent = on;
}

/** No backgrounds painted: the terminal's own (perhaps see-through) background shows. */
export function isTransparent(): boolean {
  return transparent || depth === "none";
}

export function colourOn(): boolean {
  return depth !== "none";
}

export function setColorDepth(d: "none" | "256" | "true"): void {
  depth = d;
}

export function colorDepth(): "none" | "256" | "true" {
  return depth;
}

/** A tone as a packed colour (DEFAULT without colour). */
export function tone(t: Tone): number {
  if (depth === "none") return DEFAULT;
  return fgs[t];
}

/** A surface's background: DEFAULT (nothing painted) when transparent. */
export function surface(s: Surface): number {
  if (isTransparent()) return s === "selected" && depth !== "none" ? bgs.selected : DEFAULT;
  return bgs[s];
}

/** A surface colour even in transparent mode, for small filled things such as buttons. */
export function solid(s: Surface): number {
  if (depth === "none") return DEFAULT;
  return bgs[s];
}

export function isLight(): boolean {
  return lightBg;
}

// ---------------------------------------------------------------------------
// Escape sequences.

export const ATTR = { bold: 1, dim: 2, italic: 4, underline: 8, reverse: 16 } as const;

const CUBE = [0, 95, 135, 175, 215, 255];

/** The nearest of the 256 xterm colours. */
export function to256(n: number): number {
  const [r, g, b] = unpack(n);
  const idx = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const ci = 16 + 36 * idx(r) + 6 * idx(g) + idx(b);
  const cube: Rgb = [CUBE[idx(r)]!, CUBE[idx(g)]!, CUBE[idx(b)]!];
  const grey = Math.max(0, Math.min(23, Math.round((r + g + b) / 3 / 10.7 - 0.7)));
  const gv = 8 + grey * 10;
  const d = (a: Rgb, x: Rgb): number => (a[0] - x[0]) ** 2 + (a[1] - x[1]) ** 2 + (a[2] - x[2]) ** 2;
  return d([r, g, b], [gv, gv, gv]) < d([r, g, b], cube) ? 232 + grey : ci;
}

function colour(n: number, background: boolean): string {
  if (n < 0 || depth === "none") return "";
  if (depth === "256") return `;${background ? 48 : 38};5;${to256(n)}`;
  const [r, g, b] = unpack(n);
  return `;${background ? 48 : 38};2;${r};${g};${b}`;
}

/** The full SGR for a cell: always starts from a reset, so cells never inherit. */
export function sgr(fg: number, bg: number, attrs: number): string {
  let s = "\x1b[0";
  if (attrs & ATTR.bold) s += ";1";
  if (attrs & ATTR.dim) s += ";2";
  if (attrs & ATTR.italic) s += ";3";
  if (attrs & ATTR.underline) s += ";4";
  if (attrs & ATTR.reverse) s += ";7";
  return `${s}${colour(fg, false)}${colour(bg, true)}m`;
}

// ---------------------------------------------------------------------------
// String helpers, for the few places that build styled strings rather than
// drawing on a canvas (the screensaver, messages printed on exit).

export function fg(t: Tone, text: string, isBold = false): string {
  if (depth === "none") return text;
  return `${sgr(tone(t), DEFAULT, isBold ? ATTR.bold : 0)}${text}\x1b[0m`;
}

export function bold(text: string): string {
  return depth === "none" ? text : `\x1b[1m${text}\x1b[22m`;
}
