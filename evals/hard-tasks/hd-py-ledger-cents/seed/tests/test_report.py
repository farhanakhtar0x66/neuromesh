from datetime import date
from decimal import Decimal as D

from billing.invoice import build_invoice
from billing.models import Customer, LineItem, Order
from billing.report import monthly_report


def inv(number, cid, day, items, month=3, coupon="0"):
    o = Order(number, Customer(cid, f"name-{cid}"), date(2026, month, day), tuple(items), D(coupon))
    return build_invoice(o)


def li(sku, qty, price, j):
    return LineItem(sku, D(qty), D(price), j)


def test_only_the_month_is_reported():
    invoices = [inv("1", "C1", 5, [li("A", "1", "10.00", "OR")]), inv("2", "C1", 5, [li("A", "1", "99.00", "OR")], month=4)]
    rep = monthly_report(invoices, 2026, 3)
    assert [r.invoices for r in rep.rows] == [1]
    assert rep.grand_total.total == D("10.00")


def test_rows_are_sorted_by_customer_and_summed():
    invoices = [
        inv("1", "C2", 5, [li("A", "1", "10.00", "OR")]),
        inv("2", "C1", 6, [li("A", "2", "10.00", "OR")]),
        inv("3", "C1", 7, [li("A", "1", "5.00", "OR")]),
    ]
    rep = monthly_report(invoices, 2026, 3)
    assert [r.customer_id for r in rep.rows] == ["C1", "C2"]
    assert rep.rows[0].invoices == 2 and rep.rows[0].total == D("25.00")
    assert rep.grand_total.total == D("35.00")


def test_tax_by_jurisdiction_is_sorted():
    invoices = [inv("1", "C1", 5, [li("A", "1", "100.00", "TX"), li("B", "1", "100.00", "CA")])]
    rep = monthly_report(invoices, 2026, 3)
    assert list(rep.tax_by_jurisdiction) == ["CA", "TX"]
    assert rep.tax_by_jurisdiction["CA"] == D("7.25")
    assert rep.tax_by_jurisdiction["TX"] == D("6.25")
