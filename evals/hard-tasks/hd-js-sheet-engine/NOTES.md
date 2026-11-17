# hd-js-sheet-engine: notes for the advisor (never shown to a model)

Kind: new program, JavaScript (ESM, Node 26, no dependencies). Seed: a skeleton with the public API declared, the
specification as `README.md` (200 lines), two finished helper modules (`src/address.js`, `src/values.js`), a `Sheet`
that stores numbers and text but reports `#VALUE!` for every formula (133 lines of source), and 17 visible tests
(10 pass on the seed: constants, addresses, `CellError`; 7 describe easy formulas and fail, which is the point: they
are what a model can run to see progress). Reference: `parser.js`, `evaluate.js`, `sheet.js`, 660 lines.

The `checks` entry in task.json is only the 10 foundation tests (so it passes on the seed, as the validator needs).

## The spec (README.md) and where the decisions were made

The engine is Excel-like on purpose, and every place where Excel is surprising or ambiguous is decided in the README
so that nothing hidden depends on knowing Excel: `^` is left-associative and prefix minus binds tighter than `^`
(`-2^2` = 4, `2^3^2` = 64); `&` sits below `+`; comparison text is case-insensitive and mixed kinds order number <
text < boolean; an empty cell compares as 0, "" or FALSE depending on the other side; errors are looked for before
conversions (`="x"+(1/0)` is `#DIV/0!`); `ROUND` works on the decimal text (`ROUND(1.005,2)` = 1.01) and rounds
half away from zero; `COUNTIF` operators and kinds; a lone `=` and any unparsable formula are `#VALUE!` and are not
evaluated (no hook call); cycles are found on references as written (so `IF(TRUE,1,A1)` in `A1` is `#CIRC!`);
evaluation is eager inside `set`; there is no early cut-off; the hook is called once per evaluation with the upper-case
address; cycle members, constants, emptied cells and unparsable formulas never call it.

Choices I made that the design did not state: columns `A`..`ZZ` and rows 1..100000 (so the 20,000-chain fits in one
column); numbers inside strings follow the seed's `parseNumberText` (tabs and spaces around are allowed, `"5."` and
`".5"` are numbers, `"1e999"` is text); `-0` is reported as 0; unary `+`/`-` convert to a number; `ROUND` digits outside
-15..15 are `#VALUE!`; `COUNT` ignores errors and counts only numbers (an expression `"2"` is text, not counted);
wrong argument counts are `#VALUE!` before any argument is evaluated; a range anywhere but a cell-argument position is
`#VALUE!`; `COUNTIF`'s `<>` counts every non-empty non-error cell that `=` would not count. All of it is in the README,
and each hidden case traces to a README sentence or example. Two README gaps were found while writing the reference
(unary conversions; whether an unparsable formula calls the hook) and closed in the README before the tests were fixed.

## Traps

1. **Recompute everything** on each `set` (the chain build then costs O(n squared): 20,000 formulas, 2×10^8 evaluations).
2. **Recursive evaluation** or recursive dependency walking: stack overflow on a 20,000 chain.
3. **Cycles**: detecting them by a DFS that marks only the cell where the walk closed (not every member), leaving
   members partly evaluated; or evaluating cycle members (the hook count then differs). A cell that depends on a cycle
   but is not in it must be evaluated, and must see `#CIRC!`.
4. **Stale values when a cycle is broken**: members that were `#CIRC!` have to be recalculated because they are
   dependents of the changed cell.
5. **Dependencies are static**: both `IF` branches, unknown function arguments; a range depends on every cell in it,
   given in either corner order; a formula that names an empty cell is recalculated when that cell is set.
6. **Evaluation count**: once per affected formula, no early cut-off, topological order within one `set`, so a diamond
   is evaluated once per cell (a naive "mark dirty and recurse" evaluates the bottom twice).
7. **Language details that every one of ~260 formula cases exercises**: precedence of `^` and prefix minus,
   comparison between kinds, empty-cell conversions, error-before-conversion order, `ROUND` on decimal text,
   `COUNTIF` kinds and operators, `-0`.

## Why a small model should fail

Each rule is small, there are many of them, and the README is long enough to skim: Haiku gets the centre of the
grammar and misses `^` associativity, the empty-cell comparisons, `COUNTIF`'s `<>` rule, error ordering, and (the
decisive part) builds either a recompute-all engine or a recursive evaluator that passes the visible tests and fails
the chain and the evaluation counts.

## The oracle (all in `hidden/tests/test/`)

- `cases.test.js`: 262 formula cases, one test each, in a fixed 30-cell fixture. **Expected values were written by
  hand from the README**, then run against the reference: all 262 agreed on the first run (no case was adjusted to the
  reference). Groups: precedence, zero and overflow, text, comparison, conversions, invalid names and syntax,
  SUM/AVERAGE/MIN/MAX/COUNT, IF, ROUND, COUNTIF.
- `api.test.js` (13): addresses, input kinds, number-like strings, `-0`, `input()`, `CellError`.
- `recalc.test.js` (27): evaluation counts and order through the `onEvaluate` hook (diamond, dependents only, no
  cut-off, empty cells, dropped and changed dependencies, ranges both ways round, IF branches, unknown functions,
  unparsable formulas), and cycles made, broken and made again.
- `props.test.js` (2): 150 + 150 seeded random 30-cell sheets (60 sets each; the second family allows arbitrary
  references, so cycles appear and disappear). After every set the oracle (plain JavaScript over the generator's own
  description: reachability by brute force, cycle members = cells that reach themselves) must match every cell's
  value, the exact set of formulas evaluated, and the dependency order of the evaluations.
- `perf.test.js` (4): a 20,000 chain built, recalculated (exactly 19,999 evaluations) and read; the same chain
  closed into a cycle and broken; one cell read by 20,000 formulas plus a SUM over a 20,000-cell range; 60,000
  constants then 60,000 formulas, to show a `set` costs the same in a big sheet.
- The visible tests are copied into `hidden/tests/` (also resets edits). 270 fail-to-pass, 54 pass-to-pass.

## Time limits

Ten times what the reference needs on the owner's Mac (slowest of 5 runs of the reference, rounded up): chain 570 ms
-> 6 s, cycle 300 ms -> 3 s, fan 490 ms -> 5 s, wide sheet 1.3 s -> 13 s. Everything else has no time limit. The
whole suite takes about 2.6 s on the reference; `validate-task.ts` about 9 s. A recompute-everything solution needs
minutes; a solution that scans the sheet on every `set` fails the wide-sheet test, not the 20,000 chain.

## Fairness check, done by the builder

Two README gaps closed (above). Not asserted anywhere: `0^0`, what an invalid range does outside a function, an
empty-string `COUNTIF` criterion, how `COUNTIF` treats the text `"TRUE"`, ranges larger than the grid's 100,000 rows,
the order in which two independent cells are evaluated.
