const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const origin = "http://127.0.0.1:5173";

(async () => {
  fs.mkdirSync(".review", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  for (const route of ["/careers", "/premier", "/guidance", "/investing-wealth", "/mortgage/rates", "/savings-cds/rates"]) {
    await page.goto(origin + route);
    await page.waitForFunction(() => {
      const r = document.querySelector(".public-page-host")?.shadowRoot;
      return r?.querySelector("h1, h2")?.textContent.trim();
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const r = document.querySelector(".public-page-host").shadowRoot;
      return {
        title: document.title.slice(0, 60),
        heading: r.querySelector("h1, h2").textContent.trim().slice(0, 60),
        height: Math.round(r.querySelector("main")?.getBoundingClientRect().height || 0),
        imgs: r.querySelectorAll("img").length,
        overflow: r.querySelector("main")?.getBoundingClientRect().right > innerWidth + 2,
      };
    });
    console.log(route, JSON.stringify(info));
    assert.ok(!info.overflow, route + " overflowed");
    await page.screenshot({ path: `.review/spot-${route.replaceAll("/", "-")}.png` });
  }
  console.log("page errors:", JSON.stringify(errors));
  assert.equal(errors.length, 0);
  await browser.close();
  console.log("SPOT CHECKS PASSED");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
