Add a sales report to this project. It has three parts:

1. `src/money.js` exporting `formatCents(cents)`: dollars with a thousands separator and two decimals, e.g. `123456` → `"$1,234.56"`, `5` → `"$0.05"`, `-500` → `"-$5.00"`.
2. `src/report.js` exporting `summarize(orders)`: takes the orders from `parseOrders` and returns one entry per customer, `{ customer, orders, items, totalCents }`, where `orders` counts distinct order ids, `items` sums quantities and `totalCents` sums quantity × unit price. Sort by `totalCents`, highest first, then by customer name.
3. `bin/report.js`, a command: `node bin/report.js <orders.csv> [--json]`. Without `--json` it prints a table with a header row `customer orders items total`, one row per customer in the order above with the total formatted by `formatCents`, and a last row `TOTAL` with the sums of all three columns. Columns are separated by at least two spaces. With `--json` it prints the `summarize` result as JSON. If the file does not exist it prints `File not found: <path>` to stderr and exits with code 1.

Add tests for each part.
