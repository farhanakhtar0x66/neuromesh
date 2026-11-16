`src/context.js` holds two jobs: the CONTEXT.md text format, and the logic that keeps Notes bounded (folding evicted turns into note lines, and compacting the Notes into a rollup). Move the second into its own module, `src/notes.js`, without changing any behaviour: every existing test must still pass, and `src/context.js` must still export everything it exports today.

`src/notes.js` exports:

- the constants `EXCERPT_CHARS` (160), `MAX_NOTES` (20), `MAX_NOTES_CHARS` (2000), `ROLLUP_CHARS` (240) and `ROLLUP_PREFIX` ("Earlier notes: ");
- `foldTurn(turn)`: the one-line note for an evicted turn (`<role> @ <at>: <text>`, whitespace collapsed and the text cut with a final "…" at `EXCERPT_CHARS`), or null when it has no text;
- `compactNotes(notes)`: the notes kept within the two limits, the oldest folded into a single rollup that stays first (the code that does this today);
- `foldEvicted(turns)`: new. The notes for the turns pushed out of History: only user and assistant turns that have text, oldest first, each as `foldTurn` gives it. `appendTurn` uses it in place of the inline filtering it does now.

`src/notes.js` must not import `src/context.js`; `src/context.js` imports `src/notes.js` and no longer defines `foldTurn` or `compactNotes` itself.

Graded by a new `test/notes.test.js` (not in your copy of the repository), and by the existing tests in test/context.test.js and test/agent.test.js, which must keep passing.
