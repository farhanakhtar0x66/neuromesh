The event pipeline has a regression across two files.

In `src/parser.rs`, `parse_event` reads lines of the form `id|payload|checksum` and checks that the checksum equals `calculate_checksum(payload)`, but it takes the numeric checksum from the wrong field, so valid lines are rejected. In `src/sink.rs`, `EventSink::push` has an off-by-one in its capacity check: a sink created with capacity N must accept N events and reject the (N+1)th, and it rejects events before it is full. Duplicate ids are still rejected. Fix both files.
