import { readCsv } from "../../src/index.ts";
import type { Row } from "./oracle.ts";

export async function* fromChunks(chunks: (Uint8Array | string)[]): AsyncGenerator<Uint8Array | string> {
  for (const c of chunks) yield c;
}

/** Read every row; if the reader throws, return the rows so far and the error message. */
export async function collect(chunks: (Uint8Array | string)[], options: object = {}): Promise<{ rows: Row[]; error?: string }> {
  const rows: Row[] = [];
  try {
    for await (const row of readCsv(fromChunks(chunks), options)) rows.push(row as Row);
  } catch (e) {
    return { rows, error: (e as Error).message };
  }
  return { rows };
}
