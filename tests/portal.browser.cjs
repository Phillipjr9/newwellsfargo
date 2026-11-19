const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const iso = (n = 0) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await c.newPage();
  p.setDefaultTimeout(7000);
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const go = async (path) => {
    await p.goto(base + path);
    await p.locator("h1").waitFor();
  };
  const state = async () =>
    await p.evaluate(async () => {
      const key = sessionStorage.getItem("banking-preview-workspace");
      return (
        await (
          await fetch("/api/demo/workspace", {
            headers: key ? { "X-Demo-Workspace": key } : {},
          })
        ).json()
      ).state;
    });
  const bal = (s, id) => s.accounts.find((a) => a.id === id).balance;
  const review = () =>
    p.getByRole("button", { name: /^Review (transfer|payment)$/ }).click();
  const amount = p.locator(".pb-money-input input");
  const confirm = async () => {
    await p
      .getByRole("button", { name: "Confirm demo payment", exact: true })
      .click();
    await p.waitForURL("**/portal/payments/DEMO-*");
    await p.locator(".pb-receipt h1").waitFor();
    return p.url();
  };
  const nav = async (path) => {
    await go(path);
    await p.locator(".pb-payment-form").waitFor();
  };
  try {
    await go("/");
    await p.locator(".pb-balance-value button:not(:disabled)").waitFor();
    const initial = await state();
    assert.equal(initial.accounts.length, 4);
    await p.locator('.pb-quick a[href="/portal/transfers"]').click();
    await amount.fill("6000.00");
    await review();
    await p
      .getByRole("alert")
      .filter({ hasText: "more than your available balance" })
      .waitFor();
    assert.equal(bal(await state(), "checking"), 485022);
    await amount.fill("125.55");
    await review();
    await p.getByRole("button", { name: "Edit details" }).click();
    assert.equal(await amount.inputValue(), "125.55");
    await review();
    const internalReceipt = await confirm();
    let s = await state();
    assert.equal(bal(s, "checking"), 472467);
    assert.equal(bal(s, "savings"), 1437635);
    await p.reload();
    await p.locator(".pb-receipt h1").waitFor();
    assert.match(
      await p.locator(".pb-receipt h1").innerText(),
      /Transfer completed/,
    );
    console.log(
      "PASS internal transfer, rejection, edit-before-confirm, balanced posting, durable receipt",
    );
    await nav("/portal/transfers/external");
    await p
      .getByRole("button", { name: "Link a sample bank", exact: true })
      .click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Link sample bank", exact: true })
      .click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    await p.reload();
    await p.locator(".pb-money-input input").waitFor();
    await p.locator("select").first().selectOption("harbor");
    await p.locator("select").nth(1).selectOption("checking");
    await amount.fill("25");
    await review();
    await confirm();
    s = await state();
    assert.equal(bal(s, "checking"), 474967);
    assert.equal(bal(s, "harbor"), 195500);
    console.log(
      "PASS sample bank linking, deep-link reload and external inbound transfer",
    );
    await nav("/portal/send-money");
    await p.getByLabel(/Sample recipient/).selectOption("alex");
    await amount.fill("12.50");
    await review();
    await confirm();
    assert.equal((await state()).payments[0].to, "alex");
    await nav("/portal/wires");
    await p.getByLabel(/Sample recipient/).selectOption("orchard");
    await amount.fill("75.25");
    await review();
    await confirm();
    assert.equal((await state()).payments[0].kind, "wire");
    console.log("PASS person-to-person and wire payment simulations");
    await nav("/portal/bill-pay");
    await p.getByLabel(/^Payee/).selectOption("pge");
    assert.equal(await amount.inputValue(), "128.45");
    await review();
    await confirm();
    await nav("/portal/bill-pay");
    assert.equal(await p.locator('option[value="pge"]').count(), 0);
    await nav("/portal/account-payment?to=credit");
    await amount.fill("50");
    await review();
    await confirm();
    assert.equal(bal(await state(), "credit"), 29215);
    await nav("/portal/account-payment?to=mortgage");
    await amount.fill("500");
    await review();
    await confirm();
    assert.equal(bal(await state(), "mortgage"), 28381000);
    console.log(
      "PASS bill settlement, duplicate-bill prevention, card and mortgage balances",
    );
    // The public guide lives at its real path; the demo transfer tool is at /portal/transfers.
    await nav("/portal/transfers");
    await amount.fill("72.35");
    await p.getByLabel("Transfer date").fill(iso(7));
    await p.getByLabel("Frequency").selectOption("weekly");
    const before = bal(await state(), "checking");
    await review();
    await confirm();
    assert.match(await p.locator(".pb-receipt h1").innerText(), /scheduled/);
    assert.equal(bal(await state(), "checking"), before);
    await p.getByRole("button", { name: "Edit payment", exact: true }).click();
    await p.getByRole("dialog").locator(".pb-money-input input").fill("80.50");
    await p.getByRole("dialog").getByLabel("Payment date").fill(iso(8));
    await p.getByRole("button", { name: "Save changes", exact: true }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await state()).payments[0].amount, 8050);
    await p
      .getByRole("button", { name: "Cancel payment", exact: true })
      .click();
    await p.getByRole("button", { name: "Confirm cancellation" }).click();
    await p
      .getByRole("heading", { name: "Transfer cancelled", exact: true })
      .waitFor();
    await p.reload();
    await p
      .getByRole("heading", { name: "Transfer cancelled", exact: true })
      .waitFor();
    assert.equal(bal(await state(), "checking"), before);
    console.log(
      "PASS legacy transfer route, scheduling, recurring frequency, editing, cancellation and refresh",
    );
    await go("/portal/payments?filter=cancelled");
    await p.locator(".pb-payment-row").first().waitFor();
    assert.equal(await p.locator(".pb-payment-row").count(), 1);
    await p.getByLabel("Filter payment activity").selectOption("completed");
    await p.waitForFunction((n) => document.querySelectorAll(".pb-payment-row").length === n, 7);
    assert.equal(await p.locator(".pb-payment-row").count(), 7);
    await go("/portal");
    await p.getByRole("button", { name: "Hide balances" }).click();
    await p.getByRole("button", { name: "Show balances" }).waitFor();
    await p.reload();
    await p.getByRole("button", { name: "Show balances" }).waitFor();
    await p.getByRole("button", { name: "Show balances" }).click();
    await p.getByRole("button", { name: "Hide balances" }).waitFor();
    await go("/portal/accounts/checking");
    await p
      .getByRole("searchbox", { name: "Search transactions" })
      .fill("Orchard");
    assert.equal(await p.locator(".pb-tx-row").count(), 1);
    await p.locator(".pb-tx-row").click();
    await p.getByRole("dialog").waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("dialog").waitFor({ state: "hidden" });
    let dl = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export CSV" }).click();
    assert.match((await dl).suggestedFilename(), /^DEMO-.*csv$/);
    await go("/portal/statements?account=checking");
    await p.getByRole("button", { name: "View report" }).click();
    await p.getByRole("dialog").waitFor();
    dl = p.waitForEvent("download");
    await p.getByRole("button", { name: "Download demo report" }).click();
    const download = await dl;
    assert.match(download.suggestedFilename(), /^DEMO-/);
    const fs = require("node:fs");
    assert.match(
      fs.readFileSync(await download.path(), "utf8"),
      /NOT A BANK STATEMENT/,
    );
    await p.getByRole("button", { name: "Close", exact: true }).click();
    console.log(
      "PASS account activity filtering, data privacy, and labeled report downloads",
    );
    await go("/portal/inbox");
    await p.getByRole("button", { name: "Mark all as read" }).click();
    await p.getByRole("button", { name: "All marked as read" }).waitFor();
    await p.reload();
    await p.getByRole("button", { name: "All marked as read" }).waitFor();
    await go("/portal/settings");
    const sw = p.getByRole("switch", { name: "Lock sample card" });
    await sw.click();
    await p.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Lock sample card"]')
          .getAttribute("aria-checked") === "true",
    );
    await p.reload();
    await p.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Lock sample card"]')
          ?.getAttribute("aria-checked") === "true",
    );
    await go("/portal");
    assert.equal(await p.locator("footer .footer-nav a").count(), 10);
    assert.equal(await p.locator("footer .footer-social a").count(), 6);
    assert.equal(await p.locator("footer .footer-investment li").count(), 3);
    await p.getByRole("link", { name: "Facebook", exact: true }).click();
    await p
      .getByRole("dialog", { name: "You are leaving this preview" })
      .waitFor();
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await go("/home");
    assert.match(await p.locator("h1").innerText(), /checking bonus/);
    await go("/sign-on");
    assert.equal(await p.locator("input").count(), 0);
    await p.getByRole("link", { name: "Enter demo dashboard" }).click();
    await p.locator(".pb-accounts").waitFor();
    console.log(
      "PASS settings, inbox read status, full footer, public homepage and credential-free entry",
    );
    const isolated = await b.newContext();
    const other = await isolated.newPage();
    await other.goto(base + "/portal");
    await other.getByRole("button", { name: "Hide balances" }).waitFor();
    await other.locator(".pb-balance-value button:not(:disabled)").waitFor();
    assert.match(
      await other.locator(".pb-account-rows li").first().innerText(),
      /4,850.22/,
    );
    await isolated.close();
    console.log("PASS separate browser workspaces do not share balances");
    assert.deepEqual(errors, []);
    console.log("PASS no browser page errors", base);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
