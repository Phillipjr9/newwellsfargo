import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const metadata = new Set(["admin-settings.json", "admin-root.json", "admin-staff.json", "admin-assignments.json"]);
const validName = name => typeof name === "string" && (metadata.has(name) || /^[a-f0-9]{48}\.json$/.test(name));
const marker = directory => join(directory, ".restore-in-progress");
const scratch = directory => join(directory, `.restore-scratch-${randomBytes(12).toString("hex")}`);

function finish(directory) {
  // Consuming the marker is the commit point. Cleanup is not part of the transaction.
  const retired = scratch(directory);
  renameSync(marker(directory), retired);
  try { rmSync(retired, { recursive: true, force: true }); } catch { /* safe to clean up after restart */ }
}

export function recoverRestore(directory) {
  const journal = marker(directory);
  if (!existsSync(journal)) return;
  const manifest = JSON.parse(readFileSync(join(journal, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest) || !manifest.every(entry => validName(entry?.name) && typeof entry.existed === "boolean")) {
    throw new Error("Restore recovery manifest is invalid. Preserve the data directory for manual recovery.");
  }
  for (const { name, existed } of manifest) {
    const destination = join(directory, name);
    if (existed) {
      // Keep the saved copy until every file is recovered, so rollback itself can be retried.
      const temporary = join(journal, `.rollback-${name}`);
      copyFileSync(join(journal, name), temporary);
      renameSync(temporary, destination);
    } else rmSync(destination, { force: true });
  }
  finish(directory);
}

export function installRestore(directory, changes, install) {
  recoverRestore(directory);
  const names = [...changes.keys()];
  if (!names.every(validName)) throw new Error("Restore contains an invalid destination.");
  const staging = scratch(directory);
  mkdirSync(staging, { mode: 0o700 });
  try {
    const manifest = names.map(name => {
      const source = join(directory, name);
      const existed = existsSync(source);
      if (existed) copyFileSync(source, join(staging, name));
      return { name, existed };
    });
    writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
    renameSync(staging, marker(directory));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  try {
    for (const [name, value] of changes) install(join(directory, name), value);
    finish(directory);
  } catch (error) {
    recoverRestore(directory);
    throw error;
  }
}
