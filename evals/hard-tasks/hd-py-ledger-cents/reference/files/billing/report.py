"""The monthly report: one row per customer, tax by jurisdiction, a grand total."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from .models import Invoice
from .money import ZERO


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


def monthly_report(invoices: Iterable[Invoice], year: int, month: int) -> Report:
    """Every figure is a sum of values the invoices already hold; nothing is worked out again."""
    in_month = [inv for inv in invoices if (inv.issued_on.year, inv.issued_on.month) == (year, month)]
    by_customer: dict[str, list[Invoice]] = {}
    by_jurisdiction: dict[str, Decimal] = {}
    for inv in in_month:
        by_customer.setdefault(inv.customer_id, []).append(inv)
        for line in inv.lines:
            by_jurisdiction[line.jurisdiction] = by_jurisdiction.get(line.jurisdiction, ZERO) + line.tax

    rows = []
    for cid in sorted(by_customer):
        group = by_customer[cid]
        rows.append(
            Row(
                cid,
                group[0].customer_name,
                len(group),
                sum((i.subtotal for i in group), ZERO),
                sum((i.discount for i in group), ZERO),
                sum((i.coupon for i in group), ZERO),
                sum((i.tax for i in group), ZERO),
                sum((i.total for i in group), ZERO),
            )
        )

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
