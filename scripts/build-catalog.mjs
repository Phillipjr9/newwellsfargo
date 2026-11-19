import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { extractPublicPage, isSecureDestination, sourceForPath } from "../server/public-pages.mjs";

const catalogFile = "src/public-catalog.json";
// Refresh the existing catalog; never replace it with a smaller bootstrap set.
const entries = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) : {};
const sourcePaths = ["/", "/sitemap/"];
const routes = new Set([
  "/checking/", "/savings-cds/", "/credit-cards/", "/mortgage/", "/personal-loans/", "/auto-loans/",
  "/investing-wealth/", "/premier/", "/guidance/", "/about/", "/help/", "/help/rates/", "/help/routing-number/",
  "/privacy-security/", "/online-banking/transfers/", "/online-banking/bill-pay/", "/online-banking/deposit-details/",
  "/online-banking/online-access-agreement/", "/sitemap/", "/es/", "/biz/", "/com/", "/cib/", "/careers/",
  "/financial-goals/", "/financial-goals/borrow/", "/stories/",
  ...Object.keys(entries),
]);
// Crawl public internal links already present in the catalog so a refresh also
// captures new articles and help pages, rather than only replaying the sitemap.
for (const page of Object.values(entries)) {
  const $ = cheerio.load(page.html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const target = href.split(/[?#]/)[0];
    if (
      /^\/(assets|exit)\//.test(target) ||
      /\.(pdf|xlsx?|docx?|zip|png|jpe?g|svg|gif|webm|mp4|xml|json|txt|ico)$/i.test(target)
    ) return;
    routes.add(target);
  });
}
for (const route of sourcePaths) {
  const html = await (await fetch(new URL(route, "https://www.wellsfargo.com"))).text();
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href?.startsWith("/") && !href.startsWith("//")) routes.add(href.split(/[?#]/)[0]);
  });
}
const previouslyCaptured = new Set(Object.keys(entries));
for (const page of Object.values(entries)) {
  const $ = cheerio.load(page.html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const target = href.split(/[?#]/)[0];
    if (
      /^\/(assets|exit)\//.test(target) ||
      /\.(pdf|xlsx?|docx?|zip|png|jpe?g|svg|gif|webm|mp4|xml|json|txt|ico)$/i.test(target)
    ) return;
    routes.add(target);
  });
}
const aliases = {
  "/savings/": "/savings-cds/", "/cds/": "/savings-cds/certificate-of-deposit/", "/home-loans/": "/mortgage/",
  "/business/": "/biz/", "/commercial/": "/com/", "/corporate/": "/cib/", "/investing/": "/investing-wealth/",
  "/lifesync/": "/mobile-online-banking/lifesync/", "/routing-number/": "/help/routing-number/", "/rates/": "/help/rates/",
  "/espanol/": "/es/", "/jobs/": "/careers/",
};
Object.keys(aliases).forEach((route) => routes.add(route));

const failed = [];
const routeLimit = Number(process.env.CATALOG_LIMIT || 0);
const normalizedRoutes = [...routes]
  .filter((route) => route !== "/" && route !== "/home/")
  .map((route) => route.replace(/\/+$/, "") || "/")
  .filter((route, index, all) => all.indexOf(route) === index)
  .sort()
;
// A bounded expansion always fetches uncatalogued links before refreshing the
// existing snapshots. Repeat `npm run catalog:expand` to walk another level.
const queue = [
  ...normalizedRoutes.filter((route) => !previouslyCaptured.has(route)),
  ...normalizedRoutes.filter((route) => previouslyCaptured.has(route)),
].slice(0, routeLimit > 0 ? routeLimit : undefined);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
let done = 0;
async function worker() {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(25000);
  while (queue.length) {
    const route = queue.shift();
    const requested = sourceForPath(route);
    try {
      const response = await page.goto(requested, { waitUntil: "domcontentloaded" });
      if (isSecureDestination(page.url())) throw new Error("Secure destination");
      if (response && !response.ok()) throw new Error(`Public page returned ${response.status()}`);
      // Public campaigns, product images and comparison panels are populated after DOMContentLoaded.
      await page.waitForTimeout(1500);
      const rendered = await page.evaluate(() => ({
        title: document.title,
        main: document.querySelector("main")?.outerHTML || document.body.outerHTML,
        styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href),
      }));
      const html = `<html><head><title>${rendered.title}</title>${rendered.styles.map(url => `<link rel="stylesheet" href="${url}">`).join("")}</head><body>${rendered.main}</body></html>`;
      const record = extractPublicPage(html, requested, page.url());
      if (!record.html.includes("<h1") && !record.html.includes("<h2")) throw new Error("No public page content found");
      entries[route] = record;
    } catch (error) { failed.push([route, error.message]); }
    done += 1;
    if (done % 20 === 0) {
      writeFileSync(catalogFile, JSON.stringify(entries));
      console.log(`${done}/${queue.length + done} public routes refreshed`);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: 5 }, worker));
await browser.close();
writeFileSync(catalogFile, JSON.stringify(entries));
console.log(`Catalog now holds ${Object.keys(entries).length} source-backed routes. ${failed.length} unavailable:`);
console.log(failed);
