"""The dependency graph of a set of migrations (docs/MIGRATIONS.md, section 3 to 5)."""

from __future__ import annotations

import heapq

from .errors import MigrationError
from .loader import Migration


class Graph:
    def __init__(self, migrations: list[Migration]):
        ordered = sorted(migrations, key=lambda m: m.id)
        self.ids = [m.id for m in ordered]
        self.migrations = {m.id: m for m in ordered}
        # A migration that declares nothing depends on the one with the next lower id.
        self.deps: dict[str, tuple[str, ...]] = {}
        for i, m in enumerate(ordered):
            if m.depends_on is None:
                self.deps[m.id] = (self.ids[i - 1],) if i > 0 else ()
            else:
                self.deps[m.id] = tuple(sorted(set(m.depends_on)))
        for mid in self.ids:
            for dep in self.deps[mid]:
                if dep not in self.migrations:
                    raise MigrationError(f"migration {mid} depends on missing migration {dep}")
        self.dependents: dict[str, list[str]] = {mid: [] for mid in self.ids}
        for mid in self.ids:
            for dep in self.deps[mid]:
                self.dependents[dep].append(mid)
        self.order = self._order()

    def _order(self) -> list[str]:
        waiting = {mid: len(self.deps[mid]) for mid in self.ids}
        ready = [mid for mid in self.ids if waiting[mid] == 0]
        heapq.heapify(ready)
        order: list[str] = []
        while ready:
            mid = heapq.heappop(ready)
            order.append(mid)
            for later in self.dependents[mid]:
                waiting[later] -= 1
                if waiting[later] == 0:
                    heapq.heappush(ready, later)
        if len(order) != len(self.ids):
            stuck = sorted(set(self.ids) - set(order))
            raise MigrationError(f"dependency cycle among: {', '.join(stuck)}")
        return order

    def heads(self) -> list[str]:
        return [mid for mid in self.ids if not self.dependents[mid]]

    def check_single_head(self) -> None:
        heads = self.heads()
        if len(heads) > 1:
            raise MigrationError(f"multiple heads: {', '.join(heads)} (add a migration that depends on all of them)")

    def require(self, migration_id: str) -> None:
        if migration_id not in self.migrations:
            raise MigrationError(f"unknown migration: {migration_id}")

    def _closure(self, start: str, edges: dict) -> set[str]:
        seen = {start}
        stack = [start]
        while stack:
            for nxt in edges[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    def to_apply(self, applied: set[str], to: str | None) -> list[str]:
        """The not yet applied migrations `migrate` (up to `to`) would run, in order."""
        wanted = set(self.ids) if to is None else self._closure(to, self.deps)
        return [mid for mid in self.order if mid in wanted and mid not in applied]

    def to_revert(self, applied: set[str], target: str) -> list[str]:
        """`target` and the applied migrations that depend on it, in the order to revert them."""
        affected = self._closure(target, self.dependents)
        return [mid for mid in reversed(self.order) if mid in affected and mid in applied]
