from durations import parse_duration

cases = {"2h": 7200, "45m": 2700, "90s": 90, "1h30m": 5400, "1h5s": 3605, "1h30m15s": 5415, " 10m ": 600}
for text, want in cases.items():
    got = parse_duration(text)
    assert got == want, (text, got, want)
for bad in ["", "h", "1x", "30m1h", "1.5h", "abc"]:
    try:
        parse_duration(bad)
    except ValueError:
        continue
    raise AssertionError(f"expected ValueError for {bad!r}")
print("hidden check passed")
