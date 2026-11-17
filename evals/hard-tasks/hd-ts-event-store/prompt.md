# Keep a log of every stock change

Support keeps asking for an audit trail ("who took the last 20 bolts out of north, and when?"), and operations wants
to rebuild the service's state after a crash from something smaller than a full database dump. Today `Inventory`
(`src/inventory.ts`) changes its maps in place, so there is nothing to audit and nothing to rebuild from.

Please change it so that the inventory's state is derived from an append-only log of events: every change is an
event added to the log, and the maps become what you get by applying the events. On top of that add the five calls
the audit tool needs (`events()`, `Inventory.replay`, `snapshot()`, `Inventory.restore`, `history(sku)`).
`docs/EVENTS.md` has the contract: what an event is, what replaying a log or restoring a snapshot must give back, and
what `history` covers.

Nothing that works today may change for anyone calling the library: same results, same error codes and messages,
same listing orders (the README has a section on order). The tests in `test/` pin the current behaviour down and must
keep passing.
