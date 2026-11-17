# Write the regex engine behind `linre`

`linre` is meant to be our regular expression engine for matching untrusted patterns against untrusted text, so it must never blow up: matching has to take time linear in the text for every pattern. The usual backtracking matcher is not an option (`(a*)*b` against thirty thousand `a`s must be answered at once, and so must `(a|aa)*c`).

The crate is in this folder. `src/lib.rs` declares the public API (`Regex::new`, `is_match`, `find`, `captures`, `find_iter`, `Match`, `Captures`, `Error`) but only plain literal patterns work. `README.md` is the specification: the syntax (literals, `.`, classes with ranges and negation, `\d \w \s` and their negations, `^` and `$` for the start and end of the text, capturing and non-capturing groups, alternation, `* + ? {m} {m,} {m,n}` and their lazy forms), the leftmost-first rule, how captures and `find_iter` behave, the exact position every parse error reports, and the complexity requirement.

Implement the engine so that `Regex` behaves as `README.md` says, standard library only. Keep the public API as declared. `cargo test --offline` runs the crate's tests; the cases in `tests/visible.rs` that are marked `#[ignore]` need the engine, run them with `cargo test --offline -- --ignored`.
