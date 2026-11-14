// A small stand-in for React's hooks (no DOM), used to run a custom hook the way
// a component would: state, effects with dependency lists and cleanups,
// refs, memo. A `host` object drives it: render, rerender, unmount, settle.
let cur = null;

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => Object.is(x, b[i]));
}

function use(kind) {
  const c = cur;
  const i = c.cursor++;
  if (!c.hooks[i]) c.hooks[i] = { kind };
  return c.hooks[i];
}

export function useState(initial) {
  const h = use("state");
  const c = cur;
  if (!("value" in h)) {
    h.value = typeof initial === "function" ? initial() : initial;
    h.set = (v) => {
      if (c.unmounted) { c.stateAfterUnmount++; return; }
      const next = typeof v === "function" ? v(h.value) : v;
      if (!Object.is(next, h.value)) { h.value = next; c.dirty = true; }
    };
  }
  return [h.value, h.set];
}

export function useReducer(reducer, init, initFn) {
  const [s, set] = useState(() => (initFn ? initFn(init) : init));
  const h = use("reducer");
  h.reducer = reducer;
  h.dispatch ??= (a) => set((prev) => h.reducer(prev, a));
  return [s, h.dispatch];
}

export function useRef(initial) {
  const h = use("ref");
  h.ref ??= { current: initial };
  return h.ref;
}

export function useMemo(fn, deps) {
  const h = use("memo");
  if (!h.deps || !sameDeps(h.deps, deps)) { h.value = fn(); h.deps = deps; }
  return h.value;
}

export function useCallback(fn, deps) {
  return useMemo(() => fn, deps);
}

function effectHook(kind) {
  return (fn, deps) => {
    const h = use(kind);
    const c = cur;
    if (!h.deps || !deps || !sameDeps(h.deps, deps)) {
      h.deps = deps;
      c.pending.push(h);
      h.fn = fn;
    }
  };
}
export const useEffect = effectHook("effect");
export const useLayoutEffect = effectHook("effect");
export const useInsertionEffect = effectHook("effect");
export function useDebugValue() {}
export function useId() { return use("id").id ??= `:r${Math.random().toString(36).slice(2)}:`; }
export function useTransition() { return [false, (f) => f()]; }
export function useDeferredValue(v) { return v; }
export function useSyncExternalStore(subscribe, getSnapshot) {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return getSnapshot();
}

export const startTransition = (f) => f();
export default { useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useInsertionEffect, useDebugValue, useId, useTransition, useDeferredValue, useSyncExternalStore, startTransition };

/** Driver: mounts `fn(props)` as a component. */
export function mount(fn, props) {
  const c = { hooks: [], cursor: 0, pending: [], dirty: false, unmounted: false, stateAfterUnmount: 0, result: undefined, props };
  const host = {
    get result() { return c.result; },
    get stateAfterUnmount() { return c.stateAfterUnmount; },
    render(nextProps) {
      if (c.unmounted) return;
      if (nextProps !== undefined) c.props = nextProps;
      for (let n = 0; n < 50; n++) {
        cur = c; c.cursor = 0; c.pending = []; c.dirty = false;
        try { c.result = fn(c.props); } finally { cur = null; }
        const effects = c.pending;
        for (const h of effects) { if (h.cleanup) { try { h.cleanup(); } catch (e) {} h.cleanup = undefined; } }
        for (const h of effects) { const r = h.fn(); h.cleanup = typeof r === "function" ? r : undefined; }
        if (!c.dirty) break;
      }
    },
    async settle() {
      for (let n = 0; n < 20; n++) {
        await Promise.resolve();
        await new Promise((r) => setImmediate(r));
        if (c.dirty) host.render();
      }
    },
    unmount() {
      if (c.unmounted) return;
      for (const h of c.hooks) if (h.kind === "effect" && h.cleanup) { try { h.cleanup(); } catch (e) {} h.cleanup = undefined; }
      c.unmounted = true;
    },
  };
  host.render();
  return host;
}
