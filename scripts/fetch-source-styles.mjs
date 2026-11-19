import { readFileSync, writeFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("src/public-catalog.json", "utf8"));
const urls = [...new Set(Object.values(catalog).flatMap(page => page.styles))].sort();
const styles = {};
for (const url of urls) {
  if (url.includes("ps-global")) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    console.warn(`Skipping unavailable source stylesheet ${url}: HTTP ${response.status}`);
    continue;
  }
  const css = await response.text();
  styles[url] = css.replace(/url\((['"]?)(?!https?:|data:|#|\/\/)([^)'"]+)\1\)/gi, (match, quote, asset) => `url(${new URL(asset, url).href})`);
  console.log(`Saved source stylesheet ${url}`);
}
writeFileSync("src/public/source-styles.ts", `// Exact public styles captured from the referenced source pages.\nexport const sourceStyles: Record<string, string> = ${JSON.stringify(styles)};\n`);
