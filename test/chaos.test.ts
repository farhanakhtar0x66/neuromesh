// A fixed set of fault-harness seeds on every change (test/support/chaos.ts).
// Many more are run by hand: node evals/chaos.ts --seeds 2000

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runChaos } from "./support/chaos.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-chaos-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("random runs against misbehaving agents keep every rule (20 seeds)", { timeout: 600_000 }, async () => {
  const broken: string[] = [];
  for (let seed = 9001; seed <= 9020; seed++) {
    const result = await runChaos(seed, { scratch, deadlineMs: 60_000 });
    for (const v of result.violations) broken.push(`seed ${seed} (${result.scenario}): ${v}`);
    rmSync(join(scratch, `repo-${seed}`), { recursive: true, force: true });
    rmSync(join(scratch, `home-${seed}`), { recursive: true, force: true });
  }
  assert.deepEqual(broken, []);
});

test("runs whose engine process is killed part way resume and keep every rule (8 seeds)", { timeout: 600_000 }, () => {
  const runner = fileURLToPath(new URL("../evals/chaos.ts", import.meta.url));
  const r = spawnSync(process.execPath, [runner, "--kill", "1", "--seeds", "8", "--from", "9101", "--jobs", "4", "--deadline", "60"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout.slice(-2_000) + r.stderr.slice(-1_000));
  assert.match(r.stdout, /Every run kept every rule\./);
});
