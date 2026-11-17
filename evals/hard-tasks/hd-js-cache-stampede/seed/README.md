# memo-cache

A small memo cache for API clients, used by the dashboard's pricing client.

- time-to-live (`ttlMs`) and a stale-while-revalidate window (`staleMs`)
- one load per key at a time: callers that arrive while a load is running share it
- a size bound (`maxEntries`) that evicts the least recently used key
- an injectable clock, so tests never wait

```js
import { MemoCache } from "./src/index.js";

const cache = new MemoCache({
  loader: async (key) => (await fetch(`/prices/${key}`)).json(),
  ttlMs: 60_000,
  staleMs: 30_000,
  maxEntries: 500,
});

const price = await cache.get("sku-1"); // loads, then serves from the cache
cache.set("sku-2", { cents: 1999 });    // store a value directly
cache.delete("sku-1");                  // forget one key
cache.clear();                          // forget everything
cache.size;                             // number of entries
cache.keys();                           // keys, least recently used first
cache.has("sku-2");                     // is there an entry (does not load)
```

The rules (what counts as fresh or stale, what a failed load does, what `delete`
does to a load that is still running, ...) are in [docs/CACHE_RULES.md](docs/CACHE_RULES.md).

## Layout

- `src/cache.js`: `MemoCache`
- `src/lru.js`: the recency list it uses
- `src/clock.js`: `systemClock` and `ManualClock`
- `src/client.js`: `PricingClient`, the dashboard's client
- `testing/`: helpers for the tests; `test/`: run with `npm test` (`node --test`)
