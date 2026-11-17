# linre

A small regular expression engine for Rust, standard library only. It has one job: **match in time linear in the text
for every pattern.** Patterns like `(a*)*b` or `(a|aa)*c` must not blow up, however long the text is. That rules out
the usual backtracking matcher.

The public API is declared in `src/lib.rs` (`Regex`, `Match`, `Captures`, `FindIter`, `Error`); only plain literal
patterns work so far. Everything below is the specification of the engine to be written.

## API

```rust
let re = linre::Regex::new(r"(\d+)-(\d+)")?;
re.is_match("a 12-34 b");                    // true
re.find("a 12-34 b");                        // Some(Match { start: 2, end: 7 })
let caps = re.captures("a 12-34 b").unwrap();
caps.get(0);                                 // Some(Match { start: 2, end: 7 })
caps.get(2);                                 // Some(Match { start: 5, end: 7 })
re.find_iter("1-2 3-4").count();             // 2
linre::Regex::new("(a").err().unwrap().position; // 0
```

- Positions in a `Match` are **byte offsets** into the text. The text is a `&str` and may contain any characters;
  `.` and character classes consume one whole character (`char`), never part of one.
- `captures` returns `None` when there is no match. `Captures::len()` is the number of capturing groups plus one, and
  `get(0)` is the same match `find` returns.

## Syntax

| construct | meaning |
| --- | --- |
| `a`, `é`, any character that is not special | itself |
| `.` | any character except `\n` |
| `[abc]`, `[a-z0-9_]`, `[^abc]` | a class: one character in (or, with `^`, not in) the set; ranges are by code point |
| `\d` `\D` | ASCII digit `[0-9]`, anything else |
| `\w` `\W` | ASCII word character `[A-Za-z0-9_]`, anything else |
| `\s` `\S` | ASCII whitespace `[ \t\n\r\x0b\x0c]`, anything else |
| `\n` `\t` `\r` | newline, tab, carriage return |
| `\` followed by an ASCII punctuation character | that character (`\.`, `\\`, `\*`, `\]`, ...) |
| `^` | start of the text (not start of a line) |
| `$` | end of the text (not end of a line, and not before a final newline) |
| `(` ... `)` | a capturing group, numbered 1, 2, ... by the position of its `(` |
| `(?:` ... `)` | a group that does not capture |
| `x\|y` | `x` or `y` (an empty branch matches the empty string: `a\|`, `()`; the empty pattern matches the empty string) |
| `x*` `x+` `x?` | zero or more, one or more, zero or one |
| `x{m}` `x{m,}` `x{m,n}` | exactly m, at least m, between m and n (0 <= m <= n <= 1000) |
| any of the above followed by `?` | the lazy form (`x*?`, `x+?`, `x??`, `x{m,n}?`) |

Inside a class `\d \D \w \W \s \S`, `\n \t \r` and `\` plus punctuation work as above; a `-` between two single
characters makes a range, and a `-` that is first or last is itself. A `]` right after `[` or `[^` is an error (write
`\]`). `]` and `}` outside a class are ordinary characters. A `{` always starts a counted repetition.

Not supported: back-references, look-around, word boundaries (`\b`), flags (`(?i)`), named groups, possessive
quantifiers, Unicode classes. They are syntax errors (an unknown escape or an unsupported group).

## Meaning

- **Leftmost-first.** The match starts at the leftmost position where any match exists. Among the matches that start
  there the engine picks the one a backtracking matcher (Perl, Python) would find first: alternatives are tried left
  to right, a greedy quantifier prefers more repetitions, a lazy one prefers fewer. This is not "longest match":
  `a|ab` on `ab` matches `a`.
- **Captures.** A group holds the span of its last iteration. A group inside a repetition keeps the span of an earlier
  iteration if a later iteration did not go through it (`(?:(a)\|b)*` on `ab` leaves group 1 at `a`). A group that took
  no part in the match is `None`. A repetition whose body can match the empty string (`(a*)*`, `(|a)+`) is a corner
  where engines disagree about how many empty iterations to run: the captures of groups inside such a repetition, and
  in odd cases like `(|a)+` the extent of the match, are not specified. It must still finish in linear time and give
  the obvious answer where there is one (`(a*)*b` finds the `b` after any number of `a`s).
- **`find_iter`** yields successive matches. The first is `find(text)`. After a match `m`, the next search starts at
  `m.end`. After a non-empty match an empty match at `m.end` is allowed; after an *empty* match at `p` the next search
  starts at `p` too, but an empty match at `p` is not accepted again (a longer match starting at `p`, if the pattern has
  one by priority order, is still found; otherwise the search goes on from the next character). So `a*` on `baac` gives
  `0..0, 1..3, 3..3, 4..4` and `|a` on `a` gives `0..0, 0..1, 1..1`. The iteration ends when a search finds nothing.
  `^` is true only at byte 0 of the whole text, also for a search that starts later.
- Matching is case-sensitive.

## Errors

`Regex::new` returns `Error { position, message }`. `position` is a byte offset into the pattern, `message` is free
text (not empty). For a pattern with one mistake:

| mistake | position |
| --- | --- |
| a `(` that is never closed | that `(` (with several, the last one) |
| a `)` with no `(` | that `)` |
| `(?` followed by anything but `:` | the `(` |
| a quantifier with nothing to repeat: `*a`, `(+)`, `a\|*`, `{2}`; or after `^` or `$` | the quantifier (for a counted one, its `{`) |
| a quantifier right after a quantifier (and its lazy `?`): `a**`, `a+?*`, `a{2}{3}`, `a*??` | the second quantifier |
| a `{` that does not start a valid `{m}`, `{m,}` or `{m,n}` (`a{`, `a{x}`, `a{,2}`), `m > n`, or a count above 1000 | the `{` |
| a `[` that is never closed | the `[` |
| an empty class: `[]`, `[^]` | the `[` |
| a reversed range: `[z-a]` | the first character of the range (`z`) |
| an unknown escape (`\q`, `\b`, `\1`) or a backslash at the end | the backslash |

## Complexity

For every pattern the time to find a match is O(text length x pattern size) and the memory does not grow with the
number of repetitions the match takes. No recursion depth may depend on the text (a text of a million characters must
work). Counted repetitions may be expanded, so the pattern size is bounded by the limit of 1000 on counts.

## Tests

`cargo test --offline` (the tests are compiled with optimisations, see `Cargo.toml`). The cases in `tests/visible.rs`
that need the engine are marked `#[ignore]`; run them with `cargo test --offline -- --ignored`.
