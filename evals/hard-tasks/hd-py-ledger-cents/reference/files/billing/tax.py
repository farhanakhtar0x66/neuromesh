"""Tax rates per jurisdiction and the tax of one line."""

from __future__ import annotations

from decimal import Decimal

from .money import round_cents

RATES: dict[str, Decimal] = {
    "CA": Decimal("0.0725"),
    "NY": Decimal("0.08875"),
    "TX": Decimal("0.0625"),
    "WA": Decimal("0.065"),
    "OR": Decimal("0"),
    "DE": Decimal("0.19"),
    "FR": Decimal("0.20"),
    "GB": Decimal("0.20"),
    "CH": Decimal("0.081"),
    "SE": Decimal("0.25"),
}


def rate_for(jurisdiction: str) -> Decimal:
    try:
        return RATES[jurisdiction]
    except KeyError:
        raise ValueError(f"unknown jurisdiction: {jurisdiction}") from None


def line_tax(taxable: Decimal, rate: Decimal) -> Decimal:
    """The tax on a taxable line amount, in cents (half up, in Decimal)."""
    return round_cents(taxable * rate)
