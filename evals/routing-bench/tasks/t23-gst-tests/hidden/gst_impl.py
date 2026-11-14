"""Reference implementations of calculate_gst_split, and broken copies of them.

The prompt does not say what a negative amount does, whether bad input is
rejected, whether "total" is the tax or the amount plus tax, or how the two
halves of an odd-paise tax are rounded, so a spec-compatible implementation
comes in twelve flavours (see VARIANTS). A test file is accepted if it passes
on at least one of them, and the broken copies (mutants) of that flavour must
each make it fail.
"""
import math
from decimal import Decimal, ROUND_HALF_UP

# negatives/validation x what "total" means x how the two halves are rounded
VARIANTS = tuple(
    f"{neg}/{tot}/{split}"
    for neg in ("raise", "passthrough", "strict")
    for tot in ("payable", "tax")
    for split in ("halves", "remainder")
)
MUTANTS = {
    "ignores_interstate": "treats every sale as intrastate",
    "igst_on_intrastate": "charges igst on intrastate sales too",
    "total_excludes_tax": "total ignores the tax",
    "total_double_counts": "total counts the tax twice",
    "cgst_full_rate": "cgst takes the whole tax instead of half",
    "sgst_unequal": "sgst differs from cgst",
    "default_rate_wrong": "default rate is not 18%",
    "rate_ignored": "ignores the rate argument",
    "rounds_to_rupee": "rounds to whole rupees instead of paise",
    "zero_breaks": "rejects an amount of zero",
    "negative_policy_flipped": "handles negative amounts the opposite way",
}


def _d(x):
    return Decimal(str(x))


def _q(x, places=2):
    return x.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def make(variant="raise/payable/halves", mutant=None):
    neg, tot, split = variant.split("/")
    variant = neg
    default_rate = 0.12 if mutant == "default_rate_wrong" else 0.18
    negatives_raise = variant in ("raise", "strict")
    if mutant == "negative_policy_flipped":
        negatives_raise = not negatives_raise

    def calculate_gst_split(amount, is_interstate, rate=default_rate):
        if variant == "strict":
            if isinstance(amount, bool) or not isinstance(amount, (int, float)):
                raise ValueError("amount must be a number")
            if isinstance(rate, bool) or not isinstance(rate, (int, float)):
                raise ValueError("rate must be a number")
            if not (math.isfinite(amount) and math.isfinite(rate)):
                raise ValueError("amount and rate must be finite")
            if not 0 <= rate <= 1:
                raise ValueError("rate must be between 0 and 1")
            if not isinstance(is_interstate, bool):
                raise ValueError("is_interstate must be a bool")
        if amount < 0 and negatives_raise:
            raise ValueError("amount must not be negative")
        if mutant == "zero_breaks" and amount == 0:
            raise ValueError("amount must be positive")
        if mutant == "rate_ignored":
            rate = 0.18
        places = 0 if mutant == "rounds_to_rupee" else 2
        a, r = _d(amount), _d(rate)
        tax = a * r
        inter = bool(is_interstate) and mutant != "ignores_interstate"
        if inter:
            igst, cgst, sgst = _q(tax, places), Decimal(0), Decimal(0)
        else:
            cgst = _q(tax / 2, places)
            sgst = _q(tax / 2, places) if split == "halves" else _q(tax, places) - cgst
            igst = _q(tax, places) if mutant == "igst_on_intrastate" else Decimal(0)
            if mutant == "cgst_full_rate":
                cgst = _q(tax, places)
            if mutant == "sgst_unequal":
                sgst = cgst + Decimal("0.01")
        total_tax = igst + cgst + sgst if mutant != "igst_on_intrastate" else (cgst + sgst)
        base = a if tot == "payable" else Decimal(0)
        if mutant == "total_excludes_tax":
            total = a
        elif mutant == "total_double_counts":
            total = base + 2 * total_tax
        else:
            total = base + total_tax
        return {"cgst": float(cgst), "sgst": float(sgst), "igst": float(igst), "total": float(_q(total, places))}

    return calculate_gst_split
