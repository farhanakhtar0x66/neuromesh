import pytest
from gst import calculate_gst_split


def test_intrastate_splits_tax_into_cgst_and_sgst():
    r = calculate_gst_split(100.0, False)
    assert r["cgst"] == pytest.approx(9.0)
    assert r["sgst"] == pytest.approx(9.0)
    assert r["igst"] == 0
    assert r["total"] == pytest.approx(118.0)


def test_interstate_charges_igst_only():
    r = calculate_gst_split(100.0, True)
    assert r["igst"] == pytest.approx(18.0)
    assert r["cgst"] == 0
    assert r["sgst"] == 0
    assert r["total"] == pytest.approx(118.0)


@pytest.mark.parametrize("is_interstate", [True, False])
def test_zero_amount_gives_zero_everywhere(is_interstate):
    r = calculate_gst_split(0, is_interstate)
    assert r == {"cgst": 0, "sgst": 0, "igst": 0, "total": 0}


def test_negative_amount_is_rejected():
    with pytest.raises(ValueError):
        calculate_gst_split(-1.0, True)
    with pytest.raises(ValueError):
        calculate_gst_split(-250.5, False)


def test_default_rate_is_eighteen_percent():
    assert calculate_gst_split(1000, True)["igst"] == pytest.approx(180.0)
    assert calculate_gst_split(1000, False)["cgst"] == pytest.approx(90.0)


@pytest.mark.parametrize("rate,tax", [(0.05, 50.0), (0.12, 120.0), (0.28, 280.0), (0.0, 0.0)])
def test_custom_rate_is_used(rate, tax):
    inter = calculate_gst_split(1000, True, rate=rate)
    intra = calculate_gst_split(1000, False, rate=rate)
    assert inter["igst"] == pytest.approx(tax)
    assert intra["cgst"] == pytest.approx(tax / 2)
    assert intra["sgst"] == pytest.approx(tax / 2)
    assert inter["total"] == pytest.approx(1000 + tax)
    assert intra["total"] == pytest.approx(1000 + tax)


@pytest.mark.parametrize("amount", [0.01, 0.1, 19.99, 99.99, 1234.56, 1e6])
@pytest.mark.parametrize("is_interstate", [True, False])
def test_results_are_rounded_to_paise(amount, is_interstate):
    r = calculate_gst_split(amount, is_interstate)
    for key in ("cgst", "sgst", "igst", "total"):
        assert round(r[key], 2) == pytest.approx(r[key], abs=1e-9)


def test_floating_point_noise_does_not_leak():
    r = calculate_gst_split(0.1 + 0.2, False)  # 0.30000000000000004
    assert r["total"] == pytest.approx(0.35, abs=0.011)
    r = calculate_gst_split(1.1, True)
    assert r["igst"] == pytest.approx(0.20, abs=1e-9)
    assert r["total"] == pytest.approx(1.30, abs=1e-9)


def test_intrastate_halves_are_equal_and_sum_to_total():
    for amount in (0.01, 33.33, 99.99, 12345.67):
        r = calculate_gst_split(amount, False)
        assert r["cgst"] == pytest.approx(r["sgst"])
        assert r["total"] == pytest.approx(amount + r["cgst"] + r["sgst"], abs=0.011)


def test_interstate_and_intrastate_total_the_same():
    for amount in (10, 99.99, 12345.67):
        a = calculate_gst_split(amount, True)
        b = calculate_gst_split(amount, False)
        assert a["total"] == pytest.approx(b["total"], abs=0.011)
