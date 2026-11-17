# minicalc

A spreadsheet engine as a library. No user interface: you set cells, you read cells. The point of it is the part a
spreadsheet UI cannot do cheaply: when one cell changes, only the cells that depend on it are recalculated.

```js
import { Sheet } from "./src/index.js";

const sheet = new Sheet();
sheet.set("A1", 5);
sheet.set("A2", "=A1*2");
sheet.set("B1", "=SUM(A1:A2)");
sheet.get("B1"); // 15
sheet.set("A1", 10);
sheet.get("B1"); // 30
```

`src/sheet.js` declares the public API and does not implement it yet (see "State of the code" at the end). This
file is the specification. It is meant to be complete: where it is silent, there is nothing to find out.

## API

- `new Sheet(options?)`. `options.onEvaluate`, if given, is a function called with a cell's address each time that
  cell's formula is evaluated (see "Recalculation").
- `sheet.set(address, input)`: store an input in a cell and bring every affected cell up to date before returning.
- `sheet.get(address)`: the cell's current value. It never evaluates anything.
- `sheet.input(address)`: the input the cell was given: a number, a string (a formula keeps its leading `=`), or
  `null` for an empty cell.
- `CellError`: the class of error values. `new CellError(code).code` is the text (`"#DIV/0!"`), `String(error)` is
  the same text. `sheet.get` returns an instance of it for a cell whose value is an error; a text cell that merely
  contains the characters `#DIV/0!` is a plain string, not an error.

### Addresses

An address is one or two letters (`A` to `ZZ`) followed by a row number from 1 to 100000 without leading zeros:
`A1`, `b12`, `ZZ100000`. Letters are case-insensitive and the engine always reports addresses in upper case.
`set`, `get` and `input` throw a `RangeError` for anything else (`A0`, `AAA1`, `A100001`, `1A`, `A01`, `""`, a number,
`"A1 "`). `src/address.js` has the parsing and formatting helpers.

### Inputs

`set(address, input)` takes:

- a **number** (finite; `NaN`, `Infinity` and `-Infinity` throw a `TypeError`),
- a **string**,
- `null`, `undefined` or `""`, which empty the cell.

Anything else (a boolean, an object) throws a `TypeError`. A call that throws changes nothing.

A string starting with `=` is a **formula**: the text after the `=` is parsed as a formula (a lone `=` is a formula
with a syntax error). Any other string that is a number literal as `parseNumberText` in `src/values.js` defines
(optional sign, digits with an optional decimal point or exponent, spaces around it allowed: `"42"`, `" -1.5e3 "`,
`".5"`) is stored as that number. Every other string is **text**, kept exactly as given. `"TRUE"` is text.

## Values

A cell's value is a number, a string, a boolean, a `CellError`, or `null` for a cell that is empty (never set, or
emptied). Rules:

- A constant cell's value is its number or text. A value of negative zero is never reported: it is `0`.
- A formula cell's value is the result of its formula. A formula never reports `null`: if its result is an empty
  cell's value (`=B1` with `B1` empty) it is `0`.

## Formulas

Whitespace (spaces and tabs) between tokens is ignored. Names are case-insensitive.

### Grammar and precedence

From the loosest binding to the tightest:

| level | operators | |
| --- | --- | --- |
| 1 | `=` `<>` `<` `<=` `>` `>=` | comparison, left to right |
| 2 | `&` | concatenation, left to right |
| 3 | `+` `-` | left to right |
| 4 | `*` `/` | left to right |
| 5 | `^` | **left to right**: `2^3^2` is `(2^3)^2` = 64 |
| 6 | `-` `+` (prefix) | may repeat: `--3` is 3 |
| 7 | literals, references, calls, `( ... )` | |

So a prefix minus binds tighter than `^`: `-2^2` is `(-2)^2` = 4, and `2^-1` is 0.5 (the operand of `^` may be
signed). `1+2*3` is 7, `(1+2)*3` is 9, `2-3-4` is -5, `8/2/2` is 2, `"a"&1+2` is `"a3"`.

Literals: a **number** is digits with an optional fraction and an optional exponent (`12`, `1.5`, `.5`, `2e3`,
`1.5E-2`); a **string** is in double quotes with `""` for a quote inside (`"say ""hi"""`); `TRUE` and `FALSE` are
booleans. A **reference** is an address (`A1`); a **range** is two references joined by a colon (`A1:B3`), which
names the rectangle between them (`B3:A1` is the same rectangle). A **call** is a name, `(`, arguments separated
by commas, `)`.

A name that is followed by `(` is a function. Otherwise a name that is letters followed directly by digits is a
reference; if it is not a valid address (`A0`, `AAA1`, `A100001`) its value is `#REF!`. `TRUE` and `FALSE` are
booleans. Any other name (`FOO`, `A1B`) has the value `#NAME?`. A formula that cannot be parsed at all (`1+`,
`(1`, `1 2`, `=`, a stray character) has the value `#VALUE!`.

A range may appear only as an argument of a function that takes ranges (see below); anywhere else (`=A1:B2`,
`=A1:B2+1`, `=ROUND(A1:B2,0)`) the value is `#VALUE!`. A range with an invalid end (`A1:AAA1`) is `#REF!`.

### Errors

The error values are `#DIV/0!`, `#REF!`, `#VALUE!`, `#NAME?` and `#CIRC!`.

- **Propagation.** An operator or function whose operands (arguments) include an error has that error as its
  result: if there are several, the first in left-to-right reading order (inside a range, row by row, left to right).
  Only when no operand is an error are operands converted, left to right, and the first failed conversion gives
  `#VALUE!`. So `="x"+(1/0)` is `#DIV/0!`, and `="x"+1` is `#VALUE!`.
- A reference to a cell whose value is an error has that error.
- **Exceptions**, spelled out below: `COUNT` and `COUNTIF` never propagate errors from cells; `IF` looks only at
  the branch it takes; an unknown function is `#NAME?` whatever its arguments are.
- **Wrong number of arguments** (`SUM()`, `IF(1)`, `ROUND(1,2,3)`, `COUNTIF(A1)`) is `#VALUE!`, decided before any
  argument is evaluated.

### Conversions

- **To a number** (arithmetic, `ROUND`): a number as it is; `TRUE` is 1 and `FALSE` is 0; an empty cell is 0; text
  that is a number literal (as for inputs) is that number; any other text fails (`#VALUE!`).
- **To text** (`&`): a number as JavaScript's `String(n)` writes it (`0.1+0.2` gives `"0.30000000000000004"`,
  `1e21` gives `"1e+21"`); `TRUE` and `FALSE` as `"TRUE"` and `"FALSE"`; an empty cell as `""`.
- **To a condition** (`IF`): a boolean as it is; a number is true unless it is 0; an empty cell is false; text fails
  (`#VALUE!`).

### Operators

- Prefix `-` and `+` convert their operand to a number (so `+"abc"` is `#VALUE!` and `-TRUE` is -1).
- `+ - * /` and `^` convert both operands to numbers. `x/0` is `#DIV/0!` for every `x`, `0/0` included. If the
  result of any of these is not a finite number (`10^400`, `0^-1`) it is `#VALUE!`. A result of negative zero is 0.
- `&` converts both to text and joins them.
- **Comparison** gives a boolean. An empty cell compares as `0` against a number, `""` against text, `FALSE` against a
  boolean, and as `0` against another empty cell. Two values of the same kind compare naturally: numbers by value,
  booleans with `FALSE` below `TRUE`, text **without regard to case** (compare the lower-cased strings with JavaScript's
  `<`). Values of different kinds are ordered number < text < boolean: so `1<"a"` is `TRUE`, `"a"<TRUE` is `TRUE`,
  `1="1"` is `FALSE` and `1<>"1"` is `TRUE`.

### Functions

Arguments of `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` and `COUNTIF`'s first argument may be ranges. An argument that is
exactly a reference or a range is a **cell argument**; any other argument is an **expression** (`(A1)` and `A1+0` are
expressions, `A1` is a cell argument).

- `SUM(a, b, ...)`, `AVERAGE`, `MIN`, `MAX` (one or more arguments). They work on numbers: in a cell argument only
  the cells that hold numbers count, text, booleans and empty cells are skipped and an error cell is the result; an
  expression is converted to a number as for arithmetic (so `SUM(TRUE,"3")` is 4 and `SUM("x")` is `#VALUE!`).
  `SUM` of no numbers is 0; `AVERAGE` of no numbers is `#DIV/0!`; `MIN` and `MAX` of no numbers are 0.
- `COUNT(a, b, ...)`: how many of the values are numbers (in a cell argument, how many cells hold numbers; an
  expression counts 1 if its value is a number, and an expression that is an error counts 0). Never an error.
- `IF(condition, then, else?)`: the condition is converted as above. Only the branch taken is evaluated, and the
  result is that branch's value, error included. A missing `else` is `FALSE`. The cell references of both branches are
  dependencies all the same (see "Recalculation").
- `ROUND(x, digits?)`: `x` and `digits` are converted to numbers; `digits` defaults to 0 and is truncated towards
  zero; if it is outside -15 to 15 the result is `#VALUE!`. Rounds half **away from zero** at that many decimals,
  working from the decimal text of the number, so `ROUND(1.005,2)` is 1.01, `ROUND(2.675,2)` is 2.68,
  `ROUND(-2.5)` is -3 and `ROUND(1234.5678,-2)` is 1200.
- `COUNTIF(range, criterion)`: the first argument must be a cell argument (otherwise `#VALUE!`); an error in the
  criterion is the result. The cells of the range are counted if they match; an empty cell never matches and an
  error cell is never counted. The criterion is a number, a boolean or text:
  - a number (an empty cell as the criterion is 0): counts the cells that hold that number;
  - a boolean: counts the cells that hold that boolean;
  - text: an optional operator at its start (`>=`, `<=`, `<>`, `>`, `<`, `=`, looked for in that order) followed by
    a value `v`. No operator means `=`. If `v` is a number literal (as for inputs) the operator compares number cells
    with it, and only number cells; otherwise `v` is text and the operator compares text cells with it, only text
    cells, without regard to case, with the ordering of comparisons above. For `<>` the cell counts if it is not
    empty and `=` would not count it, whatever it holds (so `<>5` counts the text cells too).

## Recalculation

Dependencies are read off the formulas: a formula **depends on** every cell its references and ranges name (every
cell of a range), anywhere in the formula that parsed, including the arguments of an unknown function and the
branch `IF` does not take. A formula that did not parse depends on nothing. Empty cells are cells like any other:
a formula that names an empty cell is recalculated when that cell is set.

`set` recalculates **eagerly**: when it returns, every value is up to date, and `get` never computes anything. The
cells recalculated by one `set` are the *affected* cells: the cell that was set and every cell that depends on it
directly or through other cells (using the formulas as they are after the change). For each affected cell:

- if it is a constant (or emptied), it just takes its value;
- if it is part of a **cycle** (it can reach itself by following references: `A1: =A1`, or `A1: =B1` and `B1: =A1`)
  its value is `#CIRC!`, and its formula is **not evaluated**;
- every other formula is evaluated **exactly once**, after the cells it depends on that are also affected. A cell
  that depends on a cycle but is not part of it is evaluated normally and sees `#CIRC!` where it reads a cycle cell
  (so it too ends up with `#CIRC!`, unless something like `IF` skips the reference). Cycles are found on the
  references as written, whether or not an `IF` would reach them.

No other cell is evaluated. There is no shortcut for "the value did not change": setting a cell to the input it
already has recalculates its dependents again. Every evaluation of a formula calls `options.onEvaluate(address)`
once, with the cell's upper-case address, just before it computes the value; cells that get `#CIRC!`, constants, emptied cells
and formulas that did not parse (their value is `#VALUE!` without being evaluated) never call it. Breaking a cycle (setting one of its cells to something else) leaves no stale values:
the cells that were `#CIRC!` are recalculated like any others.

The cost of a `set` must depend on how many cells are affected, not on how many cells the sheet has. Real sheets have
long dependency chains: a column of 20,000 formulas each referring to the cell above (`A2: =A1+1`, `A3: =A2+1`,
...) must work, and changing `A1` must recalculate it quickly without a stack overflow.

## State of the code

- `src/address.js`: `parseAddress`, `formatAddress`, the grid limits (done).
- `src/values.js`: `CellError`, `parseNumberText`, the text and number helpers (done).
- `src/sheet.js`: the `Sheet` class. The constructor, `input()`, and `set`/`get` for numbers, text and emptying are
  there; formulas are not: a formula cell currently reports `#VALUE!`. Everything under "Formulas" and
  "Recalculation" is still to be written.
- `test/`: `npm test` (`node --test`).
