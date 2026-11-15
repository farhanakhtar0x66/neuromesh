in `dag_scheduler.ts` (pure TypeScript, 0 dependencies), export `class BuildGraph`:
- `upsertNode(id: string, deps: string[], durationMs: number): { ok: boolean; cycle?: string[] }`
  Inserts or updates node `id` (where `deps` are prerequisite task IDs that must finish before `id` starts). If any `dep` does not exist yet, implicitly register it with `deps: [], durationMs: 0`. If adding/updating `id` creates a cycle, reject the change completely (leaving the graph strictly in its prior state) and return `{ ok: false, cycle }` where `cycle` starts and ends with the same node ID (`[u, ..., u]`) following dependency edges. Otherwise return `{ ok: true }`.
- `markDirty(id: string): string[]`
  Returns `id` and all nodes that transitively depend on `id`, ordered in valid topological execution order (prerequisites before dependents; tie-break lexicographically by node ID).
- `criticalPath(targets: string[]): { totalMs: number; path: string[]; parallelWaves: string[][] }`
  For the subgraph required to build `targets`, return:
  - `totalMs`: minimum total elapsed milliseconds assuming unlimited parallelism (longest duration-weighted path).
  - `path`: node IDs along that longest weighted path from earliest prerequisite to final target.
  - `parallelWaves`: array of topological waves (`string[][]`, each wave sorted lexicographically) where wave 0 has in-degree 0 in the target subgraph and each subsequent wave contains nodes whose dependencies are all in earlier waves.
