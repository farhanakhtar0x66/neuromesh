import sqlite3

import pytest

from helpers import write_migration
from migrator.errors import MigrationError
from migrator.loader import load_migrations
from migrator.runner import Migrator


@pytest.fixture
def chain(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    write_migration(folder, "0001_a", 'conn.execute("CREATE TABLE a (x)")')
    write_migration(folder, "0002_b", 'conn.execute("CREATE TABLE b (x)")')
    write_migration(folder, "0003_c", 'conn.execute("INSERT INTO a VALUES (1)")')
    return tmp_path


def tables(db):
    with sqlite3.connect(db) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def history(db):
    with sqlite3.connect(db) as conn:
        return [r[0] for r in conn.execute("SELECT id FROM schema_migrations ORDER BY id")]


def test_loader_sorts_by_id_and_skips_private_files(tmp_path):
    folder = tmp_path / "m"
    folder.mkdir()
    write_migration(folder, "0010_x", "pass")
    write_migration(folder, "0002_y", "pass")
    write_migration(folder, "_helper", "pass")
    assert [m.id for m in load_migrations(str(folder))] == ["0002_y", "0010_x"]


def test_loader_needs_up(tmp_path):
    folder = tmp_path / "m"
    folder.mkdir()
    (folder / "0001_bad.py").write_text("x = 1\n")
    with pytest.raises(MigrationError, match="0001_bad has no up"):
        load_migrations(str(folder))


def test_migrate_applies_in_id_order(chain):
    db = str(chain / "app.db")
    assert Migrator(db, str(chain / "migrations")).migrate() == ["0001_a", "0002_b", "0003_c"]
    assert history(db) == ["0001_a", "0002_b", "0003_c"]
    assert tables(db) >= {"a", "b", "schema_migrations"}


def test_migrate_twice_does_nothing_the_second_time(chain):
    m = Migrator(str(chain / "app.db"), str(chain / "migrations"))
    m.migrate()
    assert m.migrate() == []


def test_migrate_applies_only_new_files(chain):
    m = Migrator(str(chain / "app.db"), str(chain / "migrations"))
    m.migrate()
    write_migration(chain / "migrations", "0004_d", 'conn.execute("CREATE TABLE d (x)")')
    assert m.migrate() == ["0004_d"]


def test_history_records_the_clock(chain):
    db = str(chain / "app.db")
    Migrator(db, str(chain / "migrations"), clock=lambda: 1234.5).migrate()
    with sqlite3.connect(db) as conn:
        assert {r[0] for r in conn.execute("SELECT applied_at FROM schema_migrations")} == {1234.5}


def test_status_lists_applied_and_pending(chain):
    db = str(chain / "app.db")
    m = Migrator(db, str(chain / "migrations"))
    assert m.status() == [("0001_a", False), ("0002_b", False), ("0003_c", False)]
    m.migrate()
    assert m.status() == [("0001_a", True), ("0002_b", True), ("0003_c", True)]


def test_a_failing_data_migration_is_not_recorded(tmp_path):
    folder = tmp_path / "m"
    folder.mkdir()
    write_migration(folder, "0001_a", 'conn.execute("CREATE TABLE a (x)")')
    write_migration(folder, "0002_bad", 'conn.execute("INSERT INTO a VALUES (1)")\nraise RuntimeError("boom")')
    db = str(tmp_path / "app.db")
    with pytest.raises(MigrationError, match="migration 0002_bad failed: boom"):
        Migrator(db, str(folder)).migrate()
    assert history(db) == ["0001_a"]
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM a").fetchone()[0] == 0


def test_missing_directory(tmp_path):
    with pytest.raises(MigrationError, match="migrations directory not found"):
        Migrator(str(tmp_path / "app.db"), str(tmp_path / "nope")).migrate()
