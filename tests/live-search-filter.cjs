const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://www.wellsfargo.com/search/?q=checking", { waitUntil: "load", timeout: 45000 });
  const before = await page.locator('[role="checkbox"]').filter({hasText:"Personal"}).first().getAttribute("aria-checked");
  const choice=page.locator('[role="checkbox"]').filter({hasText:"Personal"}).first();
  await choice.click(); await page.waitForTimeout(300);
  const values = await page.evaluate(() => {
    const count = () => document.querySelectorAll('[class*="FusionResultsTextTiles__link"]').length;
    const heading = () => [...document.querySelectorAll("h1,h2")].find((el) => el.textContent.includes("search results"))?.textContent.trim();
    const cards=[...document.querySelectorAll('[class*="FusionResultsTextTiles__link"]')].map(a=>{let p=a;let n=0;while(p&&n<8){if(p.querySelector('[class*="FusionResultsTextTiles__category"]'))return {display:p.style.display,text:p.textContent.trim().slice(0,70)};p=p.parentElement;n++;}return {display:'unknown'};});
    const personal=document.querySelector('[role="checkbox"]');
    return { count: count(), heading: heading(), checked: personal?.getAttribute("aria-checked"), cards:cards.slice(0,3) };
  });
  values.beforeChecked = before;
  console.log(JSON.stringify(values, null, 2));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });