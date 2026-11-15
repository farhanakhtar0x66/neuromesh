export interface LedgerRow {
  tx_id: string;
  amount_paise: number;
  currency: "INR" | "USD" | "EUR";
  settled: boolean;
  note?: string | null;
}

const CURRENCIES = ["INR", "USD", "EUR"];

export function isValidLedgerRow(x: unknown): x is LedgerRow {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (typeof r.tx_id !== "string" || r.tx_id.length < 1 || r.tx_id.length > 36) return false;
  if (typeof r.amount_paise !== "number" || !Number.isInteger(r.amount_paise) || r.amount_paise <= 0) return false;
  if (typeof r.currency !== "string" || !CURRENCIES.includes(r.currency)) return false;
  if (typeof r.settled !== "boolean") return false;
  if (r.note !== undefined && r.note !== null && (typeof r.note !== "string" || r.note.length > 120)) return false;
  return true;
}
