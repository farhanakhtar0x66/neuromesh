import pytest
from gst import calculate_gst_split


def test_intrastate_splits_cgst_sgst():
    r = calculate_gst_split(100.0, False)
    assert r["cgst"] == pytest.approx(9.0)
    assert r["sgst"] == pytest.approx(9.0)
    assert r["igst"] == pytest.approx(0.0)


def test_interstate_uses_igst():
    r = calculate_gst_split(100.0, True)
    assert r["igst"] == pytest.approx(18.0)
    assert r["cgst"] == 0


def test_zero_amount():
    r = calculate_gst_split(0, False)
    assert r["total"] == 0


def test_negative_amount_raises():
    with pytest.raises(ValueError):
        calculate_gst_split(-1.0, True)


def test_rounding():
    r = calculate_gst_split(0.1, False, rate=0.18)
    assert r["total"] == pytest.approx(0.118)
