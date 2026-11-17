import { readCsv } from "../src/index.ts";
import type { CsvOptions, Chunk, Row } from "../src/index.ts";

export async function* chunksOf(chunks: Chunk[]): AsyncGenerator<Chunk> {
  for (const c of chunks) yield c;
}

/** Read every row; if the reader throws, return the rows so far and the error message. */
export async function collect(chunks: Chunk[], options: CsvOptions = {}): Promise<{ rows: Row[]; error?: string }> {
  const rows: Row[] = [];
  try {
    for await (const row of readCsv(chunksOf(chunks), options)) rows.push(row);
  } catch (e) {
    return { rows, error: (e as Error).message };
  }
  return { rows };
}

export const enc = (s: string): Buffer => Buffer.from(s, "utf8");
