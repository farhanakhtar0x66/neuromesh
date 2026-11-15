in `rwlock.py` (pure Python `threading.Lock` and `threading.Condition` only), implement `class TaskFairRWLock` with `acquire_read()`, `release_read()`, `acquire_write()`, `release_write()`, and `upgrade()` that guarantees all three simultaneously:
(1) strict writer preference (no new reader thread may acquire a read lock while a writer or upgrader is waiting),
(2) recursive re-entrant read acquisition by a thread that already holds a read lock even when a writer is waiting (without deadlocking), and
(3) in-place `upgrade()` from a held read lock to an exclusive write lock where if two reader threads call `upgrade()` concurrently, how can both upgrade in-place without either releasing its read lock or raising a deadlock error? Explain the exact theoretical impossibility of requirement (3) for the second concurrent upgrader, and implement `upgrade()` so the first upgrader waits for other readers to drain while a second concurrent `upgrade()` call immediately raises `RuntimeError("Concurrent upgrade deadlock")`.

Write the code to rwlock.py and the explanation to ANSWER.md.
