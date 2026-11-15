import { pathToFileURL } from "node:url";
const items = [];
const item = (n, ok) => items.push([n, !!ok]);
const done = () => {
  for (const [n, ok] of items) console.log((ok ? "PASS " : "FAIL ") + n);
  const p = items.filter(([, ok]) => ok).length;
  console.log(`SCORE ${p}/${items.length}`);
  process.exit(p === items.length ? 0 : 1);
};
const good = { tx_id: "tx-0001", amount_paise: 2500, currency: "INR", settled: false, note: "lunch" };
const cases = [
  ["valid: standard row", good, true],
  ["valid: note null", { ...good, note: null }, true],
  ["valid: note undefined", { ...good, note: undefined }, true],
  ["valid: note field missing", (({ note, ...r }) => r)(good), true],
  ["valid: note of 120 characters", { ...good, note: "x".repeat(120) }, true],
  ["valid: amount_paise 1", { ...good, amount_paise: 1 }, true],
  ["valid: tx_id of 36 characters", { ...good, tx_id: "a".repeat(36) }, true],
  ["invalid: null", null, false],
  ["invalid: a string", "row", false],
  ["invalid: an array", [], false],
  ["invalid: empty object", {}, false],
  ["invalid: tx_id of 37 characters", { ...good, tx_id: "a".repeat(37) }, false],
  ["invalid: tx_id missing", (({ tx_id, ...r }) => r)(good), false],
  ["invalid: amount_paise 0", { ...good, amount_paise: 0 }, false],
  ["invalid: amount_paise -50", { ...good, amount_paise: -50 }, false],
  ["invalid: amount_paise 12.34", { ...good, amount_paise: 12.34 }, false],
  ["invalid: amount_paise NaN", { ...good, amount_paise: NaN }, false],
  ["invalid: amount_paise a numeric string", { ...good, amount_paise: "25" }, false],
  ["invalid: currency GBP", { ...good, currency: "GBP" }, false],
  ["invalid: currency lower case", { ...good, currency: "inr" }, false],
  ["invalid: settled the string 'true'", { ...good, settled: "true" }, false],
  ["invalid: settled missing", (({ settled, ...r }) => r)(good), false],
  ["invalid: note of 121 characters", { ...good, note: "x".repeat(121) }, false],
  ["invalid: note a number", { ...good, note: 5 }, false],
];
let guard;
try {
  const mod = await import(pathToFileURL(process.cwd() + "/ledger.ts").href);
  guard = mod.isValidLedgerRow;
  item("ledger.ts exports isValidLedgerRow", typeof guard === "function");
} catch (e) {
  item("ledger.ts loads and exports isValidLedgerRow", false);
}
for (const [name, value, want] of cases) {
  let got;
  try { got = guard ? guard(value) : undefined; } catch { got = "threw"; }
  item(name, got === want);
}
done();
