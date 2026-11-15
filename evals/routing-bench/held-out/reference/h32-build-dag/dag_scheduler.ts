interface Node {
  deps: string[];
  durationMs: number;
}

export class BuildGraph {
  private nodes = new Map<string, Node>();

  upsertNode(id: string, deps: string[], durationMs: number): { ok: boolean; cycle?: string[] } {
    const clean = [...new Set(deps)];
    // Look for a path id -> dep -> ... -> id before touching anything.
    const next = (n: string): string[] => (n === id ? clean : this.nodes.get(n)?.deps ?? []);
    const seen = new Set<string>();
    const walk = (n: string, trail: string[]): string[] | undefined => {
      for (const d of next(n)) {
        if (d === id) return [...trail, d];
        if (seen.has(d)) continue;
        seen.add(d);
        const found = walk(d, [...trail, d]);
        if (found) return found;
      }
      return undefined;
    };
    const cycle = walk(id, [id]);
    if (cycle) return { ok: false, cycle };
    for (const d of clean) if (!this.nodes.has(d)) this.nodes.set(d, { deps: [], durationMs: 0 });
    this.nodes.set(id, { deps: clean, durationMs });
    return { ok: true };
  }

  /** Kahn's algorithm over `subset`, taking the smallest ready id each time. */
  private order(subset: Set<string>): string[] {
    const waiting = new Map<string, number>();
    for (const n of subset) waiting.set(n, (this.nodes.get(n)?.deps ?? []).filter((d) => subset.has(d)).length);
    const out: string[] = [];
    while (waiting.size > 0) {
      let pick: string | undefined;
      for (const [n, k] of waiting) if (k === 0 && (pick === undefined || n < pick)) pick = n;
      if (pick === undefined) break;
      waiting.delete(pick);
      out.push(pick);
      for (const [n] of waiting) if (this.nodes.get(n)!.deps.includes(pick)) waiting.set(n, waiting.get(n)! - 1);
    }
    return out;
  }

  markDirty(id: string): string[] {
    if (!this.nodes.has(id)) return [];
    const dirty = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [n, node] of this.nodes) if (!dirty.has(n) && node.deps.some((d) => dirty.has(d))) { dirty.add(n); grew = true; }
    }
    return this.order(dirty);
  }

  criticalPath(targets: string[]): { totalMs: number; path: string[]; parallelWaves: string[][] } {
    const need = new Set<string>();
    const visit = (n: string): void => {
      if (need.has(n) || !this.nodes.has(n)) return;
      need.add(n);
      for (const d of this.nodes.get(n)!.deps) visit(d);
    };
    targets.forEach(visit);
    const order = this.order(need);
    const best = new Map<string, { ms: number; via?: string }>();
    const wave = new Map<string, number>();
    for (const n of order) {
      const node = this.nodes.get(n)!;
      let via: string | undefined;
      let ms = 0;
      let w = 0;
      for (const d of node.deps) {
        if (!need.has(d)) continue;
        const b = best.get(d)!;
        if (via === undefined || b.ms > ms || (b.ms === ms && d < via)) { via = d; ms = b.ms; }
        w = Math.max(w, wave.get(d)! + 1);
      }
      best.set(n, { ms: ms + node.durationMs, via });
      wave.set(n, w);
    }
    let end: string | undefined;
    for (const t of targets) if (best.has(t) && (end === undefined || best.get(t)!.ms > best.get(end)!.ms)) end = t;
    const path: string[] = [];
    for (let n: string | undefined = end; n !== undefined; n = best.get(n)!.via) path.unshift(n);
    const waves: string[][] = [];
    for (const n of order) (waves[wave.get(n)!] ??= []).push(n);
    for (const w of waves) w?.sort();
    return { totalMs: end === undefined ? 0 : best.get(end)!.ms, path, parallelWaves: waves.filter(Boolean) };
  }
}
