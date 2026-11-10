The shopping cart's `total()` gives wrong answers. Two bugs have been reported:

1. Totals come out like `30.000000000000004` instead of `30`. Totals must be exact to the cent.
2. A percentage discount code is applied after tax, but it should be applied to the subtotal before tax.

Fix both in `src/cart.js`. Keep the public API the same.
