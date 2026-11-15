// Content-addressable encrypted backup. Store layout:
//   config.json              scrypt salt and a key check value
//   chunks/<id>.enc          iv | tag | AES-256-GCM(deflate(chunk)); id = HMAC-SHA256(key, chunk)
//   snapshots/<id>.snap      encrypted manifest (paths, sizes, chunk ids, Merkle root)
//   snapshots/<id>.refs.json plain list of chunk ids, so gc() needs no passphrase
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const MIN = 1024, AVG_MASK = (1 << 12) - 1, MAX = 16 * 1024; // cut points about every 4 KB after the minimum
const GEAR = Array.from({ length: 256 }, (_, i) => createHash("sha256").update(`gear-${i}`).digest().readUInt32LE(0));

/** Content-defined chunking with a gear rolling hash: the same bytes cut at the same places. */
export function chunk(buf) {
  const out = [];
  let start = 0;
  let h = 0;
  for (let i = 0; i < buf.length; i++) {
    h = ((h << 1) + GEAR[buf[i]]) >>> 0;
    const len = i - start + 1;
    if ((len >= MIN && (h & AVG_MASK) === 0) || len >= MAX) {
      out.push(buf.subarray(start, i + 1));
      start = i + 1;
      h = 0;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

const seal = (key, plain) => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
};
const open = (key, blob) => {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
};
const sha = (...parts) => { const h = createHash("sha256"); parts.forEach((p) => h.update(p)); return h.digest(); };

function merkle(leaves) {
  if (leaves.length === 0) return sha("").toString("hex");
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0].toString("hex");
}

function keyFor(storeDir, passphrase, create) {
  const cfg = join(storeDir, "config.json");
  if (!existsSync(cfg)) {
    if (!create) throw new Error("no such store");
    mkdirSync(storeDir, { recursive: true });
    const salt = randomBytes(16);
    const key = scryptSync(passphrase, salt, 32);
    writeFileSync(cfg, JSON.stringify({ salt: salt.toString("hex"), check: seal(key, Buffer.from("cas-ok")).toString("hex") }));
    return key;
  }
  const { salt, check } = JSON.parse(readFileSync(cfg, "utf8"));
  const key = scryptSync(passphrase, Buffer.from(salt, "hex"), 32);
  try { open(key, Buffer.from(check, "hex")); } catch { throw new Error("wrong passphrase"); }
  return key;
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

const chunkPath = (storeDir, id) => join(storeDir, "chunks", `${id}.enc`);
const snapPath = (storeDir, id) => join(storeDir, "snapshots", `${id}.snap`);

export async function backup(sourceDir, storeDir, passphrase) {
  const key = keyFor(storeDir, passphrase, true);
  mkdirSync(join(storeDir, "chunks"), { recursive: true });
  mkdirSync(join(storeDir, "snapshots"), { recursive: true });
  const files = [];
  const leaves = [];
  const refs = [];
  const stats = { totalBytes: 0, uniqueChunks: 0, deduplicatedChunks: 0 };
  for (const path of walk(sourceDir)) {
    const data = readFileSync(join(sourceDir, path));
    stats.totalBytes += data.length;
    leaves.push(sha("file\0", path, "\0", String(data.length)));
    const ids = [];
    for (const piece of chunk(data)) {
      const id = createHmac("sha256", key).update(piece).digest("hex");
      leaves.push(sha(piece));
      ids.push(id);
      refs.push(id);
      const target = chunkPath(storeDir, id);
      if (existsSync(target)) stats.deduplicatedChunks++;
      else {
        writeFileSync(target, seal(key, deflateRawSync(piece)));
        stats.uniqueChunks++;
      }
    }
    files.push({ path, size: data.length, chunks: ids });
  }
  const merkleRoot = merkle(leaves);
  const snapshotId = `snap-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  writeFileSync(snapPath(storeDir, snapshotId), seal(key, Buffer.from(JSON.stringify({ files, merkleRoot }))));
  writeFileSync(join(storeDir, "snapshots", `${snapshotId}.refs.json`), JSON.stringify(refs));
  return { snapshotId, merkleRoot, stats };
}

function manifest(snapshotId, storeDir, key) {
  const p = snapPath(storeDir, snapshotId);
  if (!existsSync(p)) throw new Error(`no such snapshot ${snapshotId}`);
  return JSON.parse(open(key, readFileSync(p)).toString("utf8"));
}

/** Read one chunk, check it decrypts and hashes to its id. Returns the bytes, or undefined. */
function readChunk(storeDir, key, id) {
  try {
    const plain = inflateRawSync(open(key, readFileSync(chunkPath(storeDir, id))));
    const ok = timingSafeEqual(createHmac("sha256", key).update(plain).digest(), Buffer.from(id, "hex"));
    return ok ? plain : undefined;
  } catch {
    return undefined;
  }
}

function check(snap, storeDir, key) {
  const corrupted = new Set();
  const leaves = [];
  const data = new Map();
  for (const f of snap.files) {
    leaves.push(sha("file\0", f.path, "\0", String(f.size)));
    for (const id of f.chunks) {
      const plain = readChunk(storeDir, key, id);
      if (!plain) { corrupted.add(id); continue; }
      data.set(id, plain);
      leaves.push(sha(plain));
    }
  }
  return { corrupted: [...corrupted], root: merkle(leaves), data };
}

export async function verify(snapshotId, storeDir, passphrase) {
  const key = keyFor(storeDir, passphrase, false);
  const snap = manifest(snapshotId, storeDir, key);
  const { corrupted, root } = check(snap, storeDir, key);
  return { valid: corrupted.length === 0 && root === snap.merkleRoot, corruptedChunks: corrupted };
}

export async function restore(snapshotId, storeDir, targetDir, passphrase) {
  const key = keyFor(storeDir, passphrase, false);
  const snap = manifest(snapshotId, storeDir, key);
  const { corrupted, root, data } = check(snap, storeDir, key); // nothing is written until the whole snapshot checks out
  if (corrupted.length > 0) throw new Error(`integrity error: corrupted chunks ${corrupted.join(", ")}`);
  if (root !== snap.merkleRoot) throw new Error("integrity error: Merkle root mismatch");
  const base = resolve(targetDir);
  for (const f of snap.files) {
    const dest = resolve(base, f.path);
    if (dest !== base && !dest.startsWith(base + sep)) throw new Error(`unsafe path ${f.path}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.concat(f.chunks.map((id) => data.get(id))));
  }
}

export async function deleteSnapshot(snapshotId, storeDir) {
  for (const p of [snapPath(storeDir, snapshotId), join(storeDir, "snapshots", `${snapshotId}.refs.json`)]) rmSync(p, { force: true });
}

export async function gc(storeDir) {
  const counts = new Map(); // reference counts, rebuilt from the snapshots that still exist
  const dir = join(storeDir, "snapshots");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".refs.json"))) {
      for (const id of JSON.parse(readFileSync(join(dir, name), "utf8"))) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let removedChunks = 0;
  const chunks = join(storeDir, "chunks");
  if (existsSync(chunks)) {
    for (const name of readdirSync(chunks).filter((n) => n.endsWith(".enc"))) {
      if (!counts.has(name.slice(0, -4))) { rmSync(join(chunks, name)); removedChunks++; }
    }
  }
  return { removedChunks };
}
