// Run the answer's useSearch hook against a scripted slow/fast API and a fake clock.
//   node run_hook.mjs <workspace copy> <path of the react stand-in inside it>
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [work, reactPath] = process.argv.slice(2);
const out = { error: null, results: {} };
const emit = () => console.log("RESULT " + JSON.stringify(out));

// ---- fake clock -----------------------------------------------------------
const realSetTimeout = globalThis.setTimeout, realClear = globalThis.clearTimeout;
let now = 0, nextId = 1;
const timers = new Map();
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, +ms || 0), fn: () => fn(...a) }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
globalThis.setInterval = (fn, ms = 0, ...a) => { const id = nextId++; const tick = () => { timers.set(id, { at: now + Math.max(1, +ms || 1), fn: () => { tick(); fn(...a); } }); }; tick(); return id; };
globalThis.clearInterval = globalThis.clearTimeout;
async function advance(ms, host) {
  const end = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
    if (!next) break;
    timers.delete(next.id);
    now = Math.max(now, next.t.at);
    next.t.fn();
    await host.settle();
  }
  now = end;
  await host.settle();
}

// ---- fake API -------------------------------------------------------------
let calls = [];
const marker = (q) => `RES<${q}>`;
const payload = (q) => { const a = [{ id: 1, title: marker(q), name: marker(q) }]; a.results = a; a.items = a; a.data = a; return a; };
function queryOf(url) {
  const s = String(url);
  try { const u = new URL(s, "http://x"); for (const k of ["q", "query", "search", "term", "s", "keyword"]) if (u.searchParams.has(k)) return u.searchParams.get(k); } catch {}
  return decodeURIComponent(s.split(/[=/]/).pop());
}
function fakeFetch(url, init = {}) {
  const signal = init && init.signal;
  const call = { query: queryOf(url), signal, settled: false };
  calls.push(call);
  return new Promise((resolve, reject) => {
    call.respond = () => { if (call.settled) return; call.settled = true; resolve({ ok: true, status: 200, json: async () => payload(call.query), text: async () => JSON.stringify(payload(call.query)) }); };
    const abort = () => { if (call.settled) return; call.settled = true; const e = new Error("The operation was aborted."); e.name = "AbortError"; e.code = 20; reject(e); };
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
  });
}
globalThis.fetch = fakeFetch;
const asSignal = (s) => { if (s && typeof s === "object") { try { s.signal ??= s; } catch {} } return s; };
const adapterA = (url, init) => fakeFetch(url, init);                         // fetch-like
const adapterB = async (q, second) => {                                        // fetcher(query, signal | {signal})
  const signal = second && second.signal ? second.signal : second;
  const res = await fakeFetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: asSignal(signal) });
  return res.json();
};
const options = () => {
  const o = { debounce: 300, delay: 300 };
  for (const k of ["fetchFn", "fetch", "request", "fetchImpl"]) o[k] = adapterA;
  for (const k of ["fetcher", "fetchResults", "search", "searchFn", "searchFunction", "fetchFunction", "queryFn", "getResults", "loader", "api", "searchApi", "onSearch", "fetchData", "fetchSearchResults"]) o[k] = (q, s) => adapterB(q, s);
  return o;
};

// ---- load the hook --------------------------------------------------------
let React, useSearch;
try {
  React = await import(pathToFileURL(reactPath).href);
  const mod = await import(pathToFileURL(join(work, "useSearch.js")).href);
  useSearch = mod.useSearch ?? mod.default ?? Object.values(mod).find((v) => typeof v === "function");
  if (typeof useSearch !== "function") throw new Error("useSearch.js exports no function");
} catch (e) {
  out.error = String(e && e.stack || e).split("\n").slice(0, 3).join(" | ").slice(0, 300);
  emit(); process.exit(0);
}

const shows = (host, q) => JSON.stringify(host.result) ?.includes(marker(q)) ?? false;
const text = (host) => { try { return JSON.stringify(host.result) ?? ""; } catch { return ""; } };
// the plainest call first: hooks that use the global fetch need nothing more
const callers = [
  (q) => useSearch(q),
  (q) => useSearch(q, options()),
  (q) => useSearch({ query: q, ...options() }),
];

function fresh(which) {
  calls = []; timers.clear(); now = 0;
  return React.mount((q) => callers[which](q), "react");
}
async function pickCaller() {
  for (let i = 0; i < callers.length; i++) {
    try {
      const host = fresh(i);
      await advance(3000, host);
      const n = calls.length;
      host.unmount();
      if (n > 0) return i;
    } catch (e) { out.error ??= String(e && e.message || e).slice(0, 200); }
  }
  return 0;
}

const which = await pickCaller();
const pending = () => calls.filter((c) => !c.settled && !(c.signal && c.signal.aborted)).length;
const r = out.results;
async function scenario(name, fn) {
  try { await fn(); } catch (e) { r[name] = false; out.error ??= `${name}: ${String(e && e.message || e).slice(0, 160)}`; }
}

await scenario("race", async () => {
  const host = fresh(which);
  await advance(3000, host);                     // 'react' goes out, slow
  const slow = calls.find((c) => c.query === "react");
  host.render("re"); await host.settle();
  await advance(3000, host);                     // 're' goes out
  const fast = calls.find((c) => c.query === "re");
  fast?.respond(); await host.settle();
  slow?.respond(); await host.settle();          // the old slow answer arrives last
  r.newest_shown = shows(host, "re");
  r.stale_dropped = !shows(host, "react");
  r.no_abort_error_shown = !/abort/i.test(text(host));
  r.signal_given = Boolean(slow && slow.signal && typeof slow.signal.addEventListener === "function");
  r.earlier_aborted = Boolean(slow && slow.signal && slow.signal.aborted);
  host.unmount();
});
await scenario("unmount_inflight", async () => {
  const host = fresh(which);
  await advance(3000, host);
  const c = calls.find((x) => x.query === "react");
  host.unmount();
  r.unmount_aborts_inflight = Boolean(c && c.signal && c.signal.aborted);
  r.no_timers_after_unmount = timers.size === 0;
  c?.respond(); await advance(10, { settle: async () => { await Promise.resolve(); } });
  r.no_state_after_unmount = host.stateAfterUnmount === 0;
});
await scenario("unmount_pending_timer", async () => {
  const host = fresh(which);
  await host.settle();                           // the debounce timer is waiting
  host.unmount();
  await advance(5000, { settle: async () => { await Promise.resolve(); } });
  r.unmount_cancels_debounce = calls.length === 0;
});
await scenario("burst", async () => {
  calls = []; timers.clear(); now = 0;
  const h = React.mount((q) => callers[which](q), "r");
  for (const q of ["re", "rea", "reac", "react"]) { await advance(50, h); h.render(q); await h.settle(); }
  await advance(3000, h);
  r.burst_one_request = calls.length === 1 && calls[0].query === "react";
  r.same_query_no_refetch = (() => { const before = calls.length; for (let i = 0; i < 30; i++) h.render("react"); return calls.length === before; })();
  await advance(3000, h);
  r.same_query_no_refetch = r.same_query_no_refetch && calls.length === 1;
  h.unmount();
});
await scenario("many_changes", async () => {
  calls = []; timers.clear(); now = 0;
  const host = React.mount((q) => callers[which](q), "a0");
  for (let i = 1; i <= 400; i++) { await advance(i % 5 === 0 ? 400 : 20, host); host.render("a" + i); await host.settle(); }
  host.unmount();
  r.nothing_left_running = timers.size === 0 && pending() === 0;
});
r.runs = which >= 0 && calls.length >= 0;
emit();
setImmediate(() => process.exit(0));
