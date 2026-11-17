"""Percentage discounts, per line, before coupons and tax."""

from __future__ import annotations

from decimal import Decimal

from .models import Customer, LineItem
from .money import round_cents


def effective_pct(item: LineItem, customer: Customer) -> Decimal:
    """The line's own percentage plus the customer's loyalty percentage."""
    return item.discount_pct + customer.loyalty_pct


def line_discount(subtotal: Decimal, pct: Decimal) -> Decimal:
    """The discount for a line subtotal at `pct` percent."""
    return round_cents(subtotal * pct / Decimal(100))
