import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as nodeRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("signed-in actions, maintenance mode, and sign-out use consistent server state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-session-"));
  process.env.DEMO_DATA_DIR = directory;
  delete process.env.DEMO_ADMIN_TOKEN;
  const { adminApi, demoApi } = await import("../server/api.mjs");
  const server = createServer((req, res) => adminApi(req, res, () => demoApi(req, res, () => { res.writeHead(404); res.end(); })));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = "GET", cookie, body, session = true } = {}) => fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: base, ...(session ? { "X-Demo-Session": "required" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await (await request("/api/admin/session")).json()).adminEnabled, false);
    assert.equal((await request("/api/demo/workspace")).status, 401);
    assert.equal((await request("/api/demo/session", { method: "POST", body: { username: "not-used" } })).status, 400);

    const arenaCookie = await new Promise((resolve, reject) => {
      const req = nodeRequest(`${base}/api/demo/session`, {
        method: "POST", headers: { Host: "sbx-preview-test.arena.site", "Content-Type": "application/json", "Content-Length": 2 },
      }, response => {
        response.resume();
        resolve(response.headers["set-cookie"]?.[0] ?? "");
      });
      req.on("error", reject);
      req.end("{}");
    });
    assert.match(arenaCookie, /HttpOnly; SameSite=None; Secure; Partitioned/);

    const signIn = await request("/api/demo/session", { method: "POST", body: {} });
    assert.equal(signIn.status, 200);
    assert.match(signIn.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
    const { workspaceId } = await signIn.json();
    const cookie = signIn.headers.getSetCookie()[0].split(";")[0];
    const preference = { action: "preference", payload: { key: "hideBalances", value: true } };
    assert.equal((await request("/api/demo/action", { method: "POST", body: preference, cookie })).status, 200);
    const workspace = await (await request("/api/demo/workspace", { cookie })).json();
    assert.equal(workspace.workspaceId, workspaceId);
    assert.equal(workspace.state.preferences.hideBalances, true);

    process.env.DEMO_ADMIN_TOKEN = "test-admin-configuration-only-123456789";
    const admin = await request("/api/admin/session", { method: "POST", body: { token: process.env.DEMO_ADMIN_TOKEN } });
    assert.equal(admin.status, 200);
    const adminCookie = admin.headers.getSetCookie()[0].split(";")[0];
    assert.equal((await request("/api/admin/settings", { method: "PUT", cookie: adminCookie, body: { maintenanceMode: true } })).status, 200);
    assert.equal((await request("/api/demo/workspace", { cookie })).status, 503);
    assert.equal((await request("/api/demo/action", { method: "POST", body: preference, cookie })).status, 503);

    const signOut = await request("/api/demo/exit", { method: "POST", body: {}, cookie });
    assert.equal(signOut.status, 200);
    assert.equal(signOut.headers.getSetCookie().filter(value => value.includes("Max-Age=0")).length, 2);
    assert.equal((await (await request("/api/demo/session", { cookie })).json()).authenticated, false);
    assert.equal((await request("/api/admin/settings", { method: "PUT", cookie: adminCookie, body: { maintenanceMode: false } })).status, 200);
    assert.equal((await request("/api/demo/workspace", { cookie })).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
