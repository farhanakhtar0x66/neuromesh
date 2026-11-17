from datetime import date
from decimal import Decimal as D

import pytest

from billing.invoice import build_invoice
from billing.models import Customer, LineItem, Order


def order(items, coupon="0", loyalty="0"):
    return Order("T-1", Customer("C1", "Test", D(loyalty)), date(2026, 3, 1), tuple(items), D(coupon))


def item(sku, qty, price, j="CA", pct="0"):
    return LineItem(sku, D(qty), D(price), j, D(pct))


def test_plain_line_with_tax():
    inv = build_invoice(order([item("A", "2", "10.00")]))
    (ln,) = inv.lines
    assert ln.subtotal == D("20.00")
    assert ln.discount == D("0.00")
    assert ln.tax == D("1.45")
    assert ln.total == D("21.45")


def test_fractional_quantity_rounds_the_subtotal():
    inv = build_invoice(order([item("A", "1.5", "3.33", j="OR")]))
    assert inv.lines[0].subtotal == D("5.00")  # 4.995 rounds up


def test_percentage_discount_comes_off_before_tax():
    inv = build_invoice(order([item("A", "1", "100.00", pct="20")]))
    ln = inv.lines[0]
    assert (ln.discount, ln.taxable, ln.tax, ln.total) == (D("20.00"), D("80.00"), D("5.80"), D("85.80"))


def test_loyalty_percentage_adds_to_the_line_percentage():
    inv = build_invoice(order([item("A", "1", "200.00", pct="10")], loyalty="5"))
    assert inv.lines[0].discount == D("30.00")


def test_tax_is_per_line_per_jurisdiction():
    inv = build_invoice(order([item("A", "1", "100.00", "CA"), item("B", "1", "100.00", "OR")]))
    assert [ln.tax for ln in inv.lines] == [D("7.25"), D("0.00")]


def test_coupon_that_divides_evenly():
    inv = build_invoice(order([item("A", "1", "30.00", "OR"), item("B", "1", "10.00", "OR")], coupon="10"))
    assert [ln.coupon_share for ln in inv.lines] == [D("7.50"), D("2.50")]
    assert inv.total == D("30.00")


def test_coupon_larger_than_the_invoice_is_capped():
    inv = build_invoice(order([item("A", "1", "5.00", "OR")], coupon="50"))
    assert inv.lines[0].coupon_share == D("5.00")
    assert inv.total == D("0.00")


def test_invoice_totals_are_sums_of_lines():
    inv = build_invoice(order([item("A", "3", "9.99"), item("B", "1", "0.50", "NY")]))
    assert inv.total == sum(ln.total for ln in inv.lines)
    assert inv.tax == sum(ln.tax for ln in inv.lines)


def test_unknown_jurisdiction():
    with pytest.raises(ValueError, match="unknown jurisdiction: XX"):
        build_invoice(order([item("A", "1", "1.00", "XX")]))


def test_negative_quantity_is_rejected():
    with pytest.raises(ValueError):
        build_invoice(order([item("A", "-1", "1.00")]))
