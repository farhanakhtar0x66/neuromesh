"""Hidden checks for docs/MIGRATIONS.md (dependency graph, plan, rollback, lock, transactions)."""

import io
import random
import re
import sqlite3

import pytest

from migrator.cli import main
from migrator.errors import MigrationError
from migrator.runner import Migrator

LOCK_DDL = """CREATE TABLE IF NOT EXISTS migration_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner TEXT NOT NULL,
    acquired_at REAL NOT NULL
)"""
NO = object()  # "do not write this part"


# ----------------------------------------------------------------- helpers

def mig(folder, mid, deps=NO, up=NO, down=NO):
    """Write a migration file. Defaults: create table t_<id>, drop it in down, no DEPENDS_ON line."""
    up_body = f'conn.execute("CREATE TABLE t_{mid} (x)")' if up is NO else up
    lines = []
    if deps is not NO:
        lines.append(f"DEPENDS_ON = {list(deps)!r}")
    lines += ["", "def up(conn):", *[f"    {s}" for s in up_body.splitlines()]]
    down_body = f'conn.execute("DROP TABLE t_{mid}")' if down is NO else down
    if down_body is not None:
        lines += ["", "def down(conn):", *[f"    {s}" for s in down_body.splitlines()]]
    (folder / f"{mid}.py").write_text("\n".join(lines) + "\n")


@pytest.fixture
def env(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()

    class Env:
        dir = folder
        db = str(tmp_path / "app.db")

        def migrator(self, **kw):
            return Migrator(self.db, str(folder), **kw)

    return Env()


def tables(db):
    with sqlite3.connect(db) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def history(db):
    if "schema_migrations" not in tables(db):
        return set()
    with sqlite3.connect(db) as conn:
        return {r[0] for r in conn.execute("SELECT id FROM schema_migrations")}


def lock_rows(db):
    if "migration_lock" not in tables(db):
        return []
    with sqlite3.connect(db) as conn:
        return conn.execute("SELECT id, owner, acquired_at FROM migration_lock").fetchall()


def put_lock(db, owner, at):
    with sqlite3.connect(db) as conn:
        conn.execute(LOCK_DDL)
        conn.execute("INSERT INTO migration_lock (id, owner, acquired_at) VALUES (1, ?, ?)", (owner, at))


def cli(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = main(list(argv), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def doc_example(env):
    mig(env.dir, "0001_users")
    mig(env.dir, "0002_posts")
    mig(env.dir, "0003_tags", deps=["0002_posts"])
    mig(env.dir, "0003_flags", deps=["0002_posts"])
    mig(env.dir, "0004_merge", deps=["0003_tags", "0003_flags"])


def diamond(env):
    mig(env.dir, "0001_a", deps=[])
    mig(env.dir, "0002_b", deps=["0001_a"])
    mig(env.dir, "0003_c", deps=["0001_a"])
    mig(env.dir, "0004_d", deps=["0002_b", "0003_c"])
    mig(env.dir, "0005_e", deps=["0003_c"])


DOC_ORDER = ["0001_users", "0002_posts", "0003_flags", "0003_tags", "0004_merge"]


# --------------------------------------------------- order and the graph

def test_order_follows_dependencies_and_ties_go_by_id(env):
    doc_example(env)
    m = env.migrator()
    assert [i for i, _ in m.status()] == DOC_ORDER
    assert m.migrate() == DOC_ORDER
    assert history(env.db) == set(DOC_ORDER)


def test_a_declared_dependency_beats_id_order(env):
    mig(env.dir, "0001_a", deps=["0003_c"])
    mig(env.dir, "0002_b")  # nothing declared: depends on 0001_a
    mig(env.dir, "0003_c", deps=[])
    assert env.migrator().migrate() == ["0003_c", "0001_a", "0002_b"]


def test_no_declaration_means_the_previous_id_and_an_empty_list_means_nothing(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b")
    mig(env.dir, "0003_c")
    assert env.migrator().migrate() == ["0001_a", "0002_b", "0003_c"]
    mig(env.dir, "0004_d", deps=[])
    mig(env.dir, "0005_e")  # depends on 0004_d now
    with pytest.raises(MigrationError, match="multiple heads: 0003_c, 0005_e"):
        env.migrator().migrate()
    assert env.migrator().migrate(to="0005_e") == ["0004_d", "0005_e"]


def test_duplicate_dependencies_count_once(env):
    mig(env.dir, "0001_a", deps=[])
    mig(env.dir, "0002_b", deps=["0001_a", "0001_a"])
    assert env.migrator().migrate() == ["0001_a", "0002_b"]


def test_missing_dependency_is_reported_by_every_command(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", deps=["0009_zz", "0005_yy"])
    mig(env.dir, "0003_c", deps=["0008_q"])
    want = "migration 0002_b depends on missing migration 0005_yy"
    m = env.migrator()
    for call in (m.migrate, m.status, m.plan, lambda: m.rollback("0001_a"), lambda: m.migrate(to="0001_a")):
        with pytest.raises(MigrationError) as e:
            call()
        assert str(e.value) == want
    code, out, err = cli("--db", env.db, "--dir", str(env.dir), "status")
    assert (code, out, err) == (1, "", f"error: {want}\n")


def test_cycle_message_lists_the_cycle_and_what_depends_on_it(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", deps=["0003_c"])
    mig(env.dir, "0003_c", deps=["0002_b"])
    mig(env.dir, "0004_d", deps=["0003_c"])
    mig(env.dir, "0005_e", deps=["0001_a"])
    m = env.migrator()
    with pytest.raises(MigrationError) as e:
        m.migrate()
    assert str(e.value) == "dependency cycle among: 0002_b, 0003_c, 0004_d"
    with pytest.raises(MigrationError, match="dependency cycle among: 0002_b, 0003_c, 0004_d"):
        m.plan()
    assert history(env.db) == set()


def test_a_migration_that_depends_on_itself_is_a_cycle(env):
    mig(env.dir, "0001_a", deps=["0001_a"])
    with pytest.raises(MigrationError) as e:
        env.migrator().migrate()
    assert str(e.value) == "dependency cycle among: 0001_a"


def test_a_missing_dependency_is_reported_before_a_cycle(env):
    mig(env.dir, "0001_a", deps=["0002_b"])
    mig(env.dir, "0002_b", deps=["0001_a", "0009_nope"])
    with pytest.raises(MigrationError) as e:
        env.migrator().migrate()
    assert str(e.value) == "migration 0002_b depends on missing migration 0009_nope"


def test_two_heads_without_a_merge(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", deps=["0001_a"])
    mig(env.dir, "0003_c", deps=["0001_a"])
    want = "multiple heads: 0002_b, 0003_c (add a migration that depends on all of them)"
    m = env.migrator()
    with pytest.raises(MigrationError) as e:
        m.migrate()
    assert str(e.value) == want
    with pytest.raises(MigrationError) as e:
        m.plan()
    assert str(e.value) == want
    assert history(env.db) == set()
    assert [i for i, _ in m.status()] == ["0001_a", "0002_b", "0003_c"]  # status does not check heads
    code, _, err = cli("--db", env.db, "--dir", str(env.dir), "migrate")
    assert (code, err) == (1, f"error: {want}\n")


def test_heads_are_not_checked_for_a_target_or_a_rollback(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", deps=["0001_a"])
    mig(env.dir, "0003_c", deps=["0001_a"])
    m = env.migrator()
    assert m.migrate(to="0003_c") == ["0001_a", "0003_c"]
    with pytest.raises(MigrationError, match="multiple heads"):
        m.migrate()  # still two heads, applied or not
    assert m.plan(to="0002_b") == "apply 0002_b\n1 to apply"
    assert m.rollback("0001_a") == ["0003_c", "0001_a"]


def test_a_merge_migration_makes_the_branches_one_head(env):
    doc_example(env)
    assert env.migrator().plan().splitlines()[-1] == "5 to apply"


def test_history_rows_without_a_file_are_ignored(env):
    mig(env.dir, "0001_a")
    m = env.migrator()
    m.migrate()
    with sqlite3.connect(env.db) as conn:
        conn.execute("INSERT INTO schema_migrations VALUES ('0099_gone', 1.0)")
    assert m.status() == [("0001_a", True)]
    assert m.migrate() == []


# ------------------------------------------------------- migrate --to

def test_migrate_to_applies_the_target_and_its_ancestors_only(env):
    diamond(env)
    m = env.migrator()
    assert m.migrate(to="0005_e") == ["0001_a", "0003_c", "0005_e"]
    assert {t for t in tables(env.db) if t.startswith("t_")} == {"t_0001_a", "t_0003_c", "t_0005_e"}
    assert m.migrate(to="0004_d") == ["0002_b", "0004_d"]  # a and c are already there
    assert m.migrate(to="0004_d") == []
    assert m.migrate(to="0001_a") == []
    assert history(env.db) == {"0001_a", "0002_b", "0003_c", "0004_d", "0005_e"}


def test_migrate_to_an_unknown_migration(env):
    diamond(env)
    with pytest.raises(MigrationError) as e:
        env.migrator().migrate(to="0042_nope")
    assert str(e.value) == "unknown migration: 0042_nope"
    assert history(env.db) == set()


# ------------------------------------------------------------ rollback

def test_rollback_reverts_dependents_first_and_only_applied_ones(env):
    diamond(env)
    m = env.migrator()
    m.migrate(to="0004_d")
    m.migrate(to="0005_e")
    assert m.rollback("0002_b") == ["0004_d", "0002_b"]
    assert {t for t in tables(env.db) if t.startswith("t_")} == {"t_0001_a", "t_0003_c", "t_0005_e"}
    assert history(env.db) == {"0001_a", "0003_c", "0005_e"}
    assert m.rollback("0001_a") == ["0005_e", "0003_c", "0001_a"]
    assert {t for t in tables(env.db) if t.startswith("t_")} == set()
    assert history(env.db) == set()


def test_rollback_does_not_touch_unapplied_dependents(env):
    diamond(env)
    m = env.migrator()
    m.migrate(to="0002_b")
    assert m.rollback("0001_a") == ["0002_b", "0001_a"]


def test_rollback_order_is_the_reverse_of_the_apply_order_not_id_descending(env):
    mig(env.dir, "0001_late", deps=["0003_base"])
    mig(env.dir, "0002_mid", deps=["0001_late"])
    mig(env.dir, "0003_base", deps=[])
    m = env.migrator()
    assert m.migrate() == ["0003_base", "0001_late", "0002_mid"]
    assert m.rollback("0003_base") == ["0002_mid", "0001_late", "0003_base"]


def test_rollback_errors(env):
    diamond(env)
    m = env.migrator()
    with pytest.raises(MigrationError) as e:
        m.rollback("0002_b")
    assert str(e.value) == "migration 0002_b is not applied"
    with pytest.raises(MigrationError) as e:
        m.rollback("0042_nope")
    assert str(e.value) == "unknown migration: 0042_nope"


def test_rollback_checks_every_down_before_reverting_anything(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", down=None)
    mig(env.dir, "0003_c", down=None)
    m = env.migrator()
    m.migrate()
    with pytest.raises(MigrationError) as e:
        m.rollback("0001_a")
    assert str(e.value) == "migration 0003_c has no down()"  # the first one in revert order
    assert history(env.db) == {"0001_a", "0002_b", "0003_c"}
    assert {"t_0001_a", "t_0002_b", "t_0003_c"} <= tables(env.db)
    assert lock_rows(env.db) == []


# ----------------------------------------------------------------- plan

def test_plan_text(env):
    doc_example(env)
    m = env.migrator()
    assert m.plan() == "\n".join([*(f"apply {i}" for i in DOC_ORDER), "5 to apply"])
    assert m.plan(to="0003_tags") == "apply 0001_users\napply 0002_posts\napply 0003_tags\n3 to apply"
    m.migrate(to="0003_tags")
    assert m.plan() == "apply 0003_flags\napply 0004_merge\n2 to apply"
    m.migrate()
    assert m.plan() == "nothing to apply"
    assert m.plan(rollback="0003_tags") == "revert 0004_merge\nrevert 0003_tags\n2 to revert"
    assert m.plan(rollback="0004_merge") == "revert 0004_merge\n1 to revert"
    assert m.plan(rollback="0001_users").splitlines()[-1] == "5 to revert"


def test_plan_rollback_of_something_not_applied(env):
    doc_example(env)
    with pytest.raises(MigrationError) as e:
        env.migrator().plan(rollback="0004_merge")
    assert str(e.value) == "migration 0004_merge is not applied"


def test_plan_writes_nothing(env):
    doc_example(env)
    m = env.migrator()
    m.plan()
    m.plan(to="0003_tags")
    assert tables(env.db) == set()
    m.migrate(to="0002_posts")
    before = (tables(env.db), history(env.db), lock_rows(env.db))
    m.plan()
    m.plan(rollback="0002_posts")
    assert (tables(env.db), history(env.db), lock_rows(env.db)) == before


def test_status_follows_the_dependency_order(env):
    doc_example(env)
    m = env.migrator()
    m.migrate(to="0003_flags")
    assert m.status() == [("0001_users", True), ("0002_posts", True), ("0003_flags", True), ("0003_tags", False), ("0004_merge", False)]
    code, out, _ = cli("--db", env.db, "--dir", str(env.dir), "status")
    assert out.splitlines() == ["[x] 0001_users", "[x] 0002_posts", "[x] 0003_flags", "[ ] 0003_tags", "[ ] 0004_merge"]


# ------------------------------------------------------------------ CLI

def test_cli_plan_migrate_rollback(env):
    doc_example(env)
    base = ["--db", env.db, "--dir", str(env.dir)]
    code, out, err = cli(*base, "plan", "--to", "0002_posts")
    assert (code, out, err) == (0, "apply 0001_users\napply 0002_posts\n2 to apply\n", "")
    code, out, _ = cli(*base, "migrate", "--to", "0003_tags")
    assert out.splitlines() == ["applied 0001_users", "applied 0002_posts", "applied 0003_tags"]
    code, out, _ = cli(*base, "migrate")
    assert out.splitlines() == ["applied 0003_flags", "applied 0004_merge"]
    assert cli(*base, "migrate")[1] == "nothing to apply\n"
    assert cli(*base, "plan")[1] == "nothing to apply\n"
    assert cli(*base, "plan", "--rollback", "0003_flags")[1] == "revert 0004_merge\nrevert 0003_flags\n2 to revert\n"
    code, out, err = cli(*base, "rollback", "0003_flags")
    assert (code, out.splitlines(), err) == (0, ["reverted 0004_merge", "reverted 0003_flags"], "")
    code, out, err = cli(*base, "rollback", "0004_merge")
    assert (code, out, err) == (1, "", "error: migration 0004_merge is not applied\n")
    code, out, err = cli(*base, "migrate", "--to", "0007_none")
    assert (code, out, err) == (1, "", "error: unknown migration: 0007_none\n")


def test_cli_prints_a_held_lock_as_an_error_and_honours_the_age_limit(env):
    import time

    mig(env.dir, "0001_a")
    put_lock(env.db, "ci-runner", time.time() - 100)
    base = ["--db", env.db, "--dir", str(env.dir)]
    code, out, err = cli(*base, "migrate")
    assert code == 1 and out == ""
    assert re.fullmatch(r"error: migration lock is held by ci-runner \(taken 10\d seconds ago\)\n", err)
    code, out, err = cli(*base, "--lock-max-age", "50", "migrate")
    assert (code, out, err) == (0, "applied 0001_a\n", "")
    assert lock_rows(env.db) == []


# ----------------------------------------------------------------- the lock

def test_a_fresh_lock_stops_the_run_and_nothing_changes(env):
    diamond(env)
    put_lock(env.db, "other", 1000.0)
    m = env.migrator(clock=lambda: 1100.9, owner="me")
    with pytest.raises(MigrationError) as e:
        m.migrate(to="0005_e")
    assert str(e.value) == "migration lock is held by other (taken 100 seconds ago)"
    assert history(env.db) == set() and not {t for t in tables(env.db) if t.startswith("t_")}
    assert lock_rows(env.db) == [(1, "other", 1000.0)]


def test_the_lock_age_limit_is_exclusive(env):
    mig(env.dir, "0001_a")
    put_lock(env.db, "other", 1000.0)
    with pytest.raises(MigrationError, match=r"held by other \(taken 600 seconds ago\)"):
        env.migrator(clock=lambda: 1600.0, lock_max_age=600.0).migrate()  # age == limit: still held
    assert env.migrator(clock=lambda: 1600.5, lock_max_age=600.0, owner="me").migrate() == ["0001_a"]  # older: taken over
    assert lock_rows(env.db) == []


def test_a_lock_age_limit_can_be_set(env):
    mig(env.dir, "0001_a")
    put_lock(env.db, "other", 1000.0)
    with pytest.raises(MigrationError):
        env.migrator(clock=lambda: 1030.0, lock_max_age=60.0).migrate()
    assert env.migrator(clock=lambda: 1061.0, lock_max_age=60.0).migrate() == ["0001_a"]


def test_the_lock_is_ours_while_running_and_gone_afterwards(env):
    mig(env.dir, "0001_a", up='conn.execute("CREATE TABLE seen AS SELECT owner, acquired_at FROM migration_lock")')
    put_lock(env.db, "dead-run", 10.0)
    m = env.migrator(clock=lambda: 5000.0, owner="me")
    assert m.migrate() == ["0001_a"]
    with sqlite3.connect(env.db) as conn:
        assert conn.execute("SELECT owner, acquired_at FROM seen").fetchall() == [("me", 5000.0)]
    assert lock_rows(env.db) == []


def test_the_lock_is_taken_even_when_there_is_nothing_to_do_and_for_rollback(env):
    mig(env.dir, "0001_a")
    m = env.migrator(clock=lambda: 100.0)
    m.migrate()
    put_lock(env.db, "other", 99.0)
    with pytest.raises(MigrationError, match="migration lock is held by other"):
        m.migrate()
    with pytest.raises(MigrationError, match="migration lock is held by other"):
        m.rollback("0001_a")
    assert history(env.db) == {"0001_a"}
    # plan and status do not look at the lock
    assert m.plan() == "nothing to apply"
    assert m.status() == [("0001_a", True)]


def test_the_lock_is_released_after_a_failure(env):
    mig(env.dir, "0001_a", up='raise RuntimeError("nope")')
    with pytest.raises(MigrationError):
        env.migrator().migrate()
    assert lock_rows(env.db) == []


def test_releasing_leaves_a_lock_that_someone_else_took(env):
    mig(env.dir, "0001_a", up='conn.execute("CREATE TABLE t_0001_a (x)")\nconn.execute("UPDATE migration_lock SET owner = \'intruder\'")')
    env.migrator(owner="me").migrate()
    assert [r[1] for r in lock_rows(env.db)] == ["intruder"]


# --------------------------------------------------------- transactions

def test_a_migration_that_fails_half_way_leaves_nothing_of_itself(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_half", up=(
        'conn.execute("CREATE TABLE half (x)")\n'
        'conn.execute("INSERT INTO half VALUES (1)")\n'
        'conn.execute("CREATE TABLE half_two (y)")\n'
        'raise RuntimeError("boom")'))
    mig(env.dir, "0003_after")
    m = env.migrator()
    with pytest.raises(MigrationError) as e:
        m.migrate()
    assert str(e.value) == "migration 0002_half failed: boom"
    assert history(env.db) == {"0001_a"}
    ts = tables(env.db)
    assert "t_0001_a" in ts and not ({"half", "half_two", "t_0003_after"} & ts)
    assert lock_rows(env.db) == []
    # fixing the migration lets the run continue where it stopped
    mig(env.dir, "0002_half")
    assert m.migrate() == ["0002_half", "0003_after"]


def test_a_failing_statement_is_reported_with_its_message(env):
    mig(env.dir, "0001_a", up='conn.execute("CREATE TABLE a (x)")\nconn.execute("INSERT INTO missing_table VALUES (1)")')
    with pytest.raises(MigrationError) as e:
        env.migrator().migrate()
    assert str(e.value) == "migration 0001_a failed: no such table: missing_table"
    assert "a" not in tables(env.db) and history(env.db) == set()


def test_the_history_row_is_written_in_the_same_transaction(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", up=(
        'conn.execute("CREATE TABLE t_0002_b (x)")\n'
        "conn.execute(\"CREATE TRIGGER stop BEFORE INSERT ON schema_migrations WHEN NEW.id = '0002_b' "
        "BEGIN SELECT RAISE(ABORT, 'no history'); END\")"))
    with pytest.raises(MigrationError) as e:
        env.migrator().migrate()
    assert str(e.value) == "migration 0002_b failed: no history"
    assert "t_0002_b" not in tables(env.db)
    with sqlite3.connect(env.db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'").fetchone()[0] == 0
    assert history(env.db) == {"0001_a"}


def test_a_down_that_fails_half_way_changes_nothing_of_itself(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b", down='conn.execute("DROP TABLE t_0002_b")\nraise RuntimeError("nope")')
    mig(env.dir, "0003_c")
    m = env.migrator()
    m.migrate()
    with pytest.raises(MigrationError) as e:
        m.rollback("0001_a")
    assert str(e.value) == "migration 0002_b failed: nope"
    assert history(env.db) == {"0001_a", "0002_b"}  # 0003_c was reverted before the failure
    ts = tables(env.db)
    assert {"t_0001_a", "t_0002_b"} <= ts and "t_0003_c" not in ts
    assert lock_rows(env.db) == []


def test_the_history_row_is_deleted_in_the_same_transaction(env):
    mig(env.dir, "0001_a")
    mig(env.dir, "0002_b")
    m = env.migrator()
    m.migrate()
    with sqlite3.connect(env.db) as conn:
        conn.execute("CREATE TRIGGER keep BEFORE DELETE ON schema_migrations WHEN OLD.id = '0002_b' BEGIN SELECT RAISE(ABORT, 'no delete'); END")
    with pytest.raises(MigrationError) as e:
        m.rollback("0002_b")
    assert str(e.value) == "migration 0002_b failed: no delete"
    assert "t_0002_b" in tables(env.db) and history(env.db) == {"0001_a", "0002_b"}


# ------------------------------------------------- random graphs (oracle)

def o_graph(spec):
    """Independent oracle: ('err', message) or ('ok', order, deps). spec: id -> list of deps or None."""
    ids = sorted(spec)
    deps = {}
    for k, i in enumerate(ids):
        deps[i] = set(spec[i]) if spec[i] is not None else ({ids[k - 1]} if k else set())
    for i in ids:
        for d in sorted(deps[i]):
            if d not in deps:
                return ("err", f"migration {i} depends on missing migration {d}")
    done, left = [], set(ids)
    while left:
        ready = sorted(i for i in left if deps[i] <= set(done))
        if not ready:
            return ("err", "dependency cycle among: " + ", ".join(sorted(left)))
        done.append(ready[0])
        left.discard(ready[0])
    return ("ok", done, deps)


def o_heads(deps):
    used = set().union(*deps.values()) if deps else set()
    return sorted(i for i in deps if i not in used)


def o_ancestors(deps, start):
    seen, grew = {start}, True
    while grew:
        grew = False
        for i in list(seen):
            for d in deps[i]:
                if d not in seen:
                    seen.add(d)
                    grew = True
    return seen


def o_descendants(deps, start):
    seen, grew = {start}, True
    while grew:
        grew = False
        for i in deps:
            if i not in seen and deps[i] & seen:
                seen.add(i)
                grew = True
    return seen


def make_spec(rng):
    n = rng.randint(2, 9)
    nums = rng.sample(range(1, 60), n)
    ids = [f"{k:04d}_{rng.choice('abcdefg')}" for k in nums]
    rank = list(range(n))
    rng.shuffle(rank)  # a dependency always points at a lower rank, so declared graphs are acyclic
    spec = {}
    for i, mid in enumerate(ids):
        if rng.random() < 0.2:
            spec[mid] = None
            continue
        lower = [ids[j] for j in range(n) if rank[j] < rank[i]]
        deps = [d for d in lower if rng.random() < 0.4][:3]
        if deps and rng.random() < 0.1:
            deps.append(deps[0])
        spec[mid] = deps
    if rng.random() < 0.06:
        spec[rng.choice(ids)] = ["0099_missing"]
    if rng.random() < 0.06:
        a, b = rng.sample(ids, 2)
        spec[a] = (spec[a] or []) + [b]
        spec[b] = (spec[b] or []) + [a]
    return spec


def write_spec(folder, spec):
    for mid, deps in spec.items():
        mig(folder, mid, deps=NO if deps is None else deps)


def tables_of(db):
    return {t[2:] for t in tables(db) if t.startswith("t_")}


def test_random_graphs_order_status_plan_and_errors(tmp_path):
    rng = random.Random(20261117)
    kinds = {"ok": 0, "multi-head": 0, "missing": 0, "cycle": 0}
    for case in range(300):
        folder = tmp_path / f"c{case}"
        folder.mkdir()
        spec = make_spec(rng)
        write_spec(folder, spec)
        m = Migrator(str(tmp_path / f"c{case}.db"), str(folder))
        want = o_graph(spec)
        if want[0] == "err":
            kinds["missing" if "missing" in want[1] else "cycle"] += 1
            for call in (m.status, m.plan, m.migrate, lambda: m.migrate(to=next(iter(spec)))):
                with pytest.raises(MigrationError) as e:
                    call()
                assert str(e.value) == want[1], f"case {case}: {spec}"
            continue
        _, order, deps = want
        assert [i for i, _ in m.status()] == order, f"case {case}: {spec}"
        heads = o_heads(deps)
        if len(heads) > 1:
            kinds["multi-head"] += 1
            with pytest.raises(MigrationError) as e:
                m.plan()
            assert str(e.value) == f"multiple heads: {', '.join(heads)} (add a migration that depends on all of them)", f"case {case}"
            with pytest.raises(MigrationError):
                m.migrate()
        else:
            kinds["ok"] += 1
            assert m.plan() == "\n".join([*(f"apply {i}" for i in order), f"{len(order)} to apply"]), f"case {case}: {spec}"
        target = rng.choice(order)
        need = [i for i in order if i in o_ancestors(deps, target)]
        assert m.plan(to=target) == "\n".join([*(f"apply {i}" for i in need), f"{len(need)} to apply"])
    assert min(kinds.values()) >= 5, kinds


def test_random_runs_apply_and_revert_like_the_oracle(tmp_path):
    rng = random.Random(7)
    ran = 0
    for case in range(150):
        spec = make_spec(rng)
        verdict = o_graph(spec)
        if verdict[0] == "err":
            continue
        _, order, deps = verdict
        heads = o_heads(deps)
        if len(heads) > 1 and rng.random() < 0.6:
            spec["9999_merge"] = list(heads)
            _, order, deps = o_graph(spec)
        folder = tmp_path / f"r{case}"
        folder.mkdir()
        write_spec(folder, spec)
        db = str(tmp_path / f"r{case}.db")
        m = Migrator(db, str(folder), clock=lambda: 1.0)
        applied: list[str] = []

        def check_state(label):
            assert tables_of(db) == set(applied), f"case {case} {label}: {spec}"
            assert history(db) == set(applied), f"case {case} {label}: {spec}"
            assert lock_rows(db) == []

        # a partial run to a random target
        t1 = rng.choice(order)
        need = [i for i in order if i in o_ancestors(deps, t1)]
        assert m.migrate(to=t1) == need, f"case {case}: {spec}"
        applied = need
        check_state("after --to")
        assert m.migrate(to=t1) == []
        # the rest of the graph: a second target, or everything when there is a single head
        if len(o_heads(deps)) == 1:
            rest = [i for i in order if i not in applied]
            assert m.migrate() == rest, f"case {case}: {spec}"
            applied = list(order)
        else:
            t2 = rng.choice(order)
            more = [i for i in order if i in o_ancestors(deps, t2) and i not in applied]
            assert m.migrate(to=t2) == more, f"case {case}: {spec}"
            applied = [i for i in order if i in set(applied) | set(more)]
        check_state("after the second run")
        # a rollback of a random applied migration
        victim = rng.choice(applied)
        gone = o_descendants(deps, victim)
        expect = [i for i in reversed(order) if i in gone and i in applied]
        assert m.plan(rollback=victim) == "\n".join([*(f"revert {i}" for i in expect), f"{len(expect)} to revert"])
        assert m.rollback(victim) == expect, f"case {case}: victim {victim} in {spec}"
        applied = [i for i in applied if i not in expect]
        check_state("after rollback")
        ran += 1
    assert ran >= 80, ran
