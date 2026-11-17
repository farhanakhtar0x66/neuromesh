"""Hidden checks for the billing rules (docs/BILLING_RULES.md).

The oracle below is a second, independent implementation of the rules in exact rational
arithmetic and whole cents. It lives only here.
"""

import io
import json
import random
import re
from datetime import date
from decimal import Decimal as D
from fractions import Fraction as F
from math import floor

import pytest

from billing.cli import main
from billing.invoice import build_invoice
from billing.models import Customer, LineItem, Order
from billing.report import monthly_report

RATES = {
    "CA": "0.0725", "NY": "0.08875", "TX": "0.0625", "WA": "0.065", "OR": "0",
    "DE": "0.19", "FR": "0.20", "GB": "0.20", "CH": "0.081", "SE": "0.25",
}


# ---------------------------------------------------------------- the oracle

def hu(x: F) -> int:
    """Round a non-negative Fraction (already in units of cents) half up to an integer."""
    return floor(x + F(1, 2))


def cents(d: D) -> F:
    return F(d) * 100


def oracle(order: Order):
    """Per line: dict of integer cents. Plus the applied coupon in cents."""
    pct_cap = lambda p: min(max(p, F(0)), F(100))
    cust = F(order.customer.loyalty_pct)
    subs, discs = [], []
    for it in order.items:
        sub = hu(F(it.qty) * F(it.unit_price) * 100)
        pct = pct_cap(F(it.discount_pct) + cust)
        subs.append(sub)
        discs.append(hu(F(sub) * pct / 100))
    nets = [s - d for s, d in zip(subs, discs)]
    total_net = sum(nets)
    coupon_c = cents(order.coupon)
    applied = min(coupon_c, F(total_net))
    assert applied.denominator == 1, "the generator only makes whole-cent coupons"
    applied = int(applied)
    shares = [0] * len(nets)
    if applied > 0 and total_net > 0:
        exact = [F(applied * n, total_net) for n in nets]
        shares = [floor(e) for e in exact]
        left = applied - sum(shares)
        order_idx = sorted(range(len(nets)), key=lambda i: (-(exact[i] - shares[i]), i))
        for i in order_idx[:left]:
            shares[i] += 1
    lines = []
    for it, sub, disc, net, share in zip(order.items, subs, discs, nets, shares):
        taxable = net - share
        tax = hu(F(taxable) * F(RATES[it.jurisdiction]))
        lines.append(dict(subtotal=sub, discount=disc, coupon_share=share, taxable=taxable, tax=tax, total=taxable + tax))
    return lines, applied


def as_cents(d: D) -> F:
    return F(d) * 100


def assert_line_matches(ln, want, ctx):
    for field in ("subtotal", "discount", "coupon_share", "taxable", "tax", "total"):
        got = getattr(ln, field)
        assert isinstance(got, D), f"{ctx}: {field} is {type(got).__name__}, not Decimal"
        assert as_cents(got) == want[field], f"{ctx}: {field} is {got}, rules give {want[field]} cents"


# ------------------------------------------------------------------ helpers

def mk(items, coupon="0", loyalty="0", cid="C1", number="T-1", day=(2026, 3, 1)):
    return Order(number, Customer(cid, f"name-{cid}", D(loyalty)), date(*day), tuple(items), D(coupon))


def it(sku, qty, price, j="CA", pct="0"):
    return LineItem(sku, D(qty), D(price), j, D(pct))


def make_random_orders(n, seed):
    rng = random.Random(seed)
    jurisdictions = ["TX", "SE", "WA", "CA", "NY", "CH", "DE", "OR", "FR", "GB", "TX", "SE"]
    qtys = ["1", "1", "2", "3", "5", "10", "0.5", "1.5", "2.25", "0.333", "12.5", "0.1", "7", "0"]
    pcts = ["0", "0", "0", "0", "5", "10", "12.5", "15", "33.3", "50", "85", "100", "120", "-5"]
    loyalties = ["0", "0", "0", "5", "10", "15", "50", "90"]
    orders = []
    for k in range(n):
        items = []
        for j in range(rng.randint(1, 8)):
            if rng.random() < 0.25:
                price = D(rng.randint(1, 9000)) / 1000  # three decimals: a subtotal can be a half cent
            else:
                price = D(rng.randint(0, 20000)) / 100
            items.append(LineItem(f"S{j}", D(rng.choice(qtys)), price, rng.choice(jurisdictions), D(rng.choice(pcts))))
        coupon = D(0) if rng.random() < 0.4 else D(rng.randint(1, 40000)) / 100
        cust = rng.choice(["C1", "C2", "C3", "C4", "C5"])
        day = rng.choice([(2026, 3, rng.randint(1, 28)), (2026, 3, rng.randint(1, 28)), (2026, 4, rng.randint(1, 28))])
        orders.append(mk(items, coupon=str(coupon), loyalty=rng.choice(loyalties), cid=cust, number=f"R-{k}", day=day))
    return orders


# ------------------------------------------------- the cases from the issue

def test_tax_ties_go_up():
    # 0.50 at 25 percent is exactly 0.125; 0.24 at 6.25 percent is exactly 0.015
    inv = build_invoice(mk([it("A", "1", "0.50", "SE"), it("B", "1", "0.24", "TX")]))
    assert [ln.tax for ln in inv.lines] == [D("0.13"), D("0.02")]
    assert [ln.total for ln in inv.lines] == [D("0.63"), D("0.26")]
    assert inv.total == D("0.89")


def test_tax_on_larger_ties():
    # 1.00 at 6.5 percent is 6.5 cents; 90.00 at 7.25 percent is 6.525
    inv = build_invoice(mk([it("A", "1", "1.00", "WA"), it("B", "1", "90.00", "CA")]))
    assert [ln.tax for ln in inv.lines] == [D("0.07"), D("6.53")]


def test_discount_cannot_exceed_the_line():
    # loyalty 20 plus a line discount of 85 would be 105 percent
    inv = build_invoice(mk([it("A", "2", "50.00", "CA", "85")], loyalty="20"))
    ln = inv.lines[0]
    assert (ln.subtotal, ln.discount, ln.taxable, ln.tax, ln.total) == (D("100.00"), D("100.00"), D("0.00"), D("0.00"), D("0.00"))


def test_discount_is_never_negative():
    inv = build_invoice(mk([it("A", "1", "40.00", "OR", "-10")]))
    assert inv.lines[0].discount == D("0.00") and inv.lines[0].total == D("40.00")
    inv = build_invoice(mk([it("A", "1", "40.00", "OR", "-10")], loyalty="4"))
    assert inv.lines[0].discount == D("0.00")  # -10 + 4 is still below zero


def test_coupon_shares_add_up_exactly():
    inv = build_invoice(mk([it("A", "1", "1.00", "OR"), it("B", "1", "1.00", "OR"), it("C", "1", "1.00", "OR")], coupon="0.02"))
    assert [ln.coupon_share for ln in inv.lines] == [D("0.01"), D("0.01"), D("0.00")]
    assert inv.coupon == D("0.02")
    inv = build_invoice(mk([it("A", "1", "10.00", "OR"), it("B", "1", "10.00", "OR"), it("C", "1", "10.00", "OR")], coupon="10.00"))
    assert [ln.coupon_share for ln in inv.lines] == [D("3.34"), D("3.33"), D("3.33")]


def test_coupon_leftover_cents_go_to_the_largest_remainders():
    # exact shares of 0.10 over 1.00 / 2.00 / 4.00 are 0.0143 / 0.0286 / 0.0571 dollars
    inv = build_invoice(mk([it("A", "1", "1.00", "OR"), it("B", "1", "2.00", "OR"), it("C", "1", "4.00", "OR")], coupon="0.10"))
    assert [ln.coupon_share for ln in inv.lines] == [D("0.01"), D("0.03"), D("0.06")]
    # 50.00 over 33.33 / 33.33 / 33.34: the two exact 16.665 shares tie, the earlier line takes the cent
    inv = build_invoice(mk([it("A", "1", "33.33", "OR"), it("B", "1", "33.33", "OR"), it("C", "1", "33.34", "OR")], coupon="50.00"))
    assert sum(ln.coupon_share for ln in inv.lines) == D("50.00")
    assert [ln.coupon_share for ln in inv.lines] == [D("16.67"), D("16.66"), D("16.67")]


def test_coupon_ignores_zero_net_lines_and_is_capped():
    inv = build_invoice(mk([it("A", "1", "10.00", "OR", "100"), it("B", "1", "6.00", "OR"), it("C", "1", "4.00", "OR")], coupon="3.00"))
    assert [ln.coupon_share for ln in inv.lines] == [D("0.00"), D("1.80"), D("1.20")]
    inv = build_invoice(mk([it("A", "1", "6.00", "OR"), it("B", "1", "4.00", "OR")], coupon="25.00"))
    assert [ln.coupon_share for ln in inv.lines] == [D("6.00"), D("4.00")]
    assert inv.total == D("0.00")


def test_coupon_reduces_the_taxable_amount():
    inv = build_invoice(mk([it("A", "1", "10.00", "TX"), it("B", "1", "10.00", "CA")], coupon="5.00"))
    assert [ln.taxable for ln in inv.lines] == [D("7.50"), D("7.50")]
    assert [ln.tax for ln in inv.lines] == [D("0.47"), D("0.54")]  # 0.46875 and 0.54375


def test_report_agrees_with_the_invoices_on_ties():
    # 0.50 at 25 percent: every invoice carries 0.13 of tax, the report must too
    orders = [mk([it("A", "1", "0.50", "SE")], cid="C1", number=f"N{k}") for k in range(5)]
    invoices = [build_invoice(o) for o in orders]
    rep = monthly_report(invoices, 2026, 3)
    assert rep.rows[0].tax == D("0.65") == sum(i.tax for i in invoices)
    assert rep.rows[0].total == sum(i.total for i in invoices) == D("3.15")
    assert rep.tax_by_jurisdiction == {"SE": D("0.65")}
    assert rep.grand_total.tax == D("0.65")


# --------------------------------------------------------- the whole rules

def test_random_invoices_match_the_rules():
    orders = make_random_orders(400, seed=20261117)
    ties_seen = 0
    for o in orders:
        inv = build_invoice(o)
        want, applied = oracle(o)
        assert len(inv.lines) == len(want)
        ctx = f"order {o.number}"
        for k, (ln, w) in enumerate(zip(inv.lines, want)):
            assert_line_matches(ln, w, f"{ctx} line {k}")
            assert isinstance(ln.tax_rate, D)
            assert ln.discount >= 0 and ln.taxable >= 0 and ln.total >= 0, f"{ctx} line {k} has a negative amount"
            ties_seen += 1 if (F(w["taxable"]) * F(RATES[o.items[k].jurisdiction])).denominator == 2 else 0
        assert as_cents(inv.coupon) == applied, f"{ctx}: the coupon shares do not add up to the applied coupon"
        assert as_cents(inv.total) == sum(w["total"] for w in want)
        assert as_cents(inv.tax) == sum(w["tax"] for w in want)
        assert as_cents(inv.subtotal) == sum(w["subtotal"] for w in want)
        assert as_cents(inv.discount) == sum(w["discount"] for w in want)
    assert ties_seen >= 30, "the generator must exercise exact half-cent taxes"


def test_random_report_equals_the_invoices():
    orders = make_random_orders(400, seed=7)
    invoices = [build_invoice(o) for o in orders]
    for year, month in ((2026, 3), (2026, 4), (2026, 5)):
        rep = monthly_report(invoices, year, month)
        mine = [i for i in invoices if (i.issued_on.year, i.issued_on.month) == (year, month)]
        assert rep.year == year and rep.month == month
        assert [r.customer_id for r in rep.rows] == sorted({i.customer_id for i in mine})
        for r in rep.rows:
            group = [i for i in mine if i.customer_id == r.customer_id]
            assert r.invoices == len(group)
            assert r.subtotal == sum(i.subtotal for i in group)
            assert r.discount == sum(i.discount for i in group)
            assert r.coupon == sum(i.coupon for i in group)
            assert r.tax == sum(i.tax for i in group), f"{r.customer_id}: report tax differs from the invoices"
            assert r.total == sum(i.total for i in group), f"{r.customer_id}: report total differs from the invoices"
        by_j = {}
        for i in mine:
            for ln in i.lines:
                by_j[ln.jurisdiction] = by_j.get(ln.jurisdiction, D(0)) + ln.tax
        assert rep.tax_by_jurisdiction == dict(sorted(by_j.items()))
        assert list(rep.tax_by_jurisdiction) == sorted(rep.tax_by_jurisdiction)
        g = rep.grand_total
        assert g.invoices == len(mine)
        assert g.tax == sum(i.tax for i in mine) and g.total == sum(i.total for i in mine)
        assert g.coupon == sum(i.coupon for i in mine) and g.discount == sum(i.discount for i in mine)


def test_cli_report_and_invoices_print_the_same_tax(tmp_path):
    orders = []
    for k in range(6):
        orders.append({
            "number": f"N{k}", "customer": {"id": "C1", "name": "Tie Co"}, "issued_on": "2026-03-10",
            "items": [{"sku": "A", "qty": 1, "unit_price": 0.50, "jurisdiction": "SE"},
                      {"sku": "B", "qty": 1, "unit_price": 1.00, "jurisdiction": "WA"}],
        })
    path = tmp_path / "orders.json"
    path.write_text(json.dumps(orders))
    inv_out, rep_out = io.StringIO(), io.StringIO()
    assert main(["invoice", str(path)], out=inv_out) == 0
    assert main(["report", str(path), "--month", "2026-03"], out=rep_out) == 0
    inv_tax = sum(D(m) for m in re.findall(r"TOTAL: .* tax (\d+\.\d\d)", inv_out.getvalue()))
    rep_line = next(ln for ln in rep_out.getvalue().splitlines() if ln.startswith("  C1"))
    rep_tax = D(re.search(r"tax\s+(\d+\.\d\d)", rep_line).group(1))
    assert inv_tax == rep_tax == D("1.20")  # 0.13 + 0.07 per invoice, six invoices
