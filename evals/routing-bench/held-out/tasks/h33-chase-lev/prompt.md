in a Rust library crate (`Cargo.toml` + `src/lib.rs`, 0 external dependencies), implement a generic bounded Chase-Lev lock-free work-stealing deque:
- `pub fn new_work_deque<T>(capacity: usize) -> (Worker<T>, Stealer<T>)` (round `capacity` up to next power of two >= 2)
- `impl<T> Worker<T>` (single producer/owner):
  - `pub fn push(&self, item: T) -> Result<(), T>` (FIFO/LIFO bottom push; returns `Err(item)` if full)
  - `pub fn pop(&self) -> Option<T>` (LIFO bottom pop)
- `#[derive(Clone)] impl<T> Stealer<T>` (`Send + Sync`, multi-consumer):
  - `pub fn steal(&self) -> Option<T>` (FIFO top steal)
Use `std::sync::atomic` (`AtomicIsize`/`AtomicUsize`, `Ordering`, `fence`) and `UnsafeCell<MaybeUninit<T>>`. Handle the last-element race between `Worker::pop` and `Stealer::steal` via `compare_exchange` so no item is ever duplicated or lost, and implement `Drop` so remaining elements in the buffer are dropped exactly once without leaking memory.
