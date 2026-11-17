import io
from pathlib import Path

from billing.cli import main

EXAMPLES = str(Path(__file__).resolve().parent.parent / "examples" / "orders.json")


def run(*argv):
    out = io.StringIO()
    assert main(list(argv), out=out) == 0
    return out.getvalue()


def test_invoice_output_has_one_block_per_order():
    text = run("invoice", EXAMPLES)
    assert text.count("Invoice INV-") == 3
    assert "Invoice INV-1001  Acme Print (C001)  2026-03-03" in text


def test_report_output_for_march():
    text = run("report", EXAMPLES, "--month", "2026-03")
    lines = text.splitlines()
    assert lines[0] == "Report 2026-03"
    assert lines[1].startswith("  C001")
    assert lines[2].startswith("  C002")
    assert lines[3].startswith("  TOTAL")
