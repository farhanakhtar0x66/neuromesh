// Turn a title into a URL slug.
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-");
}
