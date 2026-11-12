// [F32 tui-layers] [F33 tui-mouse] A screen drawn as a grid of cells.
//
// Views paint rectangles and text onto a canvas. Text written without a
// background keeps the one already there, which is how layers work: a card
// painted on a pane, text written on the card. Views also register regions
// (a button, a row, a box) by id, so the app knows what the mouse is over.
// The terminal then compares canvases cell by cell (term.ts).

import type { Cell } from "./term.ts";
import { cellWidth, graphemes } from "./text.ts";
import { ATTR, DEFAULT, mix, sgr } from "./theme.ts";

export interface Pen {
  fg?: number;
  /** Leave out to keep the background already there. */
  bg?: number;
  attrs?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region extends Rect {
  id: string;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w: Math.max(0, w), h: Math.max(0, h) });

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly ch: string[];
  readonly fg: Int32Array;
  readonly bg: Int32Array;
  readonly at: Uint8Array;
  readonly regions: Region[] = [];
  private area: Rect;

  constructor(w: number, h: number, bg = DEFAULT) {
    this.w = Math.max(0, w);
    this.h = Math.max(0, h);
    const n = this.w * this.h;
    this.ch = new Array<string>(n).fill(" ");
    this.fg = new Int32Array(n).fill(DEFAULT);
    this.bg = new Int32Array(n).fill(bg);
    this.at = new Uint8Array(n);
    this.area = rect(0, 0, this.w, this.h);
  }

  /** Limit drawing to `r` (inside the current limit); returns the previous limit, for restoring. */
  clip(r: Rect): Rect {
    const prev = this.area;
    const x = Math.max(prev.x, r.x);
    const y = Math.max(prev.y, r.y);
    const x2 = Math.min(prev.x + prev.w, r.x + r.w);
    const y2 = Math.min(prev.y + prev.h, r.y + r.h);
    this.area = rect(x, y, x2 - x, y2 - y);
    return prev;
  }

  unclip(prev: Rect): void {
    this.area = prev;
  }

  private ok(x: number, y: number): boolean {
    const a = this.area;
    return x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;
  }

  /** Paint a rectangle: blank cells of background `bg`. */
  fill(r: Rect, bg: number, fgColour = DEFAULT, ch = " "): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.ok(x, y)) continue;
        const i = y * this.w + x;
        this.ch[i] = ch;
        this.fg[i] = fgColour;
        this.bg[i] = bg;
        this.at[i] = 0;
      }
    }
  }

  /** Change only the background of a rectangle (a highlight), keeping its text. */
  tint(r: Rect, bg: number): void {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.ok(x, y)) this.bg[y * this.w + x] = bg;
  }

  /** Blend the text of a rectangle towards its background (0 = unchanged, 1 = gone): a fade. */
  fade(r: Rect, amount: number): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!this.ok(x, y)) continue;
        const i = y * this.w + x;
        if (this.fg[i]! >= 0 && this.bg[i]! >= 0) this.fg[i] = mix(this.fg[i]!, this.bg[i]!, amount);
        else if (amount >= 0.5) this.at[i] = this.at[i]! | ATTR.dim;
      }
    }
  }

  set(x: number, y: number, ch: string, pen: Pen): void {
    if (!this.ok(x, y)) return;
    const i = y * this.w + x;
    this.ch[i] = ch;
    this.fg[i] = pen.fg ?? DEFAULT;
    if (pen.bg !== undefined) this.bg[i] = pen.bg;
    this.at[i] = pen.attrs ?? 0;
  }

  /** Write text from (x, y), at most `max` cells; returns the cells used. */
  text(x: number, y: number, s: string, pen: Pen = {}, max = Infinity): number {
    let col = x;
    const end = x + Math.max(0, Math.min(max, this.w - x));
    // Plain ASCII: one cell a character, no segmenting.
    if (/^[\x20-\x7e]*$/.test(s)) {
      const n = Math.min(s.length, end - x);
      for (let i = 0; i < n; i++) this.set(x + i, y, s[i]!, pen);
      return Math.max(0, n);
    }
    for (const g of graphemes(s)) {
      const w = cellWidth(g);
      if (w === 0) continue;
      if (col + w > end) break;
      if (g === "\n" || g === "\t") {
        col += 1;
        continue;
      }
      this.set(col, y, g, pen);
      if (w === 2) {
        this.set(col + 1, y, "", pen);
      }
      col += w;
    }
    return col - x;
  }

  /** Text in several styles, one after the other; returns the cells used. */
  spans(x: number, y: number, parts: [string, Pen][], max = Infinity): number {
    let used = 0;
    for (const [s, pen] of parts) {
      if (used >= max) break;
      used += this.text(x + used, y, s, pen, max - used);
    }
    return used;
  }

  /** A clickable or hoverable area. Later regions win over earlier ones. */
  region(id: string, r: Rect): void {
    const a = this.area;
    const x = Math.max(a.x, r.x);
    const y = Math.max(a.y, r.y);
    const w = Math.min(a.x + a.w, r.x + r.w) - x;
    const h = Math.min(a.y + a.h, r.y + r.h) - y;
    if (w > 0 && h > 0) this.regions.push({ id, x, y, w, h });
  }

  /** The id of the region at (x, y), if any. */
  hit(x: number, y: number): string | undefined {
    return hitTest(this.regions, x, y);
  }

  /** Copy another canvas onto this one at (x, y), through the current limit. */
  blit(src: Canvas, x: number, y: number): void {
    for (let sy = 0; sy < src.h; sy++) {
      for (let sx = 0; sx < src.w; sx++) {
        const tx = x + sx;
        const ty = y + sy;
        if (!this.ok(tx, ty)) continue;
        const si = sy * src.w + sx;
        const ti = ty * this.w + tx;
        this.ch[ti] = src.ch[si]!;
        this.fg[ti] = src.fg[si]!;
        this.bg[ti] = src.bg[si]!;
        this.at[ti] = src.at[si]!;
      }
    }
    for (const r of src.regions) this.region(r.id, { ...r, x: r.x + x, y: r.y + y });
  }

  /** The canvas as terminal cells (each with its full style). */
  toCells(): Cell[][] {
    const styles = new Map<string, string>();
    const rows: Cell[][] = [];
    for (let y = 0; y < this.h; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const key = `${this.fg[i]},${this.bg[i]},${this.at[i]}`;
        let style = styles.get(key);
        if (style === undefined) {
          style = sgr(this.fg[i]!, this.bg[i]!, this.at[i]!);
          styles.set(key, style);
        }
        row.push({ ch: this.ch[i]!, style });
      }
      rows.push(row);
    }
    return rows;
  }

  /** Each row as a string with escape sequences (for tests and plain output). */
  toLines(): string[] {
    return this.toCells().map((row) => {
      let out = "";
      let last = "";
      for (const c of row) {
        if (c.style !== last) {
          out += c.style;
          last = c.style;
        }
        out += c.ch;
      }
      return `${out}\x1b[0m`;
    });
  }

  /** Each row as plain text. */
  toText(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.ch.slice(y * this.w, (y + 1) * this.w).join(""));
    return out;
  }
}

export function hitTest(regions: Region[], x: number, y: number): string | undefined {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r.id;
  }
  return undefined;
}
