in `csv_stream.mjs` (Node ESM, 0 dependencies), export `async function* parseCsvStream(asyncChunkIterable)` that accepts an async iterable of string or Uint8Array chunks and yields `string[]` for each logical CSV record following RFC 4180:
- Handle arbitrary chunk boundaries splitting mid-field, mid-escaped-quote (`""`), or mid-CRLF (`\r` at end of chunk 1, `\n` at start of chunk 2).
- Handle quoted fields containing commas, `\n`, `\r\n`, and escaped double-quotes (`""` -> `"`).
- Ignore a single trailing newline (`\n` or `\r\n`) at EOF without yielding an extra `[""]` row.
- Throw a `SyntaxError` if a quoted field is unclosed at EOF or if an unescaped quote appears inside a field or after a closing quote before a comma/newline.
