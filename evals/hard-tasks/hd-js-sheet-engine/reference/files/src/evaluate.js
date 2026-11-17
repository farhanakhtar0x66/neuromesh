// Evaluating a syntax tree. A value is a number, string, boolean, CellError, or null (an empty cell).

import { formatAddress } from "./address.js";
import { CellError, isCellError, parseNumberText } from "./values.js";

const DIV0 = new CellError("#DIV/0!");
const REF = new CellError("#REF!");
const VALUE = new CellError("#VALUE!");
const NAME = new CellError("#NAME?");

const noNegativeZero = (n) => (n === 0 ? 0 : n);

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (typeof v === "string") return parseNumberText(v) ?? VALUE;
  return v; // an error
}

function toText(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return "";
}

const kindOf = (v) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);

/** -1, 0 or 1. Neither value is an error. */
function compare(l, r) {
  if (l === null && r === null) l = r = 0;
  else if (l === null) l = typeof r === "number" ? 0 : typeof r === "string" ? "" : false;
  else if (r === null) r = typeof l === "number" ? 0 : typeof l === "string" ? "" : false;
  const kl = kindOf(l);
  const kr = kindOf(r);
  if (kl !== kr) return kl < kr ? -1 : 1;
  if (kl === 1) {
    const a = l.toLowerCase();
    const b = r.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = Number(l);
  const b = Number(r);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** x * 10^k without floating point error in the multiplication: shift the exponent of the decimal text. */
function shift(x, k) {
  const [mantissa, exponent] = x.toExponential().split("e");
  return Number(`${mantissa}e${Number(exponent) + k}`);
}

function round(x, digits) {
  const abs = Math.abs(x);
  const rounded = shift(Math.round(shift(abs, digits)), -digits);
  return noNegativeZero(x < 0 ? -rounded : rounded);
}

const isCellArg = (node) => node.t === "ref" || node.t === "range";

export function evaluate(root, lookup) {
  const ev = (n) => go(n);

  /** The values of a cell argument, row by row. An invalid reference is one #REF! value. */
  function* cellValues(arg) {
    if (arg.invalid) {
      yield REF;
    } else if (arg.t === "ref") {
      yield lookup(arg.key);
    } else {
      for (let r = arg.r1; r <= arg.r2; r++) for (let c = arg.c1; c <= arg.c2; c++) yield lookup(formatAddress(c, r));
    }
  }

  /** The numbers an aggregate works on, or the error that is its result. Errors are looked for before conversions. */
  function numbersOf(args) {
    const items = [];
    for (const arg of args) {
      if (isCellArg(arg)) for (const v of cellValues(arg)) items.push({ v, fromCell: true });
      else items.push({ v: ev(arg), fromCell: false });
    }
    for (const { v } of items) if (isCellError(v)) return v;
    const numbers = [];
    for (const { v, fromCell } of items) {
      if (fromCell) {
        if (typeof v === "number") numbers.push(v);
      } else {
        const n = toNumber(v);
        if (isCellError(n)) return n;
        numbers.push(n);
      }
    }
    return numbers;
  }

  function sumOf(numbers) {
    let total = 0;
    for (const n of numbers) total += n;
    return total;
  }

  function matcher(criterion) {
    if (typeof criterion === "number") return (v) => typeof v === "number" && v === criterion;
    if (typeof criterion === "boolean") return (v) => typeof v === "boolean" && v === criterion;
    let op = "=";
    let rest = criterion;
    for (const candidate of [">=", "<=", "<>", ">", "<", "="]) {
      if (criterion.startsWith(candidate)) {
        op = candidate;
        rest = criterion.slice(candidate.length);
        break;
      }
    }
    const n = parseNumberText(rest);
    const lower = rest.toLowerCase();
    const order = (v) => {
      // -1, 0, 1 for a cell of the criterion's kind, null for a cell of another kind
      if (n !== null) return typeof v === "number" ? (v < n ? -1 : v > n ? 1 : 0) : null;
      if (typeof v !== "string") return null;
      const s = v.toLowerCase();
      return s < lower ? -1 : s > lower ? 1 : 0;
    };
    return (v) => {
      const o = order(v);
      switch (op) {
        case "<>":
          return o !== 0;
        case "=":
          return o === 0;
        case ">":
          return o !== null && o > 0;
        case "<":
          return o !== null && o < 0;
        case ">=":
          return o !== null && o >= 0;
        default:
          return o !== null && o <= 0;
      }
    };
  }

  const FUNCTIONS = {
    SUM: [1, Infinity, (args) => {
      const nums = numbersOf(args);
      return isCellError(nums) ? nums : sumOf(nums);
    }],
    AVERAGE: [1, Infinity, (args) => {
      const nums = numbersOf(args);
      if (isCellError(nums)) return nums;
      return nums.length === 0 ? DIV0 : sumOf(nums) / nums.length;
    }],
    MIN: [1, Infinity, (args) => {
      const nums = numbersOf(args);
      if (isCellError(nums)) return nums;
      let best = nums.length ? nums[0] : 0;
      for (const n of nums) if (n < best) best = n;
      return best;
    }],
    MAX: [1, Infinity, (args) => {
      const nums = numbersOf(args);
      if (isCellError(nums)) return nums;
      let best = nums.length ? nums[0] : 0;
      for (const n of nums) if (n > best) best = n;
      return best;
    }],
    COUNT: [1, Infinity, (args) => {
      let count = 0;
      for (const arg of args) {
        if (isCellArg(arg)) {
          for (const v of cellValues(arg)) if (typeof v === "number") count++;
        } else if (typeof ev(arg) === "number") count++;
      }
      return count;
    }],
    IF: [2, 3, (args) => {
      const cond = ev(args[0]);
      if (isCellError(cond)) return cond;
      let truth;
      if (typeof cond === "boolean") truth = cond;
      else if (typeof cond === "number") truth = cond !== 0;
      else if (cond === null) truth = false;
      else return VALUE;
      if (truth) return ev(args[1]);
      return args.length === 3 ? ev(args[2]) : false;
    }],
    ROUND: [1, 2, (args) => {
      const x = ev(args[0]);
      const d = args.length === 2 ? ev(args[1]) : 0;
      if (isCellError(x)) return x;
      if (isCellError(d)) return d;
      const xn = toNumber(x);
      if (isCellError(xn)) return xn;
      const dn = toNumber(d);
      if (isCellError(dn)) return dn;
      const digits = Math.trunc(dn);
      if (digits < -15 || digits > 15) return VALUE;
      return round(xn, digits);
    }],
    COUNTIF: [2, 2, (args) => {
      if (!isCellArg(args[0])) return VALUE;
      let criterion = ev(args[1]);
      if (isCellError(criterion)) return criterion;
      if (criterion === null) criterion = 0;
      const matches = matcher(criterion);
      let count = 0;
      for (const v of cellValues(args[0])) if (v !== null && !isCellError(v) && matches(v)) count++;
      return count;
    }],
  };

  function go(node) {
    switch (node.t) {
      case "num":
      case "str":
      case "bool":
        return node.v;
      case "ref":
        return node.invalid ? REF : lookup(node.key);
      case "range":
        return node.invalid ? REF : VALUE;
      case "paren":
        return ev(node.e);
      case "neg":
      case "pos": {
        const v = ev(node.e);
        if (isCellError(v)) return v;
        const n = toNumber(v);
        if (isCellError(n)) return n;
        return noNegativeZero(node.t === "neg" ? -n : n);
      }
      case "bin": {
        const l = ev(node.l);
        const r = ev(node.r);
        if (isCellError(l)) return l;
        if (isCellError(r)) return r;
        if (node.op === "&") return toText(l) + toText(r);
        if (["=", "<>", "<", "<=", ">", ">="].includes(node.op)) {
          const c = compare(l, r);
          switch (node.op) {
            case "=":
              return c === 0;
            case "<>":
              return c !== 0;
            case "<":
              return c < 0;
            case "<=":
              return c <= 0;
            case ">":
              return c > 0;
            default:
              return c >= 0;
          }
        }
        const a = toNumber(l);
        if (isCellError(a)) return a;
        const b = toNumber(r);
        if (isCellError(b)) return b;
        if (node.op === "/" && b === 0) return DIV0;
        const result = node.op === "+" ? a + b : node.op === "-" ? a - b : node.op === "*" ? a * b : node.op === "/" ? a / b : a ** b;
        return Number.isFinite(result) ? noNegativeZero(result) : VALUE;
      }
      case "call": {
        const fn = FUNCTIONS[node.name];
        if (!fn) return NAME;
        if (node.args.length < fn[0] || node.args.length > fn[1]) return VALUE;
        return fn[2](node.args);
      }
      default:
        return NAME; // a name that is not a function, a reference or TRUE/FALSE
    }
  }

  return go(root);
}
