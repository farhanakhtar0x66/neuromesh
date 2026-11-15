import { pathToFileURL } from "node:url";
const items = [];
const item = (n, ok) => items.push([n, !!ok]);
const done = () => {
  for (const [n, ok] of items) console.log((ok ? "PASS " : "FAIL ") + n);
  const p = items.filter(([, ok]) => ok).length;
  console.log(`SCORE ${p}/${items.length}`);
  process.exit(p === items.length ? 0 : 1);
};
let BuildGraph;
try { BuildGraph = (await import(pathToFileURL(process.cwd() + "/dag_scheduler.ts").href)).BuildGraph; } catch {}
item("dag_scheduler.ts exports BuildGraph", typeof BuildGraph === "function");
if (typeof BuildGraph !== "function") done();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const attempt = (fn) => { try { return !!fn(); } catch (e) { console.log("  threw", e?.message); return false; } };
const snapshot = (g, ids) => JSON.stringify({ dirty: ids.map((i) => g.markDirty(i)), path: g.criticalPath(ids) });
// a cycle is valid when it starts and ends on one id and every step is a dependency edge
const isCycle = (c, edges) => Array.isArray(c) && c.length >= 2 && c[0] === c[c.length - 1] && c.slice(0, -1).every((u, i) => (edges[u] ?? []).includes(c[i + 1]));

item("implicit dependencies are registered; markDirty is topological with id tie-breaks", attempt(() => {
  const g = new BuildGraph();
  const r = [g.upsertNode("app", ["lib", "util"], 5), g.upsertNode("lib", ["core"], 3)];
  if (!r.every((x) => x.ok === true)) return false;
  if (!same(g.markDirty("core"), ["core", "lib", "app"])) return false;
  if (!same(g.markDirty("util"), ["util", "app"])) return false;
  const h = new BuildGraph();
  for (const [id, deps] of [["a", ["root"]], ["b", ["root"]], ["c", ["a", "b"]], ["z", ["root"]], ["m", ["z"]]]) h.upsertNode(id, deps, 1);
  return same(h.markDirty("root"), ["root", "a", "b", "c", "z", "m"]) && same(h.markDirty("z"), ["z", "m"]);
}));

item("a self-loop is rejected with a cycle and the graph stays as it was", attempt(() => {
  const g = new BuildGraph();
  g.upsertNode("A", [], 10);
  g.upsertNode("B", ["A"], 20);
  const before = snapshot(g, ["A", "B"]);
  const r = g.upsertNode("A", ["A"], 10);
  return r.ok === false && isCycle(r.cycle, { A: ["A"] }) && snapshot(g, ["A", "B"]) === before;
}));

item("a 4-hop cycle A->B->C->D->A is rejected and nothing changes", attempt(() => {
  const g = new BuildGraph();
  g.upsertNode("A", ["B"], 1);
  g.upsertNode("B", ["C"], 2);
  g.upsertNode("C", ["D"], 3);
  g.upsertNode("D", [], 4);
  const before = snapshot(g, ["A", "D"]);
  const r = g.upsertNode("D", ["A"], 4);
  const edges = { A: ["B"], B: ["C"], C: ["D"], D: ["A"] };
  return r.ok === false && isCycle(r.cycle, edges) && r.cycle.length === 5 && snapshot(g, ["A", "D"]) === before && same(g.markDirty("D"), ["D", "C", "B", "A"]);
}));

item("updating a node's dependencies works; a cycle-inducing update is rejected", attempt(() => {
  const g = new BuildGraph();
  g.upsertNode("A", ["B"], 1);
  g.upsertNode("C", [], 1);
  if (!g.upsertNode("A", ["C"], 7).ok) return false;
  if (!same(g.markDirty("B"), ["B"]) || !same(g.markDirty("C"), ["C", "A"])) return false;
  const before = snapshot(g, ["A", "C"]);
  const r = g.upsertNode("C", ["A"], 1);
  return r.ok === false && isCycle(r.cycle, { C: ["A"], A: ["C"] }) && snapshot(g, ["A", "C"]) === before;
}));

item("criticalPath weighs durations: 100+100 beats four nodes of 20, with exact waves", attempt(() => {
  const g = new BuildGraph();
  g.upsertNode("s1", [], 100);
  g.upsertNode("s2", ["s1"], 100);
  g.upsertNode("q1", [], 20);
  g.upsertNode("q2", ["q1"], 20);
  g.upsertNode("q3", ["q2"], 20);
  g.upsertNode("q4", ["q3"], 20);
  g.upsertNode("app", ["s2", "q4"], 0);
  const r = g.criticalPath(["app"]);
  return r.totalMs === 200 && same(r.path, ["s1", "s2", "app"]) && same(r.parallelWaves, [["q1", "s1"], ["q2", "s2"], ["q3"], ["q4"], ["app"]]);
}));

item("several targets: only their subgraph counts", attempt(() => {
  const g = new BuildGraph();
  g.upsertNode("a", [], 5);
  g.upsertNode("b", ["a"], 5);
  g.upsertNode("x", [], 500);
  g.upsertNode("c", ["a"], 30);
  const r = g.criticalPath(["b", "c"]);
  return r.totalMs === 35 && same(r.parallelWaves, [["a"], ["b", "c"]]) && same(r.path, ["a", "c"]);
}));
done();
