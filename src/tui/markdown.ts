// [F47 tui-markdown] Markdown drawn as text: headings, lists, quotes, code
// blocks, tables, rules, and **bold**, *italic*, `code` and [links] inline.
// The agents' final reports are written in markdown; this shows them as they
// were meant to look, wrapped to the box they sit in.

import { graphemes, width } from "./text.ts";
import type { Tone } from "./theme.ts";

export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Drawn on the code background. */
  code?: boolean;
}

export interface MdRow {
  spans: Span[];
  /** A row of a fenced code block: drawn on a code background across the box. */
  block?: boolean;
}

/** Inline markup to spans: **bold**, __bold__, *italic*, _italic_, `code`, [text](url). */
export function inline(text: string, base: Omit<Span, "text"> = {}): Span[] {
  const out: Span[] = [];
  const re = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ ...base, text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ ...base, text: m[2], code: true, tone: "cyan" });
    else if (m[3] !== undefined || m[4] !== undefined) out.push(...inline(m[3] ?? m[4]!, { ...base, bold: true }));
    else if (m[5] !== undefined || m[6] !== undefined) out.push(...inline(m[5] ?? m[6]!, { ...base, italic: true }));
    else if (m[7] !== undefined) out.push({ ...base, text: m[7], underline: true, tone: "blue" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) });
  return out;
}

/** Spans wrapped to `w` cells: words stay whole unless one is wider than the line. */
function wrapSpans(spans: Span[], w: number, first: Span[] = [], rest: Span[] = []): Span[][] {
  const rows: Span[][] = [];
  let row: Span[] = first.map((s) => ({ ...s }));
  // The indent at the start of a row is never merged into.
  let lead = row.length;
  let used = first.reduce((n, s) => n + width(s.text), 0);
  const restW = rest.reduce((n, s) => n + width(s.text), 0);
  const push = (s: Span, t: string): void => {
    const prev = row.length > lead ? row.at(-1) : undefined;
    if (prev && sameStyle(prev, s)) prev.text += t;
    else row.push({ ...s, text: t });
    used += width(t);
  };
  const newline = (): void => {
    rows.push(row);
    row = rest.map((s) => ({ ...s }));
    lead = row.length;
    used = restW;
  };
  for (const s of spans) {
    for (const word of s.text.split(/(\s+)/)) {
      if (word === "") continue;
      const ww = width(word);
      if (/^\s+$/.test(word)) {
        if (used > restW && used + ww <= w) push(s, word);
        else if (used + ww > w) newline();
        continue;
      }
      if (used + ww > w && used > restW) {
        // Drop the trailing space of the line before breaking.
        const prev = row.length > lead ? row.at(-1) : undefined;
        if (prev) prev.text = prev.text.replace(/\s+$/, "");
        newline();
      }
      if (ww > w - restW) {
        for (const g of graphemes(word)) {
          if (used + 1 > w) newline();
          push(s, g);
        }
      } else push(s, word);
    }
  }
  rows.push(row);
  return rows;
}

const sameStyle = (a: Span, b: Span): boolean => a.tone === b.tone && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.code === !!b.code;

/** Markdown to rows `w` cells wide. */
export function renderMarkdown(source: string, w: number): MdRow[] {
  const rows: MdRow[] = [];
  const lines = source.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");
  let inCode = false;
  let blank = 0;
  const add = (r: MdRow): void => {
    rows.push(r);
    blank = 0;
  };
  const gap = (): void => {
    if (rows.length > 0 && blank === 0) {
      rows.push({ spans: [] });
      blank = 1;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inCode) {
        const lang = line.replace(/^\s*(```|~~~)/, "").trim();
        if (lang) add({ spans: [{ text: lang, tone: "subtle", italic: true }] });
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      // Code keeps its own line breaks; a long line wraps hard.
      const gs = graphemes(line);
      if (gs.length === 0) add({ spans: [{ text: "" }], block: true });
      for (let k = 0; k < gs.length; k += Math.max(1, w - 2)) add({ spans: [{ text: gs.slice(k, k + w - 2).join(""), tone: "text", code: true }], block: true });
      continue;
    }
    if (line.trim() === "") {
      gap();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      if (rows.length > 0) gap();
      const tone: Tone = level === 1 ? "jade" : level === 2 ? "blue" : "mauve";
      for (const r of wrapSpans(inline(heading[2]!.replace(/\s+#+\s*$/, ""), { tone, bold: true, underline: level === 1 }), w)) add({ spans: r });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      add({ spans: [{ text: "─".repeat(Math.max(1, w)), tone: "subtle" }] });
      continue;
    }
    // A table: a header row, a separator row, then rows.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const table: string[][] = [];
      let j = i;
      for (; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]!); j++) {
        if (j === i + 1) continue;
        table.push(lines[j]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      }
      i = j - 1;
      const cols = Math.max(...table.map((r) => r.length));
      const widths = Array.from({ length: cols }, (_, c) => Math.max(...table.map((r) => width(r[c] ?? ""))));
      const total = widths.reduce((n, x) => n + x, 0) + (cols - 1) * 3;
      const scale = total > w ? (w - (cols - 1) * 3) / Math.max(1, total - (cols - 1) * 3) : 1;
      const cw = widths.map((x) => Math.max(3, Math.floor(x * scale)));
      for (const [ri, r] of table.entries()) {
        const spans: Span[] = [];
        for (let c = 0; c < cols; c++) {
          const cell = r[c] ?? "";
          const cut = width(cell) > cw[c]! ? `${graphemes(cell).slice(0, cw[c]! - 1).join("")}…` : cell;
          spans.push({ text: cut + " ".repeat(Math.max(0, cw[c]! - width(cut))), bold: ri === 0, tone: ri === 0 ? "text" : undefined });
          if (c < cols - 1) spans.push({ text: " │ ", tone: "subtle" });
        }
        add({ spans });
        if (ri === 0) add({ spans: [{ text: cw.map((x) => "─".repeat(x)).join("─┼─"), tone: "subtle" }] });
      }
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      for (const r of wrapSpans(inline(quote[1]!, { tone: "muted", italic: true }), w, [{ text: "▎ ", tone: "subtle" }], [{ text: "▎ ", tone: "subtle" }])) add({ spans: r });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      const depth = Math.min(4, Math.floor(item[1]!.length / 2));
      const pad = "  ".repeat(depth);
      const box = item[3] ? (/x/i.test(item[3]) ? "☑ " : "☐ ") : "";
      const marker = /\d/.test(item[2]!) ? `${item[2]} ` : depth % 2 === 0 ? "• " : "◦ ";
      const lead: Span[] = [{ text: pad }, { text: marker, tone: "jade" }, ...(box ? [{ text: box, tone: "muted" as Tone }] : [])];
      const hang: Span[] = [{ text: " ".repeat(width(pad + marker + box)) }];
      for (const r of wrapSpans(inline(item[4]!), w, lead, hang)) add({ spans: r });
      continue;
    }
    // A paragraph: lines that follow on are joined.
    let para = line.trim();
    while (i + 1 < lines.length && lines[i + 1]!.trim() !== "" && !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(lines[i + 1]!)) {
      i += 1;
      para += ` ${lines[i]!.trim()}`;
    }
    for (const r of wrapSpans(inline(para), w)) add({ spans: r });
  }
  while (rows.length > 0 && rows.at(-1)!.spans.length === 0) rows.pop();
  return rows;
}

/** One line of an agent's words, its inline markup drawn and wrapped to `w` cells. */
export function wrapInline(text: string, w: number, base: Omit<Span, "text"> = {}): Span[][] {
  return wrapSpans(inline(text.replace(/^\s*#{1,6}\s+/, ""), base), Math.max(4, w));
}
