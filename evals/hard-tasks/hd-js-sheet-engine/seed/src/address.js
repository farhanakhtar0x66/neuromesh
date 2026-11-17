// Cell addresses: one or two letters (A..ZZ) and a row from 1 to 100000.

export const MAX_COLUMN = 702; // ZZ
export const MAX_ROW = 100000;

/** Any name made of letters followed directly by digits. It is a reference syntactically, valid or not. */
export const REFERENCE_LIKE = /^[A-Za-z]+[0-9]+$/;

const ADDRESS = /^([A-Za-z]{1,2})([1-9][0-9]*)$/;

/** "A" is 1, "Z" is 26, "AA" is 27, "ZZ" is 702. */
export function columnToNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** The inverse of columnToNumber. */
export function numberToColumn(n) {
  let out = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
  return out;
}

/** "b12" -> { col: 2, row: 12, key: "B12" }; null when the text is not a valid address. */
export function parseAddress(text) {
  if (typeof text !== "string") return null;
  const m = ADDRESS.exec(text);
  if (!m) return null;
  const row = Number(m[2]);
  if (row > MAX_ROW) return null;
  const col = columnToNumber(m[1]);
  return { col, row, key: `${m[1].toUpperCase()}${row}` };
}

export function formatAddress(col, row) {
  return `${numberToColumn(col)}${row}`;
}
