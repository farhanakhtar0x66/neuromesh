import { CsvError } from "./errors.ts";

export interface CsvOptions {
  delimiter?: string;
  quote?: string;
  header?: boolean;
  skipEmptyLines?: boolean;
}

export interface ResolvedOptions {
  delimiter: string;
  quote: string;
  header: boolean;
  skipEmptyLines: boolean;
}

/** Fill in the defaults and check the characters. Throws CsvError with the messages of docs/FORMAT.md. */
export function resolveOptions(o: CsvOptions = {}): ResolvedOptions {
  const delimiter = o.delimiter ?? ",";
  const quote = o.quote ?? '"';
  if (delimiter.length !== 1) throw new CsvError("delimiter must be a single character");
  if (quote.length !== 1) throw new CsvError("quote must be a single character");
  const lineBreak = (c: string): boolean => c === "\r" || c === "\n";
  if (delimiter === quote || lineBreak(delimiter) || lineBreak(quote)) {
    throw new CsvError("delimiter and quote must differ and must not be line breaks");
  }
  return { delimiter, quote, header: o.header ?? false, skipEmptyLines: o.skipEmptyLines ?? false };
}
