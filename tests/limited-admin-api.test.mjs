import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("limited administrators only manage assigned workspaces", async () => {
  const directory = mkdtempSync(join(tmpdir(), "limited-admin-test-"));
  process.env.DEMO_DATA_DIR = directory;
  process.env.DEMO_ADMIN_TOKEN = "isolated-test-admin-token-123456789";
  const { adminApi } = await import("../server/api.mjs");
  const server = createServer((req, res) => adminApi(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (path, method = "GET", body, cookie) => fetch(`${base}/api/admin/${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookieFrom = (response) => response.headers.getSetCookie()[0].split(";")[0];

  try {
    const root = cookieFrom(await req("session", "POST", { token: process.env.DEMO_ADMIN_TOKEN }));
    const person = { name: "Assigned Support", email: "support@example.test", role: "limited" };
    const added = await req("admins", "POST", person, root);
    assert.equal(added.status, 201);
    const { admin, accessCode } = await added.json();
    assert.match(accessCode, /^[a-f0-9]{48}$/);
    assert.equal(admin.signInEnabled, true);
    assert.equal("signInKeyHash" in admin, false);
    const inventory = await (await req("admins", "GET", undefined, root)).text();
    assert.doesNotMatch(inventory, /signInKeyHash|passwordHash/);
    assert.equal(inventory.includes(accessCode), false);
    const backup = await (await req("backup", "GET", undefined, root)).text();
    assert.doesNotMatch(backup, /signInKeyHash|passwordHash/);
    assert.equal(backup.includes(accessCode), false);
    const create = async (name) => {
      const response = await req("customers", "POST", { name }, root);
      assert.equal(response.status, 201);
      return (await response.json()).customer;
    };
    const assigned = await create("Assigned Person");
    const other = await create("Other Person");
    assert.equal(assigned.accountCount, 4);
    const assignment = `users/${assigned.id}/assign-admin`;
    assert.equal((await req(assignment, "PUT", { ownerAdminId: admin.id }, root)).status, 200);
    assert.equal((await req("staff/session", "POST", { email: person.email, code: "incorrect" })).status, 401);
    assert.equal((await req("staff/workspaces")).status, 401);
    const switchingRoot = cookieFrom(await req("session", "POST", { token: process.env.DEMO_ADMIN_TOKEN }));
    const staffSignIn = await req("staff/session", "POST", { email: person.email.toUpperCase(), code: accessCode }, switchingRoot);
    assert.equal((await req("overview", "GET", undefined, switchingRoot)).status, 401);
    assert.equal(staffSignIn.status, 200);
    assert.match(staffSignIn.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
    assert.match(staffSignIn.headers.getSetCookie()[1], /^banking_preview_admin=;.*Max-Age=0/);
    const staff = cookieFrom(staffSignIn);
    assert.equal((await (await req("session", "GET", undefined, staff)).json()).authenticated, false);
    const mine = await (await req("staff/workspaces", "GET", undefined, staff)).json();
    assert.deepEqual(mine.workspaces.map(row => row.id), [assigned.id]);
    const detail = await (await req(`staff/workspaces/${assigned.id}`, "GET", undefined, staff)).json();
    assert.equal(detail.accounts.length, 4);
    assert.equal((await req(`staff/workspaces/${assigned.id}/access`, "PUT", { suspended: true }, staff)).status, 200);
    assert.equal((await req(`staff/workspaces/${assigned.id}/access`, "PUT", { suspended: false }, staff)).status, 200);
    const message = { subject: "Account update", body: "An internal test message." };
    assert.equal((await req(`staff/workspaces/${assigned.id}/messages`, "POST", message, staff)).status, 200);
    assert.equal((await (await req(`users/${assigned.id}/messages`, "GET", undefined, root)).json()).messages[0].subject, message.subject);
    assert.equal((await req(`staff/workspaces/${other.id}`, "GET", undefined, staff)).status, 404);
    assert.equal((await req(`staff/workspaces/${other.id}/access`, "PUT", { suspended: true }, staff)).status, 404);
    assert.equal((await req(`staff/workspaces/${other.id}/messages`, "POST", message, staff)).status, 404);
    for (const [path, method, body] of [
      ["overview", "GET"], ["settings", "PUT", { maintenanceMode: true }],
      ["customers", "POST", { name: "Blocked" }], ["backup", "GET"], ["admins", "POST", person],
      [assignment, "PUT", { ownerAdminId: null }], [`workspaces/${assigned.id}/reset`, "POST", {}],
    ]) assert.equal((await req(path, method, body, staff)).status, 403, path);
    const secondAccount = await (await req("admins", "POST", { ...person, name: "Another Support", email: "another@example.test" }, root)).json();
    const secondStaff = cookieFrom(await req("staff/session", "POST", { email: secondAccount.admin.email, code: secondAccount.accessCode }));
    assert.equal((await req(`staff/workspaces/${assigned.id}`, "GET", undefined, secondStaff)).status, 404);
    assert.equal((await req(assignment, "PUT", { ownerAdminId: secondAccount.admin.id }, root)).status, 200);
    assert.equal((await req(`staff/workspaces/${assigned.id}`, "GET", undefined, staff)).status, 404);
    assert.equal((await req(`staff/workspaces/${assigned.id}`, "GET", undefined, secondStaff)).status, 200);
    assert.equal((await req(`admins/${secondAccount.admin.id}`, "PUT", { active: false }, root)).status, 200);
    assert.equal((await req("staff/workspaces", "GET", undefined, secondStaff)).status, 401);
    assert.equal((await req(`admins/${secondAccount.admin.id}`, "DELETE", {}, root)).status, 200);
    assert.equal((await req("staff/session", "POST", { email: secondAccount.admin.email, code: secondAccount.accessCode })).status, 401);
    assert.equal((await req(assignment, "PUT", { ownerAdminId: null }, root)).status, 200);
    const replaced = await (await req(`admins/${admin.id}/access-code`, "POST", {}, root)).json();
    assert.notEqual(replaced.accessCode, accessCode);
    assert.equal((await req("staff/workspaces", "GET", undefined, staff)).status, 401);
    assert.equal((await req("staff/session", "POST", { email: person.email, code: accessCode })).status, 401);
    const newStaff = cookieFrom(await req("staff/session", "POST", { email: person.email, code: replaced.accessCode }));
    assert.equal((await req("staff/session", "DELETE", {}, newStaff)).status, 200);
    assert.equal((await req("staff/workspaces", "GET", undefined, newStaff)).status, 401);
    const getHistory = async (id) => (await (await req(`workspaces/${id}`, "GET", undefined, root)).json()).history.entries;
    const history = await getHistory(assigned.id);
    assert.ok(history.some(entry => entry.action === "customer_created" && entry.actor === "super-admin"));
    assert.ok(history.some(entry => entry.action === "support_message_sent" && entry.details.actorName === person.name));
    assert.ok(history.some(entry => entry.action === "customer_suspend"));
    assert.ok(history.some(entry => entry.action === "customer_access_restored"));
    assert.deepEqual((await getHistory(other.id)).map(entry => entry.action), ["customer_created"]);
    assert.equal("history" in detail, false);
    assert.equal(JSON.stringify(history).includes(message.body), false);

    const offboardPath = `admins/${admin.id}/offboard`;
    const recipient = await (await req("admins", "POST", { ...person, name: "Replacement Support", email: "replacement@example.test" }, root)).json();
    const sourceCookie = cookieFrom(await req("staff/session", "POST", { email: person.email, code: replaced.accessCode }));
    const destinationCookie = cookieFrom(await req("staff/session", "POST", { email: recipient.admin.email, code: recipient.accessCode }));
    assert.equal((await req(offboardPath, "GET", undefined, sourceCookie)).status, 403);
    assert.equal((await req(offboardPath, "POST", { replacementId: null }, sourceCookie)).status, 403);
    const emptyPlan = await (await req(offboardPath, "GET", undefined, root)).json();
    assert.equal(emptyPlan.workspaceCount, 0);
    assert.equal((await req(assignment, "PUT", { ownerAdminId: admin.id }, root)).status, 200);
    assert.equal((await req(offboardPath, "POST", { version: emptyPlan.version, replacementId: null }, root)).status, 409);
    const plan = await (await req(offboardPath, "GET", undefined, root)).json();
    assert.equal(plan.workspaceCount, 1);
    assert.equal((await req(offboardPath, "POST", { version: plan.version, replacementId: admin.id }, root)).status, 400);
    assert.equal((await req("staff/workspaces", "GET", undefined, sourceCookie)).status, 200);
    const completed = await (await req(offboardPath, "POST", { version: plan.version, replacementId: recipient.admin.id }, root)).json();
    assert.equal(completed.affected, 1);
    assert.equal(completed.admin.active, false);
    assert.equal(completed.admin.signInEnabled, false);
    assert.equal((await req("staff/workspaces", "GET", undefined, sourceCookie)).status, 401);
    assert.equal((await req("staff/session", "POST", { email: person.email, code: replaced.accessCode })).status, 401);
    assert.equal((await req(`staff/workspaces/${assigned.id}`, "GET", undefined, destinationCookie)).status, 200);
    assert.deepEqual((await getHistory(assigned.id))[0].details, { previousOwnerName: person.name, nextOwnerName: recipient.admin.name, workspaceCount: 1 });
    const destinationPath = `admins/${recipient.admin.id}/offboard`;
    const destinationPlan = await (await req(destinationPath, "GET", undefined, root)).json();
    assert.equal((await req(destinationPath, "POST", { version: destinationPlan.version, replacementId: null }, root)).status, 200);
    assert.equal((await (await req(`customers/${assigned.id}`, "GET", undefined, root)).json()).customer.ownerAdminId, null);
    assert.equal((await getHistory(assigned.id))[0].details.nextOwnerName, null);
    assert.equal((await req("staff/workspaces", "GET", undefined, destinationCookie)).status, 401);
    assert.equal((await req(`admins/${admin.id}`, "PUT", { active: true }, root)).status, 200);
    assert.equal((await req("staff/session", "POST", { email: person.email, code: replaced.accessCode })).status, 401);
    // Re-create a scoped operator to verify the new account permission without exposing balance controls.
    const openerIdentity = await (await req("admins", "POST", { ...person, name: "Account Setup", email: "setup@example.test" }, root)).json();
    const opener = cookieFrom(await req("staff/session", "POST", { email: openerIdentity.admin.email, code: openerIdentity.accessCode }));
    const limitedPath = `staff/workspaces/${assigned.id}/accounts`;
    const rootPath = `users/${assigned.id}/accounts`;
    const utc = new Date().toISOString().slice(0, 10);
    const opening = { name: "Generated checking", type: "checking", openingDate: "2023-01-10" };
    assert.equal((await req(limitedPath, "POST", opening, opener)).status, 404);
    assert.equal((await req(assignment, "PUT", { ownerAdminId: openerIdentity.admin.id }, root)).status, 200);
    assert.equal((await req(limitedPath, "POST", { ...opening, balance: 99 }, opener)).status, 403);
    assert.equal((await req(limitedPath, "POST", { ...opening, openingDate: "2023-02-30" }, opener)).status, 400);
    assert.equal((await req(limitedPath, "POST", { name: opening.name, type: opening.type }, opener)).status, 400);
    assert.equal((await req(limitedPath, "POST", { ...opening, openingDate: "2999-01-01" }, opener)).status, 400);
    const opened = await req(limitedPath, "POST", opening, opener);
    assert.equal(opened.status, 200);
    const { account } = await opened.json();
    assert.equal(account.balance, 0);
    assert.equal(account.openingDate, opening.openingDate);
    assert.equal((await req(`${rootPath}/${account.id}`, "PUT", { openingDate: "2023-01-09" }, root)).status, 409);
    assert.equal((await req(`users/${assigned.id}/transactions`, "POST", { accountId: account.id, amount: 100, date: "2023-01-09" }, root)).status, 400);
    assert.equal((await req(limitedPath, "POST", opening, staff)).status, 401);
    const generatePath = `workspaces/${assigned.id}/transactions/generate`;
    const batch = { accountId: account.id, endDate: "2023-01-20", count: 20, requestId: "test-dated-batch" };
    assert.equal((await req(generatePath, "POST", batch, opener)).status, 403);
    assert.equal((await req(generatePath, "POST", { ...batch, startDate: "2023-01-09" }, root)).status, 400);
    assert.equal((await req(generatePath, "POST", { ...batch, endDate: utc, count: 101 }, root)).status, 400);
    assert.equal((await req(generatePath, "POST", batch, root)).status, 200);
    assert.equal((await req(generatePath, "POST", batch, root)).status, 200);
    assert.equal((await req(generatePath, "POST", { ...batch, count: 10 }, root)).status, 409);
    const { state } = await (await req(`customers/${assigned.id}`, "GET", undefined, root)).json();
    const generated = state.transactions.filter(row => row.accountId === account.id);
    assert.equal(generated.length, 20);
    assert.equal(generated.at(-1).date, "2023-01-10");
    assert.equal(generated[0].date, "2023-01-20");
    assert.ok(generated.every(row => row.source === "generated" && row.description.startsWith("Generated activity:") && row.date >= opening.openingDate));
    let running = 0;
    for (const row of [...generated].reverse()) { running += row.amount; assert.ok(running >= 0); }
    assert.equal(state.accounts.find(row => row.id === account.id).balance, running);
    assert.equal((await req(`users/${assigned.id}/transactions/${generated[0].id}`, "PUT", { amount: 12 }, root)).status, 409);
    assert.ok((await getHistory(assigned.id)).some(entry => entry.action === "account_created" && entry.details.actorName === "Account Setup"));
    const audit = await (await req("audit", "GET", undefined, root)).json();
    assert.ok(audit.entries.some(entry => entry.action === "support_message_sent" && entry.actor.startsWith("limited-admin:")));
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
