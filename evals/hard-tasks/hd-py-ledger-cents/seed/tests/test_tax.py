from decimal import Decimal as D

import pytest

from billing.tax import line_tax, rate_for


def test_rates_are_decimals():
    assert rate_for("CA") == D("0.0725")


def test_unknown():
    with pytest.raises(ValueError):
        rate_for("ZZ")


def test_simple_tax():
    assert line_tax(D("100.00"), D("0.0725")) == D("7.25")
    assert line_tax(D("0.00"), D("0.20")) == D("0.00")
