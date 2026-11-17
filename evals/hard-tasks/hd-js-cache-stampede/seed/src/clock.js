// The cache reads time only through a clock object: { now(): number } in milliseconds.

export const systemClock = { now: () => Date.now() };

/** A clock that only moves when told to. Used by the tests. */
export class ManualClock {
  #t;
  constructor(start = 0) {
    this.#t = start;
  }
  now() {
    return this.#t;
  }
  advance(ms) {
    this.#t += ms;
  }
}
