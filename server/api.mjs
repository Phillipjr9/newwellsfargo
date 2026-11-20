import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import {
  applyAction,
  createWorkspace,
  DemoError,
  day,
  settleDue,
  validateDraft,
} from "../shared/ledger.mjs";

const directory =
  process.env.DEMO_DATA_DIR ||
  join(homedir(), ".local", "share", "banking-preview", "ledgers-v2");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const auditFile = join(directory, "admin-audit.ndjson");
const adminFailures = new Map();
const ADMIN_COOKIE = "banking_preview_admin";
const ADMIN_SESSION_SECONDS = 60 * 60;
const STAFF_COOKIE = "banking_preview_staff";

const staffFile = join(directory, "admin-staff.json");
const meFile = join(directory, "admin-root.json");
const assignmentsFile = join(directory, "admin-assignments.json");
const settingsFile = join(directory, "admin-settings.json");

const customerSessionFile = join(directory, "customer-sessions.json");
const adminEpochFile = join(directory, "admin-session-epoch.json");
const CUSTOMER_COOKIE = "banking_customer";
const CUSTOMER_SESSION_SECONDS = 60 * 60 * 8;

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

function signAdminSession(expiry, nonce, epoch = adminEpoch()) {
  const secret = configuredAdminSecret();
  if (!secret) return null;
  const payload = `${expiry}.${nonce}.${epoch}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function staffRoleCapabilities(role) {
  const capabilities = {
    root: ["*"],
    administrator: ["customers:*", "staff:*", "ledger:*", "audit:*", "backup:*", "operations:*"],
    staff: ["customers:read", "customers:update", "ledger:read", "ledger:update", "messages:*", "disputes:*", "schedules:*", "payees:*"],
    viewer: ["customers:read", "ledger:read", "audit:read", "schedules:read", "messages:read", "disputes:read", "payees:read"],
  };
  return capabilities[role] || [];
}

function hasCapability(actor, capability) {
  if (actor.role === "root") return true;
  return staffRoleCapabilities(actor.role).some((value) => value === "*" || value === capability || (value.endsWith(":*") && capability.startsWith(value.slice(0, -1))));
}

function requireAdminCapability(req, capability) {
  if (!validAdminSession(req)) throw new DemoError("An administrator session is required.", 401);
  // The root access code remains the compatibility identity. Staff identities are enforced when mapped sessions add staffActor metadata.
  const actor = req.adminActor || rootIdentity();
  if (!hasCapability(actor, capability)) throw new DemoError("The administrator role lacks this capability.", 403);
  return actor;
}

function validAdminSession(req) {
  const rootRaw = readAdminCookie(req);
  if (rootRaw) {
    const decoded = decodeURIComponent(rootRaw);
    const parts = decoded.split(".");
    if (parts.length === 4) {
      const [expiryText, nonce, epochText, signature] = parts;
      if (/^\d+$/.test(expiryText) && /^\d+$/.test(epochText) && /^[a-f0-9]{32}$/.test(nonce) && Number(epochText) === adminEpoch()) {
        const expected = signAdminSession(expiryText, nonce, epochText);
        if (expected && Number(expiryText) > Math.floor(Date.now() / 1000)) {
          const wanted = Buffer.from(expected), provided = Buffer.from(decoded);
          if (provided.length === wanted.length && timingSafeEqual(provided, wanted)) return true;
        }
      }
    }
  }

  const staffRaw = (req.headers.cookie || "").match(/(?:^|;\s*)banking_preview_staff=([^;]+)/)?.[1];
  if (!staffRaw) return false;
  const decoded = decodeURIComponent(staffRaw);
  const parts = decoded.split(".");
  if (parts.length !== 5) return false;
  const [expiryText, nonce, epochText, staffId, signature] = parts;
  if (!/^\d+$/.test(expiryText) || !/^\d+$/.test(epochText) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]+$/.test(staffId)) return false;
  const staff = staffEntries().find(item => item.id === staffId && item.active);
  if (!staff || !staff.passwordHash || !staff.passwordSalt) return false;
  if (Number(expiryText) <= Math.floor(Date.now() / 1000)) return false;
  const payload = `${expiryText}.${nonce}.${epochText}.${staffId}`;
  const expected = `${payload}.${createHmac("sha256", staff.passwordHash).update(payload).digest("base64url")}`;
  const wanted = Buffer.from(expected), provided = Buffer.from(decoded);
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
  const retention = Math.max(250, Math.min(Number(adminSettings().auditRetention || 2000), 5000));
  let entries = [];
  try { entries = readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { entries = []; }
  entries = entries.slice(-retention);
  const previousHash = entries.length ? (entries.at(-1).hash || createHash("sha256").update(JSON.stringify(entries.at(-1))).digest("hex")) : "GENESIS";
  const entry = {
    at: new Date().toISOString(),
    actor: "super-admin",
    action,
    scope: "administrator actions",
    workspace: workspace ? `${workspace.slice(0, 8)}…` : null,
    previousHash,
  };
  entry.hash = createHash("sha256").update(JSON.stringify(entry)).digest("hex");
  entries.push(entry);
  writeFileSync(auditFile, entries.slice(-retention).map(row => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
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
  if (path.startsWith("/api/demo/")) return next();
  const staffRaw = (req.headers.cookie || "").match(/(?:^|;\s*)banking_preview_staff=([^;]+)/)?.[1];
  if (staffRaw) {
    const staffMatch = decodeURIComponent(staffRaw).split(".");
    if (staffMatch.length === 5) {
      const staffId = staffMatch[3];
      const staff = staffEntries().find(item => item.id === staffId && item.active);
      if (staff) req.adminActor = staff;
    }
  }
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
    const isolatedWorkspace = /^\/api\/admin\/workspaces\/([a-f0-9]{48})(?:\/(reset))?$/.exec(path);
    if (isolatedWorkspace) {
      const [, isolatedId, isolatedAction] = isolatedWorkspace;
      const isolatedFile = join(directory, `${isolatedId}.json`);
      if (!existsSync(isolatedFile)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Workspace not found." }));
        return;
      }
      if (req.method === "GET" && !isolatedAction) {
        const state = JSON.parse(readFileSync(isolatedFile, "utf8"));
        const body = JSON.stringify({ summary: summarizeWorkspace(isolatedId, state), accounts: [], recentPayments: [] });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      if (req.method === "POST" && isolatedAction === "reset") {
        requireSameOrigin(req);
        if (!adminSettings().allowWorkspaceReset) throw new DemoError("Workspace reset is disabled.", 403);
        const state = createWorkspace();
        save(isolatedFile, state);
        auditAdmin("demo_workspace_reset", isolatedId);
        const body = JSON.stringify({ success: true, summary: summarizeWorkspace(isolatedId, state) });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      if (req.method === "DELETE" && !isolatedAction) {
        requireSameOrigin(req);
        if (!adminSettings().allowWorkspaceDelete) throw new DemoError("Workspace deletion is disabled.", 403);
        unlinkSync(isolatedFile);
        auditAdmin("demo_workspace_removed", isolatedId);
        const body = JSON.stringify({ success: true, id: isolatedId });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      throw new DemoError("Method not allowed.", 405);
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

    if (path === "/api/admin/staff/session" && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req, 4096);
      const email = cleanText(body.email, 200).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const staff = staffEntries().find(item => item.email === email && item.active);
      if (!staff?.passwordHash || !staff.passwordSalt) throw new DemoError("Staff sign-on wasn't recognized.", 401);
      const supplied = pbkdf2Sync(password, staff.passwordSalt, 120000, 32, "sha256").toString("hex");
      const wanted = Buffer.from(staff.passwordHash, "hex");
      const provided = Buffer.from(supplied, "hex");
      if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) throw new DemoError("Staff sign-on wasn't recognized.", 401);
      const expiry = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
      const nonce = randomBytes(16).toString("hex");
      const epoch = adminEpoch();
      const payload = `${expiry}.${nonce}.${epoch}.${staff.id}`;
      const cookie = `${payload}.${createHmac("sha256", staff.passwordHash).update(payload).digest("base64url")}`;
      res.setHeader("Set-Cookie", `${STAFF_COOKIE}=${cookie}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${ADMIN_SESSION_SECONDS}${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      auditAdmin("staff_session_started");
      res.end(JSON.stringify({ authenticated: true, role: staff.role, staffId: staff.id, expiresAt: new Date(expiry * 1000).toISOString() }));
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
      const staged = join(directory, `.restore-${randomBytes(12).toString("hex")}`);
      mkdirSync(staged, { recursive: true, mode: 0o700 });
      const seen = new Set();
      const movedIn = [];
      try {
        for (const item of body.workspaces) {
          if (!item || !/^[a-f0-9]{48}$/.test(item.id || "") || seen.has(item.id)) throw new DemoError("Backup contains invalid or duplicate workspace identifiers.", 400);
          seen.add(item.id);
          validateLedgerInvariants(item.state);
          writeFileSync(join(staged, `${item.id}.json`), JSON.stringify(item.state), { mode: 0o600 });
        }
        if (body.assignments && (typeof body.assignments !== "object" || Array.isArray(body.assignments))) throw new DemoError("Invalid assignment data.", 400);
        for (const [workspaceId, staffId] of Object.entries(body.assignments || {})) {
          if (!seen.has(workspaceId) || (staffId !== null && (!/^[a-f0-9]+$/.test(String(staffId)) || !staffEntries().some(staff => staff.id === String(staffId) && staff.active)))) throw new DemoError("Restore assignment references unavailable data.", 400);
        }
        for (const name of demoWorkspaceFiles()) {
          renameSync(join(directory, name), join(staged, `old-${name}`));
        }
        for (const item of body.workspaces) {
          renameSync(join(staged, `${item.id}.json`), join(directory, `${item.id}.json`));
          movedIn.push(`${item.id}.json`);
        }
        saveAdminSettings({ maintenanceMode: false, allowWorkspaceReset: true, allowWorkspaceDelete: true, auditRetention: 2000, ...body.settings });
        writeJsonFile(meFile, { ...defaultRootIdentity, ...(body.root && typeof body.root === "object" ? body.root : {}), id: "root", role: "root", active: true });
        saveStaffEntries(Array.isArray(body.admins) ? body.admins : []);
        saveAssignmentEntries(body.assignments || {});
      } catch (error) {
        for (const name of movedIn) {
          if (existsSync(join(directory, name))) unlinkSync(join(directory, name));
        }
        for (const name of readdirSync(staged).filter(name => name.startsWith("old-") && /^old-[a-f0-9]{48}\.json$/.test(name))) {
          const oldName = name.slice(4);
          if (!existsSync(join(directory, oldName))) renameSync(join(staged, name), join(directory, oldName));
        }
        rmSync(staged, { recursive: true, force: true });
        throw error;
      }
      rmSync(staged, { recursive: true, force: true });
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
      const epoch = bumpAdminEpoch();
      auditAdmin("all_admin_sessions_revoked");
      res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      res.end(JSON.stringify({ success: true, epoch }));
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
        bumpAdminEpoch();
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
        bumpAdminEpoch();
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
        if (action === "revoke-sessions") {
          state.customerSessionEpoch = Number(state.customerSessionEpoch || 0) + 1;
          state.revokedSessionsAt = new Date().toISOString();
        }
        if (action === "impersonate") {
          if (state.suspended || state.status === "suspended") throw new DemoError("A suspended customer cannot be impersonated.", 403);
        }
        validateLedgerInvariants(state);
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
      requireSameOrigin(req); const body = await readJsonBody(req, 4096); if (!id) throw new DemoError("Workspace id is required.", 400); const file = join(directory, `${id}.json`); if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404); const state = JSON.parse(readFileSync(file, "utf8")); validateLedgerInvariants(state);
      if (req.method === "POST") {
        const payload = { ...body, requestId: cleanText(body.requestId, 64) || `admin-${randomBytes(12).toString("hex")}` };
        if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(payload.requestId)) throw new DemoError("Invalid scheduled instruction identifier.", 400);
        const details = validateDraft(state, payload);
        const instruction = { ...details, id: `DEMO-${randomBytes(8).toString("hex").toUpperCase()}`, requestId: payload.requestId, series: payload.requestId, status: "scheduled", created: new Date().toISOString() };
        state.payments.unshift(instruction); validateLedgerInvariants(state); save(file,state); auditAdmin("scheduled_instruction_created",id); res.end(JSON.stringify({ success:true, instruction })); return;
      }
      const instruction = state.payments.find(item => item.id === itemId); if (!instruction) throw new DemoError("Scheduled instruction not found.",404);
      if (req.method === "DELETE") instruction.status = "cancelled";
      else {
        const edited = { ...instruction, amount: body.amount === undefined ? instruction.amount : Number(body.amount), date: body.date === undefined ? instruction.date : cleanText(body.date,20), frequency: body.frequency === undefined ? instruction.frequency : cleanText(body.frequency,40) };
        const details = validateDraft(state, edited);
        Object.assign(instruction, details);
      }
      validateLedgerInvariants(state); save(file,state); auditAdmin(req.method === "DELETE" ? "scheduled_instruction_deleted" : "scheduled_instruction_updated", id); res.end(JSON.stringify({ success:true, instruction })); return;
    }

    // Disputes, support messages and notes
    const disputeMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?disputes(?:\/([a-f0-9-]+))?(?:\/(open|status|refund))?$/);
    if (disputeMatch) { const [, id, itemId, action] = disputeMatch;
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const dispute of state.disputes||[])out.push({workspaceId:wid,...dispute});}res.end(JSON.stringify({disputes:out,count:out.length}));return; }
      requireSameOrigin(req); if (!id) throw new DemoError("Workspace id is required.",400); const body=await readJsonBody(req,4096); const file=join(directory,`${id}.json`);if(!existsSync(file))throw new DemoError("Customer workspace not found.",404);const state=JSON.parse(readFileSync(file,"utf8"));state.disputes||=[];
      if (req.method === "POST") { const dispute={id:randomBytes(12).toString("hex"),transactionId:cleanText(body.transactionId,80),reason:cleanText(body.reason,200)||"Account dispute",status:"open",amount:Number(body.amount||0),openedAt:new Date().toISOString()};state.disputes.push(dispute);save(file,state);auditAdmin("dispute_opened",id);res.end(JSON.stringify({success:true,dispute}));return; }
      const dispute=state.disputes.find(item=>item.id===itemId);if(!dispute)throw new DemoError("Dispute not found.",404);if(action=== "status"||body.status)dispute.status=cleanText(body.status,40)||dispute.status;if(action=== "refund"||body.refund){
        if (dispute.status === "refunded") throw new DemoError("This dispute refund was already applied.", 409);
        const refundAmount=Number(body.amount||dispute.amount||0);
        if (!Number.isSafeInteger(refundAmount)||refundAmount<=0) throw new DemoError("Refund amount is invalid.",400);
        const sourceTx=state.transactions.find(tx=>tx.id===dispute.transactionId);
        if (!sourceTx) throw new DemoError("Dispute transaction was not found.",404);
        const account=state.accounts.find(a=>a.id===sourceTx.accountId);
        if (!account) throw new DemoError("Dispute account was not found.",404);
        account.balance=Number((account.balance+refundAmount).toFixed(2));
        sourceTx.status="refund-reversed";
        state.transactions.unshift({id:`refund-${dispute.id}`,accountId:account.id,date:day(),description:`Refund for disputed ${sourceTx.description}`,category:"Refund",amount:refundAmount,status:"posted",reference:dispute.id,disputeId:dispute.id});
        dispute.status="refunded";dispute.refundAmount=refundAmount;dispute.refundedAt=new Date().toISOString();
      }validateLedgerInvariants(state);save(file,state);auditAdmin(action?`dispute_${action}`:"dispute_updated",id);res.end(JSON.stringify({success:true,dispute}));return;
    }

    const messageMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?messages$/);
    if (messageMatch) { const id = messageMatch[1];
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const message of state.messages||[])out.push({workspaceId:wid,...message});}res.end(JSON.stringify({messages:out,count:out.length}));return; }
      requireSameOrigin(req); if(!id)throw new DemoError("Workspace id is required.",400);const body=await readJsonBody(req,4096);const file=join(directory,`${id}.json`);if(!existsSync(file))throw new DemoError("Customer workspace not found.",404);const state=JSON.parse(readFileSync(file,"utf8"));state.messages||=[];const message={id:randomBytes(12).toString("hex"),direction:"staff",subject:cleanText(body.subject,200),body:cleanText(body.body,4000),author:"super-admin",createdAt:new Date().toISOString()};state.messages.push(message);save(file,state);auditAdmin("support_message_sent",id);res.end(JSON.stringify({success:true,message}));return;
    }

    if (path === "/api/admin/support" || path === "/api/admin/support-contact") { const file=join(directory,"admin-support.json");
      if(req.method=== "GET")res.end(JSON.stringify({support:readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]})}));else{requireSameOrigin(req);const body=await readJsonBody(req,4096);const support={status:cleanText(body.status,40)||"open",banner:cleanText(body.banner,500),contact:{email:cleanText(body.email||body?.contact?.email,200),phone:cleanText(body.phone||body?.contact?.phone,40)},notes:Array.isArray(body.notes)?body.notes.slice(-500):readJsonFile(file,{notes:[]}).notes||[]};writeJsonFile(file,support);auditAdmin("support_status_updated");res.end(JSON.stringify({success:true,support}));}return;
    }
    if (path === "/api/admin/support/notes") { requireSameOrigin(req);const body=await readJsonBody(req,4096);const file=join(directory,"admin-support.json");const support=readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]});support.notes||=[];const note={id:randomBytes(12).toString("hex"),body:cleanText(body.body,4000),createdAt:new Date().toISOString()};support.notes.push(note);writeJsonFile(file,support);auditAdmin("support_note_added");res.end(JSON.stringify({success:true,note}));}return;
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
          const balance = Number(body.balance || 0);
          const limit = Number(body.limit || 0);
          if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(limit) || limit < 0) throw new DemoError("Invalid account values.", 400);
          const account = { id: accountId, name: cleanText(body.name, 120) || "New Account", nickname: cleanText(body.nickname, 120), type: ["checking","savings","cd","credit-card","auto-loan","mortgage"].includes(body.type) ? body.type : "checking", last4: cleanText(body.last4, 4) || String(accountId).slice(-4), balance, limit, points: Number(body.points || 0), locked: Boolean(body.locked), hidden: Boolean(body.hidden), favorite: Boolean(body.favorite), primary: Boolean(body.primary), openingDate: cleanText(body.openingDate, 20) || day() };
          if (!Number.isSafeInteger(account.points) || account.points < 0) throw new DemoError("Invalid account points.", 400);
          state.accounts.push(account); validateLedgerInvariants(state); save(file, state); auditAdmin("account_created", id); res.end(JSON.stringify({ success: true, account })); return;
        }
        const account = (state.accounts || []).find(entry => entry.id === body.accountId);
        if (!account) throw new DemoError("Account not found.", 404);
        const amount = Number(body.amount);
        if (!Number.isSafeInteger(amount) || Math.abs(amount) > 10000000) throw new DemoError("Invalid transaction amount.", 400);
        const tx = { id: randomBytes(12).toString("hex"), accountId: account.id, amount, description: cleanText(body.description, 200) || "Admin adjustment", category: cleanText(body.category, 80) || "Adjustment", date: cleanText(body.date, 20) || day(), status: body.status === "pending" ? "pending" : "posted", simulated: true };
        const newBalance = account.balance + amount;
        if (!Number.isSafeInteger(newBalance) || newBalance < 0) throw new DemoError("The account balance would be invalid.", 400);
        state.transactions.unshift(tx); account.balance = newBalance;
        validateLedgerInvariants(state); save(file, state); auditAdmin("transaction_posted", id); res.end(JSON.stringify({ success: true, transaction: tx })); return;
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
          const before = state.transactions.length;
          if (settleDue(state, day())) processed += state.transactions.length - before;
        } else {
          const period = day().slice(0, 7);
          state.monthlyClosings ||= [];
          if (!state.monthlyClosings.includes(period)) {
            for (const account of state.accounts || []) {
              if (!["savings", "cd"].includes(account.type)) continue;
              const apr = Number(account.apr || (account.type === "cd" ? 0.0425 : 0.0215));
              const interest = Math.max(1, Math.round(account.balance * apr / 12));
              if (interest <= 0) continue;
              const txId = `interest-${period}-${account.id}`;
              if (!state.transactions.some(tx => tx.id === txId)) {
                account.balance = Number((account.balance + interest).toFixed(2));
                state.transactions.unshift({ id: txId, accountId: account.id, date: day(), description: "Monthly interest", category: "Interest", amount: interest, status: "posted", reference: `month-close-${period}` });
                processed++;
              }
            }
            state.monthlyClosings.push(period);
          }
        }
        validateLedgerInvariants(state);
        save(file, state);
      }
      auditAdmin(path.endsWith("process-scheduled") ? "scheduled_payments_processed" : "month_end_close");
      res.end(JSON.stringify({ success: true, processed }));
      return;
    }

    const match = /^\/api\/admin\/workspaces\/([a-f0-9]{48})(?:\/(reset))?$/.exec(path);
    if (match && req.method === "GET" && !match[2]) {
      const [, id] = match;
      const file = join(directory, `${id}.json`);
      if (!existsSync(file)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Customer workspace not found." }));
        return;
      }
      const state = JSON.parse(readFileSync(file, "utf8"));
      const body = JSON.stringify({ summary: summarizeWorkspace(id, state), accounts: [], recentPayments: [] });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (!match) throw new DemoError("Not found.", 404);
    const [, id, action] = match;
    const file = join(directory, `${id}.json`);
    if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);

    if (req.method === "POST" && action === "reset") {
      requireSameOrigin(req);
      if (!adminSettings().allowWorkspaceReset) throw new DemoError("Workspace reset is disabled.", 403);
      const state = createWorkspace();
      save(file, state);
      auditAdmin("demo_workspace_reset", id);
      const body = JSON.stringify({ success: true, summary: summarizeWorkspace(id, state) });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.method === "DELETE" && !action) {
      requireSameOrigin(req);
      if (!adminSettings().allowWorkspaceDelete) throw new DemoError("Workspace deletion is disabled.", 403);
      unlinkSync(file);
      auditAdmin("demo_workspace_removed", id);
      const body = JSON.stringify({ success: true, id });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    throw new DemoError("Method not allowed.", 405);
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "The change could not be saved. Please try again." }));
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
      if (state.suspended || state.status === "suspended") throw new DemoError("This customer workspace is suspended.", 403);
      validateLedgerInvariants(state);
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
  const result = { name, email, role: role || "staff", active: body?.active !== false };
  if (typeof body?.password === "string" && body.password.length >= 10) {
    const passwordSalt = randomBytes(16).toString("hex");
    result.passwordSalt = passwordSalt;
    result.passwordHash = pbkdf2Sync(body.password, passwordSalt, 120000, 32, "sha256").toString("hex");
  } else if (body?.password !== undefined) throw new DemoError("Staff password must contain at least 10 characters.", 400);
  return result;
}

function adminEpoch() {
  const value = readJsonFile(adminEpochFile, { epoch: 0 });
  return Number.isInteger(value?.epoch) ? value.epoch : 0;
}

function bumpAdminEpoch() {
  const epoch = adminEpoch() + 1;
  writeJsonFile(adminEpochFile, { epoch, updatedAt: new Date().toISOString() });
  return epoch;
}

function customerSessionSecret() {
  if (process.env.DEMO_CUSTOMER_TOKEN) return process.env.DEMO_CUSTOMER_TOKEN;
  if (process.env.NODE_ENV === "production") return null;
  return "banking-online-session";
}

function signCustomerSession(expiry, nonce, workspaceId, epoch) {
  const secret = customerSessionSecret();
  if (!secret) return null;
  const payload = `${expiry}.${nonce}.${workspaceId}.${epoch}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function validCustomerSession(req) {
  const raw = (req.headers.cookie || "").match(/(?:^|;\s*)banking_customer=([^;]+)/)?.[1];
  const decoded = decodeURIComponent(raw || "");
  const parts = decoded.split(".");
  if (parts.length !== 5) return null;
  const [expiryText, nonce, workspaceId, epochText, signature] = parts;
  if (!/^\d+$/.test(expiryText) || !/^\d+$/.test(epochText) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{48}$/.test(workspaceId)) return null;
  const expiry = Number(expiryText);
  if (expiry <= Math.floor(Date.now() / 1000)) return null;
  const expected = signCustomerSession(expiryText, nonce, workspaceId, epochText);
  if (!expected) return null;
  const supplied = Buffer.from(decoded);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return null;
  const file = join(directory, `${workspaceId}.json`);
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file, "utf8"));
  if (state.suspended || state.status === "suspended") return null;
  if (Number(state.customerSessionEpoch || 0) !== Number(epochText)) return null;
  return { workspaceId, state, file };
}

function validateLedgerInvariants(state) {
  if (!state || typeof state !== "object") throw new DemoError("Invalid workspace ledger.", 400);
  if (!Array.isArray(state.accounts) || !Array.isArray(state.transactions) || !Array.isArray(state.payments))
    throw new DemoError("Workspace ledger collections are incomplete.", 400);
  const accountIds = new Set();
  for (const account of state.accounts) {
    if (!account?.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(account.id)) throw new DemoError("Invalid account identifier.", 400);
    if (accountIds.has(account.id)) throw new DemoError("Duplicate account identifier.", 409);
    accountIds.add(account.id);
    const balance = Number(account.balance);
    if (!Number.isSafeInteger(balance)) throw new DemoError("Invalid account balance.", 400);
  }
  const transactionIds = new Set();
  for (const tx of state.transactions) {
    if (!tx?.id) throw new DemoError("Transaction identifier is missing.", 400);
    if (transactionIds.has(tx.id)) throw new DemoError("Duplicate transaction identifier.", 409);
    transactionIds.add(tx.id);
    if (!accountIds.has(tx.accountId)) throw new DemoError("Transaction references an unknown account.", 409);
    if (!Number.isSafeInteger(Number(tx.amount))) throw new DemoError("Invalid transaction amount.", 400);
  }
  for (const payment of state.payments) {
    if (!payment?.id || !payment?.kind || !["once", "weekly", "monthly"].includes(payment.frequency || "once")) throw new DemoError("Invalid scheduled instruction.", 400);
    if (!Number.isSafeInteger(Number(payment.amount)) || Number(payment.amount) < 1) throw new DemoError("Invalid scheduled instruction amount.", 400);
    if (typeof payment.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) throw new DemoError("Invalid scheduled instruction date.", 400);
    if (payment?.from && !accountIds.has(payment.from)) throw new DemoError("Scheduled instruction references an unknown source account.", 409);
    if (payment?.to && payment.kind !== "person" && payment.kind !== "wire" && payment.kind !== "bill" && !accountIds.has(payment.to)) throw new DemoError("Scheduled instruction references an unknown destination.", 409);
  }
  return true;
}

function revokeCustomerSessions(state) {
  state.customerSessionEpoch = Number(state.customerSessionEpoch || 0) + 1;
  state.revokedSessionsAt = new Date().toISOString();
  writeJsonFile(customerSessionFile, {

    workspaceId: state.id || null,
    revokedSessionsAt: state.revokedSessionsAt,
    epoch: state.customerSessionEpoch,
  });
}

export async function demoApi(req, res, next) {
  const path = (req.url || "/").split("?")[0];
   if (!path.startsWith("/api/demo/")) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (path === "/api/demo/session" && req.method === "GET") {
      const session = validCustomerSession(req);
      res.end(JSON.stringify({ authenticated: Boolean(session), workspaceId: session?.workspaceId || null }));
      return;
    }
    if (path === "/api/demo/session" && req.method === "POST") {
      if (req.headers["sec-fetch-site"] === "cross-site") throw new DemoError("Cross-site requests are not allowed.", 403);
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new DemoError("Origin mismatch.", 403);
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new DemoError("Use JSON for sign-on.", 415);
      const body = await readJsonBody(req, 4096);
      const username = cleanText(body.username, 120);
      if (!username) throw new DemoError("Username is required.", 400);
      const password = typeof body.password === "string" ? body.password : "";
      const secret = process.env.DEMO_CUSTOMER_PASSWORD || "customer-password";
      if (process.env.NODE_ENV === "production" && !process.env.DEMO_CUSTOMER_PASSWORD) throw new DemoError("Customer sign-on is not configured.", 503);
      if (password !== secret) throw new DemoError("Sign-on details weren't recognized.", 401);
      let session = validCustomerSession(req);
      if (!session) {
        const token = randomBytes(24).toString("hex");
        const file = join(directory, `${token}.json`);
        const state = createWorkspace();
        state.profile = { ...state.profile, name: username, email: "" };
        state.customerSessionEpoch = 1;
        save(file, state);
        session = { workspaceId: token, state, file };
      }
      const expiry = Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_SECONDS;
      const cookie = signCustomerSession(expiry, randomBytes(16).toString("hex"), session.workspaceId, session.state.customerSessionEpoch || 1);
      res.setHeader("Set-Cookie", `${CUSTOMER_COOKIE}=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${CUSTOMER_SESSION_SECONDS}${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      res.end(JSON.stringify({ authenticated: true, workspaceId: session.workspaceId, expiresAt: new Date(expiry * 1000).toISOString() }));
      return;
    }
    if (path === "/api/demo/session" && req.method === "DELETE") {
      const session = validCustomerSession(req);
      if (!session) throw new DemoError("Not authenticated.", 401);
      revokeCustomerSessions(session.state);
      res.setHeader("Set-Cookie", `${CUSTOMER_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (path === "/api/demo/workspace" && req.method === "GET") {
      const customerSession = validCustomerSession(req);
      if (customerSession) {
        res.setHeader("X-Demo-Workspace", customerSession.workspaceId);
        const state = customerSession.state;
        res.end(JSON.stringify({ state, workspaceId: customerSession.workspaceId, status: state.status || "active", suspended: Boolean(state.suspended), profile: state.profile || null }));
        return;
      }
      const result = getWorkspace(req, res);
      const id = result.file ? result.file.slice(result.file.lastIndexOf("/") + 1, -5) : null;
      if (id) res.setHeader("X-Demo-Workspace", id);
      res.end(JSON.stringify({ state: result.state, workspaceId: id || result.state.id, status: result.state.status || "active", suspended: Boolean(result.state.suspended), profile: result.state.profile || null }));
      return;
    }
    if (path === "/api/demo/workspace" && req.method === "POST") {
      const { state } = getWorkspace(req, res, false);
      const body = await readJsonBody(req, 4096);
      const name = cleanText(body?.name, 120);
      const email = cleanText(body?.email, 200).toLowerCase();
      if (name && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DemoError("Email is invalid.", 400);
      state.profile = { name: name || state.profile?.name, email };
      state.status = "active";
      state.suspended = false;
      save(state.file, state);
      res.end(JSON.stringify({ success: true, profile: state.profile }));
      return;
    }
    if (path === "/api/demo/workspace" && req.method === "DELETE") {
      const { state } = getWorkspace(req, res);
      save(state.file, createWorkspace());
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (path === "/api/demo/transaction" && req.method === "POST") {
      const { state } = getWorkspace(req, res);
      const body = await readJsonBody(req, 4096);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || Math.abs(amount) > 10000000) throw new DemoError("Invalid transaction amount.", 400);
      const tx = { id: randomBytes(12).toString("hex"), accountId: body.accountId, amount, description: cleanText(body.description, 200) || "Account transaction", category: cleanText(body.category, 80) || "Misc", date: cleanText(body.date, 20) || day(), status: "posted", simulated: true };
      state.transactions.unshift(tx);
      const account = state.accounts.find(a => a.id === body.accountId);
      if (account) account.balance = Number((account.balance + amount).toFixed(2));
      save(state.file, state);
      res.end(JSON.stringify({ success: true, transaction: tx }));
      return;
    }
    if (path === "/api/demo/transaction" && req.method === "DELETE") {
      const { file, state } = getWorkspace(req, res);
      const body = await readJsonBody(req, 4096);
      const tx = state.transactions.find(t => t.id === body.id);
      if (!tx) throw new DemoError("Transaction not found.", 404);
      const account = state.accounts.find(a => a.id === tx.accountId);
      if (account) account.balance = Number((account.balance - Number(tx.amount || 0)).toFixed(2));
      state.transactions = state.transactions.filter(t => t.id !== body.id);
      validateLedgerInvariants(state);
      save(file, state);
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (path === "/api/demo/action" && req.method === "POST") {
      if (req.headers["sec-fetch-site"] === "cross-site") throw new DemoError("Cross-site requests are not allowed.", 403);if (req.headers.origin) {
        const originHost = new URL(req.headers.origin).host;
        if (originHost !== req.headers.host) throw new DemoError("Origin mismatch.", 403);
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new DemoError("Use JSON for account operations.", 415);
      const { file, state } = getWorkspace(req, res, false);
      validateLedgerInvariants(state);
      const body = await readJsonBody(req, 4096);
      const output = applyAction(state, body);
      validateLedgerInvariants(output.state);
      save(file, output.state);
      res.end(JSON.stringify(output));
      return;
    }
    if (path === "/api/demo/exit" && req.method === "POST") {
      let legacy = null;
      try { legacy = getWorkspace(req, res, false); } catch {}
      if (legacy?.file && existsSync(legacy.file)) unlinkSync(legacy.file);
      const session = validCustomerSession(req);
      if (session) {
        session.state.customerSessionEpoch = Number(session.state.customerSessionEpoch || 0) + 1;
        session.state.revokedSessionsAt = new Date().toISOString();
        save(session.file, session.state);
      }
      res.removeHeader("X-Demo-Workspace");
      res.setHeader("Set-Cookie", `${CUSTOMER_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" || req.socket.encrypted ? "; Secure" : ""}`);
      res.setHeader("Set-Cookie", "banking_demo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      res.end(JSON.stringify({ success: true }));
      return;
    }
    throw new DemoError("Not found.", 404);
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "The change could not be saved. Please try again." }));
  }
}
