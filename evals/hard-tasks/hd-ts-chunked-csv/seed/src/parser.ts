import { CsvError } from "./errors.ts";

export interface ParserOptions {
  delimiter: string;
  quote: string;
  skipEmptyLines: boolean;
}

/**
 * Incremental tokenizer. Feed it decoded text piece by piece with feed(); every record that the text completes
 * comes out of the generator as soon as it is complete. Call end() once, after the last piece.
 */
export class Parser {
  private opts: ParserOptions;
  private fields: string[] = [];
  private field = "";
  private inQuotes = false;
  private afterQuote = false; // the closing quote has been read; only a delimiter or a line break may follow
  private started = false; // some character of the current record has been read
  private line = 1;
  private quoteLine = 1; // the line of the opening quote of the current quoted field

  constructor(opts: ParserOptions) {
    this.opts = opts;
  }

  *feed(text: string): Generator<string[]> {
    const { delimiter, quote, skipEmptyLines } = this.opts;
    let { field, afterQuote, started, line } = this;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inQuotes) {
        if (c === quote) {
          if (text[i + 1] === quote) {
            field += quote;
            i++;
          } else {
            inQuotes = false;
            afterQuote = true;
          }
        } else {
          field += c;
          if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
        }
        continue;
      }
      if (c === delimiter) {
        this.fields.push(field);
        field = "";
        afterQuote = false;
        started = true;
        continue;
      }
      if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        line++;
        if (started) {
          this.fields.push(field);
          const record = this.fields;
          this.fields = [];
          field = "";
          afterQuote = false;
          started = false;
          yield record;
        } else if (!skipEmptyLines) {
          yield [""];
        }
        continue;
      }
      if (afterQuote) throw new CsvError(`unexpected character ${JSON.stringify(c)} after closing quote at line ${line}`);
      if (c === quote && field === "") {
        inQuotes = true;
        this.quoteLine = line;
        started = true;
        continue;
      }
      field += c;
      started = true;
    }
    this.field = field;
    this.inQuotes = inQuotes;
    this.afterQuote = afterQuote;
    this.started = started;
    this.line = line;
  }

  /** The input is over: finish the record in progress, or say that a quoted field was left open. */
  *end(): Generator<string[]> {
    if (this.inQuotes) throw new CsvError(`unterminated quoted field starting at line ${this.quoteLine}`);
    if (this.started) {
      this.fields.push(this.field);
      const record = this.fields;
      this.fields = [];
      this.field = "";
      this.started = false;
      yield record;
    }
  }
}
