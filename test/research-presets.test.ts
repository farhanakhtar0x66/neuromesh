import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validatePreset } from "../src/presets/presets.ts";

const RESEARCH_DIR = fileURLToPath(new URL("../presets/research/", import.meta.url));

test("every candidate preset in presets/research/*.json conforms to the Preset schema", () => {
  const files = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 8, `Expected at least 8 research presets, found ${files.length}`);

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(RESEARCH_DIR, file), "utf8"));
    const preset = validatePreset(raw, file);
    assert.equal(preset.name, file.replace(/\.json$/, ""), `Preset name in ${file} must match filename`);
    assert.ok(preset.mode === "solo" || preset.mode === "team", `Invalid mode in ${file}`);
    assert.ok(preset.roles.worker && preset.roles.worker.length > 0, `Preset ${file} must have a worker role`);
    if (preset.mode === "team") {
      assert.ok(preset.roles.orchestrator && preset.roles.orchestrator.length > 0, `Team preset ${file} must have an orchestrator`);
      assert.ok(preset.turnTimeoutMinutes > 0, `Team preset ${file} must have positive turnTimeoutMinutes`);
      assert.ok(preset.maxTasks > 0, `Team preset ${file} must have positive maxTasks`);
    }
  }
});
