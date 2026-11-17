"""Hidden checks: the report must stay byte-identical to the seed's, from one streaming pass.

`seed_logstats` is a copy of the seed (the whole-file implementation): the oracle for the output.
"""

import io
import random
import sys
import tracemalloc
from datetime import datetime, timedelta, timezone

import pytest

from logstats.cli import main
from seed_logstats.cli import main as seed_main
from streamgen import LogSource, expected_counts

MEMORY_LIMIT = 16 * 1024 * 1024
START = datetime(2026, 2, 28, 22, 0, 0, tzinfo=timezone.utc)


# ------------------------------------------------------------ fixtures

def stamp(seconds_from_start: int) -> str:
    return (START + timedelta(seconds=seconds_from_start)).strftime("%Y-%m-%dT%H:%M:%SZ")


def L(t, user="u1", path="/a", status=200, nbytes=100, ms=10, method="GET"):
    """One line; t is seconds after START or a ready timestamp string."""
    ts = t if isinstance(t, str) else stamp(t)
    return f"{ts} {user} {method} {path} {status} {nbytes} {ms}"


def text(lines, eol="\n", final=True):
    return (eol.join(lines) + (eol if final else "")).encode()


GARBAGE = [
    "garbage", "2026-03-01T10:00:03Z u1 GET /a 200 5", "2026-03-01T10:00:03Z u1 GET /a 200 5 6 7",
    "2026-13-01T10:00:03Z u1 GET /a 200 5 6", "2026-02-30T10:00:03Z u1 GET /a 200 5 6",
    "2026-03-01T10:60:03Z u1 GET /a 200 5 6", "2026-03-01 10:00:03 u1 GET /a 200 5 6",
    "2026-03-01T10:00:03Z u1 FETCH /a 200 5 6", "2026-03-01T10:00:03Z u1 GET a 200 5 6",
    "2026-03-01T10:00:03Z u1 GET /a 99 5 6", "2026-03-01T10:00:03Z u1 GET /a 600 5 6",
    "2026-03-01T10:00:03Z u1 GET /a 200 -5 6", "2026-03-01T10:00:03Z u1 GET /a 200 5 6.5",
    "2026-03-01T10:00:03Z u1 GET /a 2OO 5 6", "# a comment", "\x00\x01\x02",
]


def random_log(rng, n, users, paths, jitter, jump, bad=0.03, blank=0.02, eol="\n"):
    """n lines in timestamp order up to `jitter` seconds (at most 60), jumps of `jump` (lo, hi) now and then."""
    t = 0
    out = []
    for _ in range(n):
        r = rng.random()
        if r < 0.10:
            t += rng.randint(*jump)
        elif r < 0.7:
            t += rng.randint(0, 20)
        j = rng.choice([0, 0, rng.randint(0, jitter), jitter]) if jitter else 0
        status = rng.choice([200] * 8 + [301, 404, 500, 503, 100])
        out.append(L(t - j, rng.choice(users), rng.choice(paths), status, rng.randint(0, 99999), rng.randint(0, 3000),
                     rng.choice(["GET", "GET", "POST", "PUT", "DELETE"])))
        r = rng.random()
        if r < bad:
            out.append(rng.choice(GARBAGE))
        elif r < bad + blank:
            out.append(rng.choice(["", "   ", "\t"]))
    return text(out, eol)


def build_fixtures():
    fx = {}
    fx["f01-empty"] = b""
    fx["f02-blank-lines-only"] = b"\n\n  \n\t\n"
    fx["f03-only-malformed"] = text(GARBAGE[:6])
    fx["f04-one-line-no-newline"] = text([L(5, "solo", "/x", 503)], final=False)
    fx["f05-two-users"] = text([L(0, "a", "/p"), L(5, "b", "/p"), L(10, "a", "/q", 500), L(60, "b", "/p", 404)])
    fx["f06-gap-exactly-1800-and-1801"] = text([
        L(0, "same"), L(1800, "same"), L(0, "over"), L(1801, "over"), L(1801 + 1800, "over"), L(1801 + 3601, "over")])
    # a late line lands in a gap of 1830 seconds and splits it into two gaps under 1800
    fx["f07-late-line-closes-a-session-gap"] = text([
        L(0, "u"), L(1830, "u"), L(1790, "u"), L(1900, "v"), L(3701, "v"), L(3650, "v"), L(5400, "u")])
    fx["f08-exactly-60-seconds-late"] = text([L(100, "a"), L(160, "b"), L(100, "b"), L(200, "a"), L(140, "a"), L(2100, "a"), L(2040, "b")])
    fx["f09-pairs-swapped"] = text(sum(([L(k * 40 + 1, f"u{k % 3}"), L(k * 40, f"u{k % 3}", "/b")] for k in range(60)), []))
    paths = ["/b", "/a", "/Z", "/é", "/10", "/9", "/a/b", "/aa", "/B", "/_", "/~", "/0", "/zz", "/m"]
    lines = []
    for k, p in enumerate(reversed(paths)):
        lines += [L(k * 3 + m, "u1", p) for m in range(3)]
    lines += [L(100 + m, "u2", "/top") for m in range(5)] + [L(110 + m, "u2", "/second") for m in range(4)]
    fx["f10-ties-in-top-paths"] = text(lines)
    lines = []
    for k in range(15):
        lines += [L(k * 50 + m, f"u{m % 4}", f"/path{k:02d}") for m in range(k + 1)]
    fx["f11-more-than-ten-paths"] = text(lines)
    fx["f12-hour-and-day-boundaries"] = text([
        L("2026-03-01T09:59:59Z", "a", "/x", 500), L("2026-03-01T10:00:00Z", "a", "/x"), L("2026-03-01T10:30:00Z", "b", "/y", 503),
        L("2026-03-01T23:59:59Z", "a", "/x", 500), L("2026-03-02T00:00:00Z", "a", "/x", 200), L("2026-03-02T00:00:00Z", "b", "/x", 500),
        L("2026-03-02T05:00:00Z", "a", "/z", 404)])
    fx["f13-crlf"] = text([L(k * 7, f"u{k % 2}", f"/p{k % 4}", 500 if k % 5 == 0 else 200) for k in range(40)], eol="\r\n")
    fx["f14-invalid-utf8"] = (
        L(0, "caf").encode() + b"\n" + (L(10).replace("u1", "caf\u0000").encode()) + b"\n"
        + "2026-02-28T22:00:20Z caf\xe9 GET /caf\xe9 200 1 1\n".encode("latin-1")
        + "2026-02-28T22:00:30Z na\xefve GET /ok 200 1 1\n".encode("utf-8") + b"\xff\xfe broken\n"
        + "2026-02-28T22:00:40Z u9 GET /\xe9t\xe9 200 1 1\n".encode("utf-8"))
    fx["f15-malformed-kinds-mixed-in"] = text(sum(([L(k * 11, f"u{k % 3}"), GARBAGE[k % len(GARBAGE)]] for k in range(32)), []))
    fx["f16-tabs-spaces-and-padding"] = text([
        f"  {stamp(0)}\tu1 \t GET\t/a   200  1  1  ", f"{stamp(5)}  u1\tPOST /b\t201\t2\t2", "\t", f"   {stamp(9)} u2 GET /a 200 3 3"])
    lines = []
    for k in range(80):
        lines.append(L(k * 86400 // 3 + (k % 5) * 100, f"u{k % 11}", f"/d{k % 7}", 500 if k % 9 == 0 else 200))
    fx["f17-days-apart"] = text(lines)
    fx["f18-one-user-every-second"] = text([L(k, "busy", "/hot") for k in range(1000)])
    fx["f19-same-timestamp"] = text([L(77, f"u{k % 6}", f"/p{k % 3}", 200 + (k % 3) * 150) for k in range(60)])
    fx["f20-leap-day-and-new-year"] = text([
        L("2028-02-28T23:59:59Z", "a"), L("2028-02-29T00:00:00Z", "a"), L("2028-02-29T23:59:59Z", "b", "/x", 500),
        L("2028-03-01T00:00:00Z", "a"), L("2026-12-31T23:59:59Z", "c"), L("2027-01-01T00:00:00Z", "c", "/y", 502)])
    rng = random.Random(20261117)
    users_small, users_mid = ["a", "b", "c"], [f"user{k:02d}" for k in range(12)]
    paths_few, paths_many = ["/a", "/b", "/c"], [f"/p/{k}" for k in range(30)]
    plans = [
        ("f21-random-near-1800-one-user", dict(n=700, users=["only"], paths=paths_few, jitter=60, jump=(1795, 1806))),
        ("f22-random-near-1800-three-users", dict(n=900, users=users_small, paths=paths_few, jitter=60, jump=(1790, 1810))),
        ("f23-random-jitter-30", dict(n=1500, users=users_mid, paths=paths_many, jitter=30, jump=(1700, 1900))),
        ("f24-random-no-jitter", dict(n=1200, users=users_mid, paths=paths_many, jitter=0, jump=(900, 4000))),
        ("f25-random-many-users", dict(n=2500, users=[f"u{k}" for k in range(300)], paths=paths_many, jitter=60, jump=(1790, 1815))),
        ("f26-random-few-paths-ties", dict(n=1000, users=users_mid, paths=["/x", "/y", "/z", "/w"], jitter=60, jump=(1000, 2600))),
        ("f27-random-crlf", dict(n=600, users=users_small, paths=paths_many, jitter=60, jump=(1795, 1805), eol="\r\n")),
        ("f28-random-heavy-malformed", dict(n=800, users=users_mid, paths=paths_many, jitter=45, jump=(1795, 1805), bad=0.3, blank=0.1)),
        ("f29-random-unicode-users", dict(n=700, users=["ünï", "用户", "usér", "u 1"[:1] + "x", "ß"], paths=["/é", "/ü", "/中", "/a"], jitter=60, jump=(1790, 1810))),
        ("f30-random-long", dict(n=6000, users=[f"user{k:03d}" for k in range(40)], paths=paths_many, jitter=60, jump=(1790, 1830))),
    ]
    for name, kw in plans:
        fx[name] = random_log(rng, **kw)
    return fx


FIXTURES = build_fixtures()
NAMES = list(FIXTURES)


def oracle_report(tmp_path, content: bytes) -> str:
    path = tmp_path / "oracle.log"
    path.write_bytes(content)
    out = io.StringIO()
    assert seed_main([str(path)], stdout=out) == 0
    return out.getvalue()


def stdin_of(content: bytes):
    return io.TextIOWrapper(io.BufferedReader(io.BytesIO(content)), encoding="utf-8", errors="replace")


def run(argv, stdout=None):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_there_are_thirty_fixtures():
    assert len(NAMES) == 30


# ------------------------------------------------- the same output

@pytest.mark.parametrize("name", NAMES)
def test_a_file_gives_the_seeds_output(tmp_path, name):
    content = FIXTURES[name]
    path = tmp_path / "in.log"
    path.write_bytes(content)
    code, out, err = run([str(path)])
    assert (code, err) == (0, "")
    assert out == oracle_report(tmp_path, content)


@pytest.mark.parametrize("name", NAMES)
def test_standard_input_gives_the_seeds_output(tmp_path, monkeypatch, name):
    content = FIXTURES[name]
    monkeypatch.setattr(sys, "stdin", stdin_of(content))
    code, out, err = run([])
    assert (code, err) == (0, "")
    assert out == oracle_report(tmp_path, content)


def test_a_dash_means_standard_input(tmp_path, monkeypatch):
    content = FIXTURES["f07-late-line-closes-a-session-gap"]
    monkeypatch.setattr(sys, "stdin", stdin_of(content))
    code, out, _ = run(["-"])
    assert code == 0 and out == oracle_report(tmp_path, content)


def test_files_are_one_stream_in_the_order_given(tmp_path):
    content = FIXTURES["f22-random-near-1800-three-users"]
    lines = content.splitlines(keepends=True)
    cuts = [0, len(lines) // 3, 2 * len(lines) // 3, len(lines)]
    paths = []
    for k in range(3):
        p = tmp_path / f"part{k}.log"
        p.write_bytes(b"".join(lines[cuts[k]:cuts[k + 1]]))
        paths.append(str(p))
    code, out, err = run(paths)
    assert (code, err) == (0, "")
    assert out == oracle_report(tmp_path, content)


def test_files_and_standard_input_can_be_mixed(tmp_path, monkeypatch):
    content = FIXTURES["f23-random-jitter-30"]
    lines = content.splitlines(keepends=True)
    a, b, c = len(lines) // 4, len(lines) // 2, 3 * len(lines) // 4
    first, last = tmp_path / "first.log", tmp_path / "last.log"
    first.write_bytes(b"".join(lines[:a]))
    last.write_bytes(b"".join(lines[c:]))
    monkeypatch.setattr(sys, "stdin", stdin_of(b"".join(lines[a:c])))
    code, out, _ = run([str(first), "-", str(last)])
    assert code == 0 and out == oracle_report(tmp_path, content)


def test_a_file_that_cannot_be_opened_stops_the_run(tmp_path):
    good = tmp_path / "good.log"
    good.write_bytes(FIXTURES["f05-two-users"])
    missing = tmp_path / "missing.log"
    code, out, err = run([str(good), str(missing)])
    assert code == 2 and out == ""
    assert err.startswith(f"logstats: cannot open {missing}: ")


def test_a_missing_file_alone(tmp_path):
    code, out, err = run([str(tmp_path / "nope.log")])
    assert code == 2 and out == "" and err.startswith("logstats: cannot open ")


# --------------------------------------------------------------- memory

def test_two_million_lines_on_standard_input_stay_under_16_mib(monkeypatch):
    n = 2_000_000
    source = LogSource(n)  # tables are built here, before tracing starts
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BufferedReader(source, 1 << 16), encoding="utf-8", errors="replace"))
    out, err = io.StringIO(), io.StringIO()
    tracemalloc.start()
    try:
        code = main([], stdout=out, stderr=err)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert code == 0, err.getvalue()
    report = out.getvalue()
    want = expected_counts(n)
    assert f"lines: {want['lines']}\nmalformed: 0\nrequests: {want['requests']}\n" in report
    assert f"4xx={want['4xx']} 5xx={want['5xx']}\n" in report
    assert "users: 2000\n" in report
    assert peak < MEMORY_LIMIT, f"peak {peak / 2**20:.1f} MiB"


def test_a_large_file_is_not_read_into_memory(tmp_path):
    n = 300_000
    path = tmp_path / "big.log"
    source = LogSource(n)
    with open(path, "wb") as fh:
        while True:
            chunk = source.read(1 << 16)
            if not chunk:
                break
            fh.write(chunk)
    out, err = io.StringIO(), io.StringIO()
    tracemalloc.start()
    try:
        code = main([str(path)], stdout=out, stderr=err)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert code == 0, err.getvalue()
    assert f"requests: {n}\n" in out.getvalue()
    assert peak < MEMORY_LIMIT, f"peak {peak / 2**20:.1f} MiB"
