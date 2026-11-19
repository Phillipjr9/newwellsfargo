// Resumable catalog expansion: captures every internal HTML page linked from
// already-catalogued pages, merging into src/public-catalog.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { extractPublicPage, isSecureDestination, sourceForPath } from "../server/public-pages.mjs";

const CATALOG = "src/public-catalog.json";
const BATCH = Number(process.env.BATCH || 140);
const catalog = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, "utf8")) : {};
const before = Object.keys(catalog).length;

// Candidates come from the route list computed on stdin via ROUTES env (file path).
const routesFile = process.env.ROUTES_FILE;
if (!routesFile) throw new Error("Set ROUTES_FILE to a newline-delimited route list.");
const candidates = readFileSync(routesFile, "utf8")
  .split("\n")
  .map((r) => r.trim().replace(/\/+$/, "") || "/")
  .filter((r, i, all) => r && all.indexOf(r) === i && !catalog[r]);
const queue = candidates.slice(0, BATCH);
console.log(`${candidates.length} routes not yet catalogued; capturing ${queue.length} this run.`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
let done = 0;
const failed = [];
async function worker() {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(25000);
  while (queue.length) {
    const route = queue.shift();
    const requested = sourceForPath(route);
    try {
      await context.clearCookies();
      const response = await page.goto(requested, { waitUntil: "domcontentloaded" });
      if (isSecureDestination(page.url())) throw new Error("secure destination");
      if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
      await page.waitForTimeout(1200);
      const rendered = await page.evaluate(() => ({
        title: document.title,
        main: document.querySelector("main")?.outerHTML || document.body.outerHTML,
        styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
      }));
      const html = `<html><head><title>${rendered.title}</title>${rendered.styles.map((u) => `<link rel="stylesheet" href="${u}">`).join("")}</head><body>${rendered.main}</body></html>`;
      const record = extractPublicPage(html, requested, page.url());
      if (!record.html.includes("<h1") && !record.html.includes("<h2")) throw new Error("no content");
      catalog[route] = record;
    } catch (error) {
      failed.push([route, String(error.message || error).slice(0, 90)]);
    }
    done += 1;
    if (done % 25 === 0) {
      writeFileSync(CATALOG, JSON.stringify(catalog)); // checkpoint
      console.log(`  ${done}/${queue.length + done - done + queue.length === 0 ? "" : ""}${done} captured this run`);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: 5 }, worker));
writeFileSync(CATALOG, JSON.stringify(catalog));
await browser.close();
console.log(`Catalog: ${before} -> ${Object.keys(catalog).length} routes. Failed this run: ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 30));
