import { cap, words } from "./strings.js";

export function titleCase(text) {
  return words(text).map((w) => cap(w.toLowerCase())).join(" ");
}

export function sentence(text) {
  const trimmed = text.trim();
  return cap(trimmed) + (trimmed.endsWith(".") ? "" : ".");
}
