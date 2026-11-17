import { CsvError } from "./errors.ts";

export interface ParserOptions {
  delimiter: string;
  quote: string;
  skipEmptyLines: boolean;
}

// Where the tokenizer is between two characters. Everything it needs to carry from one feed() to the next is here,
// so the text can be cut at any character, including between the two halves of "" or of CRLF.
type State =
  | "recordStart" // nothing of the current record has been read
  | "fieldStart" // a delimiter was just read
  | "unquoted" // inside a field that did not start with a quote
  | "quoted" // inside a quoted field
  | "quoteSeen" // a quote inside a quoted field: the next character says whether it was an escape or the end
  | "afterQuote"; // the field is closed; only a delimiter or a line break may follow

/**
 * Incremental tokenizer. Feed it decoded text piece by piece with feed(); every record that the text completes
 * comes out of the generator as soon as it is complete. Call end() once, after the last piece.
 */
export class Parser {
  private opts: ParserOptions;
  private state: State = "recordStart";
  private fields: string[] = [];
  private field = "";
  private prevCR = false; // the previous character was a CR, so an LF now is its second half
  private line = 1;
  private quoteLine = 1; // the line of the opening quote of the current quoted field

  constructor(opts: ParserOptions) {
    this.opts = opts;
  }

  private takeRecord(): string[] | undefined {
    const wasEmpty = this.state === "recordStart";
    this.state = "recordStart";
    if (wasEmpty) return this.opts.skipEmptyLines ? undefined : [""];
    this.fields.push(this.field);
    const record = this.fields;
    this.fields = [];
    this.field = "";
    return record;
  }

  *feed(text: string): Generator<string[]> {
    const { delimiter, quote } = this.opts;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      const wasCR = this.prevCR;
      this.prevCR = c === "\r";

      if (this.state === "quoteSeen") {
        if (c === quote) {
          this.field += quote;
          this.state = "quoted";
          continue;
        }
        this.state = "afterQuote"; // it was the closing quote; look at c again
      }

      if (this.state === "quoted") {
        if (c === quote) {
          this.state = "quoteSeen";
        } else {
          this.field += c;
          if (c === "\r" || (c === "\n" && !wasCR)) this.line++;
        }
        continue;
      }

      if (c === "\n" && wasCR) continue; // the second half of a CRLF whose CR already ended the record

      if (c === "\r" || c === "\n") {
        this.line++;
        const record = this.takeRecord();
        if (record) yield record;
      } else if (c === delimiter) {
        this.fields.push(this.field);
        this.field = "";
        this.state = "fieldStart";
      } else if (this.state === "afterQuote") {
        throw new CsvError(`unexpected character ${JSON.stringify(c)} after closing quote at line ${this.line}`);
      } else if (c === quote && (this.state === "recordStart" || this.state === "fieldStart")) {
        this.state = "quoted";
        this.quoteLine = this.line;
      } else {
        this.field += c;
        this.state = "unquoted";
      }
    }
  }

  /** The input is over: finish the record in progress, or say that a quoted field was left open. */
  *end(): Generator<string[]> {
    if (this.state === "quoted") throw new CsvError(`unterminated quoted field starting at line ${this.quoteLine}`);
    if (this.state === "recordStart") return;
    const record = this.takeRecord();
    if (record) yield record;
  }
}
