# The query language

`track list --search <query>` and `Store.search(query, context)` take a query written in this language. A query selects
issues; the result is always the matching issues in ascending `id` order. An empty query (or one that is only white
space) matches every issue.

Words you type without any special syntax keep meaning what they have always meant: *the issue's title or body contains
the word, ignoring case*. Several words are all required (see "Implicit AND").

## Lexical rules

The query is read from left to right as a sequence of tokens. White space (space, tab, CR, LF) separates tokens and is
otherwise ignored. Columns in this document are 1-based positions in the query string (one per JavaScript string
character).

    ws        = " " | "\t" | "\r" | "\n" ;
    special   = "(" | ")" | '"' ;
    run       = char , { char } ;                    (* char: any character except ws and special *)
    escape    = "\" , ( '"' | "\" | "n" | "t" ) ;    (* a quote, a backslash, a line feed, a tab *)
    quoted    = '"' , { escape | qchar } , '"' ;     (* qchar: any character except '"' and "\" *)

- `(` and `)` are tokens of their own.
- A `-` that is the first character of a token and is immediately followed by a character that is neither white space
  nor the end of the query is the token **MINUS**. (`re-open` is one word, `- x` is the word `-` and the word `x`,
  `-x` is MINUS and the word `x`, `--x` is two MINUS and `x`.)
- A `quoted` string is a **PHRASE**: its value is the text between the quotes with the escapes replaced by the
  characters they stand for. A backslash outside a quoted string is an ordinary character.
- Otherwise a `run` is read (it ends at white space, a parenthesis or a quote):
  - the runs `AND`, `OR` and `NOT` (exactly these capitals) are the keyword tokens **AND**, **OR**, **NOT**;
    `and`, `Or` and `"NOT"` are ordinary text;
  - a run that contains no `:` is a **WORD**;
  - a run that contains `:` is a **FILTER**. Its field name is the text before the first `:` and its value is the text
    after it (which may contain more colons). When the run ends with `:` and the very next character is `"`, the
    value is the quoted string that follows instead (and the field name is the run without its final colon).
    `title:"fix bug"` is one filter. A quote that does not follow a colon ends the run: `abc"def"` is the word `abc`
    and the phrase `def`.

## Grammar

Over tokens. Everything else on the line is the same as in EBNF.

    query    = [ or ] ;
    or       = and , { OR , and } ;
    and      = unary , { [ AND ] , unary } ;         (* two units side by side: an implicit AND *)
    unary    = ( NOT | MINUS ) , unary | primary ;
    primary  = "(" , or , ")" | PHRASE | WORD | FILTER ;

Precedence from tightest to loosest: `NOT` / `-`, then `AND` (written or implicit), then `OR`. `a OR b c` is
`a OR (b AND c)`; `NOT a b` is `(NOT a) AND b`; `-(a OR b)` negates the group. Parentheses group. `NOT` is plain
negation: `NOT assignee:ann` also matches unassigned issues.

**Implicit AND.** A unit that starts with NOT, MINUS, `(`, a PHRASE, a WORD or a FILTER, right after another unit, means
AND. So `login crash` needs both words; `a b OR c` is `(a AND b) OR c`.

## What a term matches

A WORD or a PHRASE alone matches issues whose **title or body contains its text, ignoring case**.

A FILTER `name:value` is one of these fields (names are lower case; any other name is an error):

| field | what it tests | case |
| --- | --- | --- |
| `title`, `body` | the field contains the value as a substring | ignores case |
| `status` | the status equals the value; values are `open`, `in-progress`, `closed` | ignores case |
| `assignee` | the assignee equals the value; the value `none` matches unassigned issues | ignores case |
| `reporter` | the reporter equals the value | ignores case |
| `label` | one of the labels equals the value exactly | **matters** (`bug` is not `Bug`) |
| `id`, `priority` | an integer field (`id` 1 and up, `priority` 1 to 5) | |
| `estimate` | a number of hours, may have decimals; an issue without an estimate never matches | |
| `created`, `due` | a date; an issue without a due date never matches a `due` test | |
| `is` | a macro, see below | **matters** (lower case only) |

"Ignores case" means both sides are compared after `toLowerCase()`.

### Values of number and date fields

For `id`, `priority`, `estimate`, `created` and `due` the value (when not written as a quoted string) can be

- `v`: equal to `v`;
- `>v`, `>=v`, `<v`, `<=v`: compared with `v` (the operator is the first characters of the value);
- `a..b`: from `a` to `b`, both included (the value is split at the first `..`).

`priority:<=2`, `created:>=2024-01-01`, `estimate:1.5..4`, `id:10..20`. A value written as a quoted string is always a
single plain value: `priority:">=3"` is not a comparison (it is an invalid integer). For every other field an operator
or a `..` in the (unquoted) value is an error; quote the value to search for it (`title:"wait..."`).

- an integer is one or more digits (`3`, `007`); a number is digits with an optional `.` and digits (`2`, `1.5`);
- a date is `YYYY-MM-DD` and must exist (`2024-02-29` does, `2023-02-29` does not), or a relative date:
  `@today`, `@today-7d`, `@today+2w`: today, plus or minus a whole number of days (`d`) or weeks (`w`, seven days).
  Nothing else follows `@today`. "Today" is the UTC calendar date of `context.clock()` (default: the current time).

### Macros: `is:name`

| macro | matches |
| --- | --- |
| `is:open` | status `open` or `in-progress` |
| `is:closed` | status `closed` |
| `is:mine` | the assignee equals `context.user` (ignoring case); an error if there is no user |
| `is:overdue` | the issue has a due date before today and is not `closed` |

## Errors

A bad query throws `QueryError` (`src/errors.ts`): `message` is the text below with `x` and `v` replaced by what the
query said, `column` the 1-based column. Only the first problem is reported: the query is read from left to right,
one term at a time, and **a term is checked as soon as it has been read, before the next token is read** (inside a
filter, the field name is checked first, then whether the value may have an operator or a range, then the value
itself). The errors:

| message | column |
| --- | --- |
| `unterminated quoted string` | the opening quote |
| `invalid escape "\q"` (the backslash and the character after it) | the backslash |
| `unknown field "x"` | the first character of the name (for an empty name, the colon) |
| `missing value for field "x"` (the colon is not followed by a value: the query ends, or white space or a parenthesis comes next) | the character after the colon |
| `invalid value "v" for status` | the first character of the value (the opening quote of a quoted one) |
| `invalid date "v"`, `invalid integer "v"`, `invalid number "v"` | the first character of that value, comparison operand or range end (the opening quote of a quoted one; for an empty one, where it would start) |
| `operator not allowed for field "x"` | the first character of the value |
| `unknown macro "v"` | the first character of the value |
| `no current user for is:mine` | the first character of the value |
| `unexpected ")"` (a `)` where a term is needed, or one that closes nothing) | the parenthesis |
| `unexpected "AND"`, `unexpected "OR"` (a keyword where a term is needed) | the first character of the keyword |
| `unexpected end of query` (a term is needed and the query is over) | one past the last character |
| `missing ")"` (the query ends inside a group) | the `(` that was never closed |

A backslash that is the last character of the query leaves its string unterminated (there is no character to be an invalid
escape). `v` in a message is the value after unquoting. An error in the value of a range is reported for the end that is wrong
(the first one, if both are).

## Command line

    track list [--search <query>] [--user <handle>] [--today <YYYY-MM-DD>] [--data <file>]

`--user` becomes `context.user`, `--today` makes the clock read noon UTC on that date. When the query is bad the command
prints, to standard error, the message, the query and a caret under the column, and exits with status 2:

    track: unknown field "foo"
      foo:bar
      ^

(The query line and the caret line start with two spaces; the caret is under the column.)

## Examples

| query | meaning |
| --- | --- |
| `login crash` | title or body contains `login` and `crash` |
| `"dark mode" OR theme` | contains the phrase `dark mode`, or `theme` |
| `status:open -label:docs` | open and not labelled `docs` |
| `(priority:1 OR priority:2) AND NOT assignee:none` | priority 1 or 2 and assigned |
| `created:>=@today-7d is:overdue` | created in the last week and overdue |
| `estimate:0.5..2 title:"readme"` | an estimate from half an hour to two, with `readme` in the title |
