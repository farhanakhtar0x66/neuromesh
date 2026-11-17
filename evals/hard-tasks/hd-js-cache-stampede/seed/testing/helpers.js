// Test helpers: a loader driven by hand, and a way to let pending promise callbacks run.

export function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A loader whose calls stay pending until the test settles them. */
export function manualLoader() {
  const calls = [];
  const loader = (key) =>
    new Promise((resolve, reject) => {
      calls.push({ key, resolve, reject });
    });
  return { loader, calls };
}

/** A loader that answers at once with `value-<key>-<n>`. */
export function countingLoader() {
  const seen = [];
  const loader = async (key) => {
    seen.push(key);
    return `value-${key}-${seen.length}`;
  };
  return { loader, seen };
}
