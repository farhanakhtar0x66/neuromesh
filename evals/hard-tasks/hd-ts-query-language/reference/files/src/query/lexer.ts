import { QueryError } from "../errors.ts";

export type Token =
  | { kind: "lparen" | "rparen" | "and" | "or" | "not" | "minus"; col: number }
  | { kind: "word"; col: number; text: string }
  | { kind: "phrase"; col: number; value: string }
  | { kind: "filter"; col: number; name: string; colonCol: number; value: string; valueCol: number; quoted: boolean };

const WS = new Set([" ", "\t", "\r", "\n"]);
const SPECIAL = new Set(["(", ")", '"']);
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t" };

/** Reads the query one token at a time, so that an error later in the text is not found before an earlier one is handled. */
export class Lexer {
  private text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  /** One past the last character: where "unexpected end of query" points. */
  get endColumn(): number {
    return this.text.length + 1;
  }

  next(): Token | undefined {
    const text = this.text;
    while (this.pos < text.length && WS.has(text[this.pos]!)) this.pos++;
    if (this.pos >= text.length) return undefined;
    const start = this.pos;
    const col = start + 1;
    const c = text[start]!;
    if (c === "(") {
      this.pos++;
      return { kind: "lparen", col };
    }
    if (c === ")") {
      this.pos++;
      return { kind: "rparen", col };
    }
    if (c === '"') return { kind: "phrase", col, value: this.quoted() };
    if (c === "-" && start + 1 < text.length && !WS.has(text[start + 1]!)) {
      this.pos++;
      return { kind: "minus", col };
    }
    while (this.pos < text.length && !WS.has(text[this.pos]!) && !SPECIAL.has(text[this.pos]!)) this.pos++;
    const run = text.slice(start, this.pos);
    if (run === "AND") return { kind: "and", col };
    if (run === "OR") return { kind: "or", col };
    if (run === "NOT") return { kind: "not", col };
    const colon = run.indexOf(":");
    if (colon === -1) return { kind: "word", col, text: run };
    if (run.endsWith(":") && text[this.pos] === '"') {
      const valueCol = this.pos + 1;
      const value = this.quoted();
      return { kind: "filter", col, name: run.slice(0, -1), colonCol: start + run.length, value, valueCol, quoted: true };
    }
    return { kind: "filter", col, name: run.slice(0, colon), colonCol: start + colon + 1, value: run.slice(colon + 1), valueCol: start + colon + 2, quoted: false };
  }

  /** A quoted string starting at the current position (the opening quote). */
  private quoted(): string {
    const text = this.text;
    const open = this.pos;
    let value = "";
    this.pos++;
    while (this.pos < text.length) {
      const c = text[this.pos]!;
      if (c === '"') {
        this.pos++;
        return value;
      }
      if (c === "\\") {
        const next = text[this.pos + 1];
        if (next === undefined) break;
        const mapped = ESCAPES[next];
        if (mapped === undefined) throw new QueryError(`invalid escape "\\${next}"`, this.pos + 1);
        value += mapped;
        this.pos += 2;
        continue;
      }
      value += c;
      this.pos++;
    }
    throw new QueryError("unterminated quoted string", open + 1);
  }
}
