# Why requirement (3) cannot hold for two concurrent upgraders

An upgrade turns a held read lock into the exclusive write lock. It may only complete when no
other thread holds a read lock. Take two threads, A and B, that both hold a read lock and both
call `upgrade()` without releasing it.

- A cannot become the writer until B's read lock is gone, so A waits for B.
- B cannot become the writer until A's read lock is gone, so B waits for A.

Each waits for the other to release something it has promised not to release. That is a
deadlock, and it is not a flaw of one implementation: any lock that keeps the read lock while it
waits for an upgrade, and lets two threads do so, has this cycle. The only ways out are to make
one of them give up its read lock (then the upgrade is no longer "in place": another writer could
slip in and the data it read may have changed) or to refuse one of them. Requirement (3) as
worded, "both upgrade in place without releasing and without an error", has no solution.

So `upgrade()` keeps one rule: the first upgrader is allowed to wait for the other readers to
drain, and while it waits new readers are held back (requirement 1). A second `upgrade()` call
made while one is already pending raises `RuntimeError("Concurrent upgrade deadlock")` at once. The
caller that gets the error should release its read lock; the first upgrader then proceeds.
