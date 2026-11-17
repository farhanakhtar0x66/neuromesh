"""A fixed-amount coupon spread over the lines of an invoice."""

from __future__ import annotations

from decimal import Decimal

from .money import ZERO, round_cents


def applied_coupon(coupon: Decimal, nets: list[Decimal]) -> Decimal:
    """A coupon is worth at most what the lines add up to."""
    return min(coupon, sum(nets, ZERO))


def spread_coupon(applied: Decimal, nets: list[Decimal]) -> list[Decimal]:
    """One share per line, in proportion to the line's net."""
    total = sum(nets, ZERO)
    if applied <= ZERO or total <= ZERO:
        return [ZERO for _ in nets]
    return [round_cents(applied * net / total) for net in nets]
