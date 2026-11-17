"""Orders from JSON. Numbers are read as Decimal, never as float."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from .models import Customer, LineItem, Order


def _dec(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def load_orders(path: str) -> list[Order]:
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh, parse_float=Decimal, parse_int=Decimal)
    orders = []
    for o in raw:
        c = o["customer"]
        customer = Customer(c["id"], c["name"], _dec(c.get("loyalty_pct", 0)))
        items = tuple(
            LineItem(
                sku=i["sku"],
                qty=_dec(i["qty"]),
                unit_price=_dec(i["unit_price"]),
                jurisdiction=i["jurisdiction"],
                discount_pct=_dec(i.get("discount_pct", 0)),
                description=i.get("description", ""),
            )
            for i in o["items"]
        )
        orders.append(Order(o["number"], customer, date.fromisoformat(o["issued_on"]), items, _dec(o.get("coupon", 0))))
    return orders
