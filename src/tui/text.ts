// [F19 tui] Text measured in terminal cells. A visible character may be several
// code points (an accent, a joined emoji), and some take two cells; widths and
// cursor positions are counted in graphemes and cells, never in string length.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDE =
  /\p{Extended_Pictographic}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

export function cellWidth(g: string): number {
  const cp = g.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (/^\p{Mn}+$/u.test(g)) return 0;
  return WIDE.test(g) ? 2 : 1;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export function width(text: string): number {
  let w = 0;
  for (const g of graphemes(stripAnsi(text))) w += cellWidth(g);
  return w;
}

/** Plain text cut to `max` cells, with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (width(text) <= max) return text;
  let out = "";
  let w = 0;
  for (const g of graphemes(text)) {
    const cw = cellWidth(g);
    if (w + cw > max - 1) break;
    out += g;
    w += cw;
  }
  return `${out}…`;
}

export function padEnd(text: string, cells: number): string {
  const w = width(text);
  return w >= cells ? text : text + " ".repeat(cells - w);
}

export function center(text: string, cells: number): string {
  const w = width(text);
  if (w >= cells) return text;
  const left = Math.floor((cells - w) / 2);
  return " ".repeat(left) + text + " ".repeat(cells - w - left);
}

/** Wrap plain text to `cells` columns at spaces; words longer than a line are broken. Keeps explicit line breaks. */
export function wrap(text: string, cells: number): string[] {
  if (cells <= 0) return [];
  const out: string[] = [];
  for (const paragraph of text.replace(/\t/g, "  ").split("\n")) {
    let line = "";
    let lineW = 0;
    for (const word of paragraph.split(/( +)/)) {
      if (word === "") continue;
      const w = width(word);
      if (lineW + w <= cells) {
        line += word;
        lineW += w;
        continue;
      }
      if (/^ +$/.test(word)) {
        out.push(line);
        line = "";
        lineW = 0;
        continue;
      }
      if (line !== "") out.push(line.trimEnd());
      line = "";
      lineW = 0;
      // A word wider than the line is broken across lines.
      for (const g of graphemes(word)) {
        const cw = cellWidth(g);
        if (lineW + cw > cells) {
          out.push(line);
          line = "";
          lineW = 0;
        }
        line += g;
        lineW += cw;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
