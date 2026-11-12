// [F29 tui-motion] Small animation helpers. Every animation is a pure function
// of the time since something happened, so frames can be drawn at any rate and
// tested at any instant. Nothing animates while nothing is happening.

export const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Ease out (cubic): fast start, soft landing. */
export const ease = (t: number): number => 1 - (1 - clamp(t)) ** 3;

/** How far an animation that started at `start` and lasts `ms` has got, 0 to 1 (1 when it never started). */
export function progress(start: number | undefined, ms: number, now: number): number {
  if (start === undefined) return 1;
  return clamp((now - start) / ms);
}

const NOISE = "!<>-_\\/[]{}—=+*^?#░▒";

/** A cheap repeatable "random" number for position i at frame f. */
function noise(i: number, f: number): number {
  const x = Math.sin(i * 12.9898 + f * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Text that decodes into place: characters left of the moving edge are final,
 * the rest flicker as noise. p goes from 0 (all noise) to 1 (all text).
 */
export function scramble(text: string, p: number, frame: number): string {
  const chars = [...text];
  const edge = Math.floor(chars.length * ease(p));
  return chars.map((c, i) => (i < edge || c === " " ? c : NOISE[Math.floor(noise(i, frame) * NOISE.length)]!)).join("");
}

/** The first share of the text, by characters (a typewriter). */
export function typed(text: string, p: number): string {
  const chars = [...text];
  return chars.slice(0, Math.ceil(chars.length * clamp(p))).join("");
}

/**
 * [F30 tui-intro] One line of the logo building up by density: each character
 * goes blank, then ":", then "+", then its own glyph, in a wave from the left.
 */
export function buildUp(line: string, row: number, rows: number, p: number): string {
  const chars = [...line];
  const n = chars.length;
  return chars
    .map((c, x) => {
      if (c === " ") return c;
      const start = (x / n) * 0.65 + (row / Math.max(1, rows)) * 0.1;
      const local = clamp((p - start) / 0.25);
      if (local <= 0) return " ";
      if (local < 0.34) return ":";
      if (local < 0.67) return c === ":" ? ":" : "+";
      return c;
    })
    .join("");
}

/** The cell where a sweeping light is, on a track `cells` wide (wraps with a pause off the end). */
export function sweep(now: number, cells: number, speed = 40): number {
  const span = cells + 24;
  return Math.floor(now / speed) % span - 12;
}

/** A value easing from `from` to `to` over `ms` after `at`. */
export function countUp(from: number, to: number, at: number | undefined, ms: number, now: number): number {
  return from + (to - from) * ease(progress(at, ms, now));
}
