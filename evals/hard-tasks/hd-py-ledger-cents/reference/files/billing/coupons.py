"""A fixed-amount coupon spread over the lines of an invoice."""

from __future__ import annotations

from decimal import Decimal

from .money import CENT, ZERO


def applied_coupon(coupon: Decimal, nets: list[Decimal]) -> Decimal:
    """A coupon is worth at most what the lines add up to."""
    return min(coupon, sum(nets, ZERO))


def _cents(amount: Decimal) -> int:
    return int((amount / CENT).to_integral_value())


def spread_coupon(applied: Decimal, nets: list[Decimal]) -> list[Decimal]:
    """One share per line, in proportion to the line's net, by the largest remainder method.

    Works in whole cents so the shares add up to `applied` exactly: every line gets the
    floor of its exact share, then the leftover cents go one each to the lines with the
    largest remainders (the earlier line wins a tie). A line with a zero net gets nothing.
    """
    total = sum(nets, ZERO)
    if applied <= ZERO or total <= ZERO:
        return [ZERO for _ in nets]
    applied_c = _cents(applied)
    net_c = [_cents(n) for n in nets]
    total_c = sum(net_c)
    floors = [applied_c * n // total_c for n in net_c]
    remainders = [applied_c * n % total_c for n in net_c]
    leftover = applied_c - sum(floors)
    order = sorted(range(len(nets)), key=lambda i: (-remainders[i], i))
    for i in order[:leftover]:
        floors[i] += 1
    return [Decimal(c) * CENT for c in floors]
