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
  #entries = new Map(); // key -> { value, storedAt }
  #slots = new Map(); // key -> the in-flight load callers can still join: { promise }
  #lru = new LruList();

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
      this.#lru.touch(key);
      if (this.#clock.now() - entry.storedAt >= this.#ttlMs && !this.#slots.has(key)) this.#start(key, true);
      return entry.value;
    }
    const slot = this.#slots.get(key) ?? this.#start(key, false);
    return slot.promise;
  }

  set(key, value) {
    this.#purge();
    this.#slots.delete(key); // a load that settles later must not overwrite this
    this.#store(key, value);
  }

  delete(key) {
    this.#purge();
    this.#slots.delete(key);
    if (!this.#entries.delete(key)) return false;
    this.#lru.remove(key);
    return true;
  }

  clear() {
    this.#slots.clear();
    this.#entries.clear();
    this.#lru.clear();
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
    return this.#entries.size;
  }

  // ---- internals ----

  /** Call the loader now and register the load so that later callers can join it until it settles or is invalidated. */
  #start(key, background) {
    let pending;
    try {
      pending = Promise.resolve(this.#loader(key));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const slot = { promise: undefined };
    slot.promise = pending.then(
      (value) => {
        if (this.#slots.get(key) === slot) {
          this.#slots.delete(key);
          this.#store(key, value);
        }
        return value;
      },
      (error) => {
        if (this.#slots.get(key) === slot) this.#slots.delete(key);
        throw error;
      },
    );
    if (background) slot.promise.catch(() => {}); // nobody waits for a refresh; its failure is not reported
    this.#slots.set(key, slot);
    return slot;
  }

  #store(key, value) {
    this.#entries.set(key, { value, storedAt: this.#clock.now() });
    this.#lru.touch(key);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#lru.shift();
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  #purge() {
    const limit = this.#ttlMs + this.#staleMs;
    const now = this.#clock.now();
    for (const [key, entry] of this.#entries) {
      if (now - entry.storedAt >= limit) {
        this.#entries.delete(key);
        this.#lru.remove(key);
      }
    }
  }
}
