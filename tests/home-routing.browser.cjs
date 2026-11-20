const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const destinations = require("../shared/official-destinations.json");

const base = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);

    for (const path of ["/", "/home"]) {
      await page.goto(base + path);
      await page.locator(".checking-hero h1").waitFor();
      await page.locator(".masthead").waitFor();
      assert.equal(new URL(page.url()).pathname, path);
      assert.equal(await page.locator(".secure-login-page").count(), 0);
    }

    await page.locator(".signon-actions").getByRole("link", { name: "Sign On" }).click();
    await page.waitForURL("**/login");
    await page.locator(".secure-login-page").waitFor();
    await page.goBack();
    await page.locator(".checking-hero h1").waitFor();

    await page.goto(base + "/portal/activity");
    await page.locator(".secure-login-page").waitFor();
    assert.equal(await page.locator("#portal-main").count(), 0);
    let submitted = false;
    page.on("request", request => {
      if (request.url().endsWith("/api/demo/session") && request.method() === "POST") {
        assert.equal(request.postData(), "{}");
        submitted = true;
      }
    });
    await page.locator('input[name="username"]').fill("not-a-workspace-user");
    await page.locator('input[name="password"]').fill("not-a-workspace-password");
    await page.getByRole("button", { name: "Sign on", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(submitted, false);
    await page.getByRole("button", { name: "One-click sign in" }).click();
    await page.locator("#portal-main h1").waitFor();
    assert.equal(submitted, true);
    assert.equal(new URL(page.url()).pathname, "/portal/activity");

    await page.goto(base + "/");
    await page.locator(".checking-hero h1").waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    await page.goto(base + "/login");
    await page.getByRole("button", { name: "Use a passkey" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("link", { name: "Continue" }).getAttribute("href"), destinations["/auth/login"]);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    const blocked = await browser.newPage();
    await blocked.route("**/api/demo/session", route => route.fulfill({ json: { authenticated: route.request().method() === "POST" } }));
    await blocked.goto(base + "/portal/activity");
    await blocked.getByRole("button", { name: "One-click sign in" }).click();
    const newTab = blocked.getByRole("link", { name: "Open sign-in in a new tab" });
    await newTab.waitFor();
    assert.equal(await newTab.getAttribute("target"), "_blank");
    assert.equal(await newTab.getAttribute("href"), base + "/portal/activity");
    await blocked.close();

    const preview = await browser.newPage();
    let storageAllowed = false;
    let permissionRequests = 0;
    await preview.exposeBinding("testStorageAccess", () => {
      if (++permissionRequests === 1) throw new Error("Permission denied");
      storageAllowed = true;
    });
    await preview.addInitScript(() => { document.requestStorageAccess = () => window.testStorageAccess(); });
    await preview.route("**/embedded-sign-in-test", route => route.fulfill({ contentType: "text/html", body: '<iframe title="Customer preview" src="/portal/activity"></iframe>' }));
    await preview.route("**/api/demo/session", route => storageAllowed ? route.continue() : route.fulfill({ json: { authenticated: route.request().method() === "POST" } }));
    await preview.goto(base + "/embedded-sign-in-test");
    const embedded = preview.frameLocator("iframe");
    await embedded.getByRole("button", { name: "One-click sign in" }).click();
    const permission = embedded.getByRole("button", { name: "Allow sign-in in this preview" });
    await permission.click();
    await embedded.getByText(/couldn’t get permission/).waitFor();
    await embedded.getByRole("link", { name: "Open sign-in in a new tab" }).waitFor();
    await permission.click();
    await embedded.locator("#portal-main h1").waitFor();
    await preview.close();

    await page.route(url => url.href === destinations["/enroll"], route => route.fulfill({ contentType: "text/html", body: "<h1>Official destination</h1>" }));
    await page.goto(base + "/enroll", { waitUntil: "domcontentloaded" });
    await page.waitForURL(destinations["/enroll"]);
    console.log("PASS public homepage, protected routing, and official enrollment and passkey destinations");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
