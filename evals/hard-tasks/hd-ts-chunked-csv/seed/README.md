# csvstream

A small streaming CSV reader and an import command, for loading customer exports that are too big to hold in memory.

    import { readCsv } from "./src/index.ts";
    import { createReadStream } from "node:fs";

    for await (const row of readCsv(createReadStream("customers.csv"), { header: true })) {
      console.log(row.name);
    }

`readCsv(source, options)` takes any async iterable of `Buffer`/`Uint8Array` or string chunks and yields rows as soon as they are
complete. `parseCsv(input, options)` is the same for a whole buffer or string that is already in memory.

The command line does the same and writes JSON lines:

    node src/cli.ts import customers.csv --header > customers.ndjson
    cat customers.csv | node src/cli.ts import - --delimiter ';'

Options are `--delimiter <c>` (`tab` for a tab), `--quote <c>`, `--header`, `--skip-empty`, and `--chunk-size <bytes>`
(how much is read from the file at a time, 65536 by default). Exit status is 0 when done, 1 when the input is
not valid CSV (the message is on standard error), 2 for a bad command line.

What the format accepts, and every error message, is in [docs/FORMAT.md](docs/FORMAT.md).

## Layout

    src/parser.ts    the tokenizer: text in, records out
    src/reader.ts    decoding, the header option, readCsv and parseCsv
    src/options.ts   defaults and option checks
    src/cli.ts       the import command
    test/            node --test

## Tests

    npm test        (or: node --test test/*.test.ts)

No dependencies; Node 24 or later runs the TypeScript directly.
