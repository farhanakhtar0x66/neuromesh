# The pricing cache misbehaves under load

We put `MemoCache` (`src/cache.js`) in front of the pricing API a few weeks ago. With real traffic on the dashboard
we now see three things:

- When a popular entry expires, the upstream gets dozens of identical requests for the same key at the same moment,
  although the cache is supposed to collapse concurrent requests into one.
- When the upstream has a bad minute, the errors keep coming back from the cache for the whole TTL, long after the
  upstream has recovered.
- Keys we `delete()` after a price change reappear a moment later with the old price.

On the metrics page `cache.size` has also been seen above `maxEntries`, and a few of the hottest keys, the ones
that are read all the time, get evicted before cold ones.

`docs/CACHE_RULES.md` describes how the cache is meant to behave. Please make it behave that way. The public API
(`get`, `set`, `delete`, `clear`, `has`, `keys`, `size` and the constructor options) must stay as it is, and the
tests in `test/` should keep passing.
