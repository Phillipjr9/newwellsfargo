import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("staff funding spends only super-admin grants on other customers created and still managed by that staff member", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "staff-funding-test-"));
  process.env.DEMO_DATA_DIR = dataDir;
  process.env.DEMO_ADMIN_TOKEN = "isolated-staff-funding-test-token";
  const { adminApi } = await import("../server/api.mjs");
  const server = createServer((req, res) => adminApi(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, cookie, method = "GET", body) => fetch(`${origin}/api/admin/${path}`, {
    method, headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  const check = async (status, ...args) => {
    const response = await call(...args);
    const body = await response.json();
    assert.equal(response.status, status, `${args[0]}: ${JSON.stringify(body)}`);
    return { body, cookie: response.headers.getSetCookie()[0]?.split(";")[0] };
  };
  try {
    const { cookie: root } = await check(200, "session", null, "POST", { token: process.env.DEMO_ADMIN_TOKEN });
    const newStaff = async (name, email) => (await check(201, "admins", root, "POST", { name, email, role: "limited", fundingAvailable: 99999 })).body;
    const signIn = async ({ admin, accessCode }) => (await check(200, "staff/session", null, "POST", { email: admin.email, code: accessCode })).cookie;
    const staff = await newStaff("Casey Agent", "casey@example.test");
    const replacement = await newStaff("Jordan Agent", "jordan@example.test");
    const limited = await signIn(staff);
    const second = await signIn(replacement);
    const grant = `admins/${staff.admin.id}/funding`;
    const budget = async (cookie = limited) => (await check(200, "staff/workspaces", cookie)).body.fundingAvailable;
    assert.equal(await budget(), 0);
    await check(403, grant, limited, "POST", { amount: 9000 });
    await check(400, grant, root, "POST", { amount: 12.5 });
    await check(400, grant, root, "POST", { amount: -1 });
    await check(200, grant, root, "POST", { amount: 10000 });
    await check(200, grant, root, "POST", { amount: 2000 });
    assert.equal(await budget(), 12000);
    assert.equal(await budget(second), 0);

    for (const name of ["casey   AGENT", "Casey-Agent", "CASEY@EXAMPLE.TEST"]) {
      await check(403, "staff/workspaces", limited, "POST", { name });
    }
    await check(400, "staff/workspaces", limited, "POST", { name: "Spoof", createdByLimitedAdminId: replacement.admin.id });
    const newCustomer = async (name, cookie = limited) => (await check(201, "staff/workspaces", cookie, "POST", { name })).body.customer;
    const customer = await newCustomer("Taylor Customer");
    const target = `staff/workspaces/${customer.id}`;
    const { state: empty } = (await check(200, `customers/${customer.id}`, root)).body;
    assert.deepEqual(empty.accounts, []);
    assert.deepEqual(empty.transactions, []);
    assert.deepEqual(empty.payments, []);
    assert.equal(empty.createdByLimitedAdminId, staff.admin.id);
    await check(403, `customers/${customer.id}/invitation`, limited, "POST", { status: "not_enrolled" });
    const opening = { name: "Checking", type: "checking", openingDate: "2023-01-10" };
    const { account } = (await check(200, `${target}/accounts`, limited, "POST", opening)).body;
    assert.equal(account.balance, 0);
    const funding = { accountId: account.id, amount: 2500, requestId: "initial-funding" };
    await check(401, `${target}/funding`, null, "POST", funding);
    await check(404, `${target}/funding`, second, "POST", funding);
    await check(409, `${target}/funding`, limited, "POST", { ...funding, amount: 12001 });
    await check(200, `${target}/access`, limited, "PUT", { suspended: true });
    await check(409, `${target}/funding`, limited, "POST", funding);
    await check(200, `${target}/access`, limited, "PUT", { suspended: false });
    await check(200, `customers/${customer.id}`, root, "PUT", { email: staff.admin.email });
    await check(403, `${target}/funding`, limited, "POST", funding);
    await check(200, `customers/${customer.id}`, root, "PUT", { email: "taylor@example.test" });
    const result = (await check(200, `${target}/funding`, limited, "POST", funding)).body;
    assert.equal(result.fundingAvailable, 9500);
    assert.equal(result.transaction.source, "staff_funding");
    assert.equal(result.transaction.date, new Date().toISOString().slice(0, 10));
    assert.deepEqual((await check(200, `${target}/funding`, limited, "POST", funding)).body, result);
    await check(409, `${target}/funding`, limited, "POST", { ...funding, amount: 2501 });
    await check(409, `users/${customer.id}/transactions/${result.transaction.id}`, root, "DELETE", {});

    const { id: anotherId } = await newCustomer("Second Customer");
    const { account: anotherAccount } = (await check(200, `staff/workspaces/${anotherId}/accounts`, limited, "POST", opening)).body;
    const race = await Promise.all([
      call(`${target}/funding`, limited, "POST", { ...funding, requestId: "race-first", amount: 9500 }),
      call(`staff/workspaces/${anotherId}/funding`, limited, "POST", { ...funding, accountId: anotherAccount.id, requestId: "race-second", amount: 9500 }),
    ]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
    assert.equal(await budget(), 0);
    const customerState = (await check(200, `customers/${customer.id}`, root)).body.state;
    const otherState = (await check(200, `customers/${anotherId}`, root)).body.state;
    assert.equal(customerState.accounts[0].balance + otherState.accounts[0].balance, 12000);

    const assign = `users/${customer.id}/assign-admin`;
    await check(200, assign, root, "PUT", { ownerAdminId: replacement.admin.id });
    await check(404, `${target}/funding`, limited, "POST", funding);
    await check(403, `${target}/funding`, second, "POST", funding);
    await check(200, assign, root, "PUT", { ownerAdminId: staff.admin.id });
    const { customer: assignedOnly } = (await check(201, "customers", root, "POST", { name: "Super Admin Customer" })).body;
    await check(200, `users/${assignedOnly.id}/assign-admin`, root, "PUT", { ownerAdminId: staff.admin.id });
    await check(403, `staff/workspaces/${assignedOnly.id}/funding`, limited, "POST", funding);

    await check(200, grant, root, "POST", { amount: 500 });
    const backup = (await check(200, "backup", root)).body;
    assert.equal(backup.admins.find(row => row.id === staff.admin.id).fundingAvailable, 500);
    await check(200, "restore", root, "POST", { ...backup, confirmation: "RESTORE" });
    const renewed = await signIn(staff);
    assert.equal(await budget(renewed), 500);
    assert.equal((await check(200, target, renewed)).body.canFund, true);
    const audit = (await check(200, "audit", root)).body.entries;
    assert.equal(audit.filter(row => row.action === "staff_funding_granted").length, 3);
    assert.equal(audit.filter(row => row.action === "staff_funding_allocated").length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
