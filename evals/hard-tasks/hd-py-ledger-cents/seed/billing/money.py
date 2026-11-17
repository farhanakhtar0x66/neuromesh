"""The one place where an amount is rounded to cents."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0")


def round_cents(value: Decimal) -> Decimal:
    """Round to two decimal places, ties up."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def format_money(value: Decimal) -> str:
    return f"{value:.2f}"
