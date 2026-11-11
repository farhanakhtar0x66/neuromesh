// [F19 tui] The prompt composer: multi-line text with a cursor that moves by
// grapheme, wraps by terminal cells, and remembers its column on Up and Down.

import { cellWidth, graphemes } from "./text.ts";
import type { Key } from "./term.ts";

export class Composer {
  private chars: string[] = [];
  private cursor = 0;
  private goal: number | undefined;

  get text(): string {
    return this.chars.join("");
  }

  set text(value: string) {
    this.chars = graphemes(value);
    this.cursor = this.chars.length;
    this.goal = undefined;
  }

  get isEmpty(): boolean {
    return this.chars.join("").trim() === "";
  }

  clear(): void {
    this.text = "";
  }

  /** The cursor's position, in graphemes. */
  get cursorIndex(): number {
    return this.cursor;
  }

  /** The cursor is on the first line of the text (Up would leave the box). */
  get onFirstLine(): boolean {
    return !this.chars.slice(0, this.cursor).includes("\n");
  }

  /** The word the cursor is in or just after: from the last space or line break up to the cursor. */
  wordAtCursor(): { start: number; text: string } {
    let start = this.cursor;
    while (start > 0 && this.chars[start - 1] !== " " && this.chars[start - 1] !== "\n") start--;
    return { start, text: this.chars.slice(start, this.cursor).join("") };
  }

  /** Replace graphemes [start, cursor) with `text`, leaving the cursor after it. */
  replaceBeforeCursor(start: number, text: string): void {
    const add = graphemes(text);
    this.chars.splice(start, this.cursor - start, ...add);
    this.cursor = start + add.length;
    this.goal = undefined;
  }

  insert(text: string): void {
    const add = graphemes(text.replace(/\r\n?/g, "\n").replace(/\t/g, "  "));
    this.chars.splice(this.cursor, 0, ...add);
    this.cursor += add.length;
    this.goal = undefined;
  }

  /** Handle an editing key; returns false for keys the composer does not use. */
  handle(key: Key, layoutWidth: number): boolean {
    switch (key.name) {
      case "char":
      case "space":
        if (key.ctrl) return false;
        this.insert(key.text ?? " ");
        return true;
      case "paste":
        this.insert(key.text ?? "");
        return true;
      case "enter":
        if (!(key.alt || key.shift)) return false;
        this.insert("\n");
        return true;
      case "j":
        if (!key.ctrl) return false;
        this.insert("\n");
        return true;
      case "backspace":
        if (this.cursor > 0) this.chars.splice(--this.cursor, 1);
        this.goal = undefined;
        return true;
      case "delete":
        if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1);
        return true;
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        this.goal = undefined;
        return true;
      case "right":
        this.cursor = Math.min(this.chars.length, this.cursor + 1);
        this.goal = undefined;
        return true;
      case "home":
      case "a":
        if (key.name === "a" && !key.ctrl) return false;
        while (this.cursor > 0 && this.chars[this.cursor - 1] !== "\n") this.cursor--;
        return true;
      case "end":
      case "e":
        if (key.name === "e" && !key.ctrl) return false;
        while (this.cursor < this.chars.length && this.chars[this.cursor] !== "\n") this.cursor++;
        return true;
      case "u":
        if (!key.ctrl) return false;
        this.clear();
        return true;
      case "up":
      case "down":
        return this.vertical(key.name === "up" ? -1 : 1, layoutWidth);
      default:
        return false;
    }
  }

  /** Wrapped lines and the cursor's row and column, for a box `cells` wide. */
  layout(cells: number): { lines: string[]; row: number; col: number; starts: number[] } {
    const lines: string[] = [""];
    const starts: number[] = [0];
    let w = 0;
    let row = 0;
    let col = 0;
    for (let i = 0; i <= this.chars.length; i++) {
      if (i === this.cursor) {
        row = lines.length - 1;
        col = w;
      }
      if (i === this.chars.length) break;
      const g = this.chars[i]!;
      if (g === "\n") {
        lines.push("");
        starts.push(i + 1);
        w = 0;
        continue;
      }
      const cw = cellWidth(g);
      if (w + cw > cells) {
        lines.push("");
        starts.push(i);
        w = 0;
        if (i === this.cursor) {
          row = lines.length - 1;
          col = 0;
        }
      }
      lines[lines.length - 1] += g;
      w += cw;
    }
    if (col >= cells) {
      // The cursor sits after a full line: show it at the start of the next.
      lines.push("");
      starts.push(this.chars.length);
      row = lines.length - 1;
      col = 0;
    }
    return { lines, row, col, starts };
  }

  private vertical(dir: -1 | 1, cells: number): boolean {
    const { lines, row, col, starts } = this.layout(cells);
    const target = row + dir;
    if (target < 0 || target >= lines.length) return false;
    const goal = this.goal ?? col;
    let i = starts[target]!;
    let w = 0;
    const end = target + 1 < starts.length ? starts[target + 1]! : this.chars.length;
    while (i < end && this.chars[i] !== "\n") {
      const cw = cellWidth(this.chars[i]!);
      if (w + cw > goal) break;
      w += cw;
      i++;
    }
    this.cursor = i;
    this.goal = goal;
    return true;
  }
}
