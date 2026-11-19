const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const origin = "http://127.0.0.1:5173";

(async () => {
  const browser = await chromium.launch();
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

  // 3. Search filters
  await page.goto(origin + "/search?q=checking");
  await page.waitForFunction(() => {
    const r = document.querySelector(".public-page-host")?.shadowRoot;
    return r?.querySelector('[role="checkbox"]') && r?.querySelector('[class*="FusionResultsTextTiles__link"]');
  });
  const search = await page.evaluate(() => {
    const r = document.querySelector(".public-page-host").shadowRoot;
    const total = r.querySelectorAll('[class*="FusionResultsTextTiles__link"]').length;
    const personal = Array.from(r.querySelectorAll('[role="checkbox"]')).find((b) => b.textContent.trim() === "Personal");
    const beforeChecked = personal.getAttribute("aria-checked");
    personal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const afterChecked = personal.getAttribute("aria-checked");
    const visible = Array.from(r.querySelectorAll('[class*="FusionResultsTextTiles__link"]'))
      .filter((a) => (a.closest('[class*="FusionResultsListItem__item"]') || a.parentElement).style.display !== "none").length;
    const personalVisible = Array.from(r.querySelectorAll('[class*="FusionResultsTextTiles__link"]'))
      .filter((a) => {
        const card = a.closest('[class*="FusionResultsListItem__item"]') || a.parentElement;
        return card.style.display !== "none" && card.querySelector('[class*="category"]')?.textContent.trim() === "Personal";
      }).length;
    return { total, beforeChecked, afterChecked, visible, personalVisible };
  });
  console.log("search filters:", JSON.stringify(search));
  assert.equal(search.beforeChecked, "false"); // no filters selected shows all results
  assert.equal(search.afterChecked, "true");
   assert.ok(search.visible > 0 && search.visible < search.total);
   assert.equal(search.personalVisible, search.visible);

  // Search uses the actual Wells Fargo search form field, not an invented input name.
  await page.goto(origin + "/search?q=checking");
  const searchInput = page.locator('.public-page-host input[name="search-input"]');
  await searchInput.waitFor();
  await searchInput.fill("mortgage");
  await Promise.all([
    page.waitForURL("**/search?q=mortgage"),
    searchInput.press("Enter"),
  ]);
  await page.waitForFunction(() => document.querySelector(".public-page-host")?.shadowRoot?.querySelector("h1, h2"));
  const queryValue = await page.evaluate(() => {
    const root = document.querySelector(".public-page-host").shadowRoot;
    return root.querySelector('input[name="search-input"]')?.value;
  });
  assert.equal(queryValue, "mortgage");

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
