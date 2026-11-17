"""Connecting, the history table and the lock table."""

from __future__ import annotations

import os
import sqlite3

HISTORY_DDL = "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at REAL NOT NULL)"
LOCK_DDL = """CREATE TABLE IF NOT EXISTS migration_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner TEXT NOT NULL,
    acquired_at REAL NOT NULL
)"""


def connect(path: str) -> sqlite3.Connection:
    # isolation_level=None: no implicit transactions. The Python sqlite3 module opens one only before
    # INSERT/UPDATE/DELETE, never before DDL, so DDL would run outside any transaction and could not be undone.
    # Every transaction here is an explicit BEGIN ... COMMIT/ROLLBACK.
    return sqlite3.connect(path, isolation_level=None)


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(HISTORY_DDL)
    conn.execute(LOCK_DDL)


def read_applied(path: str) -> set[str]:
    """The applied ids without writing anything: no file or no history table means none."""
    if not os.path.exists(path):
        return set()
    conn = connect(path)
    try:
        has = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").fetchone()
        return {r[0] for r in conn.execute("SELECT id FROM schema_migrations")} if has else set()
    finally:
        conn.close()


def applied_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM schema_migrations")}
