import { QueryError } from "../errors.ts";
import type { SearchContext } from "../types.ts";
import { envFor, filterPredicate } from "./fields.ts";
import type { Env, Predicate } from "./fields.ts";
import { Lexer } from "./lexer.ts";
import type { Token } from "./lexer.ts";

const text = (value: string): Predicate => {
  const v = value.toLowerCase();
  return (i) => i.title.toLowerCase().includes(v) || i.body.toLowerCase().includes(v);
};

/**
 * Recursive descent over docs/QUERY.md's grammar, producing a predicate on issues. Each term is turned into its predicate
 * (and so checked) before the next token is read, so the first problem from the left is the one reported.
 */
class Parser {
  private lexer: Lexer;
  private env: Env;
  private cur: Token | undefined;

  constructor(query: string, env: Env) {
    this.lexer = new Lexer(query);
    this.env = env;
    this.cur = this.lexer.next();
  }

  parse(): Predicate {
    if (!this.cur) return () => true;
    const p = this.or();
    if (this.cur) {
      // Only ")" can be left over: `or` consumes everything else.
      throw new QueryError('unexpected ")"', this.cur.col);
    }
    return p;
  }

  private advance(): void {
    this.cur = this.lexer.next();
  }

  private or(): Predicate {
    let left = this.and();
    while (this.cur?.kind === "or") {
      this.advance();
      const l = left;
      const r = this.and();
      left = (i) => l(i) || r(i);
    }
    return left;
  }

  private and(): Predicate {
    let left = this.unary();
    for (;;) {
      if (this.cur?.kind === "and") this.advance();
      else if (!this.startsUnit()) return left;
      const l = left;
      const r = this.unary();
      left = (i) => l(i) && r(i);
    }
  }

  private startsUnit(): boolean {
    const k = this.cur?.kind;
    return k === "not" || k === "minus" || k === "lparen" || k === "phrase" || k === "word" || k === "filter";
  }

  private unary(): Predicate {
    if (this.cur?.kind === "not" || this.cur?.kind === "minus") {
      this.advance();
      const p = this.unary();
      return (i) => !p(i);
    }
    return this.primary();
  }

  private primary(): Predicate {
    const t = this.cur;
    if (!t) throw new QueryError("unexpected end of query", this.lexer.endColumn);
    switch (t.kind) {
      case "lparen": {
        this.advance();
        const p = this.or();
        if (this.cur?.kind !== "rparen") {
          if (!this.cur) throw new QueryError('missing ")"', t.col);
          throw new QueryError('unexpected ")"', this.cur.col);
        }
        this.advance();
        return p;
      }
      case "rparen": throw new QueryError('unexpected ")"', t.col);
      case "and": throw new QueryError('unexpected "AND"', t.col);
      case "or": throw new QueryError('unexpected "OR"', t.col);
      case "not":
      case "minus": return this.unary();
      case "word": {
        const p = text(t.text);
        this.advance();
        return p;
      }
      case "phrase": {
        const p = text(t.value);
        this.advance();
        return p;
      }
      case "filter": {
        const p = filterPredicate(t.name, t.col, t.colonCol, t.value, t.valueCol, t.quoted, this.env);
        this.advance();
        return p;
      }
    }
  }
}

/** A query as a predicate on issues. Throws QueryError. */
export function compileQuery(query: string, context: SearchContext = {}): Predicate {
  return new Parser(query, envFor(context)).parse();
}
