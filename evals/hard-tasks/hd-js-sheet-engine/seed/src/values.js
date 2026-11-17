// Values: numbers, strings, booleans, errors, and null for an empty cell.

export const ERROR_CODES = ["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#CIRC!"];

/** An error value. `sheet.get` returns one for a cell whose value is an error. */
export class CellError {
  constructor(code) {
    if (!ERROR_CODES.includes(code)) throw new RangeError(`unknown error code ${code}`);
    this.code = code;
  }
  toString() {
    return this.code;
  }
}

export const isCellError = (v) => v instanceof CellError;

const NUMBER_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

/** The number a text stands for ("42", " -1.5e3 ", ".5"), or null when the text is not a number literal. */
export function parseNumberText(text) {
  if (!NUMBER_TEXT.test(text)) return null;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
}
