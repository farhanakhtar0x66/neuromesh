import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPacket, symbolBody, symbolsOf, terms } from "../src/context/packet.ts";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nm-ctx-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

const CART = `export class Cart {\n  constructor() { this.items = []; }\n  addItem(item) {\n    this.items.push(item);\n  }\n}\n\nexport function cartTotal(cart, coupon) {\n  let total = 0;\n  for (const i of cart.items) { total += i.price; }\n  return coupon ? total * 0.9 : total;\n}\n`;

test("definitions are found in JavaScript, Python and Rust", () => {
  assert.deepEqual(symbolsOf("a.js", CART).map((s) => s.name), ["Cart", "addItem", "cartTotal"]);
  assert.deepEqual(symbolsOf("a.py", "class Store:\n    def get(self, k):\n        return 1\n\nasync def main():\n    pass\n").map((s) => s.name), ["Store", "get", "main"]);
  assert.deepEqual(symbolsOf("a.rs", "pub struct Line;\nimpl Line {\n    pub fn total(&self) -> u32 { 0 }\n}\nfn helper() {}\n").map((s) => s.name), ["Line", "Line", "total", "helper"]);
  assert.ok(terms("Fix the cartTotal coupon bug in src/cart.js").includes("cart"));
});

test("the packet ranks the files the request is about first and stays within its size", () => {
  const dir = repo({
    "src/cart.js": CART,
    "src/users.js": "export function findUser(id) {\n  return null;\n}\n",
    "test/cart.test.js": "import { cartTotal } from '../src/cart.js';\n",
    "README.md": "# Shop\n",
  });
  const packet = buildPacket(dir, "The coupon total in cartTotal is wrong")!;
  assert.ok(packet.indexOf("src/cart.js") < packet.indexOf("src/users.js"), packet);
  assert.match(packet, /8: export function cartTotal\(cart, coupon\)/);
  assert.match(packet, /Layout \(4 files/);
  assert.ok(buildPacket(dir, "x", { maxChars: 300 })!.length <= 400);
  assert.equal(buildPacket(repo({ ".gitignore": "node_modules\n" }), "build an app"), undefined, "nothing to map in an empty project");
});

test("a symbol's body is cut at the end of its block", () => {
  const body = symbolBody("cart.js", CART, "cartTotal")!;
  assert.equal(body.start, 8);
  assert.equal(body.lines.at(-1), "}");
  assert.equal(body.lines.length, 5);
  const py = symbolBody("s.py", "class Store:\n    def get(self, k):\n        return 1\n\n    def put(self):\n        pass\n", "get")!;
  assert.deepEqual(py.lines.map((l) => l.trim()).filter(Boolean), ["def get(self, k):", "return 1"]);
});

test("the nm tool shows a definition and finds matches from the shell", () => {
  const dir = repo({ "src/cart.js": CART });
  const tool = fileURLToPath(new URL("../src/tools/nm.ts", import.meta.url));
  const show = spawnSync(process.execPath, [tool, "show", "src/cart.js", "cartTotal"], { cwd: dir, encoding: "utf8" });
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^\s+8  export function cartTotal/);
  const find = spawnSync(process.execPath, [tool, "find", "coupon"], { cwd: dir, encoding: "utf8" });
  assert.match(find.stdout, /src\/cart\.js\n  8: export function cartTotal\(cart, coupon\)/);
  const map = spawnSync(process.execPath, [tool, "map", "cart"], { cwd: dir, encoding: "utf8" });
  assert.match(map.stdout, /src\/cart\.js/);
});
