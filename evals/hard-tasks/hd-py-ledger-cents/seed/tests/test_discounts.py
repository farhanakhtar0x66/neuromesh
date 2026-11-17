from decimal import Decimal as D

from billing.discounts import effective_pct, line_discount
from billing.models import Customer, LineItem


def test_discount_is_rounded_to_cents():
    assert line_discount(D("33.33"), D("15")) == D("5.00")  # 4.9995


def test_effective_percentage_adds_up():
    item = LineItem("A", D(1), D(1), "CA", D("10"))
    assert effective_pct(item, Customer("C", "c", D("5"))) == D("15")
