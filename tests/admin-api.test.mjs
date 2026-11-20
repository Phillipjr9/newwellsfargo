import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("super-admin API protects, summarizes, audits and resets only demo workspaces", async () => {
  const before = {
    directory: process.env.DEMO_DATA_DIR,
    token: process.env.DEMO_ADMIN_TOKEN,
    env: process.env.NODE_ENV,
  };
  const directory = mkdtempSync(join(tmpdir(), "sample-admin-test-"));
  process.env.DEMO_DATA_DIR = directory;
  process.env.DEMO_ADMIN_TOKEN = "browser-test-only-admin";
  process.env.NODE_ENV = "test";
  const { adminApi, demoApi } = await import(`../server/api.mjs?${Date.now()}`);
  const server = createServer((req, res) => adminApi(req, res, () => demoApi(req, res, () => { res.writeHead(404); res.end(); })));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const json = { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" };
  try {
    assert.equal((await fetch(`${origin}/api/admin/overview`)).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/session`, { method: "POST", headers: json, body: JSON.stringify({ token: "wrong" }) })).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/session`, { method: "POST", headers: { ...json, Origin: "https://untrusted.example" }, body: JSON.stringify({ token: "browser-test-only-admin" }) })).status, 403);

    const customerA = await fetch(`${origin}/api/demo/workspace`);
    const customerB = await fetch(`${origin}/api/demo/workspace`);
    const keys = [customerA.headers.get("x-demo-workspace"), customerB.headers.get("x-demo-workspace")];
    assert.notEqual(keys[0], keys[1]);
    assert.equal(readdirSync(directory).filter(n => /^[a-f0-9]{48}\.json$/.test(n)).length, 2);

    const login = await fetch(`${origin}/api/admin/session`, { method: "POST", headers: json, body: JSON.stringify({ token: "browser-test-only-admin" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=3600/);
    const admin = { Cookie: cookie.split(";")[0] };

    const response = await fetch(`${origin}/api/admin/overview`, { headers: admin });
    const overview = await response.json();
    assert.equal(overview.totals.workspaces, 2);
    assert.equal(overview.totals.accounts, 8);
    assert.equal(overview.totals.checkingBalances + overview.totals.savingsBalances, overview.totals.demoDeposits);
    assert.equal(overview.dailyActivity.length, 7);
    assert.ok(overview.dailyActivity.some(day => day.count > 0));
    assert.equal(JSON.stringify(overview).includes("henry.johnson@example.com"), false);
    assert.equal(JSON.stringify(overview).includes("Trader Joe"), false);

    const id = keys[0];
    assert.equal((await fetch(`${origin}/api/admin/workspaces/${id}`, { headers: admin })).status, 200);
    const reset = await fetch(`${origin}/api/admin/workspaces/${id}/reset`, { method: "POST", headers: { ...json, ...admin }, body: "{}" });
    assert.equal(reset.status, 200);
    const resetBody = await reset.json();
    assert.equal(resetBody.summary.paymentCount, 1);
    assert.equal(resetBody.summary.scheduledCount, 1);
    const audit = await (await fetch(`${origin}/api/admin/audit`, { headers: admin })).json();
    assert.ok(audit.entries.some(e => e.action === "demo_workspace_reset"));
    assert.equal(JSON.stringify(audit).includes("henry.johnson@example.com"), false);

    assert.equal((await fetch(`${origin}/api/admin/workspaces/${id}`, { method: "DELETE", headers: { ...json, ...admin }, body: "{}" })).status, 200);
    assert.equal((await fetch(`${origin}/api/admin/workspaces/${id}`, { headers: admin })).status, 404);
    const secondLogin = await fetch(`${origin}/api/admin/session`, { method: "POST", headers: json, body: JSON.stringify({ token: process.env.DEMO_ADMIN_TOKEN }) });
    assert.equal(secondLogin.status, 200);
    const secondAdmin = { Cookie: secondLogin.headers.get("set-cookie").split(";")[0] };
    const signout = await fetch(`${origin}/api/admin/session`, { method: "DELETE", headers: { ...json, ...admin }, body: "{}" });
    assert.equal(signout.status, 200);
    assert.match(signout.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await fetch(`${origin}/api/admin/overview`, { headers: admin })).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/overview`, { headers: secondAdmin })).status, 200);
    assert.equal((await fetch(`${origin}/api/admin/overview`)).status, 401);

    delete process.env.DEMO_ADMIN_TOKEN;
    process.env.NODE_ENV = "production";
    const productionStatus = await (await fetch(`${origin}/api/admin/session`)).json();
    assert.equal(productionStatus.adminEnabled, false);
    assert.equal((await fetch(`${origin}/api/admin/session`, { method: "POST", headers: json, body: JSON.stringify({ token: "preview-admin" }) })).status, 503);
    process.env.DEMO_ADMIN_TOKEN = "too-short-production-secret";
    assert.equal((await (await fetch(`${origin}/api/admin/session`)).json()).adminEnabled, false);
    const productionSecret = "replace-with-a-unique-32-character-production-admin-secret";
    process.env.DEMO_ADMIN_TOKEN = productionSecret;
    process.env.DEMO_ADMIN_EMAIL = "root@example.test";
    process.env.DEMO_ADMIN_PASSWORD = "Production-Admin-Password-123";
    const productionLogin = await fetch(`${origin}/api/admin/session`, { method: "POST", headers: json, body: JSON.stringify({ email: "root@example.test", password: "Production-Admin-Password-123", token: productionSecret }) });
    assert.equal(productionLogin.status, 200);
    assert.match(productionLogin.headers.get("set-cookie"), /; Secure/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
    if (before.directory === undefined) delete process.env.DEMO_DATA_DIR; else process.env.DEMO_DATA_DIR = before.directory;
    if (before.token === undefined) delete process.env.DEMO_ADMIN_TOKEN; else process.env.DEMO_ADMIN_TOKEN = before.token;
    if (before.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before.env;
  }
});