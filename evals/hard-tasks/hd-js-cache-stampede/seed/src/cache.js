import { LruList } from "./lru.js";
import { systemClock } from "./clock.js";

/**
 * A memo cache in front of an async loader.
 *
 *   const cache = new MemoCache({ loader: (key) => fetchPrice(key), ttlMs: 60_000, staleMs: 30_000, maxEntries: 500 });
 *   const price = await cache.get("sku-1");
 *
 * How it is meant to behave is written down in docs/CACHE_RULES.md.
 */
export class MemoCache {
  #loader;
  #ttlMs;
  #staleMs;
  #maxEntries;
  #clock;
  #entries = new Map(); // key -> { value, error, storedAt }
  #refreshing = new Set(); // keys with a background refresh running
  #lru = new LruList();
  #size = 0;

  constructor({ loader, ttlMs, staleMs = 0, maxEntries = Infinity, clock = systemClock } = {}) {
    if (typeof loader !== "function") throw new TypeError("loader must be a function");
    if (!(ttlMs > 0)) throw new RangeError("ttlMs must be positive");
    if (!(staleMs >= 0)) throw new RangeError("staleMs must not be negative");
    if (!(maxEntries >= 1)) throw new RangeError("maxEntries must be at least 1");
    this.#loader = loader;
    this.#ttlMs = ttlMs;
    this.#staleMs = staleMs;
    this.#maxEntries = maxEntries;
    this.#clock = clock;
  }

  async get(key) {
    this.#purge();
    const entry = this.#entries.get(key);
    if (entry) {
      const age = this.#clock.now() - entry.storedAt;
      if (age < this.#ttlMs) {
        this.#lru.touch(key);
        return this.#unwrap(entry);
      }
      // Stale: answer from the old value and refresh behind the caller's back.
      this.#refresh(key);
      return this.#unwrap(entry);
    }
    return this.#load(key);
  }

  set(key, value) {
    this.#purge();
    this.#store(key, { value, storedAt: this.#clock.now() });
  }

  delete(key) {
    this.#purge();
    if (!this.#entries.has(key)) return false;
    this.#entries.delete(key);
    this.#lru.remove(key);
    this.#size--;
    return true;
  }

  clear() {
    this.#entries.clear();
    this.#lru.clear();
    this.#size = 0;
  }

  has(key) {
    this.#purge();
    return this.#entries.has(key);
  }

  keys() {
    this.#purge();
    return this.#lru.keys();
  }

  get size() {
    this.#purge();
    return this.#size;
  }

  // ---- internals ----

  async #load(key) {
    let entry;
    try {
      const value = await this.#loader(key);
      entry = { value, storedAt: this.#clock.now() };
    } catch (error) {
      entry = { error, storedAt: this.#clock.now() };
    }
    this.#store(key, entry);
    return this.#unwrap(entry);
  }

  #refresh(key) {
    if (this.#refreshing.has(key)) return;
    this.#refreshing.add(key);
    let pending;
    try {
      pending = Promise.resolve(this.#loader(key));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending
      .then((value) => {
        this.#store(key, { value, storedAt: this.#clock.now() });
      })
      .catch(() => {
        // A failed refresh is not reported to anyone; the stale entry stays.
      })
      .finally(() => {
        this.#refreshing.delete(key);
      });
  }

  #unwrap(entry) {
    if (entry.error !== undefined) throw entry.error;
    return entry.value;
  }

  #store(key, entry) {
    if (this.#entries.size >= this.#maxEntries && !this.#entries.has(key)) {
      const oldest = this.#lru.shift();
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
        this.#size--;
      }
    }
    this.#entries.set(key, entry);
    this.#lru.touch(key);
    this.#size++;
  }

  #purge() {
    const limit = this.#ttlMs + this.#staleMs;
    const now = this.#clock.now();
    for (const [key, entry] of this.#entries) {
      if (now - entry.storedAt >= limit) {
        this.#entries.delete(key);
        this.#lru.remove(key);
        this.#size--;
      }
    }
  }
}
