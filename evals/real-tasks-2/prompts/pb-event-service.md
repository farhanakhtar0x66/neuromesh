The event service crate does not build and its behaviour is unfinished. Fix `src/event.rs` and complete the filter and the dispatch pipeline.

- `src/lib.rs` carries a strict lint policy (`#![deny(...)]`) that the file violates; make the crate compile with the policy kept.
- `Event::parse_csv_line` reads `id,Type,severity,payload` (Type is `Metric`, `Alert` or `Audit`). The payload is the rest of the line after the third comma, commas included; at the moment it always comes back empty.
- `EventFilter::evaluate_predicate` (`src/filter.rs`, currently a stub that returns false) is true for an event whose severity is at least `min_severity` and whose type is one of `allowed_types`.
- `EventDispatcher::dispatch` (`src/dispatcher.rs`) returns false, calling no handler, when its filter rejects the event or when no handler is registered. Otherwise it calls every registered handler's `handle` with the event, in registration order, counts the event in `dispatched_count()` once, and returns true. An event with no filter set is always allowed.
