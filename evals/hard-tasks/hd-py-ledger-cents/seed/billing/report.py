"""The monthly report: one row per customer, tax by jurisdiction, a grand total."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from .models import Invoice
from .money import CENT, ZERO


@dataclass(frozen=True)
class Row:
    customer_id: str
    customer_name: str
    invoices: int
    subtotal: Decimal
    discount: Decimal
    coupon: Decimal
    tax: Decimal
    total: Decimal


@dataclass(frozen=True)
class Report:
    year: int
    month: int
    rows: tuple[Row, ...]
    tax_by_jurisdiction: dict[str, Decimal]
    grand_total: Row


def _line_tax(taxable: Decimal, rate: Decimal) -> Decimal:
    # The tax of a line as it will be shown in the report.
    return (taxable * rate).quantize(CENT)


def monthly_report(invoices: Iterable[Invoice], year: int, month: int) -> Report:
    by_customer: dict[str, dict] = {}
    by_jurisdiction: dict[str, Decimal] = {}
    for inv in invoices:
        if (inv.issued_on.year, inv.issued_on.month) != (year, month):
            continue
        acc = by_customer.setdefault(
            inv.customer_id,
            {"name": inv.customer_name, "invoices": 0, "subtotal": ZERO, "discount": ZERO, "coupon": ZERO, "tax": ZERO},
        )
        acc["invoices"] += 1
        for line in inv.lines:
            tax = _line_tax(line.taxable, line.tax_rate)
            acc["subtotal"] += line.subtotal
            acc["discount"] += line.discount
            acc["coupon"] += line.coupon_share
            acc["tax"] += tax
            by_jurisdiction[line.jurisdiction] = by_jurisdiction.get(line.jurisdiction, ZERO) + tax

    rows = []
    for cid in sorted(by_customer):
        a = by_customer[cid]
        total = a["subtotal"] - a["discount"] - a["coupon"] + a["tax"]
        rows.append(Row(cid, a["name"], a["invoices"], a["subtotal"], a["discount"], a["coupon"], a["tax"], total))

    grand = Row(
        "TOTAL",
        "",
        sum(r.invoices for r in rows),
        sum((r.subtotal for r in rows), ZERO),
        sum((r.discount for r in rows), ZERO),
        sum((r.coupon for r in rows), ZERO),
        sum((r.tax for r in rows), ZERO),
        sum((r.total for r in rows), ZERO),
    )
    return Report(year, month, tuple(rows), dict(sorted(by_jurisdiction.items())), grand)
