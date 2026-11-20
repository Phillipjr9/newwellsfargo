import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { day } from "../shared/ledger.mjs";

test("demo HTTP API isolates workspaces, persists changes, and rejects invalid input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bank-preview-test-"));
  process.env.DEMO_DATA_DIR = dir;
  process.env.NODE_ENV = "test";
  delete process.env.DEMO_ADMIN_TOKEN;
  process.env.DEMO_CUSTOMER_EMAIL = "customer@example.test";
  process.env.DEMO_CUSTOMER_PASSWORD = "test-customer-password";
  const { demoApi } = await import("../server/api.mjs");
  const server = createServer((req, res) =>
    demoApi(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/demo`;
  try {
    const a = await fetch(`${url}/workspace`),
      b = await fetch(`${url}/workspace`);
    const key = a.headers.get("x-demo-workspace");
    assert.match(key, /^[a-f0-9]{48}$/);
    assert.notEqual(key, b.headers.get("x-demo-workspace"));
    assert.match(a.headers.get("set-cookie"), /HttpOnly/);
    const payload = {
      kind: "transfer",
      from: "checking",
      to: "savings",
      amount: 2000,
      frequency: "once",
      date: day(),
      requestId: crypto.randomUUID(),
    };
    const headers = {
      "Content-Type": "application/json",
      "X-Demo-Workspace": key,
    };
    const action = (body, extra = {}) =>
      fetch(`${url}/action`, {
        method: "POST",
        headers: { ...headers, ...extra },
        body: JSON.stringify(body),
      });
    const [one, two] = await Promise.all([
      action({ action: "submit", payload }),
      action({ action: "submit", payload }),
    ]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal((await one.json()).result, (await two.json()).result);
    const x = await (await fetch(`${url}/workspace`, { headers })).json();
    const y = await (
      await fetch(`${url}/workspace`, {
        headers: { "X-Demo-Workspace": b.headers.get("x-demo-workspace") },
      })
    ).json();
    assert.equal(
      y.state.accounts[0].balance - x.state.accounts[0].balance,
      2000,
    );
    assert.equal(
      x.state.payments.filter((p) => p.requestId === payload.requestId).length,
      1,
    );
    assert.equal(
      (
        await action({
          action: "submit",
          payload: { ...payload, amount: -1, requestId: crypto.randomUUID() },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await action(
          {
            action: "preference",
            payload: { key: "hideBalances", value: true },
          },
          { Origin: "https://other.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await action({
          action: "preference",
          payload: { key: "notASetting", value: true },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await fetch(`${url}/action`, {
          method: "POST",
          headers,
          body: "bad json",
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${url}/exit`, { method: "POST", headers })).status,
      200,
    );
    assert.equal(
      (
        await action({
          action: "submit",
          payload: { ...payload, requestId: crypto.randomUUID() },
        })
      ).status,
      409,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
