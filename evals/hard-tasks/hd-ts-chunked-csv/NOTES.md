# hd-ts-chunked-csv (advisor only: never shown to a model)

TypeScript, bug, one cause family in two files. Seed `csvstream`: a streaming CSV reader (`src/parser.ts`, `src/reader.ts`) and an
import CLI, rules in `docs/FORMAT.md`, 33 visible tests that all feed whole files or chunks cut at safe places.

## The traps (four seeded bugs, none on the line the issue's symptoms point at)
1. `reader.ts` decodes every Buffer chunk on its own (`toString("utf8")`): a multibyte character cut by a chunk end becomes U+FFFD.
   Also, a character still open when the input ends must become U+FFFD (flush), which only a streaming decoder gives.
2. `parser.ts` starts every `feed()` with `let inQuotes = false`, the other state is restored from `this`: a quoted field that
   spans two chunks is read as unquoted (delimiters and line breaks inside it split the record).
3. A quote at the end of a chunk is decided by `text[i + 1]`, which is `undefined` there: `""` cut in the middle reads as a closing
   quote followed by another opening quote (a state "quote seen, undecided" must be carried over).
4. CRLF is recognised by `text[i + 1] === "\n"`: with the CR last in a chunk the record ends and the LF in the next chunk is an
   empty line, so an extra `[""]` appears. The reference carries a `prevCR` flag (and line numbers count CRLF once).
5. BOM: stripped only if the first chunk holds all three bytes (and, for strings, only if the first chunk is non-empty).
   `TextDecoder` (default `ignoreBOM: false`) strips it at any split.
Records already complete before an error must be delivered first (`docs/FORMAT.md`, "Errors"): `feed()` is a generator for this.

Why Haiku should fail: the visible tests and the symptoms invite the decoder fix (trap 1); 2, 3 and 4 are state-machine bugs
visible only when the cut falls on a particular character; the rules file says the result must not depend on the cut. A shallow
fix of 1 plus 2 still fails 32 of the 111 tests (checked). Buffering the whole input fixes everything and fails the streaming tests.

## The oracle
`hidden/tests/test/support/oracle.ts`: a whole-string parser with random access and lookahead (scans ahead for the end of each field),
no code shared with `src/`, written from `docs/FORMAT.md`. 50 fixtures (`support/fixtures.ts`): 26 hand-written, 10 generated tables
(quoting, CRLF/CR/LF, BOM, semicolons), 10 raw random strings from a small alphabet (so quotes, CRs, BOMs and errors collide),
4 raw random byte strings (invalid and truncated UTF-8). Generated ones come from `mulberry32(20261117)`. Each fixture is read in
200 chunkings (whole, every 1, 2, 3, 5 bytes, then random cuts with empty chunks) with `mulberry32(1000 + index)`, and compared to
the oracle's `{rows, error}` with `deepEqual` (errors included, so a line number that depends on the cut fails).
Also: 16 hand-written cases with expected rows written out (`hidden-examples`), 5 streaming/pull-count tests (`hidden-streaming`),
7 CLI tests on files that put a multibyte character, a CR and a BOM at the 64 KiB read boundary (`hidden-cli`).
The reference reproduces the oracle on all 50 x 200 chunkings, invalid UTF-8 included.

## Fairness check (every assertion against the materials)
- Result independent of cut, U+FFFD for invalid and truncated input, BOM rule, string chunks, empty chunks: `docs/FORMAT.md` "Characters".
- Line breaks CRLF/LF/CR, empty lines, `""` not empty, last record, trailing break: "Line breaks", "Fields and records".
- Header behaviour (short fill, long error, record numbering), exact error texts and line numbers: "Options", "Errors".
- Streaming pull counts: "Streaming" (a record is yielded as soon as the characters that complete it are read; a lone CR completes it).
- Header-key duplicates are not specified and no fixture or test depends on a particular choice (generated headers may repeat a name;
  the seed's `Object.fromEntries` keeps the last, the oracle does the same; a rewrite that keeps the first would differ: tell
  the advisor if a live run trips on it).
Passing on the seed (43 tests): the 33 visible ones, the streaming guard (the seed already streams), and fixtures 1, 11, 13, 16, 21.

## Numbers
Reference: parser.ts and reader.ts rewritten (about 200 lines of the two files; ~95 changed lines). 3 fresh-copy validation runs: ok.
The check (111 tests) takes about 3.8 s on the reference on the owner's Mac (seed 2.8 s); `validate-task.ts` about 17 s. No time limit is
used, so none is set.
