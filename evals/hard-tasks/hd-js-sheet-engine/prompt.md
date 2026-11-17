# Build the spreadsheet engine

`minicalc` is meant to be the calculation core of a small spreadsheet product: a library with no user interface,
where a host application sets cells and reads their values. So far only the skeleton exists: addresses, the error
value class, and a `Sheet` that stores numbers and text but does not understand formulas.

Please implement it. `README.md` is the specification of the whole engine: the API, what a formula may contain, how
each kind of value converts, how errors travel, and how a change to one cell is propagated. It is meant to be
complete, so please read it through before you start; where it gives an example, the example is right.

The host application will load sheets with tens of thousands of formula cells, so the engine has to stay quick on
those.

`src/sheet.js` has the public API declared and the tests in `test/` run with `npm test`; a few of them describe
formulas and do not pass yet.
