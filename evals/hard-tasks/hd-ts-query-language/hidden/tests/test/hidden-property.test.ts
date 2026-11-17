// Random boolean expressions written in every legal spelling must select what the expression means: precedence NOT > AND > OR,
// implicit AND, "-" for NOT, parentheses with and without spaces. The expected result is computed from the expression tree,
// not by parsing the text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ctx, has, store } from "./support/check.ts";
import { ids, issues } from "./support/fixture.ts";
import type { Issue } from "../src/index.ts";

type Pred = (i: Issue) => boolean;

const ATOMS: [string, Pred][] = [
  ["login", has("login")],
  ["dark", has("dark")],
  ["crash", has("crash")],
  ['"dark mode"', has("dark mode")],
  ["status:open", (i) => i.status === "open"],
  ["status:closed", (i) => i.status === "closed"],
  ["priority:<=2", (i) => i.priority <= 2],
  ["priority:3..4", (i) => i.priority >= 3 && i.priority <= 4],
  ["label:bug", (i) => i.labels.includes("bug")],
  ["label:docs", (i) => i.labels.includes("docs")],
  ["assignee:ann", (i) => i.assignee === "ann"],
  ["assignee:none", (i) => i.assignee === null],
  ["estimate:>=3", (i) => i.estimate !== null && i.estimate >= 3],
  ["created:>=2024-05-01", (i) => i.created >= "2024-05-01"],
  ["due:<2024-05-10", (i) => i.due !== null && i.due < "2024-05-10"],
  ["is:overdue", (i) => i.due !== null && i.due < "2024-05-10" && i.status !== "closed"],
  ["reporter:carol", (i) => i.reporter === "carol"],
  ["title:crash", (i) => i.title.toLowerCase().includes("crash")],
  ["body:cache", (i) => i.body.toLowerCase().includes("cache")],
  ["is:open", (i) => i.status !== "closed"],
  ["created:>=@today-7d", (i) => i.created >= "2024-05-03"],
];

type Node =
  | { t: "atom"; text: string; p: Pred }
  | { t: "not"; x: Node; minus: boolean }
  | { t: "and"; l: Node; r: Node; explicit: boolean }
  | { t: "or"; l: Node; r: Node };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gen(rng: () => number, depth: number): Node {
  const r = rng();
  if (depth === 0 || r < 0.25) {
    const [text, p] = ATOMS[Math.floor(rng() * ATOMS.length)]!;
    return { t: "atom", text, p };
  }
  if (r < 0.4) return { t: "not", x: gen(rng, depth - 1), minus: rng() < 0.5 };
  if (r < 0.7) return { t: "and", l: gen(rng, depth - 1), r: gen(rng, depth - 1), explicit: rng() < 0.4 };
  return { t: "or", l: gen(rng, depth - 1), r: gen(rng, depth - 1) };
}

const evalNode = (n: Node, i: Issue): boolean => (n.t === "atom" ? n.p(i) : n.t === "not" ? !evalNode(n.x, i) : n.t === "and" ? evalNode(n.l, i) && evalNode(n.r, i) : evalNode(n.l, i) || evalNode(n.r, i));

const PREC = { or: 1, and: 2, not: 3, atom: 4 };

function render(n: Node, parent: number, rng: () => number): string {
  const sp = (): string => (rng() < 0.7 ? " " : rng() < 0.5 ? "  " : "\t");
  let s: string;
  if (n.t === "atom") s = n.text;
  else if (n.t === "not") s = (n.minus ? "-" : `NOT${sp()}`) + render(n.x, PREC.not, rng);
  else if (n.t === "and") {
    const l = render(n.l, PREC.and, rng);
    const r = render(n.r, PREC.and, rng);
    // No space is needed next to a parenthesis.
    const tight = (l.endsWith(")") || r.startsWith("(")) && rng() < 0.4;
    s = n.explicit ? `${l}${sp()}AND${sp()}${r}` : tight ? `${l}${r}` : `${l}${sp()}${r}`;
  } else s = `${render(n.l, PREC.or, rng)}${sp()}OR${sp()}${render(n.r, PREC.or, rng)}`;
  const need = PREC[n.t] < parent;
  return need || (n.t !== "atom" && rng() < 0.12) ? `(${s})` : s;
}

for (let batch = 0; batch < 4; batch++) {
  test(`random boolean expressions, batch ${batch + 1} of 4`, () => {
    const rng = mulberry32(4242 + batch);
    for (let k = 0; k < 75; k++) {
      const tree = gen(rng, 1 + Math.floor(rng() * 4));
      const text = render(tree, 0, rng);
      const want = ids(issues.filter((i) => evalNode(tree, i)));
      assert.deepEqual(ids(store.search(text, ctx)), want, `query ${JSON.stringify(text)}`);
    }
  });
}
