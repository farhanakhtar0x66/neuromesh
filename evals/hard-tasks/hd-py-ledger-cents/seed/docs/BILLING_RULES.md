# Billing rules

These rules are the specification of every amount this package prints. They
are applied in the order below. Nothing is rounded anywhere except where a rule
says so, and nothing is ever rounded twice.

## 1. Numbers

1. Money is `decimal.Decimal` everywhere. A `float` never touches an amount, a
   rate or a percentage, not even for one intermediate step.
2. "Rounded to cents" always means rounded to two decimal places **half up**:
   a tie goes up (0.125 becomes 0.13, 0.5 cents becomes one cent). Amounts in
   this package are never negative, so half up and half away from zero agree.
3. Tax rates are Decimal fractions (`0.0725` is 7.25 percent). Percentages are
   Decimal numbers out of 100 (`15` is 15 percent).

## 2. A line

For each item of an order, in order:

1. **Subtotal** = `qty * unit_price`, rounded to cents. `qty` may be fractional.
2. **Percentage discount.** The effective percentage is the item's
   `discount_pct` plus the customer's `loyalty_pct`; the sum is then limited to
   the range 0 to 100 (below 0 counts as 0, above 100 counts as 100). The
   **discount** is `subtotal * percentage / 100`, rounded to cents. So a
   discount is never negative and never more than the subtotal. The line's
   **net** is `subtotal - discount`.
3. **Coupon share** (rule 3 below). `taxable = net - share`.
4. **Tax** = `taxable * rate(jurisdiction)`, rounded to cents. The jurisdiction
   is a property of the line, not of the invoice, so one invoice can carry
   several. An unknown jurisdiction code is an error (`ValueError`).
5. **Total** = `taxable + tax`.

## 3. The coupon

An order may carry one fixed-amount coupon (default 0).

1. The amount actually applied is the coupon, limited to the sum of the lines'
   nets. The rest of a larger coupon is lost, it is not carried over.
2. The applied amount is spread over the lines in proportion to their nets, in
   whole cents, by the **largest remainder method**:
   - each line first gets the whole cents of its exact proportional share,
     `applied_cents * net_cents / total_net_cents`, rounded down;
   - the cents still unassigned are handed out one each to the lines whose
     exact share had the largest fractional part left over;
   - when two lines have the same remainder, the line that comes first on the
     invoice gets the cent first;
   - a line with a net of zero gets nothing.
3. The shares always add up to exactly the applied amount, and no line gets
   more than its net.

## 4. Totals

An invoice's subtotal, discount, coupon, tax and total are plain sums of the
line values. Nothing is recomputed or re-rounded at invoice level.

## 5. The monthly report

1. The report covers the invoices whose `issued_on` falls in the month.
2. It is built from the same line values as the invoices: every figure in it is
   a sum of values the invoices already hold (subtotals, discounts, coupon
   shares, tax, totals). The report never works a tax or a discount out again,
   so the report and the invoices cannot disagree.
3. One row per customer (sorted by customer id), tax by jurisdiction (sorted by
   code) and a grand total row.
