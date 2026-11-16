The Notes in CONTEXT.md and in the prompt grow without limit: every folded turn and every added note is kept forever, so a long conversation makes the Notes block, and the system message built from it, as big as it likes. Bound both.

On disk (src/context.js, `appendTurn` and `addNote`): after any change the Notes hold at most 20 entries, and the serialized note lines ("- " plus the note, joined with newlines) total at most 2,000 characters. When they would go over either limit, the oldest entries are folded, in order, into a single "rollup" note that is always the first entry: `"Earlier notes: "` followed by the folded entries joined with "; ". The rollup is at most 240 characters including that prefix (cut with a final "…" when longer) and counts toward both limits, so there are never more than 19 other entries beside it. There is at most one rollup. Notes that are within the limits stay exactly as they are. A single note longer than the limits becomes a rollup of at most 240 characters ending in "…". The notes must still survive `serializeContext` then `parseContext` unchanged.

In the prompt (src/agent.js, `runTurn`): the "Notes:" system message sent to the model is at most 2,000 characters; when it would be longer, the end is cut off so that it is exactly 2,000 characters ending in "…".

Tests are in test/context.test.js and test/agent.test.js.
