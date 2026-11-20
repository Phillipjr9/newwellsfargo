const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);

  const root = () => page.locator(".public-page-host").evaluate((h) => h.shadowRoot);

  // 1. Savings page tabs
  await page.goto(origin + "/savings-cds");
  await page.waitForFunction(() => document.querySelector(".public-page-host")?.shadowRoot?.querySelector('[role="tab"]'));
  const tabState = await page.evaluate(() => {
    const r = document.querySelector(".public-page-host").shadowRoot;
    const platinum = r.querySelector('[role="tab"][aria-controls="platinumsavings"]');
    platinum.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return {
      selected: platinum.getAttribute("aria-selected"),
      panelHidden: r.getElementById("platinumsavings").classList.contains("is-tab-hidden"),
      popularHidden: r.getElementById("mostpopular").classList.contains("is-tab-hidden"),
      heading: r.getElementById("platinumsavings").querySelector("h1,h2")?.textContent.trim(),
    };
  });
  console.log("tabs:", JSON.stringify(tabState));
  assert.equal(tabState.selected, "true");
  assert.equal(tabState.panelHidden, false);
  assert.equal(tabState.popularHidden, true);

  // 2. Footnote dialog
  const dialogState = await page.evaluate(() => {
    const r = document.querySelector(".public-page-host").shadowRoot;
    const link = r.querySelector('a[href^="#tcm:"]');
    const id = link.getAttribute("href").slice(1);
    const expected = r.getElementById(id).textContent.trim().slice(0, 40);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = r.querySelector("dialog.footnote-dialog");
    return {
      open: dialog?.open ?? false,
      text: dialog?.textContent.trim().slice(0, 40),
      expected,
    };
  });
  console.log("footnote dialog:", JSON.stringify(dialogState));
  assert.equal(dialogState.open, true);
  assert.ok(dialogState.text.includes(dialogState.expected.slice(0, 20)));

  // Search remains usable when the upstream service is unavailable.
  const blockSearch = (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  await page.route("**/api/public-page?path=%2Fsearch**", blockSearch);
  await page.goto(origin + "/search?q=checking");
  const search = page.getByRole("searchbox", { name: "Search terms" });
  await search.waitFor();
  assert.equal(await page.locator("#main-content li a").first().getAttribute("href"), "/checking");
  await search.fill("mortgage");
  await search.press("Enter");
  await page.waitForURL("**/search?q=mortgage");
  await page.locator("#main-content li a[href='/mortgage']").waitFor();
  await search.fill("zz-no-match-zz");
  await search.press("Enter");
  await page.getByText(/0 results for/).waitFor();
  await page.unroute("**/api/public-page?path=%2Fsearch**", blockSearch);

  // 4. Credit cards + mortgage rates tabs
  for (const route of ["/credit-cards", "/mortgage/rates"]) {
    await page.goto(origin + route);
    await page.waitForFunction(() => document.querySelector(".public-page-host")?.shadowRoot?.querySelector('[role="tab"]'));
    const tabs = await page.evaluate(() => {
      const r = document.querySelector(".public-page-host").shadowRoot;
      const all = [...r.querySelectorAll('[role="tab"]')];
      const second = all[1] || all[0];
      second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { count: all.length, selected: second.getAttribute("aria-selected") };
    });
    console.log(route, "tabs:", JSON.stringify(tabs));
    assert.equal(tabs.selected, "true");
  }

  console.log("page errors:", JSON.stringify(errors));
  assert.equal(errors.length, 0);
  await browser.close();
  console.log("ALL INTERACTIVITY CHECKS PASSED");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
