build a zero-dependency Node.js content-addressable backup engine with a CLI (`bin/cas.mjs`) and library (`src/index.mjs`) that chunks files using a rolling hash (min 1KB, avg 4KB, max 16KB), compresses and encrypts chunks with AES-256-GCM derived from a passphrase via `crypto.scryptSync`, deduplicates encrypted chunks in a local store directory with reference counting (`gc()` removes unreferenced chunks), and restores snapshots while verifying a SHA-256 Merkle tree root.
Export in `src/index.mjs`:
- `backup(sourceDir, storeDir, passphrase) -> Promise<{ snapshotId: string, merkleRoot: string, stats: { totalBytes: number, uniqueChunks: number, deduplicatedChunks: number } }>`
- `verify(snapshotId, storeDir, passphrase) -> Promise<{ valid: boolean, corruptedChunks: string[] }>`
- `restore(snapshotId, storeDir, targetDir, passphrase) -> Promise<void>`
- `deleteSnapshot(snapshotId, storeDir) -> Promise<void>`
- `gc(storeDir) -> Promise<{ removedChunks: number }>`
