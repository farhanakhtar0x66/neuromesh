# Cache rules

How `MemoCache` is meant to behave. The numbers and words here are exact; where
this file is silent, the behaviour of the code today stands.

## Vocabulary

- **entry**: a stored value for a key, with the time it was stored (`storedAt`,
  read from the injected clock). Only values are stored; an error is never an
  entry.
- **age**: `clock.now() - storedAt`.
- **fresh**: age < `ttlMs`.
- **stale**: `ttlMs` <= age < `ttlMs + staleMs`.
- **expired**: age >= `ttlMs + staleMs`. An expired entry does not exist: it is
  not counted by `size`, not listed by `keys()`, `has()` is false for it, and it
  does not occupy a slot when the cache is full. Every public operation starts by
  dropping expired entries.
- **load**: one call to the loader for one key. The loader is called with the
  key, and **synchronously** from inside the call that needs it (before `get`
  returns its promise). A loader that throws is the same as a loader that
  returns a rejected promise.
- **in-flight load** (of a key): a load that has been started and has not
  settled yet. A key has at most one in-flight load that new callers can join
  (see "Invalidation").

## get

`get(key)` returns a promise.

1. **Fresh entry**: resolves to its value. The key becomes the most recently
   used. No load.
2. **Stale entry**: resolves to the stored (old) value at once, and the key
   becomes the most recently used. If the key has no in-flight load, a
   background refresh (a load) is started; if it has one, nothing new is
   started. Nobody waits for a refresh and nobody is told when it fails.
3. **No entry** (never loaded, deleted, evicted or expired): the caller waits
   for a load. If the key has an in-flight load (a miss load, or a background
   refresh started while the entry was still stale), the caller joins it;
   otherwise a new load starts. Everyone who joined one load gets the same
   outcome: the same value, or the same rejection (the loader's error object,
   unchanged).

## What a settled load does

- **Success**: the value is stored as a new entry (`storedAt` = the clock when
  the load settled), replacing any entry the key has, and the key becomes the
  most recently used. If that makes the cache hold more than `maxEntries`
  entries, the least recently used entry (never the one just stored) is evicted
  until it fits. Eviction does not cancel anything: a load in flight for an
  evicted key still stores its value when it settles.
- **Failure**: nothing is stored. An entry the key already had (stale, in the
  refresh case) is left exactly as it was: not replaced, not made fresh. The
  next caller that needs a load starts a new one. Errors are never cached.

## set, delete, clear

- `set(key, value)` stores the value now (`storedAt` = now), replacing any
  entry, and makes the key the most recently used; eviction as above.
- `delete(key)` removes the entry; returns `true` if there was an entry (after
  dropping expired ones), otherwise `false`.
- `clear()` removes every entry.

## Invalidation

`set(key, ...)`, `delete(key)` and `clear()` **invalidate** the key's in-flight
load (`clear()` all of them): when it settles, its result is thrown away,
nothing is stored. Callers that had already joined it still get its outcome (the
value or the rejection). From the moment of the invalidation the load can no
longer be joined: the next `get` that needs a load starts a new one, even while
the invalidated one is still pending.

## Size and order

- `size` is the number of entries, `keys()` lists their keys from least to most
  recently used, `has(key)` says whether an entry exists (fresh or stale; it
  neither loads nor changes the order).
- Only these things change the order: a `get` that returns a stored value (fresh
  or stale), a store of a value (load result or `set`). Looking (`has`, `keys`,
  `size`) does not.
- `maxEntries` defaults to unlimited. `staleMs` defaults to 0 (no stale window).
- The cache uses the injected clock only. It never reads the system time and
  never sets a timer.
