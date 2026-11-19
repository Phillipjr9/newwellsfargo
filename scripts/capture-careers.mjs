// Captures the Wells Fargo careers site (blocks the headless-shell UA) with a
// browser-profile user agent and merges it into the public catalog.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { extractPublicPage } from "../server/public-pages.mjs";

const catalog = JSON.parse(readFileSync("src/public-catalog.json", "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
});
const response = await page.goto("https://www.wellsfargojobs.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
if (!response?.ok()) throw new Error(`Careers page returned ${response?.status()}`);
await page.waitForTimeout(2000);
const rendered = await page.evaluate(() => ({
  title: document.title,
  main: document.querySelector("main")?.outerHTML || document.body.outerHTML,
  styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
}));
const html = `<html><head><title>${rendered.title}</title>${rendered.styles.map((u) => `<link rel="stylesheet" href="${u}">`).join("")}</head><body>${rendered.main}</body></html>`;
const record = extractPublicPage(html, "https://www.wellsfargojobs.com/", page.url());
if (!record.html.includes("<h1") && !record.html.includes("<h2")) throw new Error("No careers content captured");
catalog["/careers"] = record;
catalog["/jobs"] = record;
await browser.close();
writeFileSync("src/public-catalog.json", JSON.stringify(catalog));
console.log("careers captured:", record.title);
