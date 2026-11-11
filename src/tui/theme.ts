// [F19 tui] Colours. The Signal palette from the design pack, in true colour
// where the terminal says it has it, 256 colours otherwise, and none with
// NO_COLOR. State is always shown in words or symbols too, never colour alone.

export type Tone = "text" | "muted" | "jade" | "blue" | "mauve" | "amber" | "red";

const RGB: Record<Tone | "canvas" | "surface" | "raised" | "hairline", [number, number, number]> = {
  canvas: [0x0b, 0x10, 0x12],
  surface: [0x17, 0x20, 0x1d],
  raised: [0x1d, 0x2a, 0x24],
  hairline: [0x26, 0x35, 0x2f],
  text: [0xea, 0xf2, 0xed],
  muted: [0x91, 0xa5, 0x9a],
  jade: [0x75, 0xda, 0xb8],
  blue: [0x8c, 0xbf, 0xff],
  mauve: [0xc6, 0xa5, 0xea],
  amber: [0xeb, 0xc1, 0x7f],
  red: [0xf1, 0x8b, 0x8b],
};

type Depth = "true" | "256" | "none";

function detect(): Depth {
  if (process.env.NO_COLOR) return "none";
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  if (ct.includes("truecolor") || ct.includes("24bit")) return "true";
  return "256";
}

let depth: Depth = detect();

export function setColorDepth(d: Depth): void {
  depth = d;
}

function to256([r, g, b]: [number, number, number]): number {
  const q = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function code(rgb: [number, number, number], bg: boolean): string {
  if (depth === "none") return "";
  if (depth === "true") return `\x1b[${bg ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `\x1b[${bg ? 48 : 38};5;${to256(rgb)}m`;
}

export const RESET = "\x1b[0m";

export function fg(tone: Tone, text: string, bold = false): string {
  if (depth === "none") return text;
  return `${bold ? "\x1b[1m" : ""}${code(RGB[tone], false)}${text}\x1b[22m${code(RGB.text, false)}`;
}

export function bold(text: string): string {
  return depth === "none" ? text : `\x1b[1m${text}\x1b[22m`;
}

/** The start of every line: the canvas background and the normal text colour. */
export function canvas(): string {
  return depth === "none" ? "" : `${code(RGB.canvas, true)}${code(RGB.text, false)}`;
}

export function surface(raised = false): string {
  return depth === "none" ? "" : code(RGB[raised ? "raised" : "surface"], true);
}

export function hairline(text: string): string {
  return depth === "none" ? text : `${code(RGB.hairline, false)}${text}${code(RGB.text, false)}`;
}
