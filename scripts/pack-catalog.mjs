// Compresses the captured public-page catalog and source stylesheets into
// gzipped base64 chunks so the single-file build stays small. Pages and styles
// are decoded lazily in the browser with DecompressionStream.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

function encode(text) {
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64");
}

const catalog = JSON.parse(readFileSync("src/public-catalog.json", "utf8"));
const pageEntries = Object.entries(catalog).map(([route, page]) => [route, encode(JSON.stringify(page))]);
writeFileSync(
  "src/public/catalog-data.ts",
  `// Gzipped public page snapshots, decoded lazily. Rebuild: npm run catalog:pack\nexport const catalogData: Record<string, string> = ${JSON.stringify(Object.fromEntries(pageEntries))};\n`,
);

const stylesText = readFileSync("src/public/source-styles.ts", "utf8");
const styles = JSON.parse(stylesText.slice(stylesText.indexOf("= {") + 2, stylesText.trimEnd().length - 1));
const styleEntries = Object.entries(styles).map(([url, css]) => [url, encode(css)]);
writeFileSync(
  "src/public/style-data.ts",
  `// Gzipped source stylesheets, decoded lazily. Rebuild: npm run catalog:pack\nexport const styleData: Record<string, string> = ${JSON.stringify(Object.fromEntries(styleEntries))};\n`,
);

const raw = Buffer.byteLength(JSON.stringify(catalog)) + Buffer.byteLength(JSON.stringify(styles));
const packed = Buffer.byteLength(JSON.stringify(Object.fromEntries(pageEntries))) + Buffer.byteLength(JSON.stringify(Object.fromEntries(styleEntries)));
console.log(`packed ${pageEntries.length} pages and ${styleEntries.length} stylesheets: ${(raw / 1e6).toFixed(1)}MB -> ${(packed / 1e6).toFixed(1)}MB`);
