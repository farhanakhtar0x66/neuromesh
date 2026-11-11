// [F19 tui] Colours. By default Neuromesh uses the terminal's own colours: the
// background is never painted and accents come from the terminal's 16-colour
// palette, so it looks like the rest of the user's terminal (as Claude Code and
// opencode do). One alternative: GitHub Dark High Contrast in true colour
// (`NEUROMESH_THEME=github`, or Ctrl+T in the TUI). NO_COLOR turns colour off.
// State is always shown in words or symbols too, never by colour alone.

export type Tone = "text" | "muted" | "jade" | "blue" | "mauve" | "amber" | "red";
export type ThemeName = "terminal" | "github";

// The terminal's palette: default foreground, bright black, green, blue, magenta, yellow, red.
const ANSI: Record<Tone, string> = { text: "39", muted: "90", jade: "32", blue: "34", mauve: "35", amber: "33", red: "31" };

// GitHub Dark High Contrast.
const GITHUB: Record<Tone | "canvas" | "border", [number, number, number]> = {
  canvas: [0x0a, 0x0c, 0x10],
  text: [0xf0, 0xf3, 0xf6],
  muted: [0x9e, 0xa7, 0xb3],
  border: [0x7a, 0x82, 0x8e],
  jade: [0x26, 0xcd, 0x4d],
  blue: [0x71, 0xb7, 0xff],
  mauve: [0xcb, 0x9e, 0xff],
  amber: [0xf0, 0xb7, 0x2f],
  red: [0xff, 0x6a, 0x69],
};

let theme: ThemeName = process.env.NEUROMESH_THEME === "github" ? "github" : "terminal";
let colour = !process.env.NO_COLOR;

export function setTheme(name: ThemeName): void {
  theme = name;
}

export function themeName(): ThemeName {
  return theme;
}

export function colourOn(): boolean {
  return colour;
}

/** For tests: "none" switches colour off; anything else on. */
export function setColorDepth(depth: "none" | "256" | "true"): void {
  colour = depth !== "none";
}

const rgb = (c: [number, number, number], bg = false): string => `\x1b[${bg ? 48 : 38};2;${c[0]};${c[1]};${c[2]}m`;
const textOn = (): string => (theme === "github" ? rgb(GITHUB.text) : "\x1b[39m");

export const RESET = "\x1b[0m";

export function fg(tone: Tone, text: string, bold = false): string {
  if (!colour) return text;
  const on = theme === "github" ? rgb(GITHUB[tone]) : `\x1b[${ANSI[tone]}m`;
  return `${bold ? "\x1b[1m" : ""}${on}${text}${bold ? "\x1b[22m" : ""}${textOn()}`;
}

export function bold(text: string): string {
  return colour ? `\x1b[1m${text}\x1b[22m` : text;
}

/** The start of every line. In the terminal theme nothing: the terminal's own background shows. */
export function canvas(): string {
  if (!colour) return "";
  return theme === "github" ? rgb(GITHUB.canvas, true) + rgb(GITHUB.text) : "\x1b[39;49m";
}

/** Borders and separators. */
export function border(text: string): string {
  if (!colour) return text;
  return `${theme === "github" ? rgb(GITHUB.border) : "\x1b[90m"}${text}${textOn()}`;
}

/**
 * A button or badge: the text on a filled block of the tone's colour, one
 * space either side. In the terminal theme this is reverse video, so it uses
 * the terminal's own palette. Without colour it is "[text]", the same width.
 */
export function chip(text: string, tone: Tone = "muted", strong = false): string {
  if (!colour) return `[${text}]`;
  if (theme === "github") {
    const back = tone === "text" ? GITHUB.text : GITHUB[tone];
    return `${rgb(back, true)}${rgb(GITHUB.canvas)}${strong ? "\x1b[1m" : ""} ${text} ${strong ? "\x1b[22m" : ""}${rgb(GITHUB.canvas, true)}${textOn()}`;
  }
  return `\x1b[7m\x1b[${ANSI[tone]}m${strong ? "\x1b[1m" : ""} ${text} ${strong ? "\x1b[22m" : ""}\x1b[27m${textOn()}`;
}

/** A key the person can press, as a key-cap. */
export function keycap(key: string): string {
  return chip(key, "muted", true);
}

/** Heavy box-drawing pieces, for the thicker frame and boxes. */
export const BOX = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃", tDown: "┳", tUp: "┻", tRight: "┣", tLeft: "┫" };
