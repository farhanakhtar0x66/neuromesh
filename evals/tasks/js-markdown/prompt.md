Extend the tiny Markdown renderer in `src/markdown.js`. Today it only turns blank-line separated blocks into paragraphs. Add:

- Headings: a line starting with `#`, `##` or `###` and a space becomes `<h1>`, `<h2>` or `<h3>`.
- Lists: consecutive lines starting with `- ` become one `<ul>` with an `<li>` per line.
- Inline formatting inside paragraphs, headings and list items: `**bold**` → `<strong>bold</strong>`, `*italic*` → `<em>italic</em>`, `[text](url)` → `<a href="url">text</a>`.
- Escaping: `&`, `<` and `>` in the text become `&amp;`, `&lt;` and `&gt;` (before inline formatting is applied).

Blocks in the output are joined with a single newline, as now. Lines of a paragraph are joined with a space, as now. Add tests.
