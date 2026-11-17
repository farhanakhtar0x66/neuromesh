from io import StringIO

from logstats.cli import main

LOG = """\
2026-03-01T10:00:00Z alice GET /home 200 1000 10
2026-03-01T10:05:00Z bob GET /about 200 500 20
2026-03-01T10:10:00Z alice GET /home 200 1000 30
this line is garbage
2026-03-01T10:20:00Z bob POST /about 500 100 400

2026-03-01T10:40:00Z alice GET /home 404 200 5
2026-03-01T11:30:01Z alice GET /home 200 1000 10
2026-03-01T11:31:00Z bob GET /docs 503 50 90
"""

EXPECTED = """\
logstats report
lines: 8
malformed: 1
requests: 7
period: 2026-03-01T10:00:00Z .. 2026-03-01T11:31:00Z
bytes: 3850
duration ms: min 5, max 400, mean 80.7
status: 1xx=0 2xx=4 3xx=0 4xx=1 5xx=2
top paths:
  /home  4
  /about  2
  /docs  1
errors per hour (5xx):
  2026-03-01 10:00  1/5  20.00%
  2026-03-01 11:00  1/2  50.00%
users: 2
  alice  requests=4 sessions=2
  bob  requests=3 sessions=2
sessions: total 4
"""


def run(path):
    out, err = StringIO(), StringIO()
    code = main([str(path)], stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_report_for_a_small_log(tmp_path):
    log = tmp_path / "access.log"
    log.write_text(LOG)
    assert run(log) == (0, EXPECTED, "")


def test_an_empty_log(tmp_path):
    log = tmp_path / "empty.log"
    log.write_text("")
    code, out, _ = run(log)
    assert code == 0
    assert out == (
        "logstats report\nlines: 0\nmalformed: 0\nrequests: 0\nperiod: n/a\nbytes: 0\nduration ms: n/a\n"
        "status: 1xx=0 2xx=0 3xx=0 4xx=0 5xx=0\ntop paths:\n  (none)\nerrors per hour (5xx):\n  (none)\n"
        "users: 0\n  (none)\nsessions: total 0\n"
    )


def test_a_missing_file(tmp_path):
    code, out, err = run(tmp_path / "nope.log")
    assert code == 2 and out == ""
    assert err.startswith(f"logstats: cannot open {tmp_path / 'nope.log'}: ")


def test_ties_in_top_paths_go_by_name(tmp_path):
    log = tmp_path / "ties.log"
    log.write_text("".join(f"2026-03-01T10:00:0{i}Z u GET /{p} 200 1 1\n" for i, p in enumerate("abc")))
    assert run(log)[1].split("top paths:\n")[1].startswith("  /a  1\n  /b  1\n  /c  1\n")
