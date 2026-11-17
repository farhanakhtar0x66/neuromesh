// The oracle for the chunking tests: parse a whole input at once, with random access and lookahead. It shares no code with
// src/ and is written the other way round (find the end of each field by scanning ahead) so that a mistake in one is not
// a mistake in the other. Rules are docs/FORMAT.md.

export type Row = string[] | Record<string, string>;
export interface Outcome {
  rows: Row[];
  error?: string;
}
export interface Opts {
  delimiter?: string;
  quote?: string;
  header?: boolean;
  skipEmptyLines?: boolean;
}

/** Number of line breaks (CRLF counts once) before `index`, plus one. */
function lineAt(s: string, index: number): number {
  return (s.slice(0, index).match(/\r\n|\r|\n/g) ?? []).length + 1;
}

export function oracle(input: Uint8Array | string, o: Opts = {}): Outcome {
  const delimiter = o.delimiter ?? ",";
  const quote = o.quote ?? '"';
  const text = typeof input === "string" ? input.replace(/^﻿/, "") : new TextDecoder().decode(input);
  const records: string[][] = [];
  let tokenError: string | undefined;

  const breakLength = (at: number): number => (text[at] === "\r" && text[at + 1] === "\n" ? 2 : text[at] === "\r" || text[at] === "\n" ? 1 : 0);

  let i = 0;
  scan: while (i < text.length) {
    if (breakLength(i) > 0) {
      i += breakLength(i);
      if (!o.skipEmptyLines) records.push([""]);
      continue;
    }
    const fields: string[] = [];
    for (;;) {
      let value = "";
      if (text[i] === quote) {
        const open = i;
        let j = i + 1;
        for (;;) {
          if (j >= text.length) {
            tokenError = `unterminated quoted field starting at line ${lineAt(text, open)}`;
            break scan;
          }
          if (text[j] === quote) {
            if (text[j + 1] === quote) {
              value += quote;
              j += 2;
              continue;
            }
            j++;
            break;
          }
          value += text[j++];
        }
        if (j < text.length && text[j] !== delimiter && breakLength(j) === 0) {
          tokenError = `unexpected character ${JSON.stringify(text[j])} after closing quote at line ${lineAt(text, j)}`;
          break scan;
        }
        i = j;
      } else {
        let j = i;
        while (j < text.length && text[j] !== delimiter && breakLength(j) === 0) j++;
        value = text.slice(i, j);
        i = j;
      }
      fields.push(value);
      if (text[i] === delimiter) {
        i++;
        continue; // another field follows, even if it is empty and the input ends here
      }
      i += breakLength(i); // 0 at the end of the input
      break;
    }
    records.push(fields);
  }

  const rows: Row[] = [];
  if (!o.header) {
    rows.push(...records);
  } else {
    let keys: string[] | undefined;
    for (let n = 0; n < records.length; n++) {
      const r = records[n]!;
      if (!keys) {
        keys = r;
        continue;
      }
      if (r.length > keys.length) return { rows, error: `record ${n + 1} has ${r.length} fields but the header has ${keys.length}` };
      rows.push(Object.fromEntries(keys.map((k, c) => [k, r[c] ?? ""])));
    }
  }
  // Records that were skipped as empty lines are not in `records`, so n above counts records as the docs do.
  return tokenError === undefined ? { rows } : { rows, error: tokenError };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cut `buf` into chunks the way run number `r` says: whole, then every size 1, 2, 3 and 5, then random cuts (some chunks empty). */
export function chunking(buf: Buffer, r: number, rng: () => number): Buffer[] {
  const n = buf.length;
  const fixed = (size: number): Buffer[] => {
    const out: Buffer[] = [];
    for (let at = 0; at < n; at += size) out.push(buf.subarray(at, at + size));
    return out;
  };
  if (r === 0) return [buf];
  if (r === 1) return fixed(1);
  if (r === 2) return fixed(2);
  if (r === 3) return fixed(3);
  if (r === 4) return fixed(5);
  const count = rng() < 0.25 ? Math.floor(rng() * (n + 1)) : 1 + Math.floor(rng() * Math.min(n + 1, 10));
  const cuts = Array.from({ length: count }, () => Math.floor(rng() * (n + 1))).sort((x, y) => x - y);
  const out: Buffer[] = [];
  let from = 0;
  for (const c of cuts) {
    out.push(buf.subarray(from, c));
    from = c;
  }
  out.push(buf.subarray(from));
  return out;
}
