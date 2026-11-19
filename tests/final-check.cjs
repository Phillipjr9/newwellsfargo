const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const origin = "http://127.0.0.1:5173";

(async () => {
  fs.mkdirSync(".review", { recursive: true });
  const browser = await chromium.launch();
  const errors = [];

  // Desktop dashboard: every account image must be a loaded, real asset.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.goto(origin + "/portal");
  await page.locator(".pb-account-rows li").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const art = await page.evaluate(() =>
    [...document.querySelectorAll(".pb-account-rows .pb-account-art img")].map((img) => ({
      loaded: img.complete && img.naturalWidth > 0,
      box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)],
      clipped: img.getBoundingClientRect().bottom > img.parentElement.getBoundingClientRect().bottom + 1,
    })),
  );
  console.log("account art:", JSON.stringify(art));
  assert.equal(art.length, 4);
  assert.ok(art.every((a) => a.loaded && !a.clipped), "art must load and fit its tile");
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Wells Fargo Sans"')), true);
  await page.locator(".pb-accounts").screenshot({ path: ".review/accounts-desktop.png" });

  // Transfer flow still posts and confirms.
  await page.goto(origin + "/portal/transfers");
  await page.locator(".pb-money-input input").fill("25.00");
  await page.getByRole("button", { name: "Review transfer", exact: true }).click();
  await page.getByRole("button", { name: "Confirm demo payment", exact: true }).click();
  await page.getByRole("heading", { name: "Transfer completed" }).waitFor();
  console.log("transfer flow: completed");

  // Public guides must open their own pages, not the portal.
  for (const route of ["/online-banking/transfers", "/online-banking/bill-pay", "/mobile-online-banking/transfer-pay"]) {
    await page.goto(origin + route);
    await page.waitForFunction(() => document.querySelector(".public-page-host")?.shadowRoot?.querySelector("h1"));
    const h1 = await page.evaluate(() => document.querySelector(".public-page-host").shadowRoot.querySelector("h1").textContent.trim());
    console.log("public route", route, "->", h1);
  }

  // Mobile dashboard.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(origin + "/portal");
  await phone.locator(".pb-account-rows li").first().waitFor();
  await phone.evaluate(() => document.fonts.ready);
  await phone.waitForTimeout(500);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log("mobile overflow px:", overflow);
  assert.equal(overflow, 0);
  await phone.locator(".pb-accounts").screenshot({ path: ".review/accounts-mobile.png" });

  console.log("page errors:", JSON.stringify(errors));
  assert.equal(errors.length, 0);
  await browser.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
