import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installRestore, recoverRestore } from "../server/restore-journal.mjs";

test("interrupted restore rolls back both workspace and metadata files", () => {
  const dir = mkdtempSync(join(tmpdir(), "restore-journal-"));
  const workspace = `${"a".repeat(48)}.json`;
  const staff = "admin-staff.json", settings = "admin-settings.json";
  const write = (name, value) => writeFileSync(join(dir, name), value);
  const read = name => readFileSync(join(dir, name), "utf8");
  try {
    write(workspace, "old ledger");
    write(staff, "old staff");
    const changes = new Map([[workspace, "new ledger"], [staff, "new staff"], [settings, "new settings"]]);
    assert.throws(() => installRestore(dir, changes, (file, value) => {
      writeFileSync(file, value);
      if (file.endsWith(settings)) throw new Error("Write interrupted");
    }), /Write interrupted/);
    assert.equal(read(workspace), "old ledger");
    assert.equal(read(staff), "old staff");
    assert.equal(existsSync(join(dir, settings)), false);

    // A process exits after writing new files and before consuming the journal.
    const journal = join(dir, ".restore-in-progress");
    mkdirSync(journal);
    writeFileSync(join(journal, "manifest.json"), JSON.stringify([{ name: workspace, existed: true }, { name: staff, existed: true }, { name: settings, existed: false }]));
    writeFileSync(join(journal, workspace), read(workspace));
    writeFileSync(join(journal, staff), read(staff));
    write(workspace, "partial install");
    write(settings, "partial settings");
    recoverRestore(dir);
    assert.equal(read(workspace), "old ledger");
    assert.equal(read(staff), "old staff");
    assert.equal(existsSync(join(dir, settings)), false);
    assert.equal(existsSync(journal), false);
    installRestore(dir, changes, writeFileSync);
    assert.equal(read(settings), "new settings");
    assert.equal(read(staff), "new staff");
    assert.equal(read(workspace), "new ledger");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
