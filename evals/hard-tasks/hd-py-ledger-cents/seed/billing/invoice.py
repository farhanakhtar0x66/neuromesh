"""Orders become invoices. The rules are in docs/BILLING_RULES.md."""

from __future__ import annotations

from .coupons import applied_coupon, spread_coupon
from .discounts import effective_pct, line_discount
from .models import Invoice, InvoiceLine, Order
from .money import ZERO, round_cents
from .tax import line_tax, rate_for


def build_invoice(order: Order) -> Invoice:
    for item in order.items:
        if item.qty < ZERO or item.unit_price < ZERO:
            raise ValueError(f"negative quantity or price on {item.sku}")
    if order.coupon < ZERO:
        raise ValueError("a coupon cannot be negative")

    subtotals = [round_cents(i.qty * i.unit_price) for i in order.items]
    discounts = [
        line_discount(sub, effective_pct(item, order.customer))
        for sub, item in zip(subtotals, order.items)
    ]
    nets = [sub - disc for sub, disc in zip(subtotals, discounts)]
    shares = spread_coupon(applied_coupon(order.coupon, nets), nets)

    lines = []
    for item, sub, disc, net, share in zip(order.items, subtotals, discounts, nets, shares):
        rate = rate_for(item.jurisdiction)
        taxable = net - share
        tax = line_tax(taxable, rate)
        lines.append(
            InvoiceLine(
                sku=item.sku,
                description=item.description,
                jurisdiction=item.jurisdiction,
                subtotal=sub,
                discount=disc,
                coupon_share=share,
                taxable=taxable,
                tax_rate=rate,
                tax=tax,
                total=taxable + tax,
            )
        )
    return Invoice(
        number=order.number,
        customer_id=order.customer.id,
        customer_name=order.customer.name,
        issued_on=order.issued_on,
        lines=tuple(lines),
    )
