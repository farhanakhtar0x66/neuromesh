import inspect
import sys

sys.path.insert(0, "hidden")
import original_reports as old
import reports as new

sales = [{"region": "North", "units": 3, "revenue": 12.5}, {"region": "South-East", "units": 1200, "revenue": 99999.999}]
items = [{"name": "Bolt", "qty": 3, "min": 10}, {"name": "Very long item name", "qty": 50, "min": 5}]
people = [{"name": "Ana", "team": "Ops", "hours": 7.25}, {"name": "Bo", "team": "Platform engineering", "hours": 40}]
for fn, data in [("sales_report", sales), ("stock_report", items), ("staff_report", people)]:
    for rows in (data, data[:1], []):
        assert getattr(new, fn)(rows) == getattr(old, fn)(rows), (fn, rows)

assert callable(getattr(new, "format_table", None)), "format_table is missing"
source = inspect.getsource(new)
assert source.count(".ljust(") <= 2 and source.count(".rjust(") <= 1, "formatting code is still repeated"
for fn in ("sales_report", "stock_report", "staff_report"):
    assert "format_table(" in inspect.getsource(getattr(new, fn)), f"{fn} does not use format_table"
print("hidden check passed")
