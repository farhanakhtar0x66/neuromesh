# hd-py-ledger-cents (bug, Python): notes for the advisor, never shown to a model

## What the task is

`billing/`: orders become invoices, invoices become a monthly report. `docs/BILLING_RULES.md` (README calls it the
specification) states every money rule. The seed breaks four of them in four files, and the issue names only symptoms
("report and invoices a cent apart", "a negative line"), never a file or a rule.

## The four seeded bugs (each one is caught on its own by the hidden checks, see "Mutation check")

| file | bug | rule broken |
| --- | --- | --- |
| `billing/tax.py` | `line_tax` goes through `float` and Python's `round` (half-even on exact binary ties) | 1.1 no floats, 1.2 half up |
| `billing/report.py` | re-derives each line's tax with `.quantize(CENT)` (context default, half-even) instead of summing the invoice's `line.tax` | 1.2, 5.2 report built from the invoices' values |
| `billing/coupons.py` | each share is `round_cents(applied * net / total)` independently, so shares can add up to more or less than the coupon | 3.2 largest remainder, 3.3 shares sum exactly |
| `billing/discounts.py` | `effective_pct` is not limited to 0..100, so a discount can exceed the line or be negative | 2.2 |

The issue's "0.24 in TX: invoice 0.01, report 0.02" is real on the seed: float `0.24 * 0.0625` is 0.01499999..., the report's
Decimal tie 0.0150 rounds half-even to 0.02. Making the report half-up changes nothing for this example (0.015 is
0.02 either way); the invoice's 0.01 is the wrong one, so only a fix that reaches `tax.py` closes the issue's own case.

## Why a small model should fail

It fixes the call the issue points at (the report's rounding, or one `round`) and stops. The coupon and the discount
cap are reachable only through `docs/BILLING_RULES.md`, which the issue never cites; the visible tests (23, all green on
the seed, none lands on a half-cent tie or a coupon that does not divide) stay green after a shallow fix. The report fix
looks finished on its own: "report half-up only" fails 10 of 12 hidden tests.

## Oracle

`hidden/tests/tests/test_hidden_ledger.py` carries a second implementation of the rules in exact `Fraction` arithmetic and
whole integer cents (no `Decimal`, no code shared with the reference). Used by:
- `test_random_invoices_match_the_rules`: 400 seeded orders (`random.Random(20261117)`), 1 to 8 lines, fractional
  quantities, three-decimal prices (half-cent subtotals), item discounts from -5 to 120 percent, loyalty 0 to 90,
  coupons from nothing to more than the invoice, all ten jurisdictions weighted towards TX/SE/WA (exact half-cent taxes).
  Every line field and every invoice total is compared, plus "all values are Decimal" and "nothing negative". The test
  also asserts the generator hit at least 30 exact half-cent taxes (it hits about 3 times that).
- `test_random_report_equals_the_invoices`: 400 other orders (seed 7), three months, every report figure equals the sum
  of the invoice values; rows and jurisdictions sorted.
- Named cases (the issue's, plus ties, caps, leftover-cent order) have literal expected values worked out by hand.

## Decisions worth knowing

- DESIGN says the coupon is spread "in proportion to subtotal". Taken literally that can give a 100 percent discounted
  line a positive share and a negative taxable amount, so the rules spread it in proportion to the line's **net after the
  percentage discount**. Stated in rules 3.2.
- Rules 2.2 clamps the percentage (sum of item and loyalty) to 0..100, including negative item percentages; a hidden test
  covers the negative case (`-10` and `-10 + 4`).
- Tie order for the leftover cent (earlier line first) is stated in rule 3.2, so the hidden literal cases are decidable.
- Two named tests (a coupon with zero-net lines or capped at the invoice, and a coupon reducing the taxable amount) pass on
  the seed, so they are pass-to-pass guards, not fail-to-pass.
- The reference change is 80 changed lines (161 in the four files as shipped); a bug task cannot honestly be 150 lines
  without padding, so it is below DESIGN's 150 to 700.

## Mutation check (done by hand, offline)

Putting each seed file back into the reference alone: tax fails 5 hidden tests, report 3, coupons 3, discounts 3; the
random invoice test catches tax, coupons and discounts; the random report test and the CLI test catch the report.

## Time

The hidden file runs in about 0.2 s on the reference (pytest total 0.6 s); no time limit is used. validate-task (3 reference
runs plus the seed) takes about 5 s including the offline venv.
