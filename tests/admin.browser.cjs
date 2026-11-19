const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5174";
const adminCode = process.env.DEMO_ADMIN_TOKEN || "browser-test-admin";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));

  const unauthenticated = await context.request.get(`${origin}/api/admin/overview`);
  assert.equal(unauthenticated.status(), 401);
  await page.goto(`${origin}/admin`);
  await page.getByRole("heading", { name: "Administration" }).waitFor();
  await page.getByLabel("Admin access code").fill("incorrect-code");
  await page.getByRole("button", { name: "Open admin console" }).click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Admin access code").fill(adminCode);
  await page.getByRole("button", { name: "Open admin console" }).click();
  await page.getByRole("heading", { name: "System overview" }).waitFor();
  const sessionCookie = (await context.cookies()).find(cookie => cookie.name === "banking_preview_admin");
  assert.ok(sessionCookie?.httpOnly, "admin session cookie is HttpOnly");
  assert.equal(sessionCookie.sameSite, "Strict");
  assert.match(sessionCookie.path, /^\/api\/admin/);
  console.log("PASS admin login, rejected credentials, signed HTTP-only session");

  const otherContext = await browser.newContext();
  await Promise.all([
    context.request.get(`${origin}/api/demo/workspace`),
    otherContext.request.get(`${origin}/api/demo/workspace`),
  ]);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ad-table tbody tr").length === 2);
  const privateAggregate = await page.evaluate(async () => {
    const response = await fetch("/api/admin/overview");
    return response.json();
  });
  assert.equal(privateAggregate.totals.workspaces, 2);
  assert.equal(privateAggregate.totals.accounts, 8);
  assert.equal(privateAggregate.totals.checkingBalances + privateAggregate.totals.savingsBalances, privateAggregate.totals.demoDeposits);
  assert.equal(JSON.stringify(privateAggregate).includes("henry.johnson@example.com"), false);
  assert.equal(JSON.stringify(privateAggregate).includes("Trader Joe"), false);
  await page.screenshot({ path: ".review/admin-overview.png" });
  console.log("PASS factual totals and anonymized workspaces");

  await page.getByRole("button", { name: /Sample data workspace/ }).first().click();
  await page.getByRole("dialog", { name: "Demo workspace details" }).waitFor();
  assert.ok(await page.getByRole("dialog").locator(".ad-detail-row").count() >= 4);
  await page.getByRole("button", { name: "Reset sample data" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset sample data" }).click();
  await page.getByText("Sample workspace reset to its original fictional demo data.").waitFor();
  assert.equal(await page.getByRole("dialog").locator(".ad-detail-row").count(), 5);
  await page.getByRole("button", { name: "Delete workspace" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete workspace" }).click();
  await page.getByRole("dialog", { name: "Demo workspace details" }).waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelectorAll(".ad-table tbody tr").length === 1);
  await page.getByRole("link", { name: "Audit trail" }).click();
  await page.getByText("demo workspace reset").waitFor();
  await page.getByText("demo workspace removed").waitFor();
  await page.screenshot({ path: ".review/admin-audit.png" });
  console.log("PASS workspace inspection, reset, deletion, and audit trail");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Admin settings" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.equal(mobileWidth, 0, "mobile admin dashboard must not overflow");
  await page.screenshot({ path: ".review/admin-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Administration" }).waitFor();
  assert.equal((await context.cookies()).some(cookie => cookie.name === "banking_preview_admin"), false);
  assert.equal(errors.length, 0);
  console.log("PASS admin navigation, sign-out, and zero page errors");
  await otherContext.close();
  await browser.close();
})().catch(error => { console.error("FAILED:", error.message); process.exit(1); });