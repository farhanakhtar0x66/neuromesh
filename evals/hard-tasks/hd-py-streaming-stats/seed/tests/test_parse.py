import pytest

from logstats.parse import parse_line


def test_a_good_line():
    r = parse_line("2026-03-01T10:00:03Z u17 GET /api/users 200 5123 48")
    assert (r.text, r.user, r.method, r.path, r.status, r.nbytes, r.ms) == (
        "2026-03-01T10:00:03Z", "u17", "GET", "/api/users", 200, 5123, 48)
    assert r.ts == 1772359203


def test_tabs_and_trailing_newline_are_fine():
    assert parse_line("2026-03-01T10:00:03Z\tu1\tPOST\t/x\t201\t0\t0\r\n") is not None


@pytest.mark.parametrize("line", [
    "",
    "2026-03-01T10:00:03Z u17 GET /api/users 200 5123",            # a field short
    "2026-03-01T10:00:03Z u17 GET /api/users 200 5123 48 extra",   # a field too many
    "2026-13-01T10:00:03Z u17 GET /a 200 1 1",                     # month 13
    "2026-02-30T10:00:03Z u17 GET /a 200 1 1",                     # no 30 February
    "2026-03-01T24:00:03Z u17 GET /a 200 1 1",                     # hour 24
    "2026-03-01 10:00:03 u17 GET /a 200 1 1",                      # not the timestamp format
    "2026-03-01T10:00:03Z u17 FETCH /a 200 1 1",                   # unknown method
    "2026-03-01T10:00:03Z u17 GET a 200 1 1",                      # path without a slash
    "2026-03-01T10:00:03Z u17 GET /a 99 1 1",                      # status out of range
    "2026-03-01T10:00:03Z u17 GET /a 600 1 1",
    "2026-03-01T10:00:03Z u17 GET /a 200 -1 1",                    # negative bytes
    "2026-03-01T10:00:03Z u17 GET /a 200 1 1.5",                   # not a whole number
],
    ids=["empty", "field-short", "field-extra", "month-13", "feb-30", "hour-24", "not-iso", "unknown-method",
         "path-no-slash", "status-99", "status-600", "negative-bytes", "fractional-ms"])
def test_malformed_lines(line):
    assert parse_line(line) is None


def test_leap_day():
    assert parse_line("2028-02-29T00:00:00Z u GET /a 200 1 1") is not None
    assert parse_line("2026-02-29T00:00:00Z u GET /a 200 1 1") is None
