// A very small Markdown renderer.
export function render(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block) => `<p>${block.split("\n").map((l) => l.trim()).join(" ")}</p>`)
    .join("\n");
}
