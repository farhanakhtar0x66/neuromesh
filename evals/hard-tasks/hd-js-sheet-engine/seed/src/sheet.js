import { parseAddress } from "./address.js";
import { CellError, parseNumberText } from "./values.js";

/**
 * A spreadsheet: cells hold numbers, text or formulas; setting a cell brings the cells that depend on it up to date.
 * The rules are in README.md.
 */
export class Sheet {
  #cells = new Map(); // address -> { input, value }
  #onEvaluate;

  /**
   * @param {{ onEvaluate?: (address: string) => void }} [options]
   *   `onEvaluate(address)` is called each time a formula cell is evaluated (see "Recalculation" in README.md).
   */
  constructor(options = {}) {
    this.#onEvaluate = options.onEvaluate ?? null;
  }

  /**
   * Store an input in a cell and bring every affected cell up to date before returning.
   * @param {string} address  "A1" .. "ZZ100000", any case. RangeError otherwise.
   * @param {number | string | null | undefined} input  a number, a string ("=..." is a formula), or null/undefined/"" to empty the cell. TypeError otherwise.
   * @returns {void}
   */
  set(address, input) {
    const key = this.#addressOf(address);
    if (input === null || input === undefined || input === "") {
      this.#cells.delete(key);
      return;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("a cell number must be finite");
      this.#cells.set(key, { input, value: input === 0 ? 0 : input });
      return;
    }
    if (typeof input !== "string") throw new TypeError("a cell input is a number, a string, or null");
    if (input.startsWith("=")) {
      // TODO: parse the formula, record what it depends on, evaluate it, and recalculate the dependents.
      this.#cells.set(key, { input, value: new CellError("#VALUE!") });
      return;
    }
    const n = parseNumberText(input);
    this.#cells.set(key, { input, value: n === null ? input : n === 0 ? 0 : n });
  }

  /**
   * The cell's current value: a number, string, boolean, CellError, or null when the cell is empty. Never evaluates anything.
   * @param {string} address
   */
  get(address) {
    return this.#cells.get(this.#addressOf(address))?.value ?? null;
  }

  /**
   * What the cell was given: a number, a string (a formula keeps its "="), or null for an empty cell.
   * @param {string} address
   */
  input(address) {
    return this.#cells.get(this.#addressOf(address))?.input ?? null;
  }

  #addressOf(address) {
    const parsed = parseAddress(address);
    if (!parsed) throw new RangeError(`invalid cell address ${JSON.stringify(address)}`);
    return parsed.key;
  }
}
