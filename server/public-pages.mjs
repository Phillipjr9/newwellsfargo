import * as cheerio from "cheerio";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import officialDestinations from "../shared/official-destinations.json" with { type: "json" };

const PUBLIC_HOSTS = new Set([
  "www.wellsfargo.com",
  "creditcards.wellsfargo.com",
  "getmoneyready.wf.com",
  "stories.wf.com",
  "www.wellsfargojobs.com",
  "sites.wf.com",
]);
const SECURE_HOSTS = [
  "secure.wellsfargo.com",
  "oam.wellsfargo.com",
  "privacycenter.wellsfargo.com",
  "apply.wellsfargo.com",
  "accountoffers.wellsfargo.com",
  "appointments.wellsfargo.com",
  "icomplete.wellsfargo.com",
  "confirmcard.wellsfargo.com",
];

export function sourceForPath(path) {
  const clean = `/${String(path).replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
  const aliases = {
    "/": "https://www.wellsfargo.com/",
    "/home/": "https://www.wellsfargo.com/",
    "/credit-cards/": "https://creditcards.wellsfargo.com/",
    "/guidance/": "https://getmoneyready.wf.com/",
    "/stories/": "https://stories.wf.com/",
    "/careers/": "https://www.wellsfargojobs.com/",
    "/savings/": "https://www.wellsfargo.com/savings-cds/",
    "/cds/": "https://www.wellsfargo.com/savings-cds/certificate-of-deposit/",
    "/home-loans/": "https://www.wellsfargo.com/mortgage/",
    "/business/": "https://www.wellsfargo.com/biz/",
    "/commercial/": "https://www.wellsfargo.com/com/",
    "/corporate/": "https://www.wellsfargo.com/cib/",
    "/investing/": "https://www.wellsfargo.com/investing-wealth/",
    "/lifesync/": "https://www.wellsfargo.com/mobile-online-banking/lifesync/",
    "/financial-goals/": "https://www.wellsfargo.com/financial-goals/",
    "/routing-number/": "https://www.wellsfargo.com/help/routing-number/",
    "/rates/": "https://www.wellsfargo.com/help/rates/",
    "/locations/": "https://locations.wellsfargo.com/search",
    "/appointments/": "https://appointments.wellsfargo.com/maa/appointment/",
    "/sign-on/": "https://connect.secure.wellsfargo.com/auth/login/present?origin=cob&LOB=CONS",
    "/login/": "https://connect.secure.wellsfargo.com/auth/login/present?origin=cob&LOB=CONS",
    "/jobs/": "https://www.wellsfargojobs.com/",
    "/espanol/": "https://www.wellsfargo.com/es/",
  };
  const destination = officialDestinations[clean.slice(0, -1)];
  if (destination) return destination;
  if (aliases[clean]) return aliases[clean];
  if (clean.startsWith("/credit-cards/")) return `https://creditcards.wellsfargo.com${clean.slice(13) || "/"}`;
  if (clean.startsWith("/guidance/")) return `https://getmoneyready.wf.com${clean.slice(9) || "/"}`;
  if (clean.startsWith("/stories/")) return `https://stories.wf.com${clean.slice(8) || "/"}`;
  return `https://www.wellsfargo.com${clean}`;
}

export function isSecureDestination(url) {
  try {
    const host = new URL(url).hostname;
    return SECURE_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return true;
  }
}

function relativeSourcePath(url) {
  const original = new URL(url);
  if (original.hostname === "creditcards.wellsfargo.com") return `/credit-cards${original.pathname}`;
  if (original.hostname === "getmoneyready.wf.com") return `/guidance${original.pathname}`;
  if (original.hostname === "stories.wf.com") return `/stories${original.pathname}`;
  return original.pathname;
}

export function extractPublicPage(html, requestedUrl, finalUrl = requestedUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $("script, style, noscript, iframe, object, embed, template, base, meta, link").remove();
  $("*").each((_, element) => {
    for (const attr of Object.keys(element.attribs || {})) {
      if (/^on/i.test(attr) || ["integrity", "crossorigin", "srcdoc", "nonce"].includes(attr.toLowerCase())) {
        $(element).removeAttr(attr);
      }
    }
  });
  $("form").each((_, form) => {
    const action = $(form).attr("action") || finalUrl;
    const actionUrl = new URL(action, finalUrl);
    if (isSecureDestination(actionUrl.href) || $(form).find('input[type="password"], input[name*="ssn" i], input[id*="ssn" i], input[autocomplete*="cc-" i]').length) {
      $(form).replaceWith(`<div class="public-secure-action"><a href="${actionUrl.href}" target="_blank" rel="noreferrer">Continue on the official secure site</a></div>`);
    } else {
      $(form).attr("action", actionUrl.href);
      $(form).attr("method", "get");
    }
  });
  $("[data-deferred-src]").each((_, el) => {
    const value = $(el).attr("data-deferred-src");
    if (value) $(el).attr("src", value);
    $(el).removeAttr("data-deferred-src");
  });
  $("[data-srcset]").each((_, el) => {
    const value = $(el).attr("data-srcset");
    if (value) $(el).attr("srcset", value);
    $(el).removeAttr("data-srcset");
  });
  $("img, source, video, audio").each((_, el) => {
    for (const attr of ["src", "poster"]) {
      const value = $(el).attr(attr);
      if (value && !value.startsWith("data:")) $(el).attr(attr, new URL(value, finalUrl).href);
    }
    if ($(el).attr("loading")) $(el).removeAttr("loading");
  });
  $("source[srcset], img[srcset]").each((_, el) => {
    const value = $(el).attr("srcset");
    // The original media URLs are already absolute. Their transformation query
    // strings contain commas and must not be split as responsive candidates.
    if (!value || /^https?:\/\//i.test(value)) return;
    const candidates = value.split(/\s*,\s*(?=\/|https?:)/).map((candidate) => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/);
      return `${new URL(url, finalUrl).href} ${descriptor.join(" ")}`.trim();
    });
    $(el).attr("srcset", candidates.join(", "));
  });
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") || "";
    if (raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) {
      if (raw.startsWith("javascript:")) $(el).attr("href", "#");
      return;
    }
    let url;
    try { url = new URL(raw, finalUrl); } catch { $(el).attr("href", "#"); return; }
    if (url.hostname === "www.wellsfargo.com" && !isSecureDestination(url.href)) {
      $(el).attr("href", `${url.pathname}${url.search}${url.hash}`);
      $(el).removeAttr("target");
    } else if (["creditcards.wellsfargo.com", "getmoneyready.wf.com", "stories.wf.com"].includes(url.hostname) && !isSecureDestination(url.href)) {
      $(el).attr("href", `${relativeSourcePath(url.href)}${url.search}${url.hash}`);
      $(el).removeAttr("target");
    } else {
      $(el).attr("href", url.href);
      $(el).attr("target", "_blank");
      $(el).attr("rel", "noreferrer");
    }
  });
  const main = $("main").first();
  const application = $("#nxgSearchRoot").first();
  const legacy = $("#shell").first();
  let content = main.length ? main : application.length ? application : $("body").first();
  if (!main.length && !application.length && legacy.length) {
    const regions = legacy.children(".c42, #mainColumns, #contentTop");
    if (regions.length) {
      legacy.children().remove();
      legacy.append(regions);
      content = $(`<main id="shell" class="${legacy.attr("class") || "t8"} legacy-public-content">${legacy.html()}</main>`);
    }
  }
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || "Wells Fargo";
  const styles = cheerio.load(html)("link[rel='stylesheet']").map((_, el) => new URL(cheerio.load(html)(el).attr("href") || "", finalUrl).href).get();
  return {
    source: finalUrl,
    title,
    html: $.html(content) || "<main><h1>Page unavailable</h1></main>",
    styles,
    status: 200,
  };
}

const cacheDirectory = process.env.PUBLIC_CACHE_DIR || join(homedir(), ".cache", "banking-preview", "public-pages");
mkdirSync(cacheDirectory, { recursive: true });
const inflight = new Map();

async function getRenderedPublicPage(target) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ timeout: 2500 });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 2500 });
    if (target.pathname === "/search/") await page.locator('input[name="search-input"]').waitFor({ timeout: 2000 });
    const destination = new URL(page.url());
    if (!PUBLIC_HOSTS.has(destination.hostname) || isSecureDestination(destination.href)) throw new Error("Official destination required.");
    const rendered = await page.evaluate(() => ({
      title: document.title,
      body: document.body.outerHTML,
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href),
    }));
    const html = `<html><head><title>${rendered.title}</title>${rendered.styles.map(url => `<link rel="stylesheet" href="${url}">`).join("")}</head>${rendered.body}</html>`;
    return extractPublicPage(html, target.href, page.url());
  } finally { await browser.close(); }
}

export async function getPublicPage(path, searchQuery = "") {
  const requested = sourceForPath(path);
  const target = new URL(requested);
  if (target.pathname === "/search/" && searchQuery) target.searchParams.set("q", searchQuery.slice(0, 200));
  const normalized = String(path).toLowerCase().replace(/\/+$/, "");
  if (officialDestinations[normalized] || normalized.startsWith("/auth/login/") || isSecureDestination(requested) || !PUBLIC_HOSTS.has(target.hostname)) {
    const error = new Error("This secure destination is available only on the official site.");
    error.code = 400;
    throw error;
  }
  const key = `${target.hostname}${target.pathname}${target.search}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 180);
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    if (["/search/", "/help/rates/"].includes(target.pathname)) {
      const page = await getRenderedPublicPage(target);
      writeFileSync(join(cacheDirectory, `${key}.json`), JSON.stringify(page));
      return page;
    }
    const response = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PublicPagePreview/1.0)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = new Error(`Public page returned ${response.status}.`);
      error.code = response.status;
      throw error;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) {
      const error = new Error("This destination is not a public HTML page.");
      error.code = 415;
      throw error;
    }
    const finalUrl = response.url;
    if (isSecureDestination(finalUrl) || !PUBLIC_HOSTS.has(new URL(finalUrl).hostname)) {
      const error = new Error("This destination requires official authentication.");
      error.code = 400;
      throw error;
    }
    const page = extractPublicPage(await response.text(), target.href, finalUrl);
    writeFileSync(join(cacheDirectory, `${key}.json`), JSON.stringify(page));
    return page;
  })().catch((error) => {
    const file = join(cacheDirectory, `${key}.json`);
    try { return JSON.parse(readFileSync(file, "utf8")); } catch { throw error; }
  }).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

export async function publicPageApi(req, res, next) {
  const path = (req.url || "").split("?")[0];
  if (path !== "/api/public-page") return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const query = new URL(req.url || "", "http://localhost").searchParams;
    const page = await getPublicPage(query.get("path") || "/", query.get("q") || "");
    res.end(JSON.stringify(page));
  } catch (error) {
    res.statusCode = Number.isInteger(error.code) && error.code >= 400 && error.code <= 599 ? error.code : 502;
    res.end(JSON.stringify({ error: error.message || "Public page unavailable.", source: sourceForPath(new URL(req.url || "", "http://localhost").searchParams.get("path") || "/") }));
  }
}
