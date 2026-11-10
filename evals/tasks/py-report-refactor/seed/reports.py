"""Plain-text reports."""


def sales_report(sales):
    headers = ["Region", "Units", "Revenue"]
    rows = [[s["region"], str(s["units"]), f"{s['revenue']:.2f}"] for s in sales]
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    lines = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))]
    lines.append("  ".join("-" * w for w in widths))
    for row in rows:
        lines.append("  ".join(cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i]) for i, cell in enumerate(row)))
    return "\n".join(lines)


def stock_report(items):
    headers = ["Item", "On hand", "Reorder"]
    rows = [[i["name"], str(i["qty"]), "yes" if i["qty"] < i["min"] else "no"] for i in items]
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    lines = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))]
    lines.append("  ".join("-" * w for w in widths))
    for row in rows:
        lines.append("  ".join(cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i]) for i, cell in enumerate(row)))
    return "\n".join(lines)


def staff_report(people):
    headers = ["Name", "Team", "Hours"]
    rows = [[p["name"], p["team"], f"{p['hours']:.1f}"] for p in people]
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    lines = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))]
    lines.append("  ".join("-" * w for w in widths))
    for row in rows:
        lines.append("  ".join(cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i]) for i, cell in enumerate(row)))
    return "\n".join(lines)
