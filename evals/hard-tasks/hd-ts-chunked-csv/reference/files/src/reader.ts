import { CsvError } from "./errors.ts";
import { resolveOptions } from "./options.ts";
import type { CsvOptions, ResolvedOptions } from "./options.ts";
import { Parser } from "./parser.ts";

export type Row = string[] | Record<string, string>;
export type Chunk = Uint8Array | string;

/** Turns records into rows: arrays as they are, or objects keyed by the header record. */
class Shaper {
  private opts: ResolvedOptions;
  private keys: string[] | undefined;
  private recordNo = 0;

  constructor(opts: ResolvedOptions) {
    this.opts = opts;
  }

  accept(record: string[]): Row | undefined {
    this.recordNo++;
    if (!this.opts.header) return record;
    if (!this.keys) {
      this.keys = record;
      return undefined;
    }
    if (record.length > this.keys.length) {
      throw new CsvError(`record ${this.recordNo} has ${record.length} fields but the header has ${this.keys.length}`);
    }
    return Object.fromEntries(this.keys.map((k, i) => [k, record[i] ?? ""]));
  }
}

/**
 * Read rows from a source of chunks (an fs stream, process.stdin, any async iterable of Buffers or strings).
 * Rows are yielded as soon as they are complete.
 */
export async function* readCsv(source: AsyncIterable<Chunk> | Iterable<Chunk>, options: CsvOptions = {}): AsyncGenerator<Row> {
  const opts = resolveOptions(options);
  const parser = new Parser(opts);
  const shaper = new Shaper(opts);
  const decoder = new TextDecoder("utf-8"); // keeps a character cut by a chunk end for the next chunk; drops a leading BOM
  let atStart = true;
  const decode = (chunk: Chunk | undefined): string => {
    let text: string;
    if (chunk === undefined) text = decoder.decode(); // the end: a sequence still open becomes U+FFFD
    else if (typeof chunk === "string") text = chunk;
    else text = decoder.decode(chunk, { stream: true });
    if (atStart && text.length > 0) {
      atStart = false;
      if (typeof chunk === "string" && text[0] === "\uFEFF") text = text.slice(1);
    }
    return text;
  };
  for await (const chunk of source) {
    for (const record of parser.feed(decode(chunk))) {
      const row = shaper.accept(record);
      if (row) yield row;
    }
  }
  for (const record of parser.feed(decode(undefined))) {
    const row = shaper.accept(record);
    if (row) yield row;
  }
  for (const record of parser.end()) {
    const row = shaper.accept(record);
    if (row) yield row;
  }
}

/** The whole input at once. */
export function parseCsv(input: Chunk, options: CsvOptions = {}): Row[] {
  const opts = resolveOptions(options);
  const parser = new Parser(opts);
  const shaper = new Shaper(opts);
  const text = typeof input === "string" ? input.replace(/^﻿/, "") : new TextDecoder().decode(input);
  const rows: Row[] = [];
  for (const record of [...parser.feed(text), ...parser.end()]) {
    const row = shaper.accept(record);
    if (row) rows.push(row);
  }
  return rows;
}
