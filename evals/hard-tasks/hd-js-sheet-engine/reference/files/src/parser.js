// Formula text -> syntax tree. A formula that does not parse throws ParseError (the sheet turns that into #VALUE!).

import { parseAddress, REFERENCE_LIKE } from "./address.js";

export class ParseError extends Error {}

const NUMBER = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_.]*/y;
const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "(", ")", ",", ":"];

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let out = "";
      i++;
      for (;;) {
        if (i >= text.length) throw new ParseError("unterminated string");
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out += text[i++];
      }
      tokens.push({ type: "str", value: out });
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(text);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) throw new ParseError("number too large");
      tokens.push({ type: "num", value });
      i = NUMBER.lastIndex;
      continue;
    }
    NAME.lastIndex = i;
    const name = NAME.exec(text);
    if (name) {
      tokens.push({ type: "name", value: name[0] });
      i = NAME.lastIndex;
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (!op) throw new ParseError(`unexpected character ${ch}`);
    tokens.push({ type: "op", value: op });
    i += op.length;
  }
  return tokens;
}

/** A reference node: valid ones carry their cell, invalid ones (A0, AAA1) evaluate to #REF!. */
function refNode(name) {
  const a = parseAddress(name);
  return a ? { t: "ref", key: a.key, col: a.col, row: a.row } : { t: "ref", invalid: true };
}

export function parseFormula(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (...ops) => peek()?.type === "op" && ops.includes(peek().value);
  const take = () => tokens[pos++];
  const expectOp = (op) => {
    if (!isOp(op)) throw new ParseError(`expected ${op}`);
    pos++;
  };

  function comparison() {
    let left = concat();
    while (isOp("=", "<>", "<", "<=", ">", ">=")) left = { t: "bin", op: take().value, l: left, r: concat() };
    return left;
  }
  function concat() {
    let left = additive();
    while (isOp("&")) left = { t: "bin", op: take().value, l: left, r: additive() };
    return left;
  }
  function additive() {
    let left = multiplicative();
    while (isOp("+", "-")) left = { t: "bin", op: take().value, l: left, r: multiplicative() };
    return left;
  }
  function multiplicative() {
    let left = power();
    while (isOp("*", "/")) left = { t: "bin", op: take().value, l: left, r: power() };
    return left;
  }
  function power() {
    let left = unary();
    while (isOp("^")) left = { t: "bin", op: take().value, l: left, r: unary() };
    return left;
  }
  function unary() {
    if (isOp("-")) {
      pos++;
      return { t: "neg", e: unary() };
    }
    if (isOp("+")) {
      pos++;
      return { t: "pos", e: unary() };
    }
    return primary();
  }
  function primary() {
    const tok = take();
    if (!tok) throw new ParseError("unexpected end");
    if (tok.type === "num") return { t: "num", v: tok.value };
    if (tok.type === "str") return { t: "str", v: tok.value };
    if (tok.type === "op") {
      if (tok.value !== "(") throw new ParseError(`unexpected ${tok.value}`);
      const e = comparison();
      expectOp(")");
      return { t: "paren", e };
    }
    // a name
    if (isOp("(")) {
      pos++;
      const args = [];
      if (!isOp(")")) {
        args.push(comparison());
        while (isOp(",")) {
          pos++;
          args.push(comparison());
        }
      }
      expectOp(")");
      return { t: "call", name: tok.value.toUpperCase(), args };
    }
    if (REFERENCE_LIKE.test(tok.value)) {
      const first = refNode(tok.value);
      if (!isOp(":")) return first;
      pos++;
      const second = take();
      if (!second || second.type !== "name" || !REFERENCE_LIKE.test(second.value)) throw new ParseError("expected a reference after the colon");
      const last = refNode(second.value);
      if (first.invalid || last.invalid) return { t: "range", invalid: true };
      return {
        t: "range",
        c1: Math.min(first.col, last.col),
        c2: Math.max(first.col, last.col),
        r1: Math.min(first.row, last.row),
        r2: Math.max(first.row, last.row),
      };
    }
    const upper = tok.value.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return { t: "bool", v: upper === "TRUE" };
    return { t: "name" };
  }

  const ast = comparison();
  if (pos < tokens.length) throw new ParseError("unexpected trailing input");
  return ast;
}

/** Call `add(key)` for every cell the formula's references and ranges name, anywhere in the tree. */
export function collectReferences(node, add, keyOf) {
  switch (node.t) {
    case "ref":
      if (!node.invalid) add(node.key);
      break;
    case "range":
      if (!node.invalid) for (let r = node.r1; r <= node.r2; r++) for (let c = node.c1; c <= node.c2; c++) add(keyOf(c, r));
      break;
    case "paren":
    case "neg":
    case "pos":
      collectReferences(node.e, add, keyOf);
      break;
    case "bin":
      collectReferences(node.l, add, keyOf);
      collectReferences(node.r, add, keyOf);
      break;
    case "call":
      for (const a of node.args) collectReferences(a, add, keyOf);
      break;
  }
}
