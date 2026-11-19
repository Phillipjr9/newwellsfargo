const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync(".review", { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(20000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  for (const r of ["/about/corporate/governance", "/com/insights", "/help/online-banking/zelle-faqs", "/privacy-security/fraud/report"]) {
    await p.goto("http://127.0.0.1:5173" + r);
    await p.waitForFunction(() => document.querySelector(".public-page-host")?.shadowRoot?.querySelector("h1, h2"));
    const info = await p.evaluate(() => {
      const root = document.querySelector(".public-page-host").shadowRoot;
      return { heading: root.querySelector("h1, h2").textContent.trim().slice(0, 70), h: Math.round(root.querySelector("main")?.getBoundingClientRect().height || 0) };
    });
    console.log(r, JSON.stringify(info));
    assert.ok(info.h > 200, r + " too short");
    await p.screenshot({ path: `.review/new-${r.replaceAll("/", "-")}.png` });
  }
  console.log("errors:", JSON.stringify(errors));
  assert.equal(errors.length, 0);
  await b.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
