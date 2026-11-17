import { formatAddress, parseAddress } from "./address.js";
import { evaluate } from "./evaluate.js";
import { collectReferences, ParseError, parseFormula } from "./parser.js";
import { CellError, parseNumberText } from "./values.js";

const CIRC = new CellError("#CIRC!");

/**
 * A spreadsheet: cells hold numbers, text or formulas; setting a cell brings the cells that depend on it up to date.
 * The rules are in README.md.
 *
 * Each non-empty cell is `{ input, value, ast?, deps? }`: `ast` is the parsed formula (absent for constants and for a
 * formula that did not parse), `deps` the set of cells it names. `#dependents` is the reverse of every `deps`.
 */
export class Sheet {
  #cells = new Map();
  #dependents = new Map(); // address -> the formula cells that name it
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
    let cell = null;
    if (input === null || input === undefined || input === "") {
      cell = null;
    } else if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("a cell number must be finite");
      cell = { input, value: input === 0 ? 0 : input };
    } else if (typeof input === "string") {
      cell = input.startsWith("=") ? this.#formulaCell(input) : this.#constantCell(input);
    } else {
      throw new TypeError("a cell input is a number, a string, or null");
    }

    const old = this.#cells.get(key);
    if (old?.deps) for (const dep of old.deps) this.#unlink(dep, key);
    if (cell) {
      this.#cells.set(key, cell);
      if (cell.deps) for (const dep of cell.deps) this.#link(dep, key);
    } else {
      this.#cells.delete(key);
    }
    this.#recalculate(key);
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

  // ---- internals ----

  #addressOf(address) {
    const parsed = parseAddress(address);
    if (!parsed) throw new RangeError(`invalid cell address ${JSON.stringify(address)}`);
    return parsed.key;
  }

  #constantCell(input) {
    const n = parseNumberText(input);
    return { input, value: n === null ? input : n === 0 ? 0 : n };
  }

  #formulaCell(input) {
    let ast;
    try {
      ast = parseFormula(input.slice(1));
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      return { input, value: new CellError("#VALUE!") };
    }
    const deps = new Set();
    collectReferences(ast, (k) => deps.add(k), formatAddress);
    return { input, value: null, ast, deps };
  }

  #link(dep, key) {
    let set = this.#dependents.get(dep);
    if (!set) this.#dependents.set(dep, (set = new Set()));
    set.add(key);
  }

  #unlink(dep, key) {
    const set = this.#dependents.get(dep);
    if (!set) return;
    set.delete(key);
    if (set.size === 0) this.#dependents.delete(dep);
  }

  /**
   * Bring the cell and everything that depends on it up to date. The affected cells are found by walking
   * `#dependents`; they are then taken in dependency order by Tarjan's algorithm, run without recursion so that a
   * chain of any length works. A component of more than one cell, or of one cell that names itself, is a cycle.
   */
  #recalculate(start) {
    const affected = [start];
    const seen = new Set(affected);
    for (let i = 0; i < affected.length; i++) {
      for (const d of this.#dependents.get(affected[i]) ?? []) {
        if (!seen.has(d)) {
          seen.add(d);
          affected.push(d);
        }
      }
    }

    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    let counter = 0;

    const emit = (members) => {
      const cyclic = members.length > 1 || this.#cells.get(members[0])?.deps?.has(members[0]);
      for (const key of members) {
        const cell = this.#cells.get(key);
        if (!cell) continue;
        if (cyclic) cell.value = CIRC;
        else if (cell.ast) this.#evaluate(key, cell);
      }
    };

    for (const root of affected) {
      if (index.has(root)) continue;
      const frames = [{ key: root, deps: this.#cells.get(root)?.deps?.values() ?? [][Symbol.iterator]() }];
      index.set(root, counter);
      low.set(root, counter++);
      stack.push(root);
      onStack.add(root);
      while (frames.length) {
        const frame = frames[frames.length - 1];
        const next = frame.deps.next();
        if (!next.done) {
          const w = next.value;
          if (!seen.has(w)) continue; // an unaffected cell keeps its value
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter++);
            stack.push(w);
            onStack.add(w);
            frames.push({ key: w, deps: this.#cells.get(w)?.deps?.values() ?? [][Symbol.iterator]() });
          } else if (onStack.has(w)) {
            low.set(frame.key, Math.min(low.get(frame.key), index.get(w)));
          }
          continue;
        }
        frames.pop();
        const v = frame.key;
        if (frames.length) {
          const parent = frames[frames.length - 1].key;
          low.set(parent, Math.min(low.get(parent), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const members = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            members.push(w);
          } while (w !== v);
          emit(members);
        }
      }
    }
  }

  #evaluate(key, cell) {
    this.#onEvaluate?.(key);
    const value = evaluate(cell.ast, (k) => this.#cells.get(k)?.value ?? null);
    cell.value = value === null || value === 0 ? 0 : value;
  }
}
