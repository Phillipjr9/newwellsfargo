import { readFileSync, writeFileSync } from "node:fs";
import { extractPublicPage } from "../server/public-pages.mjs";

const file = "src/public-catalog.json";
const catalog = JSON.parse(readFileSync(file, "utf8"));
let repaired = 0;
for (const [route, page] of Object.entries(catalog)) {
  if (!page.html.trimStart().startsWith("<body")) continue;
  const record = extractPublicPage(page.html, page.source, page.source);
  record.title = page.title;
  record.styles = page.styles;
  catalog[route] = record;
  repaired += 1;
}
writeFileSync(file, JSON.stringify(catalog));
console.log(`Extracted legacy content regions for ${repaired} routes.`);
