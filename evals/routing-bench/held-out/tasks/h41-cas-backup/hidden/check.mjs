import { pathToFileURL } from "node:url";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const items = [];
const item = (n, ok) => items.push([n, !!ok]);
const done = () => {
  for (const [n, ok] of items) console.log((ok ? "PASS " : "FAIL ") + n);
  const p = items.filter(([, ok]) => ok).length;
  console.log(`SCORE ${p}/${items.length}`);
  process.exit(p === items.length ? 0 : 1);
};
let api = {};
try { api = await import(pathToFileURL(process.cwd() + "/src/index.mjs").href); } catch (e) { console.log("  import failed:", e.message); }
const have = ["backup", "verify", "restore", "deleteSnapshot", "gc"].every((n) => typeof api[n] === "function");
item("src/index.mjs exports backup, verify, restore, deleteSnapshot, gc", have);
item("bin/cas.mjs exists", existsSync("bin/cas.mjs"));
if (!have) done();
const { backup, verify, restore, deleteSnapshot, gc } = api;

const tmp = mkdtempSync(join(tmpdir(), "cas-"));
const ok = async (fn) => { try { return await fn(); } catch (e) { console.log("  threw:", e?.message); return undefined; } };
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };
const tree = (dir, base = dir, out = {}) => {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) tree(p, base, out); else out[relative(base, p).split(sep).join("/")] = readFileSync(p).toString("base64");
  }
  return out;
};

const src = join(tmp, "src");
const big = randomBytes(32 * 1024);
mkdirSync(join(src, "a/deep"), { recursive: true });
mkdirSync(join(src, "b"), { recursive: true });
writeFileSync(join(src, "a/big1.bin"), big);
writeFileSync(join(src, "b/big2.bin"), big); // a duplicate of big1
writeFileSync(join(src, "a/deep/notes.txt"), "small file, version one\n");
writeFileSync(join(src, "hello.txt"), "hello");
writeFileSync(join(src, "empty.txt"), "");
const wide = Buffer.concat([randomBytes(20000), Buffer.from("tail")]);
writeFileSync(join(src, "wide.bin"), wide);

const store = join(tmp, "store");
const PASS = "correct horse battery staple";
const first = await ok(() => backup(src, store, PASS));
const second = await ok(() => backup(src, store, PASS));
const shape = (r) => r && typeof r.snapshotId === "string" && /^[0-9a-f]{64}$/.test(r.merkleRoot) && ["totalBytes", "uniqueChunks", "deduplicatedChunks"].every((k) => Number.isInteger(r.stats?.[k]));
item("backup returns a snapshot id, a 64-hex Merkle root and chunk stats", shape(first) && shape(second));
item("duplicate files and a repeat backup deduplicate chunks", first && second && first.stats.deduplicatedChunks > 0 && second.stats.deduplicatedChunks > 0 && first.stats.totalBytes === second.stats.totalBytes && first.snapshotId !== second.snapshotId);

const out1 = join(tmp, "out1");
await ok(() => restore(first.snapshotId, store, out1, PASS));
item("restore gives back every file byte for byte, at the same relative paths", existsSync(out1) && JSON.stringify(tree(out1)) === JSON.stringify(tree(src)));
item("verify passes on an untouched snapshot", (await ok(() => verify(first.snapshotId, store, PASS)))?.valid === true);

const wrong = join(tmp, "wrong");
const rv = await rejects(() => restore(first.snapshotId, store, wrong, "not the passphrase"));
const vv = await ok(async () => { try { return await verify(first.snapshotId, store, "not the passphrase"); } catch { return { valid: false, threw: true }; } });
item("a wrong passphrase is rejected and writes nothing", rv && vv?.valid === false && (!existsSync(wrong) || readdirSync(wrong).length === 0));

// damage one chunk in a copy of the store
const bad = join(tmp, "bad");
cpSync(store, bad, { recursive: true });
const all = [];
const scan = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) scan(p); else all.push(p); } };
scan(bad);
const binary = all.filter((p) => { const b = readFileSync(p); return b[0] !== 0x7b && b[0] !== 0x5b; });
const victim = binary.sort((x, y) => statSync(y).size - statSync(x).size)[0];
const blob = readFileSync(victim);
blob[Math.floor(blob.length / 2)] ^= 0x01;
writeFileSync(victim, blob);
const damaged = await ok(async () => { try { return await verify(first.snapshotId, bad, PASS); } catch { return { valid: false, threw: true }; } });
const stem = victim.split(sep).pop().replace(/\.[^.]*$/, "");
item("a flipped byte in one stored chunk: verify reports it, restore throws", damaged?.valid === false && (damaged.threw || (damaged.corruptedChunks.length >= 1 && damaged.corruptedChunks.some((c) => stem.includes(c) || c.includes(stem)))) && await rejects(() => restore(first.snapshotId, bad, join(tmp, "out-bad"), PASS)));

// a third snapshot after some edits; delete the two earlier ones and collect
writeFileSync(join(src, "a/deep/notes.txt"), "small file, version two, changed\n");
writeFileSync(join(src, "new.bin"), randomBytes(5000));
const third = await ok(() => backup(src, store, PASS));
await ok(() => deleteSnapshot(first.snapshotId, store));
await ok(() => deleteSnapshot(second.snapshotId, store));
const g1 = await ok(() => gc(store));
const out3 = join(tmp, "out3");
await ok(() => restore(third.snapshotId, store, out3, PASS));
const gone = await rejects(() => restore(first.snapshotId, store, join(tmp, "out-gone"), PASS));
const v2 = await ok(() => verify(third.snapshotId, store, PASS));
item("delete + gc removes only chunks no snapshot needs: the surviving snapshot still verifies and restores", g1 && Number.isInteger(g1.removedChunks) && g1.removedChunks > 0 && JSON.stringify(tree(out3)) === JSON.stringify(tree(src)) && v2?.valid === true && gone);
const g2 = await ok(() => gc(store));
item("a second gc finds nothing more to remove", g2?.removedChunks === 0);
rmSync(tmp, { recursive: true, force: true });
done();
