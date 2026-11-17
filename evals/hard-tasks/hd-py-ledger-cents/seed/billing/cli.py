"""python -m billing invoice FILE | report FILE --month YYYY-MM"""

from __future__ import annotations

import argparse
import sys

from .invoice import build_invoice
from .loader import load_orders
from .money import format_money
from .report import monthly_report


def _print_invoice(inv, out) -> None:
    print(f"Invoice {inv.number}  {inv.customer_name} ({inv.customer_id})  {inv.issued_on.isoformat()}", file=out)
    for ln in inv.lines:
        print(
            f"  {ln.sku:<10} {ln.jurisdiction:<3} sub {format_money(ln.subtotal):>9}"
            f"  disc {format_money(ln.discount):>8}  coupon {format_money(ln.coupon_share):>7}"
            f"  tax {format_money(ln.tax):>7}  total {format_money(ln.total):>9}",
            file=out,
        )
    print(
        f"  TOTAL: subtotal {format_money(inv.subtotal)}  discount {format_money(inv.discount)}"
        f"  coupon {format_money(inv.coupon)}  tax {format_money(inv.tax)}  total {format_money(inv.total)}",
        file=out,
    )


def _print_report(rep, out) -> None:
    print(f"Report {rep.year:04d}-{rep.month:02d}", file=out)
    for r in (*rep.rows, rep.grand_total):
        print(
            f"  {r.customer_id:<8} n={r.invoices:<3} sub {format_money(r.subtotal):>10}"
            f"  disc {format_money(r.discount):>9}  coupon {format_money(r.coupon):>8}"
            f"  tax {format_money(r.tax):>8}  total {format_money(r.total):>10}",
            file=out,
        )
    for code, amount in rep.tax_by_jurisdiction.items():
        print(f"  tax {code:<3} {format_money(amount):>10}", file=out)


def main(argv: list[str] | None = None, out=None) -> int:
    out = out or sys.stdout
    parser = argparse.ArgumentParser(prog="billing")
    sub = parser.add_subparsers(dest="command", required=True)
    p_inv = sub.add_parser("invoice")
    p_inv.add_argument("file")
    p_rep = sub.add_parser("report")
    p_rep.add_argument("file")
    p_rep.add_argument("--month", required=True, help="YYYY-MM")
    args = parser.parse_args(argv)

    invoices = [build_invoice(o) for o in load_orders(args.file)]
    if args.command == "invoice":
        for inv in invoices:
            _print_invoice(inv, out)
        return 0
    year, month = (int(p) for p in args.month.split("-"))
    _print_report(monthly_report(invoices, year, month), out)
    return 0
