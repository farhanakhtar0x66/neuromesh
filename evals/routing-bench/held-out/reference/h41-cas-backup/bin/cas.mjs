#!/usr/bin/env node
import { backup, deleteSnapshot, gc, restore, verify } from "../src/index.mjs";

const [cmd, ...a] = process.argv.slice(2);
const pass = process.env.CAS_PASSPHRASE ?? "";
const usage = "usage: cas backup <source> <store> | verify <snapshot> <store> | restore <snapshot> <store> <target> | delete <snapshot> <store> | gc <store>   (passphrase in CAS_PASSPHRASE)";
try {
  if (cmd === "backup" && a.length === 2) console.log(JSON.stringify(await backup(a[0], a[1], pass), null, 2));
  else if (cmd === "verify" && a.length === 2) { const r = await verify(a[0], a[1], pass); console.log(JSON.stringify(r)); process.exitCode = r.valid ? 0 : 1; }
  else if (cmd === "restore" && a.length === 3) await restore(a[0], a[1], a[2], pass);
  else if (cmd === "delete" && a.length === 2) await deleteSnapshot(a[0], a[1]);
  else if (cmd === "gc" && a.length === 1) console.log(JSON.stringify(await gc(a[0])));
  else { console.error(usage); process.exitCode = 2; }
} catch (e) {
  console.error(`cas: ${e.message}`);
  process.exitCode = 1;
}
