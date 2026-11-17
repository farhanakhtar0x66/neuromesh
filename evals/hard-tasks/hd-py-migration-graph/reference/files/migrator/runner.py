"""Applying and reverting migrations (docs/MIGRATIONS.md)."""

from __future__ import annotations

import os
import sqlite3
import time
from typing import Callable

from .db import applied_ids, connect, ensure_tables, read_applied
from .errors import MigrationError
from .graph import Graph
from .loader import Migration, load_migrations


class Migrator:
    def __init__(
        self,
        db_path: str,
        migrations_dir: str,
        *,
        clock: Callable[[], float] = time.time,
        lock_max_age: float = 600.0,
        owner: str | None = None,
    ):
        self.db_path = db_path
        self.migrations_dir = migrations_dir
        self.clock = clock
        self.lock_max_age = lock_max_age
        self.owner = owner or f"pid-{os.getpid()}"

    def _graph(self) -> Graph:
        return Graph(load_migrations(self.migrations_dir))

    # -- the lock ---------------------------------------------------------------------------

    def _acquire(self, conn: sqlite3.Connection) -> None:
        try:
            conn.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as exc:
            raise MigrationError(f"migration lock is held by another process ({exc})") from exc
        try:
            row = conn.execute("SELECT owner, acquired_at FROM migration_lock WHERE id = 1").fetchone()
            now = self.clock()
            if row is None:
                conn.execute("INSERT INTO migration_lock (id, owner, acquired_at) VALUES (1, ?, ?)", (self.owner, now))
            else:
                age = now - row[1]
                if age <= self.lock_max_age:
                    raise MigrationError(f"migration lock is held by {row[0]} (taken {int(age)} seconds ago)")
                conn.execute("UPDATE migration_lock SET owner = ?, acquired_at = ? WHERE id = 1", (self.owner, now))
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise

    def _release(self, conn: sqlite3.Connection) -> None:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM migration_lock WHERE id = 1 AND owner = ?", (self.owner,))
        conn.execute("COMMIT")

    # -- one migration, one transaction -----------------------------------------------------

    def _run(self, conn: sqlite3.Connection, m: Migration, *, up: bool) -> None:
        conn.execute("BEGIN")
        try:
            if up:
                m.up(conn)
                conn.execute("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", (m.id, self.clock()))
            else:
                assert m.down is not None
                m.down(conn)
                conn.execute("DELETE FROM schema_migrations WHERE id = ?", (m.id,))
            conn.execute("COMMIT")
        except BaseException as exc:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            if isinstance(exc, Exception):
                raise MigrationError(f"migration {m.id} failed: {exc}") from exc
            raise

    def _locked(self, work: Callable[[sqlite3.Connection], list[str]]) -> list[str]:
        conn = connect(self.db_path)
        try:
            ensure_tables(conn)
            self._acquire(conn)
            try:
                return work(conn)
            finally:
                self._release(conn)
        finally:
            conn.close()

    # -- the commands -----------------------------------------------------------------------

    def migrate(self, to: str | None = None) -> list[str]:
        """Apply the pending migrations (or those `to` needs), in dependency order. Returns the ids applied."""
        graph = self._graph()
        if to is None:
            graph.check_single_head()
        else:
            graph.require(to)

        def work(conn: sqlite3.Connection) -> list[str]:
            done = []
            for mid in graph.to_apply(applied_ids(conn), to):
                self._run(conn, graph.migrations[mid], up=True)
                done.append(mid)
            return done

        return self._locked(work)

    def rollback(self, migration_id: str) -> list[str]:
        """Revert a migration and everything applied that depends on it. Returns the ids reverted."""
        graph = self._graph()
        graph.require(migration_id)

        def work(conn: sqlite3.Connection) -> list[str]:
            applied = applied_ids(conn)
            if migration_id not in applied:
                raise MigrationError(f"migration {migration_id} is not applied")
            ids = graph.to_revert(applied, migration_id)
            for mid in ids:
                if graph.migrations[mid].down is None:
                    raise MigrationError(f"migration {mid} has no down()")
            done = []
            for mid in ids:
                self._run(conn, graph.migrations[mid], up=False)
                done.append(mid)
            return done

        return self._locked(work)

    def plan(self, to: str | None = None, rollback: str | None = None) -> str:
        """What `migrate` / `rollback` would do, as text. Reads the history, writes nothing."""
        graph = self._graph()
        if rollback is not None:
            graph.require(rollback)
            applied = read_applied(self.db_path)
            if rollback not in applied:
                raise MigrationError(f"migration {rollback} is not applied")
            ids = graph.to_revert(applied, rollback)
            return "\n".join([*(f"revert {i}" for i in ids), f"{len(ids)} to revert"])
        if to is None:
            graph.check_single_head()
        else:
            graph.require(to)
        ids = graph.to_apply(read_applied(self.db_path), to)
        if not ids:
            return "nothing to apply"
        return "\n".join([*(f"apply {i}" for i in ids), f"{len(ids)} to apply"])

    def status(self) -> list[tuple[str, bool]]:
        """Every migration, in dependency order, with whether it is applied."""
        graph = self._graph()
        applied = read_applied(self.db_path)
        return [(mid, mid in applied) for mid in graph.order]
