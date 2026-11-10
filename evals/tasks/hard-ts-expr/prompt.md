Implement `evaluate(source, vars = {})` in `src/expr.ts`: it parses and evaluates an arithmetic expression and returns a number.

- Numbers: `12`, `2.5`, `.5`. Whitespace may appear between any tokens.
- Binary operators, loosest first: `+ -`, then `* / %`, then `^` (power). `^` is right-associative (`2^3^2` is 512); the others are left-associative.
- Unary `-` and `+` bind looser than `^` but tighter than `* / %`: `-2^2` is -4, `2^-1` is 0.5, `--3` is 3.
- Parentheses.
- Identifiers (`[A-Za-z_][A-Za-z0-9_]*`) are variables, looked up in `vars`, or function calls when followed by `(`. Functions: `min` and `max` (one or more arguments), `abs` and `sqrt` (exactly one).

Errors throw the exported class `ExprError` (a subclass of `Error`) with a `position` property: the 0-based index in `source` where the problem is. Messages and positions:

- `Unexpected token '<text>' at <pos>`, where the token starts.
- `Unexpected end of input at <pos>`, where pos is the length of the source.
- `Unknown variable '<name>' at <pos>` and `Unknown function '<name>' at <pos>`, at the name.
- `Wrong number of arguments for <name> at <pos>`, at the function name.
- `Division by zero at <pos>`, at the `/` or `%` operator.

Keep the existing exports.
