# hd-rust-free-slots (advisor only, never shown to a model)

Rust, bug, group A. Crate `calsched`: weekly hours, exceptions (time off, extra hours), meetings with optional own
buffers, `free_slots(people, window, min_len)`. Rules are in the seed's `docs/RULES.md` (the model has to read it);
the README links to it; the prompt does not.

## The four seeded bugs (the prompt reports each as a symptom, never names a cause)

| # | where | seed behaviour | rule it breaks |
| --- | --- | --- | --- |
| 1 | `interval.rs` `normalize` | joins only overlapping intervals (`<`), touching ones stay apart | README "touching intervals are one block", RULES 2 and 10 |
| 2 | `availability.rs` `busy_blocks` | merges meetings first, then applies the *person's default* buffer once; a meeting's own `buffer_before/after` (incl. `Some(0)`) are ignored | RULES 7 |
| 3 | `availability.rs` `first_day_piece` | an exception is cut at the local midnight after it starts; the rest is dropped (extra hours after midnight vanish, time off after midnight is not applied) | RULES 5 |
| 4 | `availability.rs` `exceptions_of` | time off is passed to `subtract` unsorted; `subtract` needs `blocked` sorted by start (doc comment) and stops early, so an earlier day off listed after a later one is not applied | RULES 11, README "unsorted" |

Why a small model should fail: the issue's four examples each point at one place; fixing the touching join (one
character) and the buffer line makes the visible tests and most of the issue examples pass. Bug 4 hides in the caller
of `subtract` (the helper is correct for its documented precondition), and bug 3 is two functions away from the
symptom. The random property test (300 calendars, 1 to 3 people, offsets incl. +05:30, +05:45, +12:45, night shifts,
split blocks, overlapping meetings with mixed buffers) is the wide check.

Mutation check (reference with one fix reverted, hidden tests failing): touching 6, buffers 8, midnight 6, unsorted 6.
Every bug is caught by named tests and by the property test.

## Fairness audit (each hidden assertion and the sentence that decides it)

- buffer cases: RULES 7 and the `Meeting` doc comment (`None` default, `Some(0)` none).
- midnight cases: RULES 5; local weekday and day-off-as-local-day: RULES 1 and 4.
- touching hours, night shift, hours that only touch between two people: README model paragraph, RULES 2 (half-open).
- list order: README "plain Vecs in whatever order", RULES 11.
- `min_len < 1` as 1, empty people, clipping to the window: `free_slots` doc comment in the seed and RULES 10.
- Off wins over Extra, buffers block outside working hours: RULES 4 and 8.
- Property oracle: `bookable()` in the hidden test applies RULES 9 minute by minute, without any interval algebra.

## How the oracle was made

Minute-grid brute force inside `hidden/tests/tests/hd_free_slots.rs` (`brute_force`, `bookable`). Random cases use a
fixed xorshift seed (`Rng::new(1000 + case)`), 300 cases, at least 150 must have a non-empty result (asserted, so the
generator cannot silently go degenerate). Windows are 1 to 4 days (+ up to 11 h) around Mon 2022-01-10.

## Build commands

    cd <repo root>
    node evals/hard-tasks/hd-rust-free-slots/hidden/make-spec.ts    # writes hidden/spec.json (16 fail-to-pass, 22 pass-to-pass)
    node evals/validate-task.ts evals/hard-tasks/hd-rust-free-slots

## Timing

The whole hidden check (`node hidden/grade.ts`, debug build, compile included) takes about 3.5 s on the reference
(compile about 1.7 s, tests 0.35 s). No time limits are used in this task.

## Sizes and one deviation

Seed 571 lines in total (368 in `src/`, 12 visible tests). The reference changes 2 files, 34 lines: smaller than the
design's 150 to 700 for a reference, because this is a bug fix; the seed is the size the design asks for.
DESIGN.md says "touching intervals merged as overlapping"; merging touching intervals is correct for free time, so
the seeded bug is the opposite one (touching intervals *not* joined), same class: half-open boundary handling.
