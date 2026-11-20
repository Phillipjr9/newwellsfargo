import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("cookie-free preview sessions are isolated, temporary and never authenticate customer or admin APIs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "preview-session-"));
  process.env.DEMO_DATA_DIR = directory;
  const { adminApi, demoApi } = await import("../server/api.mjs");
  const server = createServer((req, res) => adminApi(req, res, () => demoApi(req, res, () => { res.writeHead(404); res.end(); })));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = "GET", data, token, origin = base } = {}) => fetch(`${base}/api/${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json", "X-Demo-Session": "required", ...(token ? { "X-Workspace-Preview-Session": token } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const signIn = () => request("demo/preview/session", { method: "POST", data: {} });
  try {
    assert.equal((await request("demo/preview/session", { method: "POST", data: {}, origin: "https://elsewhere.test" })).status, 403);
    assert.equal((await request("demo/preview/session", { method: "POST", data: { workspaceId: "invalid" } })).status, 400);
    const start = await signIn();
    assert.equal(start.status, 200);
    assert.equal(start.headers.has("Set-Cookie"), false);
    assert.equal(start.headers.get("Cache-Control"), "no-store");
    const { token } = await start.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal((await (await request("demo/preview/session", { token })).json()).authenticated, true);
    assert.equal((await request("demo/preview/workspace")).status, 401);
    assert.equal((await request("admin/overview", { token })).status, 401);
    assert.equal((await request("demo/workspace", { token })).status, 401);
    const result = await request("demo/preview/action", { token, method: "POST", data: { action: "preference", payload: { key: "hideBalances", value: true } } });
    assert.equal(result.status, 200);
    assert.equal((await (await request("demo/preview/workspace", { token })).json()).state.preferences.hideBalances, true);
    const secondToken = (await (await signIn()).json()).token;
    assert.equal((await (await request("demo/preview/workspace", { token: secondToken })).json()).state.preferences.hideBalances, false);
    assert.deepEqual(readdirSync(directory), []);
    assert.equal((await request("demo/preview/exit", { method: "POST", data: {}, token })).status, 200);
    assert.equal((await request("demo/preview/workspace", { token })).status, 401);
    process.env.NODE_ENV = "production";
    assert.equal((await signIn()).status, 404);
    assert.equal((await request("demo/preview/workspace", { token: secondToken })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

process.env.NODE_ENV = "test";
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_ADMIN_PASSWORD;
  delete process.env.DEMO_CUSTOMER_EMAIL;
  delete process.env.DEMO_CUSTOMER_PASSWORD;
