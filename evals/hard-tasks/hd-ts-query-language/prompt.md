# Search: support the new query language

`track list --search` and `Store.search` only know plain words today. Priya wrote up the query language we agreed on in
`docs/QUERY.md` (grammar, what every field means, the error messages), and it is the spec for this work.

Please implement it, so that:

- `Store.search(query, context)` understands the whole language and throws `QueryError` (already in `src/errors.ts`) for a bad
  query, and `track list --search <query>` uses it, with the options and the error output the document describes;
- searching for plain words keeps working exactly as it does now, so nobody's saved searches change meaning.

Keep it readable: the parser will be extended later (more fields, saved filters), so it should not be one function.
