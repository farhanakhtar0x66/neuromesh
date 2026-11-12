// [F31 tui-screensaver] When a run has been working for a while and nobody has
// touched the terminal, the screen shows the NEUROMESH logo with animated
// effects; any key or mouse movement brings the workspace back, and so does the
// run finishing. After the owner's terminal-ascii-screensaver
// (github.com/farhanakhtar0x66/terminal-ascii-screensaver), which plays
// TerminalTextEffects-style effects over ASCII art; these are written here with
// no dependencies, each a pure function of time.

import { clamp, ease } from "./anim.ts";

export type Rgb = [number, number, number];

interface Cell {
  ch: string;
  rgb?: Rgb;
  bold?: boolean;
}

export interface Saver {
  /** When it began showing. */
  at: number;
  order: string[];
  /** Which effect of `order` is playing, and when it began. */
  index: number;
  effectAt: number;
  /** Last effect of the previous cycle, so a new cycle does not repeat it. */
  previous?: string;
}

export const EFFECTS = ["decrypt", "beams", "rain", "waves", "spotlight", "scatter", "matrix"] as const;
export const EFFECT_MS = 9_000;

/** Each effect once per cycle, shuffled, never the same twice in a row across cycles. */
export function shuffled(previous: string | undefined, random = Math.random): string[] {
  const cycle: string[] = [...EFFECTS];
  for (let i = cycle.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cycle[i], cycle[j]] = [cycle[j]!, cycle[i]!];
  }
  if (cycle.length > 1 && cycle[0] === previous) {
    const k = 1 + Math.floor(random() * (cycle.length - 1));
    [cycle[0], cycle[k]] = [cycle[k]!, cycle[0]!];
  }
  return cycle;
}

export function newSaver(now: number, previous?: string): Saver {
  return { at: now, order: shuffled(previous), index: 0, effectAt: now, previous };
}

/** Move to the next effect when the current one has played. */
export function advance(s: Saver, now: number): void {
  while (now - s.effectAt >= EFFECT_MS) {
    s.effectAt += EFFECT_MS;
    s.index += 1;
    if (s.index >= s.order.length) {
      s.previous = s.order.at(-1);
      s.order = shuffled(s.previous);
      s.index = 0;
    }
  }
}

/** Scale art in cells to fit, keeping its proportions (as the original's fit_art). */
export function fitArt(lines: string[], cols: number, rows: number): string[] {
  const art = lines.map((l) => l.replace(/\s+$/, ""));
  const w = Math.max(...art.map((l) => [...l].length));
  const h = art.length;
  const ratio = Math.min(1, (cols - 4) / w, (rows - 4) / h);
  if (ratio >= 1) return art;
  const ow = Math.max(1, Math.floor(w * ratio));
  const oh = Math.max(1, Math.floor(h * ratio));
  const out: string[] = [];
  for (let y = 0; y < oh; y++) {
    const src = [...art[Math.min(h - 1, Math.floor(y / ratio))]!.padEnd(w)];
    let line = "";
    for (let x = 0; x < ow; x++) line += src[Math.min(w - 1, Math.floor(x / ratio))];
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

// A gradient through the Signal accents: jade, blue, mauve, amber.
const STOPS: Rgb[] = [
  [0x75, 0xda, 0xb8],
  [0x8c, 0xbf, 0xff],
  [0xc6, 0xa5, 0xea],
  [0xeb, 0xc1, 0x7f],
  [0x75, 0xda, 0xb8],
];

export function gradient(t: number): Rgb {
  const x = ((t % 1) + 1) % 1;
  const span = x * (STOPS.length - 1);
  const i = Math.floor(span);
  const f = span - i;
  const a = STOPS[i]!;
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)]!;
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

const mix = (a: Rgb, b: Rgb, f: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
const WHITE: Rgb = [0xf0, 0xf3, 0xf6];
const DIM: Rgb = [0x2a, 0x36, 0x30];
const GLYPHS = "01<>/\\|=+*#%&@$?!~^:;.-_░▒▓";

/** A repeatable pseudo-random number in [0, 1) for a cell and a seed. */
function rnd(x: number, y: number, seed = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

interface ArtCell {
  x: number;
  y: number;
  ch: string;
}

function artCells(art: string[], ox: number, oy: number): ArtCell[] {
  const out: ArtCell[] = [];
  for (const [y, line] of art.entries()) {
    for (const [x, ch] of [...line].entries()) if (ch !== " ") out.push({ x: ox + x, y: oy + y, ch });
  }
  return out;
}

type Effect = (cells: ArtCell[], put: (x: number, y: number, c: Cell) => void, t: number, w: { cols: number; rows: number; ox: number; oy: number; aw: number; ah: number }) => void;

const effects: Record<string, Effect> = {
  // Noise that resolves into the logo, holds, then shimmers.
  decrypt(cells, put, t, w) {
    for (const c of cells) {
      const reveal = 400 + rnd(c.x, c.y) * 2_600;
      const hue = (c.x - w.ox) / w.aw * 0.6 + t / 6_000;
      if (t < reveal) put(c.x, c.y, { ch: GLYPHS[Math.floor(rnd(c.x, c.y, Math.floor(t / 70)) * GLYPHS.length)]!, rgb: mix(DIM, gradient(hue), 0.5) });
      else put(c.x, c.y, { ch: c.ch, rgb: t - reveal < 220 ? WHITE : gradient(hue), bold: t - reveal < 220 });
    }
  },
  // Beams cross each row; the logo lights where they pass and keeps a glow.
  beams(cells, put, t, w) {
    for (const c of cells) {
      const row = c.y - w.oy;
      const dir = row % 2 === 0 ? 1 : -1;
      const start = row * 260;
      const pos = ((t - start) / 900) * (w.aw + 20) - 10;
      const x = dir === 1 ? c.x - w.ox : w.aw - (c.x - w.ox);
      const passed = pos - x;
      if (passed < 0) continue;
      const hue = (c.x - w.ox) / w.aw * 0.5 + row * 0.05;
      put(c.x, c.y, { ch: c.ch, rgb: passed < 3 ? WHITE : mix(WHITE, gradient(hue), clamp((passed - 3) / 18)), bold: passed < 3 });
    }
    // The beam heads themselves, as light streaks.
    for (let row = 0; row < w.ah; row++) {
      const dir = row % 2 === 0 ? 1 : -1;
      const pos = ((t - row * 260) / 900) * (w.aw + 20) - 10;
      if (pos < -2 || pos > w.aw + 10) continue;
      for (let k = 0; k < 6; k++) {
        const x = dir === 1 ? w.ox + Math.floor(pos) - k : w.ox + w.aw - Math.floor(pos) + k;
        if (x >= 0 && x < w.cols) put(x, w.oy + row, { ch: k === 0 ? "▓" : k < 3 ? "▒" : "░", rgb: mix(WHITE, gradient(row * 0.1), k / 6) });
      }
    }
  },
  // Characters fall from the top and land in place.
  rain(cells, put, t) {
    for (const c of cells) {
      const delay = rnd(c.x, c.y) * 2_400;
      const fall = clamp((t - delay) / 700);
      if (fall <= 0) continue;
      const y = Math.round(c.y * ease(fall) - (1 - ease(fall)) * 2);
      const landed = fall >= 1;
      put(c.x, Math.max(0, y), { ch: landed ? c.ch : GLYPHS[Math.floor(rnd(c.x, y, 3) * GLYPHS.length)]!, rgb: landed ? gradient(c.x / 80 + t / 7_000) : mix(DIM, [0x8c, 0xbf, 0xff], 0.8) });
    }
  },
  // The whole logo ripples through the gradient.
  waves(cells, put, t, w) {
    for (const c of cells) {
      const phase = Math.sin(t / 520 - (c.x - w.ox) / 7 + (c.y - w.oy) * 0.6);
      const lift = phase > 0.82 && (c.y - w.oy) > 0 ? -1 : 0;
      put(c.x, c.y + lift, { ch: c.ch, rgb: gradient((c.x - w.ox) / w.aw * 0.8 + phase * 0.12 + t / 4_000), bold: phase > 0.9 });
    }
  },
  // A dim logo with a moving spotlight.
  spotlight(cells, put, t, w) {
    const cx = w.ox + w.aw / 2 + Math.sin(t / 1_300) * (w.aw / 2.2);
    const cy = w.oy + w.ah / 2 + Math.cos(t / 900) * (w.ah / 1.6);
    for (const c of cells) {
      const d = Math.hypot((c.x - cx) / 2, c.y - cy);
      const light = clamp(1 - d / 9);
      put(c.x, c.y, { ch: c.ch, rgb: mix(DIM, light > 0.75 ? WHITE : gradient((c.x - w.ox) / w.aw * 0.6 + t / 8_000), light), bold: light > 0.8 });
    }
  },
  // Characters start scattered over the screen and gather into the logo.
  scatter(cells, put, t, w) {
    const p = ease(clamp((t - 300) / 2_600));
    for (const c of cells) {
      const sx = Math.floor(rnd(c.x, c.y, 1) * w.cols);
      const sy = Math.floor(rnd(c.x, c.y, 2) * w.rows);
      const x = Math.round(sx + (c.x - sx) * p);
      const y = Math.round(sy + (c.y - sy) * p);
      put(x, y, { ch: c.ch, rgb: p >= 1 ? gradient((c.x - w.ox) / w.aw + t / 6_000) : mix(DIM, gradient(rnd(c.x, c.y, 5)), 0.4 + 0.6 * p) });
    }
  },
  // Falling streams of glyphs; the logo shows bright where they pass.
  matrix(cells, put, t, w) {
    const green: Rgb = [0x26, 0xcd, 0x4d];
    for (let x = 0; x < w.cols; x += 2) {
      const speed = 6 + rnd(x, 0, 9) * 10;
      const head = ((t / 1_000) * speed + rnd(x, 1, 9) * w.rows * 2) % (w.rows * 2) - w.rows / 2;
      for (let k = 0; k < 10; k++) {
        const y = Math.floor(head) - k;
        if (y < 0 || y >= w.rows) continue;
        put(x, y, { ch: GLYPHS[Math.floor(rnd(x, y, Math.floor(t / 120)) * GLYPHS.length)]!, rgb: k === 0 ? WHITE : mix(green, DIM, k / 10) });
      }
    }
    const reveal = clamp((t - 1_200) / 2_000);
    for (const c of cells) if (rnd(c.x, c.y, 4) < reveal) put(c.x, c.y, { ch: c.ch, rgb: mix(green, WHITE, 0.25 + 0.2 * Math.sin(t / 300 + c.x)), bold: true });
  },
};

export type Paint = "true" | "256" | "none";

function code(rgb: Rgb, paint: Paint): string {
  if (paint === "true") return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  const q = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  return `\x1b[38;5;${16 + 36 * q(rgb[0]) + 6 * q(rgb[1]) + q(rgb[2])}m`;
}

/** One frame of the screensaver: `rows` lines of `cols` cells. */
export function saverFrame(s: Saver, art: string[], cols: number, rows: number, now: number, paint: Paint, status: string): string[] {
  advance(s, now);
  const fitted = fitArt(art, cols, rows - 2);
  const aw = Math.max(...fitted.map((l) => [...l].length));
  const ah = fitted.length;
  const ox = Math.max(0, Math.floor((cols - aw) / 2));
  const oy = Math.max(0, Math.floor((rows - 1 - ah) / 2));
  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: " " })));
  const put = (x: number, y: number, c: Cell): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (yi >= 0 && yi < rows - 1 && xi >= 0 && xi < cols) grid[yi]![xi] = c;
  };
  const name = s.order[s.index]!;
  effects[name]!(artCells(fitted, ox, oy), put, now - s.effectAt, { cols, rows: rows - 1, ox, oy, aw, ah });

  // A quiet status line at the bottom: the run is still going, and how to come back.
  const st = [...status].slice(0, cols);
  const sx = Math.max(0, Math.floor((cols - st.length) / 2));
  for (const [i, ch] of st.entries()) grid[rows - 1]![sx + i] = { ch, rgb: [0x6b, 0x77, 0x72] };

  return grid.map((line) => {
    let out = "";
    let last = "";
    for (const c of line) {
      if (paint === "none" || !c.rgb) {
        if (last) {
          out += "\x1b[0m";
          last = "";
        }
        out += c.ch;
        continue;
      }
      const k = `${code(c.rgb, paint)}${c.bold ? "\x1b[1m" : "\x1b[22m"}`;
      if (k !== last) {
        out += k;
        last = k;
      }
      out += c.ch;
    }
    return out + (last ? "\x1b[0m" : "");
  });
}
