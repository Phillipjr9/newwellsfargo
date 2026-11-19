const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://www.wellsfargo.com/search/?q=checking", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(800);
  console.log(JSON.stringify(await page.evaluate(() => {
    const link = document.querySelector("#nxgSearchRoot [class*=FusionResultsTextTiles__link]");
    const rows = [];
    for (let node = link; node && rows.length < 12; node = node.parentElement) {
      rows.push({ tag: node.tagName, class: typeof node.className === "string" ? node.className : "", text: (node.innerText || "").slice(0, 220) });
    }
    return rows;
  }), null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });