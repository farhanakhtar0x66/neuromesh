// Recency order of keys: first = least recently used, last = most recently used.

export class LruList {
  #keys = new Map();

  /** Make `key` the most recently used (adds it if it is not there). */
  touch(key) {
    this.#keys.delete(key);
    this.#keys.set(key, true);
  }

  /** Forget `key`. */
  remove(key) {
    this.#keys.delete(key);
  }

  /** Remove and return the least recently used key, or undefined when empty. */
  shift() {
    for (const key of this.#keys.keys()) {
      this.#keys.delete(key);
      return key;
    }
    return undefined;
  }

  /** Keys from least to most recently used. */
  keys() {
    return [...this.#keys.keys()];
  }

  clear() {
    this.#keys.clear();
  }

  get size() {
    return this.#keys.size;
  }
}
