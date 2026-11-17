"""Applying migrations."""

from __future__ import annotations

import time
from typing import Callable

from .db import applied_ids, connect, ensure_history
from .errors import MigrationError
from .loader import load_migrations


class Migrator:
    def __init__(self, db_path: str, migrations_dir: str, *, clock: Callable[[], float] = time.time):
        self.db_path = db_path
        self.migrations_dir = migrations_dir
        self.clock = clock

    def migrate(self) -> list[str]:
        """Apply every migration that is not in the history, in id order. Returns the ids applied."""
        migrations = load_migrations(self.migrations_dir)
        conn = connect(self.db_path)
        try:
            ensure_history(conn)
            done = applied_ids(conn)
            applied = []
            for m in migrations:
                if m.id in done:
                    continue
                try:
                    m.up(conn)
                    conn.execute("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", (m.id, self.clock()))
                    conn.commit()
                except Exception as exc:
                    raise MigrationError(f"migration {m.id} failed: {exc}") from exc
                applied.append(m.id)
            return applied
        finally:
            conn.close()

    def status(self) -> list[tuple[str, bool]]:
        """Every migration, in id order, with whether it is applied."""
        migrations = load_migrations(self.migrations_dir)
        conn = connect(self.db_path)
        try:
            ensure_history(conn)
            done = applied_ids(conn)
            return [(m.id, m.id in done) for m in migrations]
        finally:
            conn.close()
