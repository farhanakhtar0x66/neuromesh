"""Percentage discounts, per line, before coupons and tax."""

from __future__ import annotations

from decimal import Decimal

from .models import Customer, LineItem
from .money import ZERO, round_cents

HUNDRED = Decimal(100)


def effective_pct(item: LineItem, customer: Customer) -> Decimal:
    """The line's own percentage plus the customer's loyalty percentage, limited to 0..100."""
    return min(max(item.discount_pct + customer.loyalty_pct, ZERO), HUNDRED)


def line_discount(subtotal: Decimal, pct: Decimal) -> Decimal:
    """The discount for a line subtotal at `pct` percent: never negative, never above the subtotal."""
    pct = min(max(pct, ZERO), HUNDRED)
    return min(round_cents(subtotal * pct / HUNDRED), subtotal)
