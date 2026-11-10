/** Upper-case the first letter of a string. */
export function cap(s) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function words(s) {
  return s.split(/\s+/).filter(Boolean);
}
