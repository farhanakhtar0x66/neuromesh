from decimal import Decimal as D

from billing.coupons import applied_coupon, spread_coupon


def test_applied_coupon_is_capped():
    assert applied_coupon(D("100"), [D("10"), D("20")]) == D("30")
    assert applied_coupon(D("5"), [D("10"), D("20")]) == D("5")


def test_even_split():
    assert spread_coupon(D("10.00"), [D("5.00"), D("5.00")]) == [D("5.00"), D("5.00")]


def test_zero_coupon_gives_zero_shares():
    assert spread_coupon(D("0"), [D("5.00"), D("5.00")]) == [D("0"), D("0")]
