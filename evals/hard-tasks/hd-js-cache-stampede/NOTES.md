# hd-js-cache-stampede: notes for the advisor (never shown to a model)

Kind: bug, JavaScript (ESM, Node 26, no dependencies). Seed: 390 lines of source, docs and README, 249 lines of visible tests
and helpers (21 visible tests). Reference: `src/cache.js` rewritten (130 lines; 96 changed lines against the seed, below the
design's 150 floor: a bug fix in one file is this size; nothing was padded).

## The seed's five bugs (the issue names the symptoms, not the causes)

1. Concurrent misses each start a load (`#load` has no in-flight map; only refreshes are deduplicated).
2. A failed load is stored as `{ error }` and thrown back for the whole TTL.
3. A background refresh that settles after `delete`/`clear`/`set` stores its value anyway (`#refresh` has no
   notion of invalidation).
4. A stale read does not touch the LRU list (the fresh branch does).
5. `#size` is incremented on every store, including a replacement, so it drifts above the real count.

## Rules in docs/CACHE_RULES.md that the seed does not state in code and the hidden tests check

A caller that finds the entry expired joins a refresh still running; a failed refresh leaves the stale entry
untouched (not extended) and a later stale read starts a new refresh; a failed refresh is silent (an unhandled
rejection would crash the test process); invalidation detaches the in-flight load, so the next `get` starts a new
load while the old one is still pending, but waiters that had joined still get the old load's outcome; eviction
does not cancel a load; a store is dated from when the load settled; the loader is called synchronously inside
`get`. All of it is in the rules file, none of it in the issue: reading the file is the skill under test.

## Why a small model should fail

Each of the five fixes is local and plausible, and the visible tests (which pass on the seed and after a shallow
fix) never settle two loads in a chosen order. The hidden interleavings need one design (a per-key slot that
invalidation detaches), and a patch per symptom tends to break another ordering: sharing the miss load but not
joining a refresh, deleting an entry but not invalidating the slot, ignoring `set` as an invalidator.

## The oracle

- `hidden/tests/test/stampede.test.js`: 31 deterministic tests; the loader's promises are settled by the test in a
  chosen order, time is a clock the test moves, `setImmediate` is the "let the microtasks run" barrier. No timers.
- `hidden/tests/test/model.test.js`: four tests of 100 seeded random operation sequences each (get, set, delete,
  clear, tick, resolve, reject; 80 to 100 steps; four configurations of ttl, stale window and size bound). A
  plain array-based model written from the rules file (no shared code with the reference) is compared after every
  step on: loader calls (count and key, in order), `size`, `keys()` order, `has()` for every key, `delete`'s answer,
  and the outcome of every `get` promise issued so far. A mismatch names the seed, the step and the last six
  operations.
- The visible tests are copied into `hidden/tests/` so that a model that edited them cannot weaken the check.
- 22 fail-to-pass (18 named tests and the 4 random ones), 34 pass-to-pass (the 21 visible tests plus 13 hidden
  tests that already hold on the seed).

## Time

Whole `node --test` on the reference: 1.8 s (the random tests take about 3 s of CPU in total). `validate-task.ts`
(seed once, reference 3 times): about 6 s. No complexity limit, so no time limit in the tests.

## Fairness check, done by the builder

Every hidden assertion was traced to a sentence of docs/CACHE_RULES.md. One test that depended on whether a loader
that throws synchronously is "settled" before the next caller arrives was removed as ambiguous (a second caller
in the same tick is no longer asserted).
