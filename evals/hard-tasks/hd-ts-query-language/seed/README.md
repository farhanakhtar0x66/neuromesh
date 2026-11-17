# track

A small issue tracker library and command line. Issues live in a JSON file; `Store` holds them in memory.

    import { Store } from "./src/index.ts";
    const store = new Store(issues);
    store.search("login crash");          // issues whose title or body contains both words

    node src/cli.ts list --data data/issues.json --search "login crash"

`track list` prints one line per issue, `#<id> [<status>] P<priority> @<assignee> <title>`, and a count.

Searching understands a query language (boolean operators, fields, comparisons, dates, macros); it is specified in
[docs/QUERY.md](docs/QUERY.md). Searching by plain words works exactly as it always has.

## Layout

    src/types.ts     Issue, SearchContext
    src/store.ts     Store: all, get, search
    src/search.ts    the plain-words search
    src/errors.ts    QueryError
    src/format.ts    the lines `track list` prints
    src/cli.ts       the command line
    test/            node --test
    data/issues.json a small example data set

## Tests

    npm test      (or: node --test test/*.test.ts)

Needs Node 24 or later (it runs the TypeScript directly). No dependencies.
