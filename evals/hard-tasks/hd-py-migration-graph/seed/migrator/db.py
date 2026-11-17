"""Connecting, and the history table."""

from __future__ import annotations

import sqlite3

HISTORY_DDL = "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at REAL NOT NULL)"


def connect(path: str) -> sqlite3.Connection:
    return sqlite3.connect(path)


def ensure_history(conn: sqlite3.Connection) -> None:
    conn.execute(HISTORY_DDL)
    conn.commit()


def applied_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM schema_migrations")}
