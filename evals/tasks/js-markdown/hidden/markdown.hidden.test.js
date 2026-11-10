import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../src/markdown.js";

test("hidden: blocks", () => {
  assert.equal(render("# Title\n\nSome text\nmore"), "<h1>Title</h1>\n<p>Some text more</p>");
  assert.equal(render("## Two\n\n### Three"), "<h2>Two</h2>\n<h3>Three</h3>");
  assert.equal(render("- a\n- b\n- c"), "<ul><li>a</li><li>b</li><li>c</li></ul>");
  assert.equal(render("Intro\n\n- x\n- y\n\nEnd"), "<p>Intro</p>\n<ul><li>x</li><li>y</li></ul>\n<p>End</p>");
});

test("hidden: inline", () => {
  assert.equal(render("a **b** *c* d"), "<p>a <strong>b</strong> <em>c</em> d</p>");
  assert.equal(render("see [docs](https://x.dev/a?b=1)"), '<p>see <a href="https://x.dev/a?b=1">docs</a></p>');
  assert.equal(render("# Hello **world**"), "<h1>Hello <strong>world</strong></h1>");
  assert.equal(render("- *one*\n- [two](/t)"), '<ul><li><em>one</em></li><li><a href="/t">two</a></li></ul>');
});

test("hidden: escaping", () => {
  assert.equal(render("1 < 2 & 3 > 2"), "<p>1 &lt; 2 &amp; 3 &gt; 2</p>");
  assert.equal(render("**<b>**"), "<p><strong>&lt;b&gt;</strong></p>");
});
