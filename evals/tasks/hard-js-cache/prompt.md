Implement `createCache` in `src/cache.js`, an in-memory cache with a size limit, expiry and shared loading.

`createCache({ max, ttlMs, now = Date.now })` returns an object with:

- `get(key)`: the value, or `undefined` if the key is missing or expired. A hit makes the key the most recently used. Counts a hit or a miss.
- `set(key, value)`: stores the value with a fresh expiry time (`now() + ttlMs`) and makes the key the most recently used. If this makes the cache hold more than `max` live entries, the least recently used live entry is evicted.
- `has(key)`: true for a live entry. Does not change recency and does not count as a hit or miss.
- `delete(key)`: removes the entry; returns whether a live entry was removed.
- `size()`: the number of live (unexpired) entries.
- `getOrLoad(key, loader)`: returns a promise of the value. A live entry is returned without calling `loader` (and counts as a hit). Otherwise it counts one miss and calls `loader(key)`, stores the result as `set` would, and resolves with it. While a load for a key is in progress, further `getOrLoad` calls for that key share the same promise instead of calling `loader` again. If the loader rejects, nothing is stored, every caller of that load gets the same error, and the next call loads again.
- `stats()`: `{ hits, misses, evictions }`. Evictions count only entries removed to stay within `max`, not expired ones.

An entry is expired once `now()` is at or after its expiry time. Expired entries never count towards `max` or `size()`. `createCache` throws a `RangeError` if `max` is not a positive integer or `ttlMs` is not a positive number.
