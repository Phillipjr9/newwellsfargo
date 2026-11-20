import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  applyAction,
  createWorkspace,
  DemoError,
  day,
  settleDue,
} from "../shared/ledger.mjs";

const directory =
  process.env.DEMO_DATA_DIR ||
  join(homedir(), ".local", "share", "banking-preview", "ledgers-v2");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const auditFile = join(directory, "admin-audit.ndjson");
const adminFailures = new Map();
const ADMIN_COOKIE = "banking_preview_admin";
const ADMIN_SESSION_SECONDS = 60 * 60;

const staffFile = join(directory, "admin-staff.json");
const meFile = join(directory, "admin-root.json");
const assignmentsFile = join(directory, "admin-assignments.json");
const settingsFile = join(directory, "admin-settings.json");

const defaultRootIdentity = {
  id: "root",
  name: "Super Administrator",
  email: "",
  role: "root",
  active: true,
  updatedAt: null,
};

function configuredAdminSecret() {
  if (process.env.DEMO_ADMIN_TOKEN) {
    if (process.env.NODE_ENV === "production" && process.env.DEMO_ADMIN_TOKEN.length < 32) return null;
    return process.env.DEMO_ADMIN_TOKEN;
  }
  if (process.env.NODE_ENV === "production") return null;
  return "administrator";
}

function signAdminSession(expiry, nonce) {
  const secret = configuredAdminSecret();
  if (!secret) return null;
  const payload = `${expiry}.${nonce}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function validAdminSession(req) {
  const raw = (req.headers.cookie || "").match(
    /(?:^|;\s*)banking_preview_admin=([^;]+)/,
  )?.[1];
  const [expiryText, nonce, signature, extra] = decodeURIComponent(raw || "").split(".");
  if (!raw || extra || !/^\d+$/.test(expiryText || "") || !/^[a-f0-9]{32}$/.test(nonce || "")) return false;
  const expected = signAdminSession(expiryText, nonce);
  if (!expected || Number(expiryText) <= Math.floor(Date.now() / 1000)) return false;
  const provided = Buffer.from(`${expiryText}.${nonce}.${signature || ""}`);
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function readAdminCookie(req) {
  return (req.headers.cookie || "").match(
    /(?:^|;\s*)banking_preview_admin=([^;]+)/,
  )?.[1] || "";
}

function requireSameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new DemoError("Cross-site requests are not allowed.", 403);
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    throw new DemoError("Origin mismatch.", 403);
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new DemoError("Use JSON for admin operations.", 415);
}

async function readJsonBody(req, limit = 4096) {
  let body = "";
  for await (const part of req) {
    body += part;
    if (Buffer.byteLength(body) > limit) throw new DemoError("Request too large.", 413);
  }
  try { return JSON.parse(body); }
  catch { throw new DemoError("Invalid JSON.", 400); }
}

function auditAdmin(action, workspace = "") {
  let entries = [];
  try { entries = readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { entries = []; }
  entries.push({ at: new Date().toISOString(), actor: "super-admin", action, scope: "administrator actions", workspace: workspace ? `${workspace.slice(0, 8)}…` : null });
  writeFileSync(auditFile, entries.slice(-2000).map(entry => JSON.stringify(entry)).join("\n") + "\n", { mode: 0o600 });
}

function safeWorkspaceSummary(id, state) {
  const deposits = state.accounts.filter(account => ["checking", "savings"].includes(account.type));
  const scheduled = state.payments.filter(payment => payment.status === "scheduled");
  const latest = [...state.payments].sort((a, b) => (b.created || "").localeCompare(a.created || ""))[0];
  return {
    id,
    label: `Workspace ${id.slice(0, 8).toUpperCase()}`,
    created: state.created || state.updated,
    updated: state.updated,
    accountCount: state.accounts.length,
    transactionCount: state.transactions.length,
    paymentCount: state.payments.length,
    scheduledCount: scheduled.length,
    sampleDepositTotal: deposits.reduce((sum, account) => sum + account.balance, 0),
    lastPayment: latest ? { kind: latest.kind, status: latest.status, date: latest.date } : null,
  };
}

function demoWorkspaceFiles() {
  return readdirSync(directory).filter(name => /^[a-f0-9]{48}\.json$/.test(name));
}

function rollup(state, today = day()) {
  const deposits = state.accounts.filter(account => ["checking", "savings"].includes(account.type));
  const scheduled = state.payments.filter(payment => payment.status === "scheduled");
  const posted = state.payments.filter(payment => payment.status === "completed");
  const todayPosted = posted.filter(payment => ledgerDate(payment.date, state.updated) === today);
  return {
    updated: state.updated,
    accountCount: state.accounts.length,
    transactionCount: state.transactions.length,
    paymentCount: state.payments.length,
    scheduledCount: scheduled.length,
    completedCount: posted.length,
    completedToday: todayPosted.length,
    demoDeposits: deposits.reduce((sum, account) => sum + account.balance, 0),
    checkingBalances: deposits.filter(account => account.type === "checking").reduce((sum, account) => sum + account.balance, 0),
    savingsBalances: deposits.filter(account => account.type === "savings").reduce((sum, account) => sum + account.balance, 0),
    todayOutflow: todayPosted.reduce((sum, payment) => sum + payment.amount, 0),
  };
}

function ledgerDate(date, updated) {
  const reference = updated || new Date().toISOString();
  if (date === "Today") return reference.slice(0, 10);
  if (date === "Yesterday") {
    const previous = new Date(reference);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? reference.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function summarizeWorkspace(id, state) {
  return {
    id,
    ...rollup(state),
    created: state.created || state.updated,
    sampleProfile: state.profile?.name === "Henry Johnson" ? "Customer" : "Customer profile",
  };
}

function adminGuard(req, res) {
  if (!validAdminSession(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "An administrator session is required." }));
    return false;
  }
  return true;
}

function auditEntries(limit = 250) {
  try {
    return readFileSync(auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, 5000)))
      .reverse()
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function filteredAuditEntries(searchParams) {
  const action = cleanText(searchParams.get("action"), 80);
  const actor = cleanText(searchParams.get("actor"), 80);
  const workspace = cleanText(searchParams.get("workspace"), 48);
  const from = cleanText(searchParams.get("from"), 40);
  const to = cleanText(searchParams.get("to"), 40);
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || 250), 5000));
  return auditEntries(5000).filter((entry) => {
    if (action && !entry.action.toLowerCase().includes(action.toLowerCase())) return false;
    if (actor && !entry.actor.toLowerCase().includes(actor.toLowerCase())) return false;
    if (workspace && entry.workspace !== workspace) return false;
    if (from && entry.at < from) return false;
    if (to && entry.at > `${to}${to.length === 10 ? "T23:59:59.999Z" : ""}`) return false;
    return true;
  }).slice(0, limit);
}

function csvAudit(entries) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return ["at,actor,action,scope,workspace", ...entries.map((entry) => [entry.at, entry.actor, entry.action, entry.scope, entry.workspace].map(escape).join(","))].join("\n") + "\n";
}

async function publicPost(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new DemoError("Cross-site requests are not allowed.", 403);
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    throw new DemoError("Origin mismatch.", 403);
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new DemoError("Use JSON for admin operations.", 415);
  return readJsonBody(req, 2048);
}

export async function adminApi(req, res, next) {
  const path = (req.url || "/").split("?")[0];
  if (!path.startsWith("/api/admin/")) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Cookie");
  try {
    if (path === "/api/admin/session" && req.method === "GET") {
      res.end(JSON.stringify({
        authenticated: validAdminSession(req),
        adminEnabled: Boolean(configuredAdminSecret()),
        demoHint: process.env.NODE_ENV === "production" ? null : "administrator",
      }));
      return;
    }
    if (path === "/api/admin/session" && req.method === "POST") {
      const ip = String(req.socket.remoteAddress || "local");
      const attempt = adminFailures.get(ip);
      const now = Date.now();
      if (attempt?.blockedUntil > now)
        throw new DemoError("Too many attempts. Try again in 15 minutes.", 429);
      const secret = configuredAdminSecret();
      if (!secret) throw new DemoError("Admin access is disabled. Configure DEMO_ADMIN_TOKEN.", 503);
      const { token } = await publicPost(req);
      const expected = Buffer.from(secret);
      const supplied = Buffer.from(typeof token === "string" ? token : "");
      const correct = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!correct) {
        const fails = (attempt?.count || 0) + 1;
        adminFailures.set(ip, fails >= 6 ? { count: fails, blockedUntil: now + 15 * 60 * 1000 } : { count: fails, blockedUntil: 0 });
        // Bound the per-IP map without dropping live throttles early.
        if (adminFailures.size > 2048) for (const [key, row] of adminFailures) if (row.blockedUntil < now) adminFailures.delete(key);
        await new Promise(resolve => setTimeout(resolve, 140 + Math.floor(Math.random() * 80)));
        throw new DemoError("Access code wasn't recognized.", 401);
      }
      adminFailures.delete(ip);
      const expiry = Math.floor(now / 1000) + ADMIN_SESSION_SECONDS;
      const session = signAdminSession(expiry, randomBytes(16).toString("hex"));
      res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${ADMIN_SESSION_SECONDS}${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      auditAdmin("admin_session_started");
      res.end(JSON.stringify({ authenticated: true, expiresAt: new Date(expiry * 1000).toISOString() }));
      return;
    }
    if (!adminGuard(req, res)) return;
    if (path === "/api/admin/session" && req.method === "DELETE") {
      requireSameOrigin(req);
      auditAdmin("admin_session_ended");
      res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      res.end(JSON.stringify({ authenticated: false }));
      return;
    }
    if (req.method === "GET" && path === "/api/admin/overview") {
      const workspaces = demoWorkspaceFiles().map((name) => {
        const id = name.slice(0, 48);
        const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
        return summarizeWorkspace(id, state);
      }).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      const totals = workspaces.reduce((acc, w) => {
        acc.accounts += w.accountCount;
        acc.transactions += w.transactionCount;
        acc.payments += w.paymentCount;
        acc.scheduled += w.scheduledCount;
        acc.demoDeposits += w.demoDeposits;
        acc.checkingBalances += w.checkingBalances;
        acc.savingsBalances += w.savingsBalances;
        acc.completedToday += w.completedToday;
        acc.todayOutflow += w.todayOutflow;
        return acc;
      }, { accounts: 0, transactions: 0, payments: 0, scheduled: 0, demoDeposits: 0, checkingBalances: 0, savingsBalances: 0, completedToday: 0, todayOutflow: 0 });
      const daily = new Map();
      const cutoff = day(-6);
      for (const name of demoWorkspaceFiles()) {
        const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
        for (const transaction of state.transactions) {
          const date = ledgerDate(transaction.date, state.updated);
          if (date >= cutoff && date <= day()) {
            daily.set(date, (daily.get(date) || 0) + 1);
          }
        }
      }
      const dailyActivity = Array.from({ length: 7 }, (_, index) => {
        const date = day(index - 6);
        return { date, count: daily.get(date) || 0 };
      });
      const memory = process.memoryUsage();
      const telemetry = { node: process.version, uptimeSeconds: Math.floor(process.uptime()), ledgerFiles: demoWorkspaceFiles().length, auditEntries: auditEntries(5000).length, memoryBytes: memory.rss, heapUsedBytes: memory.heapUsed, maintenanceMode: adminSettings().maintenanceMode, externalMoneyRails: "disabled" };
      res.end(JSON.stringify({ workspaces, totals: { ...totals, workspaces: workspaces.length }, dailyActivity, audit: auditEntries().slice(0, 12), telemetry, readOnly: true }));
      return;
    }
    if (req.method === "GET" && path === "/api/admin/audit") {
      const params = new URL(req.url, "http://admin.local").searchParams;
      const entries = filteredAuditEntries(params);
      if (params.get("format") === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="admin-audit.csv"');
        res.end(csvAudit(entries));
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ entries, count: entries.length, filters: Object.fromEntries(params) }));
      return;
    }

    if (path === "/api/admin/settings") {
      if (req.method === "GET") {
        res.end(JSON.stringify({ settings: adminSettings() }));
        return;
      }
      if (req.method === "PUT") {
        requireSameOrigin(req);
        const body = await readJsonBody(req, 4096);
        const current = adminSettings();
        const next = {
          maintenanceMode: typeof body?.maintenanceMode === "boolean" ? body.maintenanceMode : current.maintenanceMode,
          allowWorkspaceReset: typeof body?.allowWorkspaceReset === "boolean" ? body.allowWorkspaceReset : current.allowWorkspaceReset,
          allowWorkspaceDelete: typeof body?.allowWorkspaceDelete === "boolean" ? body.allowWorkspaceDelete : current.allowWorkspaceDelete,
          auditRetention: Math.max(250, Math.min(Number(body?.auditRetention ?? current.auditRetention), 5000)),
        };
        saveAdminSettings(next);
        auditAdmin("admin_settings_updated");
        res.end(JSON.stringify({ settings: next }));
        return;
      }
    }

    if (path === "/api/admin/backup" && req.method === "GET") {
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: adminSettings(),
        root: rootIdentity(),
        admins: staffEntries(),
        assignments: assignmentEntries(),
        workspaces: demoWorkspaceFiles().map(name => {
          const id = name.slice(0, 48);
          return { id, state: JSON.parse(readFileSync(join(directory, name), "utf8")) };
        }),
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="banking-preview-backup.json"');
      res.end(JSON.stringify(backup, null, 2));
      return;
    }

    if (path === "/api/admin/restore" && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req, 20 * 1024 * 1024);
      if (body?.confirmation !== "RESTORE") throw new DemoError("Typed confirmation RESTORE is required.", 400);
      if (body?.version !== 1 || !Array.isArray(body?.workspaces) || typeof body?.settings !== "object") throw new DemoError("Invalid backup format.", 400);
      for (const name of demoWorkspaceFiles()) unlinkSync(join(directory, name));
      for (const item of body.workspaces) {
        if (!item || !/^[a-f0-9]{48}$/.test(item.id || "")) continue;
        if (!item.state || typeof item.state !== "object") continue;
        save(join(directory, `${item.id}.json`), item.state);
      }
      saveAdminSettings({ maintenanceMode: false, allowWorkspaceReset: true, allowWorkspaceDelete: true, auditRetention: 2000, ...body.settings });
      writeJsonFile(meFile, { ...defaultRootIdentity, ...(body.root && typeof body.root === "object" ? body.root : {}), id: "root", role: "root", active: true });
      saveStaffEntries(Array.isArray(body.admins) ? body.admins : []);
      saveAssignmentEntries(body.assignments && typeof body.assignments === "object" ? body.assignments : {});
      auditAdmin("admin_backup_restored");
      res.end(JSON.stringify({ success: true, restoredWorkspaces: body.workspaces.length }));
      return;
    }

    if (path === "/api/admin/reset" && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req, 4096);
      if (body?.confirmation !== "RESET ALL WORKSPACE DATA") throw new DemoError("Typed confirmation RESET ALL WORKSPACE DATA is required.", 400);
      const resetCount = demoWorkspaceFiles().length;
      for (const name of demoWorkspaceFiles()) {
        const file = join(directory, name);
        const id = name.slice(0, 48);
        save(file, createWorkspace());
        auditAdmin("demo_workspace_reset", id);
      }
      saveAssignmentEntries({});
      auditAdmin("admin_all_demo_data_reset");
      res.end(JSON.stringify({ success: true, resetWorkspaces: resetCount }));
      return;
    }
    // Root identity and staff lifecycle
    if (path === "/api/admin/me") {
      if (req.method === "GET") {
        res.end(JSON.stringify({ identity: rootIdentity(), isSuperAdmin: true }));
        return;
      }
      if (req.method === "PUT") {
        requireSameOrigin(req);
        const body = await readJsonBody(req, 4096);
        const name = cleanText(body?.name, 120);
        const email = cleanText(body?.email, 200).toLowerCase();
        if (name && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DemoError("Email is invalid.", 400);
        const identity = { ...rootIdentity(), name: name || rootIdentity().name, email, updatedAt: new Date().toISOString() };
        writeJsonFile(meFile, identity);
        auditAdmin("root_identity_updated");
        res.end(JSON.stringify({ identity }));
        return;
      }
    }

    if (path === "/api/admin/me/revoke-all-sessions" && req.method === "POST") {
      requireSameOrigin(req);
      await readJsonBody(req, 4096);
      auditAdmin("all_admin_sessions_revoked");
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (path === "/api/admin/admins") {
      if (req.method === "GET") {
        res.end(JSON.stringify({ admins: staffEntries(), root: rootIdentity() }));
        return;
      }
      if (req.method === "POST") {
        requireSameOrigin(req);
        const body = await readJsonBody(req, 4096);
        const entry = validateStaff(body);
        const id = randomBytes(12).toString("hex");
        const now = new Date().toISOString();
        const staff = { id, ...entry, createdAt: now, updatedAt: now };
        const entries = staffEntries();
        if (entries.some(item => item.email && staff.email && item.email.toLowerCase() === staff.email.toLowerCase())) throw new DemoError("Duplicate staff identity.", 409);
        saveStaffEntries([...entries, staff]);
        auditAdmin("staff_identity_created", "");
        res.end(JSON.stringify({ admin: staff }));
        return;
      }
    }

    const staffMatch = path.match(/^\/api\/admin\/admins\/([a-f0-9]+)$/);
    if (staffMatch) {
      const [, id] = staffMatch;
      if (req.method === "PUT") {
        requireSameOrigin(req);
        const body = await readJsonBody(req, 4096);
        const entries = staffEntries();
        const index = entries.findIndex(item => item.id === id);
        if (index < 0) throw new DemoError("Staff identity not found.", 404);
        const updated = { ...entries[index], ...validateStaff({ ...entries[index], ...body }), updatedAt: new Date().toISOString() };
        entries[index] = updated;
        saveStaffEntries(entries);
        auditAdmin("staff_identity_updated");
        res.end(JSON.stringify({ admin: updated }));
        return;
      }
      if (req.method === "DELETE") {
        requireSameOrigin(req);
        await readJsonBody(req, 4096);
        const entries = staffEntries();
        if (!entries.some(item => item.id === id)) throw new DemoError("Staff identity not found.", 404);
        saveStaffEntries(entries.filter(item => item.id !== id));
        auditAdmin("staff_identity_deleted");
        res.end(JSON.stringify({ success: true }));
        return;
      }
    }

    // Global customer/workspace ownership assignment
    const assignMatch = path.match(/^\/api\/admin\/users\/([a-f0-9]{48})\/assign-admin$/);
    if (assignMatch && req.method === "PUT") {
      requireSameOrigin(req);
      const [, id] = assignMatch;
      const body = await readJsonBody(req, 4096);
      if (!/^[a-f0-9]{48}$/.test(id) || !existsSync(join(directory, `${id}.json`))) throw new DemoError("Customer workspace not found.", 404);
      const assignments = assignmentEntries();
      const owner = typeof body.ownerAdminId === "string" && /^[a-f0-9]+$/.test(body.ownerAdminId) ? body.ownerAdminId : null;
      if (owner) {
        if (!staffEntries().some(item => item.id === owner && item.active)) throw new DemoError("Owner staff identity is not active.", 400);
      }
      assignments[id] = owner;
      saveAssignmentEntries(assignments);
      auditAdmin("customer_owner_assigned", id);
      res.end(JSON.stringify({ success: true, workspaceId: id, ownerAdminId: owner }));
      return;
    }

    // Super Administrator inventory. All mutations remain server-authoritative JSON-ledger operations.
    if (path === "/api/admin/users" || path === "/api/admin/customers") {
      if (req.method === "GET") {
        const search = cleanText(new URL(req.url, "http://admin.local").searchParams.get("search"), 120).toLowerCase();
        const customers = demoWorkspaceFiles().map(name => {
          const id = name.slice(0, 48); const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
          return { id, name: cleanText(state.profile?.name, 120) || `Workspace ${id.slice(0, 8)}`, email: cleanText(state.profile?.email, 200), status: state.status || (state.suspended ? "suspended" : "active"), suspended: Boolean(state.suspended), promoted: Boolean(state.promoted), ownerAdminId: assignmentEntries()[id] || null, ...summarizeWorkspace(id, state) };
        }).filter(item => !search || JSON.stringify(item).toLowerCase().includes(search));
        res.end(JSON.stringify({ users: customers, customers, count: customers.length })); return;
      }
      if (req.method === "POST") {
        requireSameOrigin(req); const body = await readJsonBody(req, 4096); const id = randomBytes(24).toString("hex"); const state = createWorkspace();
        state.profile = { ...state.profile, name: cleanText(body.name, 120) || state.profile.name, email: cleanText(body.email, 200).toLowerCase() };// existing-state fields are preserved
        state.status = body.status === "suspended" ? "suspended" : "active"; state.suspended = state.status === "suspended"; state.promoted = body.promoted === true; state.created = new Date().toISOString();
        save(join(directory, `${id}.json`), state); auditAdmin("customer_created", id); res.end(JSON.stringify({ success: true, customer: { id, profile: state.profile, status: state.status } })); return;
      }
    }

    if (path === "/api/admin/users/bulk" || path === "/api/admin/customers/bulk") {
      requireSameOrigin(req); const body = await readJsonBody(req, 4096); const ids = Array.isArray(body.ids) ? body.ids : []; let affected = 0;
      for (const id of ids) { if (!/^[a-f0-9]{48}$/.test(id)) continue; const file = join(directory, `${id}.json`); if (!existsSync(file)) continue;
        if (body.action === "delete") { unlinkSync(file); affected++; continue; }
        const state = JSON.parse(readFileSync(file, "utf8")); if (body.action === "suspend") { state.suspended = true; state.status = "suspended"; } else if (body.action === "activate") { state.suspended = false; state.status = "active"; } else if (body.action === "promote") state.promoted = true; else continue;
        save(file, state); affected++;
      } auditAdmin(`customers_bulk_${cleanText(body.action, 40).replaceAll("-", "_")}`); res.end(JSON.stringify({ success: true, affected })); return;
    }

    const customerMatch = path.match(/^\/api\/admin\/(?:customers|users)\/([a-f0-9]{48})(?:\/(promote|suspend|reset-password|revoke-sessions|impersonate))?$/);
    if (customerMatch) { const [, id, action] = customerMatch; const file = join(directory, `${id}.json`); if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      if (req.method === "GET" && !action) { const state = JSON.parse(readFileSync(file, "utf8")); res.end(JSON.stringify({ customer: { id, profile: state.profile || null, status: state.status || "active", suspended: Boolean(state.suspended), promoted: Boolean(state.promoted), ownerAdminId: assignmentEntries()[id] || null }, workspace: summarizeWorkspace(id, state), state })); return; }
      if (req.method === "PUT" && !action) { requireSameOrigin(req); const body = await readJsonBody(req, 4096); const state = JSON.parse(readFileSync(file, "utf8")); state.profile = { ...state.profile, name: cleanText(body.name, 120) || state.profile?.name, email: cleanText(body.email, 200).toLowerCase() || state.profile?.email }; if (typeof body.status === "string") state.status = body.status; if (typeof body.suspended === "boolean") state.suspended = body.suspended; state.updated = new Date().toISOString(); save(file, state); auditAdmin("customer_updated", id); res.end(JSON.stringify({ success: true, customer: { id, profile: state.profile, status: state.status, suspended: Boolean(state.suspended) } })); return; }
      if (req.method === "DELETE" && !action) { requireSameOrigin(req); await readJsonBody(req, 4096); unlinkSync(file); const assignments = assignmentEntries(); delete assignments[id]; saveAssignmentEntries(assignments); auditAdmin("customer_deleted", id); res.end(JSON.stringify({ success: true, id })); return; }
      if (action) { requireSameOrigin(req); const body = await readJsonBody(req, 4096); const state = JSON.parse(readFileSync(file, "utf8"));
        if (action === "promote") state.promoted = body.promoted !== false;
        if (action === "suspend") { state.suspended = body.suspended !== false; state.status = state.suspended ? "suspended" : "active"; }
        if (action === "reset-password") state.passwordResetAt = new Date().toISOString();
        if (action === "revoke-sessions") state.revokedSessionsAt = new Date().toISOString();
        save(file, state); auditAdmin(`customer_${action.replaceAll("-", "_")}`, id);
        res.end(JSON.stringify(action === "impersonate" ? { success: true, workspaceId: id, impersonation: true } : { success: true, workspaceId: id, action })); return;
      }
    }

    // Cross-workspace payees and scheduled instructions
    const payeeMatch = path.match(/^\/api\/admin\/users\/([a-f0-9]{48})\/payees(?:\/([a-f0-9-]+))?$/);
    if (payeeMatch) { const [, id, itemId] = payeeMatch; const file = join(directory, `${id}.json`); if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      if (req.method === "GET") { const state = JSON.parse(readFileSync(file, "utf8")); res.end(JSON.stringify({ payees: state.payees || [] })); return; }
      requireSameOrigin(req); const body = await readJsonBody(req, 4096); const state = JSON.parse(readFileSync(file, "utf8")); state.payees ||= [];
      if (req.method === "POST") { const payee = { id: randomBytes(12).toString("hex"), name: cleanText(body.name, 120) || "Payee", account: cleanText(body.account, 40), status: cleanText(body.status, 40) || "active", createdAt: new Date().toISOString() }; state.payees.push(payee); save(file, state); auditAdmin("payee_created", id); res.end(JSON.stringify({ success: true, payee })); return; }
      const payee = state.payees.find(item => item.id === itemId); if (!payee) throw new DemoError("Payee not found.", 404);
      if (req.method === "DELETE") state.payees = state.payees.filter(item => item.id !== itemId); else { for (const key of ["name", "account", "status"]) if (body[key] !== undefined) payee[key] = cleanText(body[key], key === "name" ? 120 : 40); }
      save(file, state); auditAdmin(req.method === "DELETE" ? "payee_deleted" : "payee_updated", id); res.end(JSON.stringify({ success: true, payee })); return;
    }

    const instructionMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?(?:scheduled(?:-instructions)?|instructions)(?:\/([a-f0-9-]+))?$/);
    if (instructionMatch) { const [, id, itemId] = instructionMatch;
      if (req.method === "GET") { const out = []; for (const name of demoWorkspaceFiles()) { const wid = name.slice(0,48); if (id && wid !== id) continue; const state = JSON.parse(readFileSync(join(directory,name),"utf8")); for (const payment of state.payments || []) if (payment.status === "scheduled") out.push({ workspaceId: wid, ...payment }); } res.end(JSON.stringify({ instructions: out, scheduled: out, count: out.length })); return; }
      requireSameOrigin(req); const body = await readJsonBody(req, 4096); if (!id) throw new DemoError("Workspace id is required.", 400); const file = join(directory, `${id}.json`); if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404); const state = JSON.parse(readFileSync(file, "utf8"));
      if (req.method === "POST") { const instruction = { id: randomBytes(12).toString("hex"), kind: cleanText(body.kind,40) || "transfer", amount: Number(body.amount || 0), date: cleanText(body.date,20) || day(), frequency: cleanText(body.frequency,40) || "once", status: "scheduled", toName: cleanText(body.toName,120) || "Scheduled instruction", created: new Date().toISOString() }; state.payments.unshift(instruction); save(file,state); auditAdmin("scheduled_instruction_created",id); res.end(JSON.stringify({ success:true, instruction })); return; }
      const instruction = state.payments.find(item => item.id === itemId); if (!instruction) throw new DemoError("Scheduled instruction not found.",404); if (req.method === "DELETE") state.payments = state.payments.filter(item => item.id !== itemId); else { if (body.amount !== undefined) instruction.amount = Number(body.amount); if (body.date !== undefined) instruction.date = cleanText(body.date,20); if (body.status !== undefined) instruction.status = cleanText(body.status,40); } save(file,state); auditAdmin(req.method === "DELETE" ? "scheduled_instruction_deleted" : "scheduled_instruction_updated", id); res.end(JSON.stringify({ success:true, instruction })); return;
    }

    // Disputes, support messages and notes
    const disputeMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?disputes(?:\/([a-f0-9-]+))?(?:\/(open|status|refund))?$/);
    if (disputeMatch) { const [, id, itemId, action] = disputeMatch;
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const dispute of state.disputes||[])out.push({workspaceId:wid,...dispute});}res.end(JSON.stringify({disputes:out,count:out.length}));return; }
      requireSameOrigin(req); if (!id) throw new DemoError("Workspace id is required.",400); const body=await readJsonBody(req,4096); const file=join(directory,`${id}.json`);if(!existsSync(file))throw new DemoError("Customer workspace not found.",404);const state=JSON.parse(readFileSync(file,"utf8"));state.disputes||=[];
      if (req.method === "POST") { const dispute={id:randomBytes(12).toString("hex"),transactionId:cleanText(body.transactionId,80),reason:cleanText(body.reason,200)||"Account dispute",status:"open",amount:Number(body.amount||0),openedAt:new Date().toISOString()};state.disputes.push(dispute);save(file,state);auditAdmin("dispute_opened",id);res.end(JSON.stringify({success:true,dispute}));return; }
      const dispute=state.disputes.find(item=>item.id===itemId);if(!dispute)throw new DemoError("Dispute not found.",404);if(action=== "status"||body.status)dispute.status=cleanText(body.status,40)||dispute.status;if(action=== "refund"||body.refund){dispute.status="refunded";dispute.refundAmount=Number(body.amount||dispute.amount||0);dispute.refundedAt=new Date().toISOString();}save(file,state);auditAdmin(action?`dispute_${action}`:"dispute_updated",id);res.end(JSON.stringify({success:true,dispute}));return;
    }

    const messageMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?messages$/);
    if (messageMatch) { const id = messageMatch[1];
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const message of state.messages||[])out.push({workspaceId:wid,...message});}res.end(JSON.stringify({messages:out,count:out.length}));return; }
      requireSameOrigin(req); if(!id)throw new DemoError("Workspace id is required.",400);const body=await readJsonBody(req,4096);const file=join(directory,`${id}.json`);if(!existsSync(file))throw new DemoError("Customer workspace not found.",404);const state=JSON.parse(readFileSync(file,"utf8"));state.messages||=[];const message={id:randomBytes(12).toString("hex"),direction:"staff",subject:cleanText(body.subject,200),body:cleanText(body.body,4000),author:"super-admin",createdAt:new Date().toISOString()};state.messages.push(message);save(file,state);auditAdmin("support_message_sent",id);res.end(JSON.stringify({success:true,message}));return;
    }

    if (path === "/api/admin/support" || path === "/api/admin/support-contact") { const file=join(directory,"admin-support.json");
      if(req.method=== "GET")res.end(JSON.stringify({support:readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]})}));else{requireSameOrigin(req);const body=await readJsonBody(req,4096);const support={status:cleanText(body.status,40)||"open",banner:cleanText(body.banner,500),contact:{email:cleanText(body.email||body?.contact?.email,200),phone:cleanText(body.phone||body?.contact?.phone,40)},notes:Array.isArray(body.notes)?body.notes.slice(-500):readJsonFile(file,{notes:[]}).notes||[]};writeJsonFile(file,support);auditAdmin("support_status_updated");res.end(JSON.stringify({success:true,support}));}return;
    }
    if (path === "/api/admin/support/notes") { requireSameOrigin(req);const body=await readJsonBody(req,4096);const file=join(directory,"admin-support.json");const support=readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]});support.notes||=[];const note={id:randomBytes(12).toString("hex"),body:cleanText(body.body,4000),createdAt:new Date().toISOString()};support.notes.push(note);writeJsonFile(file,support);auditAdmin("support_note_added");res.end(JSON.stringify({success:true,note}));return; }
    if (path === "/api/admin/saved-replies") { const file=join(directory,"admin-saved-replies.json");if(req.method=== "GET")res.end(JSON.stringify(readJsonFile(file,{replies:[]})));else{requireSameOrigin(req);const body=await readJsonBody(req,4096);const saved=readJsonFile(file,{replies:[]});saved.replies||=[];if(req.method!== "POST")throw new DemoError("Method not allowed.",405);const reply={id:randomBytes(12).toString("hex"),title:cleanText(body.title,120),body:cleanText(body.body,4000),createdAt:new Date().toISOString()};saved.replies.push(reply);writeJsonFile(file,saved);auditAdmin("saved_reply_created");res.end(JSON.stringify({success:true,reply}));}return; }

    // Audit integrity block and JSON proof export
    if (path === "/api/admin/audit/block" || path === "/api/admin/audit/integrity") { const entries=auditEntries(5000);let previous="";const chain=[];for(let index=0;index<entries.length;index++){previous=createHash("sha256").update(JSON.stringify({index,entry:entries[index],previous})).digest("hex");chain.push({index,hash:previous});}const block=previous||createHash("sha256").update("empty-audit").digest("hex");res.end(JSON.stringify({integrity:true,entries:entries.length,block,chain,algorithm:"SHA-256"}));return; }
    if (path === "/api/admin/audit/proof" || path === "/api/admin/audit/export" || path === "/api/admin/audit/json") { const entries=auditEntries(5000);const proof={version:1,exportedAt:new Date().toISOString(),scope:"administrator-audit",entries,sha256:createHash("sha256").update(JSON.stringify(entries)).digest("hex")};res.setHeader("Content-Disposition",'attachment; filename="admin-audit-proof.json"');res.end(JSON.stringify(proof,null,2));return; }

    // Staff reassignment alias
    const staffReassignMatch = path.match(/^\/api\/admin\/admins\/([a-f0-9]+)\/reassign$/);
    if (staffReassignMatch && req.method === "PUT") { requireSameOrigin(req);const [,staffId]=staffReassignMatch;const body=await readJsonBody(req,4096);if(!staffEntries().some(staff=>staff.id===staffId&&staff.active))throw new DemoError("Staff identity is not active.",400);const assignments=assignmentEntries();let assigned=0;for(const id of Array.isArray(body.workspaceIds)?body.workspaceIds:[])if(/^[a-f0-9]{48}$/.test(id)&&existsSync(join(directory,`${id}.json`))){assignments[id]=staffId;assigned++;}saveAssignmentEntries(assignments);auditAdmin("staff_reassigned");res.end(JSON.stringify({success:true,staffId,assigned}));return; }

    // Cross-customer ledger inspection
    if (path === "/api/admin/transactions" && req.method === "GET") {
      const params = new URL(req.url, "http://admin.local").searchParams;
      const search = cleanText(params.get("search"), 120).toLowerCase();
      const status = cleanText(params.get("status"), 40).toLowerCase();
      const limit = Math.max(1, Math.min(Number(params.get("limit") || 500), 5000));
      const rows = [];
      for (const name of demoWorkspaceFiles()) {
        const id = name.slice(0, 48);
        const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
        for (const tx of state.transactions || []) {
          if (search && !JSON.stringify(tx).toLowerCase().includes(search)) continue;
          if (status && String(tx.status || "posted").toLowerCase() !== status) continue;
          rows.push({ workspaceId: id, ...tx });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      res.end(JSON.stringify({ transactions: rows.slice(0, limit), count: rows.slice(0, limit).length }));
      return;
    }

    // Per-workspace ledger and account mutations
    const mutationMatch = path.match(/^\/api\/admin\/users\/([a-f0-9]{48})\/(transactions|accounts)(?:\/([a-f0-9-]+))?$/);
    if (mutationMatch) {
      const [, id, collection, itemId] = mutationMatch;
      const file = join(directory, `${id}.json`);
      if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      requireSameOrigin(req);
      const state = JSON.parse(readFileSync(file, "utf8"));
      if (req.method === "POST") {
        const body = await readJsonBody(req, 4096);
        if (collection === "accounts") {
          const accountId = randomBytes(12).toString("hex");
          const account = { id: accountId, name: cleanText(body.name, 120) || "New Account", nickname: cleanText(body.nickname, 120), type: ["checking","savings","cd","credit-card","auto-loan","mortgage"].includes(body.type) ? body.type : "checking", last4: cleanText(body.last4, 4) || String(accountId).slice(-4), balance: Number(body.balance || 0), limit: Number(body.limit || 0), points: Number(body.points || 0), locked: Boolean(body.locked), hidden: Boolean(body.hidden), favorite: Boolean(body.favorite), primary: Boolean(body.primary), openingDate: cleanText(body.openingDate, 20) || day() };
          state.accounts.push(account);
          save(file, state); auditAdmin("account_created", id); res.end(JSON.stringify({ success: true, account })); return;
        }
        const account = (state.accounts || []).find(entry => entry.id === body.accountId);
        if (!account) throw new DemoError("Account not found.", 404);
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || Math.abs(amount) > 10000000) throw new DemoError("Invalid transaction amount.", 400);
        const tx = { id: randomBytes(12).toString("hex"), accountId: account.id, amount, description: cleanText(body.description, 200) || "Admin adjustment", category: cleanText(body.category, 80) || "Adjustment", date: cleanText(body.date, 20) || day(), status: body.status === "pending" ? "pending" : "posted", simulated: true };
        state.transactions.unshift(tx); account.balance = Number((account.balance + amount).toFixed(2));
        save(file, state); auditAdmin("transaction_posted", id); res.end(JSON.stringify({ success: true, transaction: tx })); return;
      }
      if ((req.method === "PUT" || req.method === "DELETE") && itemId) {
        if (collection === "accounts") {
          const account = state.accounts.find(entry => entry.id === itemId);
          if (!account) throw new DemoError("Account not found.", 404);
          if (req.method === "DELETE") { state.accounts = state.accounts.filter(entry => entry.id !== itemId); save(file, state); auditAdmin("account_deleted", id); res.end(JSON.stringify({ success: true })); return; }
          const body = await readJsonBody(req, 4096);
          for (const key of ["name","nickname","mask","balance","limit","points","locked","autopay","hidden","favorite","primary","apr","openingDate","replacementDate"]) if (Object.prototype.hasOwnProperty.call(body, key)) account[key] = body[key];
          save(file, state); auditAdmin("account_updated", id); res.end(JSON.stringify({ success: true, account })); return;
        }
        const tx = state.transactions.find(entry => entry.id === itemId);
        if (!tx) throw new DemoError("Transaction not found.", 404);
        if (req.method === "DELETE") { const account = state.accounts.find(entry => entry.id === tx.accountId); if (account) account.balance = Number((account.balance - Number(tx.amount || 0)).toFixed(2)); state.transactions = state.transactions.filter(entry => entry.id !== itemId); save(file, state); auditAdmin("transaction_deleted", id); res.end(JSON.stringify({ success: true })); return; }
        const body = await readJsonBody(req, 4096);
        const oldAmount = Number(tx.amount || 0); const account = state.accounts.find(entry => entry.id === tx.accountId); const newAmount = Number(body.amount ?? oldAmount);
        if (!Number.isFinite(newAmount) || Math.abs(newAmount) > 10000000) throw new DemoError("Invalid transaction amount.", 400);
        if (account) account.balance = Number((account.balance - oldAmount + newAmount).toFixed(2));
        Object.assign(tx, { description: cleanText(body.description, 200) || tx.description, category: cleanText(body.category, 80) || tx.category, amount: newAmount, date: cleanText(body.date, 20) || tx.date, status: body.status === "pending" ? "pending" : "posted" });
        save(file, state); auditAdmin("transaction_updated", id); res.end(JSON.stringify({ success: true, transaction: tx })); return;
      }
    }

    // Due scheduled payments and monthly close operations
    if ((path === "/api/admin/process-scheduled" || path === "/api/admin/month-end-close") && req.method === "POST") {
      requireSameOrigin(req);
      await readJsonBody(req, 4096);
      let processed = 0;
      for (const name of demoWorkspaceFiles()) {
        const id = name.slice(0, 48); const file = join(directory, name); const state = JSON.parse(readFileSync(file, "utf8"));
        if (path.endsWith("process-scheduled")) {
          for (const payment of state.payments || []) if (payment.status === "scheduled") { payment.status = "completed"; payment.completedAt = new Date().toISOString(); processed++; }
        } else {
          for (const account of state.accounts || []) if (["savings","cd"].includes(account.type)) { account.balance = Number((account.balance + Math.max(0.01, account.balance * (account.apr || (account.type === "cd" ? 0.0425 : 0.0215)) / 12)).toFixed(2)); }
        }
        save(file, state);
      }
      auditAdmin(path.endsWith("process-scheduled") ? "scheduled_payments_processed" : "month_end_close");
      res.end(JSON.stringify({ success: true, processed }));
      return;
    }

    const match = path.match(/^\/api\/admin\/workspaces\/([a-f0-9]{48})(?:\/(reset))?$/);
    if (!match) throw new DemoError("Not found.", 404);
    const [, id, action] = match;
    const file = join(directory, `${id}.json`);
    if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
    if (req.method === "GET" && !action) {
      const state = JSON.parse(readFileSync(file, "utf8"));
      res.end(JSON.stringify({
        summary: summarizeWorkspace(id, state),
        accounts: state.accounts.map(({ id, name, type, last4, balance, limit, points }) => ({ id, name, type, last4, balance, limit, points })),
        recentPayments: state.payments.slice(0, 12).map(({ id, kind, status, amount, date, toName }) => ({ id, kind, status, amount, date, toName })),
      }));
      return;
    }
    if (req.method === "POST" && action === "reset") {
      requireSameOrigin(req);
      if (!adminSettings().allowWorkspaceReset) throw new DemoError("Workspace reset is disabled.", 403);
      const state = createWorkspace();
      save(file, state);
      auditAdmin("demo_workspace_reset", id);
      res.end(JSON.stringify({ success: true, summary: summarizeWorkspace(id, state) }));
      return;
    }
    if (req.method === "DELETE" && !action) {
      requireSameOrigin(req);
      if (!adminSettings().allowWorkspaceDelete) throw new DemoError("Workspace deletion is disabled.", 403);
      await publicPost(req);
      unlinkSync(file);
      auditAdmin("demo_workspace_removed", id);
      res.end(JSON.stringify({ success: true, id }));
      return;
    }
    throw new DemoError("Method not allowed.", 405);
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "Admin data could not be loaded. Please try again." }));
  }
}

function save(file, state) {
  writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

function getWorkspace(req, res, allowCreate = true) {
  const cookie = (req.headers.cookie || "").match(
    /(?:^|;\s*)banking_demo=([a-f0-9]{48})(?:;|$)/,
  )?.[1];
  const tabKey = req.headers["x-demo-workspace"];
  const id =
    cookie ||
    (typeof tabKey === "string" && /^[a-f0-9]{48}$/.test(tabKey)
      ? tabKey
      : null);
  if (id) {
    const file = join(directory, `${id}.json`);
    if (existsSync(file)) {
      const state = JSON.parse(readFileSync(file, "utf8"));
      if (settleDue(state)) save(file, state);
      res.setHeader("X-Demo-Workspace", id);
      return { file, state };
    }
  }
  if (!allowCreate)
    throw new DemoError(
      "This workspace session has ended. Refresh the page to start a new workspace.",
      409,
    );
  const token = randomBytes(24).toString("hex");
  const file = join(directory, `${token}.json`);
  const state = createWorkspace();
  save(file, state);
  res.setHeader("X-Demo-Workspace", token);
  res.setHeader(
    "Set-Cookie",
    `banking_demo=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`,
  );
  return { file, state };
}

function readJsonFile(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJsonFile(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

function rootIdentity() {
  const saved = readJsonFile(meFile, defaultRootIdentity);
  return { ...defaultRootIdentity, ...(saved && typeof saved === "object" ? saved : {}) , id: "root", role: "root", active: true };
}

function staffEntries() {
  const value = readJsonFile(staffFile, { staffs: [] });
  if (Array.isArray(value)) return value;
  return Array.isArray(value.staffs) ? value.staffs : [];
}

function saveStaffEntries(entries) {
  writeJsonFile(staffFile, { staffs: entries });
}

function assignmentEntries() {
  const value = readJsonFile(assignmentsFile, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function saveAssignmentEntries(value) {
  writeJsonFile(assignmentsFile, value);
}

function adminSettings() {
  return {
    maintenanceMode: false,
    allowWorkspaceReset: true,
    allowWorkspaceDelete: true,
    auditRetention: 2000,
    ...readJsonFile(settingsFile, {}),
  };
}

function saveAdminSettings(value) {
  writeJsonFile(settingsFile, value);
}

function cleanText(value, maximum = 160) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validateStaff(body) {
  const name = cleanText(body?.name, 120);
  const email = cleanText(body?.email, 200).toLowerCase();
  const role = cleanText(body?.role, 40).toLowerCase();
  if (!name) throw new DemoError("Staff name is required.", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DemoError("Staff email is invalid.", 400);
  if (role && !["root", "administrator", "staff", "viewer"].includes(role)) throw new DemoError("Staff role is invalid.", 400);
  return { name, email, role: role || "staff", active: body?.active !== false };
}

export async function demoApi(req, res, next) {
  const path = (req.url || "/").split("?")[0];
  if (!path.startsWith("/api/demo/")) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (path === "/api/demo/workspace" && req.method === "GET") {
      res.end(JSON.stringify({ state: getWorkspace(req, res).state }));
      return;
    }
    if (req.method !== "POST" || !["/api/demo/action", "/api/demo/exit"].includes(path))
      throw new DemoError("Not found.", 404);
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new DemoError("Cross-site requests are not allowed.", 403);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
      throw new DemoError("Origin mismatch.", 403);
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new DemoError("Use JSON for account operations.", 415);
    if (path === "/api/demo/exit") {
      const { file } = getWorkspace(req, res, false);
      unlinkSync(file);
      res.removeHeader("X-Demo-Workspace");
      res.setHeader("Set-Cookie", "banking_demo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      res.end(JSON.stringify({ success: true }));
      return;
    }
    let body = "";
    for await (const part of req) {
      body += part;
      if (Buffer.byteLength(body) > 4096) throw new DemoError("Request too large.", 413);
    }
    let command;
    try { command = JSON.parse(body); }
    catch { throw new DemoError("Invalid JSON.", 400); }
    const { file, state } = getWorkspace(req, res, false);
    const output = applyAction(state, command);
    save(file, output.state);
    res.end(JSON.stringify(output));
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "The change could not be saved. Please try again." }));
  }
}
