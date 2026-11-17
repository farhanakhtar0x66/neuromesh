import { MemoCache } from "./cache.js";

/**
 * The pricing API client the dashboard uses. `transport(path)` is any async function that returns the parsed
 * JSON body (in production a thin wrapper over fetch).
 */
export class PricingClient {
  #cache;
  #transport;
  #calls = 0;

  constructor(transport, { ttlMs = 60_000, staleMs = 30_000, maxEntries = 500, clock } = {}) {
    this.#transport = transport;
    this.#cache = new MemoCache({
      loader: (sku) => this.#fetch(sku),
      ttlMs,
      staleMs,
      maxEntries,
      ...(clock ? { clock } : {}),
    });
  }

  async #fetch(sku) {
    this.#calls++;
    const body = await this.#transport(`/prices/${encodeURIComponent(sku)}`);
    if (typeof body?.cents !== "number") throw new Error(`bad price response for ${sku}`);
    return { sku, cents: body.cents, currency: body.currency ?? "USD" };
  }

  price(sku) {
    return this.#cache.get(sku);
  }

  /** Call after a price change on our side: the next read goes to the API. */
  invalidate(sku) {
    return this.#cache.delete(sku);
  }

  invalidateAll() {
    this.#cache.clear();
  }

  /** Numbers for the metrics page. */
  stats() {
    return { upstreamCalls: this.#calls, cached: this.#cache.size };
  }
}
