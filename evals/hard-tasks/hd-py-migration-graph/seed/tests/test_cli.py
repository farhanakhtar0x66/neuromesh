import io
from pathlib import Path

from migrator.cli import main

EXAMPLES = str(Path(__file__).resolve().parent.parent / "examples" / "migrations")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = main(list(argv), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_migrate_prints_what_it_applied(tmp_path):
    db = str(tmp_path / "app.db")
    code, out, err = run("--db", db, "--dir", EXAMPLES, "migrate")
    assert (code, err) == (0, "")
    assert out.splitlines() == ["applied 0001_create_users", "applied 0002_add_email", "applied 0003_create_posts"]
    assert run("--db", db, "--dir", EXAMPLES, "migrate")[1] == "nothing to apply\n"


def test_status_output(tmp_path):
    db = str(tmp_path / "app.db")
    assert run("--db", db, "--dir", EXAMPLES, "status")[1].splitlines() == [
        "[ ] 0001_create_users", "[ ] 0002_add_email", "[ ] 0003_create_posts"
    ]
    run("--db", db, "--dir", EXAMPLES, "migrate")
    assert run("--db", db, "--dir", EXAMPLES, "status")[1].splitlines()[0] == "[x] 0001_create_users"


def test_an_error_is_printed_with_status_1(tmp_path):
    code, out, err = run("--db", str(tmp_path / "app.db"), "--dir", str(tmp_path / "missing"), "migrate")
    assert code == 1 and out == ""
    assert err == f"error: migrations directory not found: {tmp_path / 'missing'}\n"
