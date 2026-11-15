from this CREATE TABLE statement, generate a pure TypeScript file `ledger.ts` exporting `interface LedgerRow` and a zero-dependency type-guard function `export function isValidLedgerRow(x: unknown): x is LedgerRow` that enforces every NOT NULL, CHECK, integer, and string length constraint (note may be string <= 120 chars, null, or undefined):
CREATE TABLE ledger (
  tx_id VARCHAR(36) NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR')),
  settled BOOLEAN NOT NULL,
  note VARCHAR(120)
);
