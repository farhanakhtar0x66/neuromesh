# hd-ts-event-store: notes for the advisor (never shown to a model)

Kind: refactor (behaviour kept, an event log added), TypeScript run by Node 26 type stripping (no build, no
dependencies, no type check: the seed has no `typescript`). Seed: 403 lines of source, README and docs, 60 visible
tests (449 lines). Reference: `events.ts` and `state.ts` new (153 lines), `inventory.ts` rewritten (256 lines),
`errors.ts` and `index.ts` touched; about 330 changed lines.

## What the seed is

An inventory (warehouses, receive, ship, reserve, release, fulfill, transfer, returnItems) on `Map`s and a `Set`,
with eleven questions (`listStock`, `lowStock`, `skus`, `orderLines`, `returnsOf`, ...). Validation order and error
codes and messages are fixed by the seed code and pinned by the 60 visible tests and 40 more hidden ones. The
refactor's contract is `docs/EVENTS.md` (written for this task: the API, one call = one event, frozen and JSON-safe
events, replay, snapshot and restore with a tail, history).

## Traps (none named in the prompt)

1. **Atomicity.** A call that throws must append nothing and change nothing. Naive event sourcing (append, apply,
   then validate) or a `fulfill` that applies line by line half-applies.
2. **Order is state.** `listStock`, `skus()`, `warehouses()`, `orderLines`, `returnsOf` follow `Map` insertion order,
   and `skus()` is a global first-appearance order that cannot be derived from `listStock`. A snapshot made of plain
   objects reorders integer-like keys (`"9"`, `"100"`, `"20"` as ids) and breaks `__proto__`/`constructor` as ids; the
   random generator and a named test use such names on purpose. (A fair rule: README says order is part of the
   behaviour and the visible tests pin first-appearance order; the names are ordinary non-empty strings.)
3. **Events must be enough to replay and to answer `history`.** A `release` event that only carries the order id
   cannot say which skus it freed without consulting state.
4. **Deep freeze and JSON data.** Nested `lines` arrays must be frozen; no `Map`, `Set` or `undefined` values.
5. **Copies, not adoption.** `restore` must not keep or mutate the snapshot's objects (the tests pass a frozen
   snapshot); `replay`/`restore` must not freeze or change the caller's events (the tests pass JSON copies) but the
   inventory's own `events()` must be frozen.
6. **The tail rules.** Older events are skipped, a gap is `BAD_EVENT_LOG`, numbering continues from the snapshot's
   `seq`, a restored inventory's `events()` and `history` start at the snapshot.
7. **The visible tests are a false comfort.** They pass on the seed and after any refactor that keeps the maps; the
   new API and the 300 sequences are where it shows.

## Why a small model should fail

It is a refactor with a half-page contract: Haiku tends to add `events()` and `replay` that re-run the public methods
(which throw on replay or double-append), forget `restore`'s tail semantics, shallow-freeze, and snapshot through
plain objects. Each of those passes the visible tests.

## The oracle (all in `hidden/tests/test/`)

- `inventory.test.ts`: the seed's 60 visible tests, copied (pass-to-pass; also resets any edit to them).
- `inventory-more.test.ts`: 40 more tests of the seed's public behaviour (validation order, integer-like and
  prototype-name ids, copies, ordering, messages). They all pass on the seed (pass-to-pass).
- `event-log.test.ts`: 28 scripted contract tests on one 15-step scenario that touches every kind of change; every
  assertion is a sentence of docs/EVENTS.md. History expectations are written by hand as `seq` lists.
- `event-props.test.ts`: five properties, each on 300 fixed-seed sequences of 60 operations (about 18 events and 40
  refusals per sequence; the generator is biased towards calls that can succeed, and names include `__proto__`):
  live == replay (also of JSON copies) with consecutive seq and frozen JSON-safe events; live == snapshot at a random
  cut plus tail (frozen and JSON snapshots, whole log as tail, snapshot at the end); refused calls append nothing
  and leave state and snapshot unchanged; replayed and restored inventories keep giving the same results, errors and
  events for 30 more operations; `history(sku)` equals the expected seq list tracked outside the inventory.
  A first run of the generator found a bug in the test (an optional call that skipped running the operations), which
  the "sequences are not trivial" assertion now guards against.
- 33 fail-to-pass (28 + 5), 100 pass-to-pass.

## Time

`node --test` on the reference: about 2.5 s. `validate-task.ts` (seed once, reference 3 times): about 11 s. No time
limits in the tests.

## Fairness check, done by the builder

Snapshot-to-snapshot equality between a restored and a live inventory is deliberately not asserted (the docs promise
behaviour, not byte equality of snapshots). `BAD_EVENT_LOG` is named in the docs; its message is not tested.
Whether `restore` must accept events that are all older than the snapshot is covered by the docs ("skipped").
