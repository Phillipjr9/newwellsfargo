const { chromium } = require("playwright");
const fs = require("node:fs");

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const shots = (process.env.SHOTS || "/portal").split(",");
const width = Number(process.env.WIDTH || 1440);

(async () => {
  fs.mkdirSync(".review", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of shots) {
    await page.goto(origin + route, { waitUntil: "load" });
    await page.locator("#portal-main h1").waitFor({ timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    const name = (route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "portal") + "-" + width;
    await page.screenshot({ path: `.review/${name}.png`, fullPage: process.env.FULL === "1" });
    const info = await page.evaluate(() => ({
      h1: document.querySelector("#portal-main h1")?.textContent.trim(),
      overflow: document.documentElement.scrollWidth - innerWidth,
      height: document.documentElement.scrollHeight,
    }));
    console.log(route, JSON.stringify(info));
  }
  console.log("page errors:", JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
