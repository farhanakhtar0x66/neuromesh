Repair the streaming pipeline crate (`src/lib.rs`, `src/buffer.rs`, `src/pipeline.rs`, `src/sink.rs`). It does not build, and its behaviour is wrong in places:

- `src/lib.rs` has a strict lint policy (`#![deny(...)]`) that the file violates; make the crate compile with the policy kept.
- `ChunkBuffer::push` must enforce its capacity strictly: a chunk is accepted when the buffer would still hold at most `capacity` bytes afterwards (a buffer filled exactly to capacity is fine) and rejected with an `Err` when it would hold more; a rejected chunk leaves the buffer unchanged.
- `StreamingPipeline` should apply its stage to each item and push the transformed bytes into its buffer, in order; check that it does, and fix whatever prevents it.
- Implement `MemorySink::flush_buffer(&mut self, buffer: &mut ChunkBuffer) -> usize` in `src/sink.rs` (it is a `todo!()` stub): take everything out of the buffer (leaving it empty), append it as one new record, and return the number of bytes flushed. An empty buffer adds no record and returns 0.
