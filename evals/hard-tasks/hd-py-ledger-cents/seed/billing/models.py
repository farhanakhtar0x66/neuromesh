from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .money import ZERO


@dataclass(frozen=True)
class Customer:
    id: str
    name: str
    loyalty_pct: Decimal = ZERO


@dataclass(frozen=True)
class LineItem:
    sku: str
    qty: Decimal
    unit_price: Decimal
    jurisdiction: str
    discount_pct: Decimal = ZERO
    description: str = ""


@dataclass(frozen=True)
class Order:
    number: str
    customer: Customer
    issued_on: date
    items: tuple[LineItem, ...]
    coupon: Decimal = ZERO


@dataclass(frozen=True)
class InvoiceLine:
    sku: str
    description: str
    jurisdiction: str
    subtotal: Decimal
    discount: Decimal
    coupon_share: Decimal
    taxable: Decimal
    tax_rate: Decimal
    tax: Decimal
    total: Decimal


@dataclass(frozen=True)
class Invoice:
    number: str
    customer_id: str
    customer_name: str
    issued_on: date
    lines: tuple[InvoiceLine, ...]

    @property
    def subtotal(self) -> Decimal:
        return sum((ln.subtotal for ln in self.lines), ZERO)

    @property
    def discount(self) -> Decimal:
        return sum((ln.discount for ln in self.lines), ZERO)

    @property
    def coupon(self) -> Decimal:
        return sum((ln.coupon_share for ln in self.lines), ZERO)

    @property
    def tax(self) -> Decimal:
        return sum((ln.tax for ln in self.lines), ZERO)

    @property
    def total(self) -> Decimal:
        return sum((ln.total for ln in self.lines), ZERO)
