# billing

A small invoicing package: it turns orders into invoices and invoices into a
monthly report. Standard library only.

    python -m billing invoice examples/orders.json
    python -m billing report examples/orders.json --month 2026-03

The money rules are in [docs/BILLING_RULES.md](docs/BILLING_RULES.md). That file
is the specification: when the code and the rules disagree, the rules win.

## Layout

| file | what it does |
| --- | --- |
| `billing/money.py` | the cent type and the rounding helper |
| `billing/models.py` | `Customer`, `LineItem`, `Order`, `InvoiceLine`, `Invoice` |
| `billing/discounts.py` | percentage discounts per line |
| `billing/coupons.py` | spreading a fixed-amount coupon over the lines |
| `billing/tax.py` | tax rates per jurisdiction and the per-line tax |
| `billing/invoice.py` | `build_invoice(order)`: puts the steps above together |
| `billing/report.py` | `monthly_report(invoices, year, month)` |
| `billing/loader.py` | reads orders from JSON (numbers are read as `Decimal`) |
| `billing/cli.py` | the command line |

## Tests

    pytest
