# hd-ts-query-language (advisor only: never shown to a model)

TypeScript, feature, several files. Seed `track`: an issue-tracker library (`Store`, plain-words search in `src/search.ts`) and
`track list --search`, 13 visible tests, and `docs/QUERY.md`: the spec the task asks for (lexical rules, EBNF grammar, field table with
case rules, relative dates, macros, 13 kinds of error with the exact message and column, the CLI error format). `QueryError` is already in
the seed (`src/errors.ts`) so the hidden tests import it from a name the seed gives them.

## What makes it hard (the small-model failure modes this targets)
Thirty-odd clauses, each cheap alone: precedence NOT > AND > OR with implicit AND; `-` as NOT only at a token start and only when something
follows (`re-open`, `- x`, `login -` are words); keywords exact capitals only; `"AND"` and `and` are text; a quote that is not after a colon
ends a run (`log"in"`); `field:"quoted value"`; operators and `..` only for numeric/date fields and never inside quotes; split at the *first*
`..`; case rules per field (labels and macros are case-sensitive, the rest are not); `assignee:none`; null estimate/due never match; UTC
"today" from the injected clock, `@today-7d`/`+2w` only; 1-based columns for 13 error kinds (empty field name points at the colon, missing
value points after it, unexpected end is one past the last character, missing `)` points at the `(`); error order (a term is checked
before the next token is read, so a tokenize-everything-first design reports `created:foo "unterminated` wrongly; inside a filter: name,
then operator, then value); the CLI caret line. Plain words must keep their old meaning. A model that implements the centre of the grammar
and not the clauses fails many of the 39 fail-to-pass tests: they are spread over 44 hidden tests in 4 files, so the score is a fraction, not 0/1.

## The oracle (no library exists for this language)
Expected results are predicates written inline from `docs/QUERY.md` in the hidden tests (`i => i.priority <= 2`, `has("login")`), applied to
the fixed 24-issue store (`support/fixture.ts`, today = 2024-05-10): 207 queries in 21 tests (one of them 4 results written out in full, as a
cross-check). The property test (4 tests x 75 = 300 random boolean trees, `mulberry32(4242 + batch)`) renders each tree in every legal spelling (minimal
parentheses by precedence, redundant ones, `NOT x` or `-x`, explicit or implicit AND, spaces/tabs, no space next to parentheses) and compares
with the tree evaluated directly: the oracle never parses text. Errors: 125 `(query, message, column)` rows in 12 tests (the last two check the `QueryError` class and that odd but legal queries do not throw). When a column in
a test disagreed with the reference I recounted the query by hand: all 4 mismatches were my counting, the reference was right; the other
rows agreed first time, so each column was derived twice. CLI: 7 tests through `run()` (output lines computed from predicates, caret line
computed from the column).
Fairness fixes made while building, all in `docs/QUERY.md`: the order of checks inside a filter (name, operator/range, value); a backslash
at the end of the query is an unterminated string; an empty comparison operand points where it would start; `missing value` also when a
parenthesis follows the colon. Two assertions rely on a literal reading and are worth watching in a live run: `""` (an empty phrase)
matches every issue ("contains its text"), and `"dark"mode` (a phrase touching a word) is two terms.
Sensitivity (mutations of the reference, each caught): read-ahead before checking a term (2 tests fail), labels ignoring case (7),
lowercase keywords (2), no leading-minus rule (12), null estimates matching (8), weeks counted as days (2), empty-name column (1).

## Fairness check
Every assertion follows from a sentence or table row of `docs/QUERY.md`, or from the seed's behaviour (the line format and `--today`/`--user`/
`--data` options of `track list`, the plain-words search, id order). Nothing relies on a choice that the document leaves open.

## Numbers
Seed 447 lines (src 146, tests 102, `docs/QUERY.md` 151, README and data the rest). Reference: 418 lines in 5 files (`src/query/{lexer,fields,
parser}.ts` new, `store.ts` and `cli.ts` changed, `src/search.ts` deleted): +341 / -18 lines. Check: 57 tests (13 visible, 44 hidden; 39
fail-to-pass, 18 pass-to-pass), about 2.2 s on the reference on the owner's Mac; `validate-task.ts` about 12 s. No time limit is used.
