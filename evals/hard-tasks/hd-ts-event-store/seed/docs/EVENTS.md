# The event log

Support wants an audit trail of every stock change, and operations wants to rebuild the service's state after a
crash without a database dump. So `Inventory` stops being "maps that mutate" and becomes **a log of events plus the
state that follows from them**. Nothing a caller can do or see today changes (results, error codes and messages,
listing orders: see the README); this file describes what is added.

## API

```ts
inv.events(): readonly InventoryEvent[]                     // the whole log, oldest first
Inventory.replay(events: readonly InventoryEvent[]): Inventory
inv.snapshot(): Snapshot
Inventory.restore(snapshot: Snapshot, tail?: readonly InventoryEvent[]): Inventory
inv.history(sku: string): InventoryEvent[]
```

## Events

- An event is a plain object with a `seq` (the first event of a new inventory is 1, each next one is the previous
  plus 1), a `type` (a string saying what happened) and whatever else is needed to rebuild the state from the log
  alone. The shape beyond `seq` and `type` is yours to design.
- Every successful call that changes the inventory (`addWarehouse`, `receive`, `ship`, `reserve`, `release`,
  `fulfill`, `transfer`, `returnItems`) appends **exactly one** event. A call that throws appends nothing and changes
  nothing. Questions (`onHand`, `listStock`, ...) append nothing.
- Events are immutable: the event and everything inside it (nested objects and arrays) is frozen
  (`Object.isFrozen`).
- Events are data: `JSON.parse(JSON.stringify(event))` is deeply equal to the event. No `Map`, `Set`, `Date`,
  `undefined` values or class instances inside.
- `events()` returns a new array each time. Changing that array does not change the inventory.

## Replay

`Inventory.replay(events)` returns a new inventory in the state reached by applying the events in order. The events
are taken as they are (they were checked when they were first appended). The log must start at `seq` 1 and go up by
one: otherwise `replay` throws an `InventoryError` with the code `BAD_EVENT_LOG`.

- The new inventory's `events()` is deeply equal to the log it was given, and its events are frozen, also when the
  ones passed in were not (for instance after `JSON.parse`). `replay` leaves the objects it was given as they were:
  it does not freeze or change them.
- From then on the new inventory behaves exactly like the original would have: the same answers, the same
  refusals with the same messages, the same events appended with the same `seq`.

## Snapshot and restore

`inv.snapshot()` returns a plain object that holds the whole state at that moment, including every order and
the order of every listing, and `seq`, the `seq` of the last event so far (0 for an inventory without events). It
is data in the same sense as an event: `JSON.parse(JSON.stringify(s))` is deeply equal to `s`. It is a copy:
neither later calls on the inventory nor anything done to the snapshot (it may be frozen, or kept for hours) change
the other.

`Inventory.restore(snapshot, tail = [])` returns a new inventory in the snapshot's state, and then applies the
events of `tail` whose `seq` is greater than `snapshot.seq`, in order (events at or before the snapshot are
skipped, so a whole log may be passed as the tail). The events applied must continue exactly at `snapshot.seq + 1`
and go up by one, otherwise `restore` throws an `InventoryError` with the code `BAD_EVENT_LOG`. `restore` does
not change the snapshot or the events it was given.

- The restored inventory behaves exactly like the original at the end of the tail. It is the same as
  `Inventory.replay` of the whole log.
- Its `events()` holds only the tail events it applied and the events appended after, not those before the
  snapshot (they are not in the snapshot). Numbering continues: the next new event has `seq` one more than the last.

## History

`inv.history(sku)` returns, as a new array, the events in `events()` that changed the units of that sku (on hand or
reserved) in any warehouse, oldest first: a receive, ship, reserve, release, fulfil, transfer or return of that sku.
Creating a warehouse is in no sku's history. An event that involves several skus (a fulfilled order with several
lines) is in the history of each of them. For a restored inventory, history covers its `events()` only.
