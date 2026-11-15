Tier 0's router sends a request to the wrong tier when the request names a file and then gives its instruction as a sentence with numbers in it.

The router (src/routing/router.ts) splits a request into its instruction and any pasted data, and scores only the instruction. A one-line request of the form "<instruction>: <text>" has the text after the colon treated as pasted data when it holds enough digits and list punctuation.

The bug: for

    In src/ringbuf.rs: fix the memory ordering race condition when capacity > 1024, consumers == 8, and sequence wrap-around exceeds 65535.

the whole sentence after the colon is taken as data, so only "In src/ringbuf.rs" is scored and the request goes to the worker tier. It is an instruction that happens to contain numbers; it should be scored in full and go to the expert tier. The same happens to a paragraph that opens like this inside a longer request:

    In src/context.js: cap Notes at a maximum of 20 entries and 2,000 total characters on disk. When folding evicted turns (or adding a note) would go beyond either limit, compact the oldest entries into a single rollup line of at most 240 characters.

Expected:
- `splitPayload(request).payload` is empty for both requests above (all of the text is instruction).
- `routeTier({ request, kind: "bug" }, undefined, { instructionOnly: true }).tier` is "expert" for the ringbuf request.

Must keep working: when the text after the colon really is data (numbers to sort, `key=value; key=value` settings, a column of timestamps to convert) it is still split off as the payload and the request still goes to the grunt tier.

Tests are in test/routing.test.ts.
