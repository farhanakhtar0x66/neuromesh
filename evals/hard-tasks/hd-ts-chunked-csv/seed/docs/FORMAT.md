# Input format

What `readCsv`, `parseCsv` and the `import` command accept, and what they return. The reader gives the same
result however the input is cut into chunks; a file read in one piece and the same file read 7 bytes at a time
are the same input.

## Characters

- The input is UTF-8. A byte sequence that is not valid UTF-8 (including one cut off by the end of the input)
  becomes U+FFFD, exactly as when the whole input is decoded at once.
- A UTF-8 byte order mark (EF BB BF) at the very start of the input is dropped. A U+FEFF anywhere else is data.
- A chunk handed over as a string is already text; only the byte-order-mark rule applies to it.
- Empty chunks are allowed and ignored.

## Line breaks

A line break is CRLF, LF or a lone CR. CRLF is one line break, not two. A line break inside a quoted field is data
and is kept exactly as it was written (a quoted CRLF stays CRLF). A line break that ends a record is never part
of a field.

A line break at the very end of the input does not start another record. The last record needs no line break.
`""` (empty input) has no records, `"\n"` has one record `[""]`.

## Fields and records

- Fields are separated by the delimiter (default `,`). A record is the fields of one line.
- A field that does not start with the quote character runs to the next delimiter or line break. A quote
  character inside such a field is ordinary data.
- A field that starts with the quote character is quoted. Inside it, two quote characters in a row are one
  quote character, a single quote character closes the field, and delimiters and line breaks are data.
  After the closing quote only a delimiter, a line break or the end of the input may follow.
- An empty line (no characters at all) is a record with one empty field, `[""]`. With `skipEmptyLines` it is
  left out. A line that holds `""` is not empty.
- A record needs no particular number of fields.

## Options

| option | default | meaning |
| --- | --- | --- |
| `delimiter` | `","` | one character |
| `quote` | `'"'` | one character |
| `header` | `false` | the first record names the columns; records come back as objects |
| `skipEmptyLines` | `false` | leave empty lines out (also before the header) |

With `header: true` the first record (after skipped empty lines) is the list of column names and is not
returned. Every later record is returned as an object keyed by those names. A record with fewer fields than the
header gets `""` for the missing columns. A record with more fields is an error.

## Errors

A `CsvError` is thrown. Everything that was complete before the point of the error is delivered first; after
the error nothing more is read. The messages are exact:

| situation | message |
| --- | --- |
| input ends inside a quoted field | `unterminated quoted field starting at line N` |
| a character other than the above follows a closing quote | `unexpected character "X" after closing quote at line N` |
| header mode, a record with too many fields | `record R has M fields but the header has K` |
| `delimiter` is not one character | `delimiter must be a single character` |
| `quote` is not one character | `quote must be a single character` |
| delimiter equals quote, or either is CR or LF | `delimiter and quote must differ and must not be line breaks` |

`X` is the offending character written as JSON would write it (`"x"`, `"\r"`).
Line numbers start at 1 and go up by one at each line break (CRLF counts once), inside quoted fields too.
For an unterminated field N is the line where the field's opening quote is. `R` counts the records of the
input starting at 1, the header row being record 1; skipped empty lines do not count.

## Streaming

`readCsv` yields a record as soon as the characters that complete it have been read. It asks the source for
the next chunk only when it has nothing left to read from the previous one. It never holds more than the
current chunk and the record being built.
