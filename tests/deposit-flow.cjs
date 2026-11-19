const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync(".review", { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.setDefaultTimeout(15000);
  const state = async () => (await p.evaluate(async () => {
    const key = sessionStorage.getItem("banking-preview-workspace");
    return (await (await fetch("/api/demo/workspace", { headers: key ? { "X-Demo-Workspace": key } : {} })).json()).state;
  }));
  const bal = (s, id) => s.accounts.find((a) => a.id === id).balance;

  await p.goto("http://127.0.0.1:5173/portal/mobile-deposit");
  await p.getByRole("heading", { name: "Mobile check deposit" }).waitFor();
  assert.ok(await p.locator(".pb-deposit-hero img").isVisible(), "hero image");
  console.log("hero ok");
  const before = bal(await state(), "savings");

  await p.getByRole("button", { name: "Start a deposit" }).click();
  await p.getByRole("radio", { name: /Way2Save Savings/ }).check();
  await p.getByRole("checkbox", { name: "Make selected account my default" }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  console.log("account step ok");

  await p.locator(".pb-money-input input").fill("250.00");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  console.log("amount step ok");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const inputs = p.locator('.pb-photo-slot input[type="file"]');
  await inputs.nth(0).setInputFiles({ name: "front.png", mimeType: "image/png", buffer: png });
  await inputs.nth(1).setInputFiles({ name: "back.png", mimeType: "image/png", buffer: png });
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  console.log("photos step ok");

  await assert.doesNotReject(() => p.getByText("Way2Save Savings ····9104").waitFor());
  await p.getByRole("button", { name: "Deposit", exact: true }).click();
  await p.getByRole("heading", { name: "Sample deposit recorded" }).waitFor();
  const ref = await p.locator(".pb-deposit-confirm").innerText();
  assert.match(ref, /Reference DEMO-/);
  const after = bal(await state(), "savings");
  assert.equal(after, before + 25000, "balance increased by deposit");
  console.log("deposit posted; balance", before, "->", after);

  // Activity shows it
  await p.getByRole("link", { name: "View account activity" }).click();
  await p.getByText("Mobile check deposit").first().waitFor();
  console.log("activity entry ok");

  // History lists it as a mobile deposit
  await p.goto("http://127.0.0.1:5173/portal/payments");
  await p.locator(".pb-payment-row").first().waitFor();
  assert.match(await p.locator(".pb-payment-row").first().innerText(), /Mobile deposit/);

  // Default account persisted
  await p.goto("http://127.0.0.1:5173/portal/mobile-deposit");
  await p.getByRole("heading", { name: "Mobile check deposit" }).waitFor();
  await p.getByRole("button", { name: "Start a deposit" }).click();
  assert.equal(await p.getByRole("radio", { name: /Way2Save Savings/ }).isChecked(), true, "default account preselected");

  await p.locator(".pb-deposit-grid").screenshot({ path: ".review/deposit-flow.png" });
  console.log("errors:", JSON.stringify(errors));
  assert.equal(errors.length, 0);
  await b.close();
  console.log("DEPOSIT FLOW PASSED");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
