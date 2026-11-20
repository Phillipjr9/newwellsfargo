import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, applyAction } from "../shared/ledger.mjs";

test("scheduled processing settles saved workspaces without visits and does not double post", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-scheduler-"));
  process.env.DEMO_DATA_DIR = directory;
  const { processScheduledWorkspaces } = await import("../server/api.mjs");
  const ledger = createWorkspace();
  ledger.payments = [];
  const original = ledger.accounts[0].balance;
  const queued = applyAction(ledger, { action: "submit", payload: { kind: "transfer", from: "checking", to: "savings", amount: 10000, date: "2026-11-20", frequency: "once", requestId: "scheduled-worker-test" } }, "2026-11-19");
  const workspace = join(directory, `${"a".repeat(48)}.json`);
  const suspended = join(directory, `${"b".repeat(48)}.json`);
  const settings = join(directory, "admin-settings.json");
  const read = file => JSON.parse(readFileSync(file));
  try {
    writeFileSync(workspace, JSON.stringify(queued.state));
    writeFileSync(suspended, JSON.stringify({ ...queued.state, suspended: true }));
    writeFileSync(settings, JSON.stringify({ maintenanceMode: true }));
    assert.equal(processScheduledWorkspaces("2026-11-20").paused, true);
    writeFileSync(settings, JSON.stringify({ maintenanceMode: false }));
    assert.equal(processScheduledWorkspaces("2026-11-19").processed, 0);
    assert.equal(processScheduledWorkspaces("2026-11-20").processed, 1);
    assert.equal(read(workspace).accounts[0].balance, original - 10000);
    assert.equal(read(suspended).accounts[0].balance, original);
    assert.equal(processScheduledWorkspaces("2026-11-21").processed, 0);
    assert.equal(read(workspace).transactions.filter(row => row.reference === queued.result).length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
