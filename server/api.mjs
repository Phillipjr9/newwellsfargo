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
import { installRestore, recoverRestore } from "./restore-journal.mjs";
import { homedir } from "node:os";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  applyAction,
  availableBalance,
  checkOpeningDate,
  isLedgerDate,
  createWorkspace,
  DemoError,
  day,
  nextDepositAvailability,
  settleDue,
} from "../shared/ledger.mjs";

const directory =
  process.env.DEMO_DATA_DIR ||
  join(homedir(), ".local", "share", "banking-preview", "ledgers-v2");
mkdirSync(directory, { recursive: true, mode: 0o700 });
recoverRestore(directory);
const auditFile = join(directory, "admin-audit.ndjson");
const adminFailures = new Map();
const rootSessions = new Map();
const ADMIN_COOKIE = "banking_preview_admin";
const ADMIN_SESSION_SECONDS = 60 * 60;
const STAFF_COOKIE = "banking_preview_limited";
const staffSessions = new Map();
const staffFailures = new Map();

const staffFile = join(directory, "admin-staff.json");
const meFile = join(directory, "admin-root.json");
const assignmentsFile = join(directory, "admin-assignments.json");
const settingsFile = join(directory, "admin-settings.json");

const customerKeyFile = join(directory, "customer-session-key");
const adminEpochFile = join(directory, "admin-session-epoch.json");
const CUSTOMER_COOKIE = "banking_customer";
const CUSTOMER_SESSION_SECONDS = 60 * 60 * 8;
const CUSTOMER_INVITE_SECONDS = 24 * 60 * 60;
const customerAccessDirectory = join(directory, "customer-access");
const customerAccessFailures = new Map();
const previewSessions = new Map();
const PREVIEW_SESSION_MS = 60 * 60 * 1000;

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
  return null;
}

function signAdminSession(expiry, nonce, epoch = adminEpoch()) {
  const secret = configuredAdminSecret();
  if (!secret) return null;
  const payload = `${expiry}.${nonce}.${epoch}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function validAdminSession(req) {
  const supplied = readAdminCookie(req);
  const parts = supplied.split(".");
  if (parts.length !== 4) return false;
  const [expiry, nonce, epoch] = parts;
  if (!/^\d+$/.test(expiry) || !/^\d+$/.test(epoch) || !/^[a-f0-9]{32}$/.test(nonce) ||
      Number(expiry) <= Math.floor(Date.now() / 1000) || Number(epoch) !== adminEpoch()) return false;
  const expected = signAdminSession(expiry, nonce, epoch);
  const actualBytes = Buffer.from(supplied);
  return !!expected && Buffer.byteLength(expected) === actualBytes.length && timingSafeEqual(Buffer.from(expected), actualBytes) && rootSessions.has(digest(supplied));
}

function registerAdminSession(req, expiry) {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, expires] of rootSessions) if (expires <= now) rootSessions.delete(key);
  revokeAdminSession(req);
  if (rootSessions.size >= 256) throw new DemoError("Too many active admin sessions.", 503);
  const token = signAdminSession(expiry, randomBytes(16).toString("hex"));
  rootSessions.set(digest(token), expiry);
  return token;
}

function revokeAdminSession(req) {
  const token = readAdminCookie(req);
  if (token) rootSessions.delete(digest(token));
}

function readAdminCookie(req) {
  return (req.headers.cookie || "").match(
    /(?:^|;\s*)banking_preview_admin=([^;]+)/,
  )?.[1] || "";
}

function requireSameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new DemoError("Cross-site requests are not allowed.", 403);
  if (req.headers.origin && URL.parse(req.headers.origin)?.host !== req.headers.host)
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

function auditAdmin(action, workspace = "", actor = "super-admin", details) {
  const workspaces = Array.isArray(workspace) ? workspace : workspace ? [workspace] : [];
  const retention = Math.max(250, Math.min(Number(adminSettings().auditRetention || 2000), 5000));
  let entries = [];
  try { entries = readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { entries = []; }
  entries = entries.slice(-retention);
  const previousHash = entries.length ? (entries.at(-1).hash || createHash("sha256").update(JSON.stringify(entries.at(-1))).digest("hex")) : "GENESIS";
  const entry = {
    at: new Date().toISOString(),
    actor,
    action,
    scope: "administrator actions",
    workspace: workspaces.length === 1 ? `${workspaces[0].slice(0, 8)}…` : null,
    // Match exact workspace IDs in history without publishing them in the audit feed.
    ...(workspaces.length ? { workspaceKeys: workspaces.map(id => digest(`workspace:${id}`)) } : {}),
    ...(details ? { details } : {}),
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
  return { ...safeWorkspaceSummary(id, state), ...rollup(state) };
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

function storedAuditIntegrity() {
  let entries;
  try {
    entries = readFileSync(auditFile, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code !== "ENOENT") return { integrity: false, entries: 0, error: "The audit log could not be read." };
    entries = [];
  }
  const anchor = entries[0]?.previousHash ?? "GENESIS";
  let prior = anchor;
  for (const [index, entry] of entries.entries()) {
    const { hash, ...content } = entry ?? {};
    if ((!index && prior !== "GENESIS" && !/^[a-f0-9]{64}$/.test(prior)) || content.previousHash !== prior || hash !== digest(JSON.stringify(content))) {
      return { integrity: false, entries: entries.length, firstInvalidIndex: index };
    }
    prior = hash;
  }
  return { integrity: true, entries: entries.length, anchor, block: prior, algorithm: "SHA-256" };
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
    if (workspace && entry.workspace !== workspace && !(/^[a-f0-9]{48}$/.test(workspace) && entry.workspaceKeys?.includes(digest(`workspace:${workspace}`)))) return false;
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
  if (req.headers.origin && URL.parse(req.headers.origin)?.host !== req.headers.host)
    throw new DemoError("Origin mismatch.", 403);
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new DemoError("Use JSON for admin operations.", 415);
  return readJsonBody(req, 2048);
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const staffActor = (staff) => `limited-admin:${staff.id.slice(0, 8)}`;

function setCustomerSuspended(state, suspended) {
  if (suspended && state.customerManaged && !state.suspended && state.status !== "suspended") {
    state.customerSessionEpoch = Number(state.customerSessionEpoch || 0) + 1;
  }
  state.suspended = suspended;
  state.status = suspended ? "suspended" : "active";
}

function customerAccessFile(id) {
  return join(customerAccessDirectory, `${id}.json`);
}

function customerAccess(id, state) {
  if (!state.customerAccessVersion) return null;
  const record = readJsonFile(customerAccessFile(id), null);
  return record?.version === state.customerAccessVersion ? record : null;
}

function customerAccessStatus(id, state) {
  const record = customerAccess(id, state);
  const suspended = Boolean(state.suspended || state.status === "suspended");
  if (record?.accessHash) return { status: "enrolled", suspended };
  if (record?.inviteHash) return { status: record.expiresAt > Date.now() ? "invited" : "expired", expiresAt: new Date(record.expiresAt).toISOString(), suspended };
  return { status: "not_enrolled", suspended };
}

function recordCustomerAccessFailure(ip, now) {
  if (customerAccessFailures.size >= 2048) {
    for (const [key, value] of customerAccessFailures) if (value.until <= now) customerAccessFailures.delete(key);
  }
  if (customerAccessFailures.size >= 2048 && !customerAccessFailures.has(ip)) return;
  const attempt = customerAccessFailures.get(ip);
  customerAccessFailures.set(ip, { count: (attempt?.until > now ? attempt.count : 0) + 1, until: now + 900000 });
}

async function useCustomerAccess(req, res, claim) {
  const body = await publicPost(req);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "code")) {
    throw new DemoError("Provide only an app-issued workspace code.", 400);
  }
  const { code } = body;
  const now = Date.now();
  const ip = String(req.socket.remoteAddress || "local");
  const attempt = customerAccessFailures.get(ip);
  if (attempt?.until > now && attempt.count >= 12) throw new DemoError("Too many attempts. Try again in 15 minutes.", 429);
  const prefix = claim ? "join" : "access";
  const match = typeof code === "string" && new RegExp(`^${prefix}-([a-f0-9]{48})-[a-f0-9]{48}$`).exec(code);
  const id = match?.[1];
  const file = id && join(directory, `${id}.json`);
  const state = file && readJsonFile(file, null);
  const record = state && customerAccess(id, state);
  const hash = claim ? record?.inviteHash : record?.accessHash;
  const expected = Buffer.from(hash || "0".repeat(64), "hex");
  const matches = match && expected.length === 32 && timingSafeEqual(Buffer.from(digest(code), "hex"), expected);
  if (!matches || !hash || !state.customerManaged || state.suspended || state.status === "suspended" || (claim && record.expiresAt <= now)) {
    recordCustomerAccessFailure(ip, now);
    throw new DemoError(claim ? "This invitation is invalid, expired, or no longer available." : "This workspace access code wasn't recognized or access is unavailable.", 401);
  }
  customerAccessFailures.delete(ip);
  if (claim) {
    const accessCode = `access-${id}-${randomBytes(24).toString("hex")}`;
    writeJsonFile(customerAccessFile(id), { version: record.version, accessHash: digest(accessCode) });
    auditAdmin("customer_invitation_accepted", id, "workspace-customer");
    return res.end(JSON.stringify({ accessCode }));
  }
  const current = validCustomerSession(req);
  if (current && current.workspaceId !== id) revokeCustomerSessions(current);
  return startCustomerSession(req, res, { workspaceId: id, state });
}

function workspaceHistory(id) {
  const key = digest(`workspace:${id}`);
  const matches = auditEntries(5000).filter(entry => entry.workspaceKeys?.includes(key));
  return {
    entries: matches.slice(0, 50).map(({ hash, at, action, actor, details }) => ({ id: hash, at, action, actor, details })),
    hasMore: matches.length > 50,
  };
}

function offboardingPlan(staffId, assignments) {
  const ids = Object.keys(assignments).filter(id => assignments[id] === staffId && /^[a-f0-9]{48}$/.test(id) && existsSync(join(directory, `${id}.json`))).sort();
  return { ids, version: digest(ids.join(",")) };
}


function arenaPreviewHost(req) {
  return /^(?:\d+-[a-z0-9-]+\.e2b\.app|sbx-[a-z0-9-]+\.arena\.site)(?::443)?$/i.test(String(req.headers.host ?? ""));
}

function browserUsesHttps(req) {
  // Arena can terminate TLS and forward plain HTTP without an X-Forwarded-Proto header.
  const host = String(req.headers.host ?? "").toLowerCase();
  const origin = typeof req.headers.origin === "string" ? URL.parse(req.headers.origin) : null;
  return process.env.NODE_ENV === "production" || Boolean(req.socket.encrypted) ||
    req.headers["x-forwarded-proto"] === "https" || (origin?.protocol === "https:" && origin.host === host) || arenaPreviewHost(req);
}

function adminCookie(req, name, value, age) {
  const secure = browserUsesHttps(req);
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}${secure ? "; Secure" : ""}`;
}

function staffSessionKey(req) {
  const token = (req.headers.cookie || "").match(/(?:^|;\s*)banking_preview_limited=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token ? digest(token) : "";
}

function eligibleLimitedStaff(row) {
  return row?.active === true && row.role === "limited" && typeof row.signInKeyHash === "string" && /^[a-f0-9]{64}$/.test(row.signInKeyHash);
}

function currentStaff(req) {
  const key = staffSessionKey(req);
  const session = staffSessions.get(key);
  if (!session) return null;
  const staff = staffEntries().find(row => row.id === session.id);
  if (!configuredAdminSecret() || session.expires <= Date.now() || session.epoch !== adminEpoch() || !eligibleLimitedStaff(staff) || staff.signInKeyHash !== session.keyHash) {
    staffSessions.delete(key);
    return null;
  }
  return staff;
}

function revokeStaffSessions(id) {
  for (const [key, session] of staffSessions) if (session.id === id) staffSessions.delete(key);
}

function publicStaff(row) {
  const { id, name, email, role, active, createdAt, updatedAt } = row;
  return { id, name, email, role, active, createdAt, updatedAt, signInEnabled: eligibleLimitedStaff(row), fundingAvailable: row.fundingAvailable ?? 0 };
}

function canCloseAccount(state, account) {
  return account.balance === 0 && !state.transactions.some(tx => tx.accountId === account.id) &&
    !state.payments.some(payment => payment.from === account.id || payment.to === account.id);
}

function canEditAdjustment(tx) {
  return tx.source === "admin_adjustment" && tx.simulated === true && tx.status === "posted" && !tx.availableOn && !tx.reference;
}

function workspaceDetails(id, state) {
  const accounts = state.accounts.map(({ id, name, type, last4, balance, openingDate }) => ({ id, name, type, last4, balance, openingDate }));
  const recentPayments = state.payments.slice(0, 5).map(({ id, kind, status, amount, date, toName }) => ({ id, kind, status, amount, date, toName }));
  return { summary: summarizeWorkspace(id, state), accounts, recentPayments };
}

function saveSupportMessage(file, state, body, actor) {
  const subject = cleanText(body?.subject, 200);
  const text = cleanText(body?.body, 2000);
  if (!subject || !text) throw new DemoError("Subject and message are required.", 400);
  const message = { id: randomBytes(12).toString("hex"), direction: "staff", subject, body: text, author: actor, createdAt: new Date().toISOString() };
  (state.messages ||= []).push(message);
  state.preferences.inboxRead = false;
  save(file, state);
  return message;
}

function isStaffIdentity(profile, staff) {
  const normalized = value => cleanText(value, 200).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const name = normalized(profile?.name);
  const email = cleanText(profile?.email, 200).toLowerCase();
  return Boolean((name && name === normalized(staff.name)) ||
    (staff.email && (email === staff.email || cleanText(profile?.name, 200).toLowerCase() === staff.email)));
}

function staffCustomerCanReceiveFunding(state, staff) {
  return state.customerManaged === true && state.createdByLimitedAdminId === staff.id && !isStaffIdentity(state.profile, staff);
}

function clearStarterActivity(state) {
  for (const key of ["accounts", "transactions", "payments", "bills"]) state[key] = [];
}

async function limitedAdminApi(req, res, path) {
  const method = req.method;
  if (path === "/api/admin/staff/session" && method === "GET") {
    const staff = currentStaff(req);
    return res.end(JSON.stringify({ authenticated: !!staff, staff: staff ? { name: staff.name } : null }));
  }
  if (path === "/api/admin/staff/session" && method === "POST") {
    if (!configuredAdminSecret()) throw new DemoError("Administration is disabled on this server.", 503);
    const body = await publicPost(req);
    const now = Date.now();
    const ip = String(req.socket.remoteAddress || "local");
    const attempt = staffFailures.get(ip);
    if (attempt?.until > now && attempt.count >= 6) throw new DemoError("Too many attempts. Try again in 15 minutes.", 429);
    const email = cleanText(body?.email, 200).toLowerCase();
    const code = cleanText(body?.code, 100);
    const staff = staffEntries().find(row => row.email === email && eligibleLimitedStaff(row));
    const expected = Buffer.from(staff?.signInKeyHash || "0".repeat(64), "hex");
    const match = timingSafeEqual(Buffer.from(digest(code), "hex"), expected);
    if (!match || !staff) {
      if (staffFailures.size >= 2048) for (const [key, row] of staffFailures) if (row.until <= now) staffFailures.delete(key);
      if (staffFailures.size >= 2048 && !staffFailures.has(ip)) throw new DemoError("Try signing in again later.", 429);
      staffFailures.set(ip, { count: (attempt?.until > now ? attempt.count : 0) + 1, until: now + 900000 });
      throw new DemoError("Email or access code wasn't recognized.", 401);
    }
    staffFailures.delete(ip);
    staffSessions.delete(staffSessionKey(req));
    for (const [key, row] of staffSessions) if (row.expires <= now) staffSessions.delete(key);
    if (staffSessions.size >= 2048) staffSessions.delete(staffSessions.keys().next().value);
    const token = randomBytes(32).toString("hex");
    staffSessions.set(digest(token), { id: staff.id, keyHash: staff.signInKeyHash, epoch: adminEpoch(), expires: now + ADMIN_SESSION_SECONDS * 1000 });
    revokeAdminSession(req);
    res.setHeader("Set-Cookie", [adminCookie(req, STAFF_COOKIE, token, ADMIN_SESSION_SECONDS), adminCookie(req, ADMIN_COOKIE, "", 0)]);
    auditAdmin("limited_admin_signed_in", "", staffActor(staff));
    return res.end(JSON.stringify({ authenticated: true, staff: { name: staff.name } }));
  }
  if (path === "/api/admin/staff/session" && method === "DELETE") {
    requireSameOrigin(req);
    const staff = currentStaff(req);
    staffSessions.delete(staffSessionKey(req));
    res.setHeader("Set-Cookie", adminCookie(req, STAFF_COOKIE, "", 0));
    if (staff) auditAdmin("limited_admin_signed_out", "", staffActor(staff));
    return res.end(JSON.stringify({ authenticated: false }));
  }
  if (method !== "GET") requireSameOrigin(req);
  const body = method !== "GET" ? await readJsonBody(req) : null;
  const staff = currentStaff(req);
  if (!staff) throw new DemoError("Limited admin sign-in is required.", 401);
  const assignments = assignmentEntries();
  if (path === "/api/admin/staff/workspaces" && method === "POST") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "name")) {
      throw new DemoError("Provide only the customer display name.", 400);
    }
    const name = cleanText(body.name, 120);
    if (!name) throw new DemoError("Customer display name is required.", 400);
    if (isStaffIdentity({ name }, staff)) throw new DemoError("You cannot create a customer workspace for yourself.", 403);
    const id = randomBytes(24).toString("hex");
    const state = createWorkspace();
    clearStarterActivity(state);
    state.profile = { name, firstName: name.split(/\s+/)[0], initials: name.split(/\s+/).slice(0, 2).map(part => [...part][0]).join("").toUpperCase(), email: "" };
    Object.assign(state, { status: "active", suspended: false, customerManaged: true, customerSessionEpoch: 1,
      created: new Date().toISOString(), createdByLimitedAdminId: staff.id });
    installRestore(directory, new Map([[`${id}.json`, state], ["admin-assignments.json", { ...assignments, [id]: staff.id }]]), writeJsonFile);
    auditAdmin("customer_created", id, staffActor(staff), { actorName: staff.name });
    res.writeHead(201);
    return res.end(JSON.stringify({ customer: { id, name, suspended: false, accountCount: 0 } }));
  }
  if (path === "/api/admin/staff/workspaces" && method === "GET") {
    const workspaces = Object.entries(assignments).flatMap(([id, owner]) => {
      if (owner !== staff.id || !/^[a-f0-9]{48}$/.test(id)) return [];
      const state = readJsonFile(join(directory, `${id}.json`), null);
      if (!state) return [];
      return [{ id, name: state.profile?.name || `Workspace ${id.slice(0, 8)}`, accountCount: state.accounts.length, suspended: Boolean(state.suspended || state.status === "suspended") }];
    });
    return res.end(JSON.stringify({ workspaces, fundingAvailable: staff.fundingAvailable ?? 0 }));
  }
  const route = /^\/api\/admin\/staff\/workspaces\/([a-f0-9]{48})(?:\/(messages|access|accounts|funding))?$/.exec(path);
  if (!route) throw new DemoError("Not found.", 404);
  const [, id, action] = route;
  const file = join(directory, `${id}.json`);
  if (assignments[id] !== staff.id || !existsSync(file)) throw new DemoError("Workspace not found.", 404);
  const state = JSON.parse(readFileSync(file, "utf8"));
  if (!action && method === "GET") return res.end(JSON.stringify({ ...workspaceDetails(id, state), canFund: staffCustomerCanReceiveFunding(state, staff) }));
  if (action === "funding" && method === "POST") {
    if (!staffCustomerCanReceiveFunding(state, staff)) throw new DemoError("You can fund only other customers you created and still manage.", 403);
    if (state.suspended || state.status === "suspended") throw new DemoError("Restore workspace access before funding an account.", 409);
    const account = state.accounts.find(row => row.id === body?.accountId);
    if (!account || !["checking", "savings"].includes(account.type) || !account.openingDate) throw new DemoError("Select a dated checking or savings account.", 400);
    const amount = checkedCents(body?.amount, "Funding amount", 1);
    const requestId = body?.requestId;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(requestId)) throw new DemoError("A confirmation identifier is required.", 400);
    const reference = `funding-${digest(`${staff.id}:${requestId}`)}`;
    const previous = state.transactions.find(tx => tx.reference === reference);
    const available = staff.fundingAvailable ?? 0;
    if (previous) {
      if (previous.accountId !== account.id || previous.amount !== amount) throw new DemoError("This confirmation already belongs to a different funding allocation.", 409);
      return res.end(JSON.stringify({ fundingAvailable: available, transaction: previous }));
    }
    if (amount > available) throw new DemoError("The amount exceeds your remaining funding budget.", 409);
    const date = day();
    checkOpeningDate(account, date);
    changeLedgerBalance(state, account, amount);
    const transaction = { ...manualEntry(account.id, amount, "Staff funding allocation", date, "Account funding"), source: "staff_funding", reference };
    state.transactions.unshift(transaction);
    state.updated = new Date().toISOString();
    validateLedgerInvariants(state);
    const fundingAvailable = available - amount;
    const entries = staffEntries().map(row => row.id === staff.id ? { ...row, fundingAvailable } : row);
    // Commit the budget debit and customer credit together, or recover both after interruption.
    installRestore(directory, new Map([["admin-staff.json", { staffs: entries }], [`${id}.json`, state]]), writeJsonFile);
    auditAdmin("staff_funding_allocated", id, staffActor(staff), { actorName: staff.name, amount, fundingAvailable });
    return res.end(JSON.stringify({ fundingAvailable, transaction }));
  }
  if (action === "accounts" && method === "POST") {
    const account = createDatedAccount(state, body, true);
    save(file, state);
    auditAdmin("account_created", id, staffActor(staff), { actorName: staff.name });
    return res.end(JSON.stringify({ account }));
  }
  if (action === "messages" && method === "POST") {
    const message = saveSupportMessage(file, state, body, staffActor(staff));
    auditAdmin("support_message_sent", id, staffActor(staff), { actorName: staff.name });
    return res.end(JSON.stringify({ message }));
  }
  if (action === "access" && method === "PUT") {
    if (typeof body?.suspended !== "boolean") throw new DemoError("Choose whether to suspend or restore access.", 400);
    setCustomerSuspended(state, body.suspended);
    save(file, state);
    auditAdmin(state.suspended ? "customer_suspend" : "customer_access_restored", id, staffActor(staff), { actorName: staff.name });
    return res.end(JSON.stringify({ suspended: state.suspended }));
  }
  throw new DemoError("Method not allowed.", 405);
}

export async function adminApi(req, res, next) {
  const path = (req.url || "/").split("?")[0];
  if (!path.startsWith("/api/admin/")) return next();
  if (path.startsWith("/api/demo/")) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    ensureRestoreRecovered();
    if (path.startsWith("/api/admin/staff/")) return await limitedAdminApi(req, res, path);
    if (path === "/api/admin/session" && req.method === "GET") {
      res.end(JSON.stringify({
        authenticated: validAdminSession(req),
        adminEnabled: Boolean(configuredAdminSecret()),
        demoHint: null,
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
      const session = registerAdminSession(req, expiry);
      const rootCookie = adminCookie(req, ADMIN_COOKIE, session, ADMIN_SESSION_SECONDS);
      if (staffSessionKey(req)) {
        staffSessions.delete(staffSessionKey(req));
        res.setHeader("Set-Cookie", [rootCookie, adminCookie(req, STAFF_COOKIE, "", 0)]);
      } else res.setHeader("Set-Cookie", rootCookie);
      auditAdmin("admin_session_started");
      res.end(JSON.stringify({ authenticated: true, expiresAt: new Date(expiry * 1000).toISOString() }));
      return;
    }
    if (staffSessionKey(req) && !validAdminSession(req) && currentStaff(req)) throw new DemoError("Super-admin access is required.", 403);
    if (!adminGuard(req, res)) return;
    if (path === "/api/admin/session" && req.method === "DELETE") {
      requireSameOrigin(req);
      revokeAdminSession(req);
      auditAdmin("admin_session_ended");
      res.setHeader("Set-Cookie", adminCookie(req, ADMIN_COOKIE, "", 0));
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
        const body = JSON.stringify({ ...workspaceDetails(isolatedId, state), history: workspaceHistory(isolatedId), access: customerAccessStatus(isolatedId, state),
          profile: { name: cleanText(state.profile?.name, 120), email: cleanText(state.profile?.email, 200) },
          accountControls: state.accounts.map(account => ({ id: account.id, nickname: account.nickname ?? "", canClose: canCloseAccount(state, account) })) });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      if (req.method === "POST" && isolatedAction === "reset") {
        requireSameOrigin(req);
        if (!adminSettings().allowWorkspaceReset) throw new DemoError("Workspace reset is disabled.", 403);
        const state = resetWorkspace(isolatedFile);
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
        const assignments = assignmentEntries();
        if (Object.hasOwn(assignments, isolatedId)) {
          delete assignments[isolatedId];
          saveAssignmentEntries(assignments);
        }
        rmSync(customerAccessFile(isolatedId), { force: true });
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
        admins: staffEntries().map(publicStaff),
        assignments: Object.fromEntries(Object.entries(assignmentEntries()).filter(([id, staffId]) =>
          /^[a-f0-9]{48}$/.test(id) && existsSync(join(directory, `${id}.json`)) && staffEntries().some(staff => staff.id === staffId))),
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
      if (!adminGuard(req, res)) return;
      if (body?.dryRun !== true && body?.confirmation !== "RESTORE") throw new DemoError("Typed confirmation RESTORE is required.", 400);
      const { changes, summary } = prepareRestore(body);
      if (body.dryRun === true) return res.end(JSON.stringify({ dryRun: true, ...summary }));
      installRestore(directory, changes, (file, value) => value === null ? rmSync(file, { force: true }) : writeJsonFile(file, value));
      staffSessions.clear();
      auditAdmin("admin_backup_restored");
      res.end(JSON.stringify({ success: true, ...summary, restoredWorkspaces: summary.workspaces }));
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
        resetWorkspace(file);
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
      res.setHeader("Set-Cookie", adminCookie(req, ADMIN_COOKIE, "", 0));
      res.end(JSON.stringify({ success: true, epoch }));
      return;
    }

    if (path === "/api/admin/admins") {
      if (req.method === "GET") {
        res.end(JSON.stringify({ admins: staffEntries().map(publicStaff), root: rootIdentity() }));
        return;
      }
      if (req.method === "POST") {
        requireSameOrigin(req);
        const body = await readJsonBody(req, 4096);
        const entry = validateStaff(body);
        const id = randomBytes(12).toString("hex");
        const now = new Date().toISOString();
        const accessCode = entry.role === "limited" ? randomBytes(24).toString("hex") : null;
        const staff = { id, ...entry, createdAt: now, updatedAt: now, ...(accessCode ? { signInKeyHash: digest(accessCode) } : {}) };
        const entries = staffEntries();
        if (entries.some(item => item.email && staff.email && item.email.toLowerCase() === staff.email.toLowerCase())) throw new DemoError("Duplicate staff identity.", 409);
        saveStaffEntries([...entries, staff]);
        auditAdmin("staff_identity_created", "");
        res.writeHead(201);
        res.end(JSON.stringify({ admin: publicStaff(staff), ...(accessCode ? { accessCode } : {}) }));
        return;
      }
    }

    const fundingGrantMatch = /^\/api\/admin\/admins\/([a-f0-9]{24})\/funding$/.exec(path);
    if (fundingGrantMatch && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      const amount = checkedCents(body?.amount, "Grant amount", 1);
      const entries = staffEntries();
      const staff = entries.find(row => row.id === fundingGrantMatch[1] && eligibleLimitedStaff(row));
      if (!staff) throw new DemoError("Choose an active limited admin with sign-in access.", 404);
      staff.fundingAvailable = checkedCents((staff.fundingAvailable ?? 0) + amount, "Funding budget");
      saveStaffEntries(entries);
      auditAdmin("staff_funding_granted", "", "super-admin", { staffId: staff.id, staffName: staff.name, amount, fundingAvailable: staff.fundingAvailable });
      return res.end(JSON.stringify({ admin: publicStaff(staff) }));
    }

    const accessCodeMatch = /^\/api\/admin\/admins\/([a-f0-9]{24})\/access-code$/.exec(path);
    if (accessCodeMatch && req.method === "POST") {
      requireSameOrigin(req);
      await readJsonBody(req);
      const entries = staffEntries();
      const staff = entries.find(row => row.id === accessCodeMatch[1] && row.role === "limited");
      if (!staff) throw new DemoError("Limited admin not found.", 404);
      const accessCode = randomBytes(24).toString("hex");
      staff.signInKeyHash = digest(accessCode);
      staff.updatedAt = new Date().toISOString();
      saveStaffEntries(entries);
      revokeStaffSessions(staff.id);
      auditAdmin("staff_access_code_replaced");
      res.end(JSON.stringify({ admin: publicStaff(staff), accessCode }));
      return;
    }

    const offboardMatch = /^\/api\/admin\/admins\/([a-f0-9]{24})\/offboard$/.exec(path);
    if (offboardMatch) {
      const [, staffId] = offboardMatch;
      if (req.method !== "GET" && req.method !== "POST") throw new DemoError("Method not allowed.", 405);
      let body;
      if (req.method === "POST") {
        requireSameOrigin(req);
        body = await readJsonBody(req);
        if (!adminGuard(req, res)) return;
      }
      const entries = staffEntries();
      const source = entries.find(row => row.id === staffId && row.role === "limited");
      if (!source) throw new DemoError("Limited admin not found.", 404);
      const assignments = assignmentEntries();
      const { ids, version } = offboardingPlan(staffId, assignments);
      if (req.method === "GET") return res.end(JSON.stringify({ workspaceCount: ids.length, version }));
      if (body?.version !== version) throw new DemoError("Assignments changed. Review the updated offboarding plan before confirming.", 409);
      const replacementId = body?.replacementId;
      const replacement = entries.find(row => row.id === replacementId && row.id !== staffId && eligibleLimitedStaff(row));
      if (replacementId !== null && !replacement) throw new DemoError("Choose another active limited admin or leave the workspaces unassigned.", 400);

      // Disable credentials first. If saving assignments fails, access stays revoked and the operation can be retried.
      source.active = false;
      source.updatedAt = new Date().toISOString();
      delete source.signInKeyHash;
      saveStaffEntries(entries);
      revokeStaffSessions(staffId);
      const existing = new Set(ids);
      for (const [id, owner] of Object.entries(assignments)) {
        if (owner !== staffId) continue;
        if (replacement && existing.has(id)) assignments[id] = replacement.id;
        else delete assignments[id];
      }
      saveAssignmentEntries(assignments);
      auditAdmin("staff_offboarded", ids, "super-admin", {
        previousOwnerName: source.name,
        nextOwnerName: replacement?.name ?? null,
        workspaceCount: ids.length,
      });
      return res.end(JSON.stringify({ admin: publicStaff(source), affected: ids.length }));
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
        if (entries.some(item => item.id !== id && item.email && item.email === updated.email)) throw new DemoError("Duplicate staff identity.", 409);
        if (updated.role !== entries[index].role || updated.email !== entries[index].email) delete updated.signInKeyHash;
        entries[index] = updated;
        saveStaffEntries(entries);
        revokeStaffSessions(id);
        auditAdmin("staff_identity_updated");
        res.end(JSON.stringify({ admin: publicStaff(updated) }));
        return;
      }
      if (req.method === "DELETE") {
        requireSameOrigin(req);
        await readJsonBody(req, 4096);
        const entries = staffEntries();
        if (!entries.some(item => item.id === id)) throw new DemoError("Staff identity not found.", 404);
        saveStaffEntries(entries.filter(item => item.id !== id));
        revokeStaffSessions(id);
        saveAssignmentEntries(Object.fromEntries(Object.entries(assignmentEntries()).filter(([, owner]) => owner !== id)));
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
      const owner = body?.ownerAdminId;
      if (owner !== null && (typeof owner !== "string" || !/^[a-f0-9]{24}$/.test(owner))) throw new DemoError("Choose a limited admin or remove the assignment.", 400);
      if (owner) {
        if (!staffEntries().some(item => item.id === owner && eligibleLimitedStaff(item))) throw new DemoError("Choose an active limited admin.", 400);
      }
      const oldOwner = assignments[id] || null;
      if (oldOwner !== owner) {
        if (owner) assignments[id] = owner;
        else delete assignments[id];
        saveAssignmentEntries(assignments);
        const staff = staffEntries();
        auditAdmin("customer_owner_assigned", id, "super-admin", {
          previousOwnerName: staff.find(row => row.id === oldOwner)?.name ?? null,
          nextOwnerName: staff.find(row => row.id === owner)?.name ?? null,
        });
      }
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
        requireSameOrigin(req);
        const body = await readJsonBody(req);
        const name = cleanText(body?.name, 120);
        if (!name) throw new DemoError("Customer display name is required.", 400);
        const id = randomBytes(24).toString("hex");
        const state = createWorkspace();
        const initials = name.split(/\s+/).slice(0, 2).map(part => [...part][0]).join("").toUpperCase();
        state.profile = { ...state.profile, name, firstName: name.split(/\s+/)[0], initials, email: "" };
        state.status = "active";
        state.suspended = false;
        state.customerManaged = true;
        state.customerSessionEpoch = 1;
        state.created = new Date().toISOString();
        save(join(directory, `${id}.json`), state);
        auditAdmin("customer_created", id);
        res.writeHead(201);
        res.end(JSON.stringify({ customer: { id, name, status: state.status, suspended: false, accountCount: state.accounts.length, ownerAdminId: null } }));
        return;
      }
    }

    if (req.method === "POST" && ["/api/admin/users/bulk", "/api/admin/customers/bulk"].includes(path)) {
      requireSameOrigin(req);
      const body = await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      if (!["delete", "suspend", "activate", "promote", "reassign"].includes(body?.action) || !Array.isArray(body.ids)) throw new DemoError("Choose a bulk action and workspaces.", 400);
      if (["suspend", "activate", "reassign"].includes(body.action)) {
        const ids = [...new Set(body.ids)];
        if (!ids.length || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id))) throw new DemoError("Select 1–50 valid workspaces.", 400);
        const changes = new Map();
        const changed = [];
        const assignments = assignmentEntries();
        const owner = body.ownerAdminId;
        if (body.action === "reassign" && owner !== null && !staffEntries().some(staff => staff.id === owner && eligibleLimitedStaff(staff))) {
          throw new DemoError("Choose an active limited admin or remove the assignment.", 400);
        }
        for (const id of ids) {
          const name = `${id}.json`;
          const state = readJsonFile(join(directory, name), null);
          if (!state) throw new DemoError("One or more selected workspaces no longer exist. Refresh and try again.", 404);
          if (body.action === "reassign") {
            if ((assignments[id] ?? null) === owner) continue;
            if (owner === null) delete assignments[id];
            else assignments[id] = owner;
          } else {
            const suspend = body.action === "suspend";
            if (Boolean(state.suspended || state.status === "suspended") === suspend) continue;
            setCustomerSuspended(state, suspend);
            changes.set(name, state);
          }
          changed.push(id);
        }
        if (changed.length) {
          if (body.action === "reassign") changes.set("admin-assignments.json", assignments);
          installRestore(directory, changes, writeJsonFile);
          auditAdmin(`customers_bulk_${body.action}`, changed, "super-admin", { affected: changed.length });
        }
        return res.end(JSON.stringify({ success: true, affected: changed.length }));
      }
      if (body.action === "delete" && !adminSettings().allowWorkspaceDelete) throw new DemoError("Workspace deletion is disabled.", 403);
      const changed = [];
      const assignments = assignmentEntries();
      for (const id of new Set(body.ids)) {
        if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id)) continue;
        const file = join(directory, `${id}.json`);
        if (!existsSync(file)) continue;
        if (body.action === "delete") {
          unlinkSync(file);
          rmSync(customerAccessFile(id), { force: true });
          delete assignments[id];
        } else {
          const state = JSON.parse(readFileSync(file, "utf8"));
          state.promoted = true;
          save(file, state);
        }
        changed.push(id);
      }
      if (changed.length) {
        if (body.action === "delete") saveAssignmentEntries(assignments);
        auditAdmin(`customers_bulk_${body.action}`, changed);
      }
      return res.end(JSON.stringify({ success: true, affected: changed.length }));
    }

    const inviteMatch = /^\/api\/admin\/customers\/([a-f0-9]{48})\/invitation$/.exec(path);
    if (inviteMatch && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      const [, id] = inviteMatch;
      const file = join(directory, `${id}.json`);
      const state = readJsonFile(file, null);
      if (!state) throw new DemoError("Customer workspace not found.", 404);
      const access = customerAccessStatus(id, state);
      if (access.suspended) throw new DemoError("Restore workspace access before issuing an invitation.", 409);
      if (body?.status !== access.status) throw new DemoError("Workspace access changed. Reopen workspace details before issuing an invitation.", 409);
      const version = randomBytes(24).toString("hex");
      const code = `join-${id}-${randomBytes(24).toString("hex")}`;
      const expiresAt = Date.now() + CUSTOMER_INVITE_SECONDS * 1000;
      mkdirSync(customerAccessDirectory, { recursive: true, mode: 0o700 });
      state.customerManaged = true;
      state.customerAccessVersion = version;
      revokeCustomerSessions({ file, state });
      writeJsonFile(customerAccessFile(id), { version, inviteHash: digest(code), expiresAt });
      auditAdmin(access.status === "enrolled" ? "customer_access_recovery_issued" : "customer_invitation_issued", id);
      res.writeHead(201);
      return res.end(JSON.stringify({ code, access: customerAccessStatus(id, state) }));
    }

    const customerMatch = path.match(/^\/api\/admin\/(?:customers|users)\/([a-f0-9]{48})(?:\/(promote|suspend|reset-password|revoke-sessions|impersonate))?$/);
    if (customerMatch) { const [, id, action] = customerMatch; const file = join(directory, `${id}.json`); if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      if (req.method === "GET" && !action) { const state = JSON.parse(readFileSync(file, "utf8")); res.end(JSON.stringify({ customer: { id, profile: state.profile || null, status: state.status || "active", suspended: Boolean(state.suspended), promoted: Boolean(state.promoted), ownerAdminId: assignmentEntries()[id] || null }, workspace: summarizeWorkspace(id, state), state })); return; }
      if (req.method === "PUT" && !action) {
        requireSameOrigin(req);
        const body = await readJsonBody(req);
        if (!adminGuard(req, res)) return;
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("Expected a customer profile.", 400);
        const state = JSON.parse(readFileSync(file, "utf8"));
        const profile = { ...state.profile };
        if (Object.hasOwn(body, "name")) {
          const name = cleanText(body.name, 120);
          if (!name) throw new DemoError("Customer display name is required.", 400);
          const parts = name.split(/\s+/);
          Object.assign(profile, { name, firstName: parts[0], initials: parts.slice(0, 2).map(part => [...part][0]).join("").toUpperCase() });
        }
        if (Object.hasOwn(body, "email")) {
          const email = cleanText(body.email, 200).toLowerCase();
          if (typeof body.email !== "string" || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new DemoError("Enter a valid email address or leave it blank.", 400);
          profile.email = email;
        }
        state.profile = profile;
        if (typeof body.suspended === "boolean") setCustomerSuspended(state, body.suspended);
        else if (body.status === "suspended") setCustomerSuspended(state, true);
        else if (body.status === "active") setCustomerSuspended(state, false);
        else if (body.status !== undefined) throw new DemoError("Choose active or suspended status.", 400);
        state.updated = new Date().toISOString();
        save(file, state);
        auditAdmin("customer_updated", id);
        return res.end(JSON.stringify({ success: true, customer: { id, profile, status: state.status || "active", suspended: Boolean(state.suspended) } }));
      }
      if (req.method === "DELETE" && !action) { requireSameOrigin(req); await readJsonBody(req, 4096); unlinkSync(file); rmSync(customerAccessFile(id), { force: true }); const assignments = assignmentEntries(); delete assignments[id]; saveAssignmentEntries(assignments); auditAdmin("customer_deleted", id); res.end(JSON.stringify({ success: true, id })); return; }
      if (action) {
        if (req.method !== "POST") throw new DemoError("Method not allowed.", 405);
        requireSameOrigin(req);
        const body = await readJsonBody(req);
        if (!adminGuard(req, res)) return;
        const state = JSON.parse(readFileSync(file, "utf8"));
        if (action === "promote") state.promoted = body.promoted !== false;
        if (action === "suspend") setCustomerSuspended(state, body.suspended !== false);
        if (action === "reset-password") state.passwordResetAt = new Date().toISOString();
        if (action === "revoke-sessions") {
          state.customerSessionEpoch = Number(state.customerSessionEpoch || 0) + 1;
          state.revokedSessionsAt = new Date().toISOString();
        }
        if (action === "impersonate") {
          if (state.suspended || state.status === "suspended") throw new DemoError("A suspended customer cannot be impersonated.", 403);
        }
        validateLedgerInvariants(state);
        save(file, state); auditAdmin(action === "suspend" && !state.suspended ? "customer_access_restored" : `customer_${action.replaceAll("-", "_")}`, id);
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

    const instructionMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?(?:scheduled(?:-instructions)?|instructions)(?:\/([a-zA-Z0-9-]+))?$/);
    if (instructionMatch) {
      const [, id, itemId] = instructionMatch;
      if (req.method === "GET") {
        const instructions = demoWorkspaceFiles().flatMap(name => {
          const workspaceId = name.slice(0, 48);
          if (id && workspaceId !== id) return [];
          const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
          return state.payments.filter(payment => payment.status === "scheduled").map(payment => ({ workspaceId, ...payment }));
        });
        return res.end(JSON.stringify({ instructions, scheduled: instructions, count: instructions.length }));
      }
      const actions = { POST: "submit", PUT: "edit", DELETE: "cancel" };
      const action = actions[req.method];
      if (!action || (action === "submit" ? itemId : !itemId)) throw new DemoError("Method not allowed.", 405);
      requireSameOrigin(req);
      const body = req.method === "DELETE" ? {} : await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      if (!id) throw new DemoError("Workspace id is required.", 400);
      const file = join(directory, `${id}.json`);
      if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      const state = JSON.parse(readFileSync(file, "utf8"));
      validateLedgerInvariants(state);
      if (action === "submit" && (!body || typeof body.date !== "string" || body.date <= day())) throw new DemoError("Select a future date for a scheduled instruction.", 400);
      if (action === "edit" && (!body || typeof body.date !== "string" || body.date <= day())) throw new DemoError("Select a future date for a scheduled instruction.", 400);
      const payload = action === "submit" ? { ...body, frequency: body.frequency ?? "once", requestId: cleanText(body.requestId, 64) || `admin-${randomBytes(12).toString("hex")}` } : { ...body, id: itemId };
      const result = applyAction(state, { action, payload });
      validateLedgerInvariants(result.state);
      save(file, result.state);
      auditAdmin(`scheduled_instruction_${action === "submit" ? "created" : action === "edit" ? "updated" : "deleted"}`, id);
      const instruction = result.state.payments.find(payment => payment.id === (result.result ?? itemId));
      return res.end(JSON.stringify({ success: true, instruction }));
    }

    const disputeMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?disputes(?:\/([a-f0-9-]+))?(?:\/(open|status|refund))?$/);
    if (disputeMatch) { const [, id, itemId, action] = disputeMatch;
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const dispute of state.disputes||[])out.push({workspaceId:wid,...dispute});}res.end(JSON.stringify({disputes:out,count:out.length}));return; }
      requireSameOrigin(req); if (!id) throw new DemoError("Workspace id is required.",400); const body=await readJsonBody(req,4096); const file=join(directory,`${id}.json`);if(!existsSync(file))throw new DemoError("Customer workspace not found.",404);const state=JSON.parse(readFileSync(file,"utf8"));state.disputes||=[];
      if (req.method === "POST") { const dispute={id:randomBytes(12).toString("hex"),transactionId:cleanText(body.transactionId,80),reason:cleanText(body.reason,200)||"Account dispute",status:"open",amount:Number(body.amount||0),openedAt:new Date().toISOString()};state.disputes.push(dispute);save(file,state);auditAdmin("dispute_opened",id);res.end(JSON.stringify({success:true,dispute}));return; }
      const dispute=state.disputes.find(item=>item.id===itemId);if(!dispute)throw new DemoError("Dispute not found.",404);if(action=== "status"||body.status)dispute.status=cleanText(body.status,40)||dispute.status;if(action=== "refund"||body.refund){
        if (dispute.status === "refunded") throw new DemoError("This dispute refund was already applied.", 409);
        const refundAmount=body.amount ?? dispute.amount;
        if (!Number.isSafeInteger(refundAmount)||refundAmount<=0) throw new DemoError("Refund amount is invalid.",400);
        const sourceTx=state.transactions.find(tx=>tx.id===dispute.transactionId);
        if (!sourceTx) throw new DemoError("Dispute transaction was not found.",404);
        const account=state.accounts.find(a=>a.id===sourceTx.accountId);
        if (!account) throw new DemoError("Dispute account was not found.",404);
        changeLedgerBalance(state, account, refundAmount);
        sourceTx.status="refund-reversed";
        state.transactions.unshift({id:`refund-${dispute.id}`,accountId:account.id,date:day(),description:`Refund for disputed ${sourceTx.description}`,category:"Refund",amount:refundAmount,status:"posted",reference:dispute.id,disputeId:dispute.id});
        dispute.status="refunded";dispute.refundAmount=refundAmount;dispute.refundedAt=new Date().toISOString();
      }validateLedgerInvariants(state);save(file,state);auditAdmin(action?`dispute_${action}`:"dispute_updated",id);res.end(JSON.stringify({success:true,dispute}));return;
    }

    const messageMatch = path.match(/^\/api\/admin\/(?:users\/([a-f0-9]{48})\/)?messages$/);
    if (messageMatch) { const id = messageMatch[1];
      if (req.method === "GET") { const out=[]; for(const name of demoWorkspaceFiles()){const wid=name.slice(0,48);if(id&&wid!==id)continue;const state=JSON.parse(readFileSync(join(directory,name),"utf8"));for(const message of state.messages||[])out.push({workspaceId:wid,...message});}res.end(JSON.stringify({messages:out,count:out.length}));return; }
      if (req.method !== "POST") throw new DemoError("Method not allowed.", 405);
      requireSameOrigin(req);
      if (!id) throw new DemoError("Workspace id is required.", 400);
      const body = await readJsonBody(req);
      const file = join(directory, `${id}.json`);
      if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
      const state = JSON.parse(readFileSync(file, "utf8"));
      const message = saveSupportMessage(file, state, body, "super-admin");
      auditAdmin("support_message_sent", id);
      res.end(JSON.stringify({ success: true, message }));
      return;
    }

    if (path === "/api/admin/support" || path === "/api/admin/support-contact") { const file=join(directory,"admin-support.json");
      if(req.method=== "GET")res.end(JSON.stringify({support:readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]})}));else{requireSameOrigin(req);const body=await readJsonBody(req,4096);const support={status:cleanText(body.status,40)||"open",banner:cleanText(body.banner,500),contact:{email:cleanText(body.email||body?.contact?.email,200),phone:cleanText(body.phone||body?.contact?.phone,40)},notes:Array.isArray(body.notes)?body.notes.slice(-500):readJsonFile(file,{notes:[]}).notes||[]};writeJsonFile(file,support);auditAdmin("support_status_updated");res.end(JSON.stringify({success:true,support}));}return;
    }
    if (path === "/api/admin/support/notes") { requireSameOrigin(req);const body=await readJsonBody(req,4096);const file=join(directory,"admin-support.json");const support=readJsonFile(file,{status:"open",banner:"",contact:{email:"",phone:""},notes:[]});support.notes||=[];const note={id:randomBytes(12).toString("hex"),body:cleanText(body.body,4000),createdAt:new Date().toISOString()};support.notes.push(note);writeJsonFile(file,support);auditAdmin("support_note_added");res.end(JSON.stringify({success:true,note}));return;}
    if (path === "/api/admin/saved-replies") { const file=join(directory,"admin-saved-replies.json");if(req.method=== "GET")res.end(JSON.stringify(readJsonFile(file,{replies:[]})));else{requireSameOrigin(req);const body=await readJsonBody(req,4096);const saved=readJsonFile(file,{replies:[]});saved.replies||=[];if(req.method!== "POST")throw new DemoError("Method not allowed.",405);const reply={id:randomBytes(12).toString("hex"),title:cleanText(body.title,120),body:cleanText(body.body,4000),createdAt:new Date().toISOString()};saved.replies.push(reply);writeJsonFile(file,saved);auditAdmin("saved_reply_created");res.end(JSON.stringify({success:true,reply}));}return; }

    if (req.method === "GET" && ["/api/admin/audit/block", "/api/admin/audit/integrity"].includes(path)) {
      return res.end(JSON.stringify(storedAuditIntegrity()));
    }
    if (req.method === "GET" && ["/api/admin/audit/proof", "/api/admin/audit/export", "/api/admin/audit/json"].includes(path)) {
      const entries = auditEntries(5000);
      const proof = { version: 1, exportedAt: new Date().toISOString(), scope: "administrator-audit", verification: storedAuditIntegrity(), entries, sha256: digest(JSON.stringify(entries)) };
      res.setHeader("Content-Disposition", 'attachment; filename="admin-audit-proof.json"');
      return res.end(JSON.stringify(proof, null, 2));
    }

    // Staff reassignment alias
    const staffReassignMatch = path.match(/^\/api\/admin\/admins\/([a-f0-9]+)\/reassign$/);
    if (staffReassignMatch && req.method === "PUT") {
      requireSameOrigin(req);
      const [, staffId] = staffReassignMatch;
      const body = await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      if (!staffEntries().some(staff => staff.id === staffId && eligibleLimitedStaff(staff))) throw new DemoError("Staff identity is not active.", 400);
      const assignments = assignmentEntries();
      const changed = [];
      for (const id of new Set(Array.isArray(body?.workspaceIds) ? body.workspaceIds : [])) {
        if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || assignments[id] === staffId || !existsSync(join(directory, `${id}.json`))) continue;
        assignments[id] = staffId;
        changed.push(id);
      }
      if (changed.length) {
        saveAssignmentEntries(assignments);
        auditAdmin("staff_reassigned", changed);
      }
      return res.end(JSON.stringify({ success: true, staffId, assigned: changed.length }));
    }

    // Cross-customer ledger inspection
    if (path === "/api/admin/transactions" && req.method === "GET") {
      const params = new URL(req.url, "http://admin.local").searchParams;
      const search = cleanText(params.get("search"), 120).toLowerCase();
      const status = cleanText(params.get("status"), 40).toLowerCase();
      const scope = params.get("workspace") || "";
      const from = params.get("from") || "";
      const to = params.get("to") || "";
      const source = params.get("source") || "";
      if (scope && !/^[a-f0-9]{48}$/.test(scope)) throw new DemoError("Invalid workspace ID.", 400);
      if ((from && !isLedgerDate(from)) || (to && !isLedgerDate(to)) || (from && to && from > to)) throw new DemoError("Choose a valid transaction date range.", 400);
      if (source && !["admin_adjustment", "generated", "staff_funding"].includes(source)) throw new DemoError("Choose a valid transaction source.", 400);
      const csv = params.get("format") === "csv";
      const requestedLimit = Number(params.get("limit") || (csv ? 5000 : 500));
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new DemoError("Invalid transaction result limit.", 400);
      const limit = Math.min(requestedLimit, 5000);
      const rows = [];
      for (const name of demoWorkspaceFiles()) {
        const id = name.slice(0, 48);
        if (scope && id !== scope) continue;
        const state = JSON.parse(readFileSync(join(directory, name), "utf8"));
        const accounts = new Map(state.accounts.map(account => [account.id, account]));
        for (const tx of state.transactions || []) {
          if (search && !JSON.stringify(tx).toLowerCase().includes(search)) continue;
          if (status && String(tx.status || "posted").toLowerCase() !== status) continue;
          if ((from && tx.date < from) || (to && tx.date > to) || (source && tx.source !== source)) continue;
          const account = accounts.get(tx.accountId);
          rows.push({ ...tx, workspaceId: id, editable: canEditAdjustment(tx), accountName: account?.name ?? tx.accountId, openingDate: account?.openingDate });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const transactions = rows.slice(0, limit);
      if (csv) {
        const cell = value => {
          const text = String(value ?? "");
          const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
          return `"${safe.replaceAll('"', '""')}"`;
        };
        const data = transactions.map(tx => [tx.workspaceId, tx.id, tx.accountId, tx.date, tx.description, tx.category, tx.status, tx.source].map(cell).concat(String(tx.amount)).join(","));
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="workspace-transactions.csv"');
        res.setHeader("X-Export-Truncated", String(rows.length > limit));
        return res.end(["workspace_id,transaction_id,account_id,date,description,category,status,source,amount_cents", ...data].join("\r\n") + "\r\n");
      }
      res.end(JSON.stringify({ transactions, count: transactions.length, total: rows.length }));
      return;
    }

    const generatorMatch = /^\/api\/admin\/workspaces\/([a-f0-9]{48})\/transactions\/generate$/.exec(path);
    if (generatorMatch && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      const [, id] = generatorMatch;
      const file = join(directory, `${id}.json`);
      const state = readJsonFile(file, null);
      if (!state) throw new DemoError("Workspace not found.", 404);
      const { batch, created } = generateWorkspaceActivity(state, body);
      if (created) {
        save(file, state);
        auditAdmin("transactions_generated", id, "super-admin", { count: batch.count, startDate: batch.startDate, endDate: batch.endDate });
      }
      return res.end(JSON.stringify({ count: batch.count, startDate: batch.startDate, endDate: batch.endDate }));
    }

    const mutationMatch = /^\/api\/admin\/users\/([a-f0-9]{48})\/(transactions|accounts)(?:\/([a-zA-Z0-9_-]+))?$/.exec(path);
    if (mutationMatch) return await mutateAdminLedger(req, res, mutationMatch);

    if (path === "/api/admin/process-scheduled" && req.method === "POST") {
      requireSameOrigin(req);
      await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      const result = processScheduledWorkspaces();
      auditAdmin("scheduled_payments_processed", result.workspaces, "super-admin", { processed: result.processed, errors: result.errors });
      return res.end(JSON.stringify({ success: true, processed: result.processed, errors: result.errors, paused: result.paused }));
    }

    if (path === "/api/admin/month-end-close" && req.method === "POST") {
      requireSameOrigin(req);
      await readJsonBody(req);
      if (!adminGuard(req, res)) return;
      const period = day().slice(0, 7);
      let processed = 0;
      for (const name of demoWorkspaceFiles()) {
        const file = join(directory, name);
        const state = JSON.parse(readFileSync(file, "utf8"));
        validateLedgerInvariants(state);
        state.monthlyClosings ||= [];
        if (state.monthlyClosings.includes(period)) continue;
        for (const account of state.accounts) {
          if (!["savings", "cd"].includes(account.type)) continue;
          const apr = account.apr ?? (account.type === "cd" ? 0.0425 : 0.0215);
          if (!Number.isFinite(apr) || apr < 0 || apr > 1) throw new DemoError("Invalid account APR.", 409);
          const interest = Math.round(account.balance * apr / 12);
          if (interest <= 0) continue;
          const txId = `interest-${period}-${account.id}`;
          if (state.transactions.some(tx => tx.id === txId)) continue;
          changeLedgerBalance(state, account, interest);
          state.transactions.unshift({ id: txId, accountId: account.id, date: day(), description: "Monthly interest", category: "Interest", amount: interest, status: "posted", reference: `month-close-${period}` });
          processed++;
        }
        state.monthlyClosings.push(period);
        validateLedgerInvariants(state);
        save(file, state);
      }
      auditAdmin("month_end_close");
      return res.end(JSON.stringify({ success: true, processed }));
    }

    throw new DemoError("Not found.", 404);
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "The change could not be saved. Please try again." }));
  }
}

// A single-process worker and the manual admin action share this settlement pass.
export function processScheduledWorkspaces(today = day()) {
  ensureRestoreRecovered();
  if (adminSettings().maintenanceMode) return { processed: 0, workspaces: [], errors: 0, paused: true };
  const workspaces = [];
  let processed = 0, errors = 0;
  for (const name of demoWorkspaceFiles()) {
    try {
      const file = join(directory, name);
      const state = JSON.parse(readFileSync(file, "utf8"));
      if (state.suspended || state.status === "suspended") continue;
      validateLedgerInvariants(state);
      const before = new Set(state.payments.filter(payment => payment.status === "completed" || payment.status === "failed").map(payment => payment.id));
      if (!settleDue(state, today)) continue;
      validateLedgerInvariants(state);
      save(file, state);
      processed += state.payments.filter(payment => ["completed", "failed"].includes(payment.status) && !before.has(payment.id)).length;
      workspaces.push(name.slice(0, 48));
    } catch { errors++; }
  }
  return { processed, workspaces, errors, paused: false };
}

export function runScheduledWorker() {
  const result = processScheduledWorkspaces();
  if (result.workspaces.length) auditAdmin("scheduled_payments_processed", result.workspaces, "workspace-scheduler", { processed: result.processed });
  return result;
}

function ensureRestoreRecovered() {
  try { recoverRestore(directory); }
  catch { throw new DemoError("Workspace data is unavailable while a backup restore is being recovered.", 503); }
}

function prepareRestore(body) {
  if (body?.version !== 1 || !Array.isArray(body.workspaces) || !body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
    throw new DemoError("Invalid backup format.", 400);
  }
  const changes = new Map(demoWorkspaceFiles().map(name => [name, null]));
  const seen = new Set();
  for (const item of body.workspaces) {
    if (!item || typeof item.id !== "string" || !/^[a-f0-9]{48}$/.test(item.id) || seen.has(item.id)) throw new DemoError("Backup contains invalid or duplicate workspace identifiers.", 400);
    seen.add(item.id);
    validateLedgerInvariants(item.state);
    if (item.state.createdByLimitedAdminId !== undefined && (item.state.customerManaged !== true ||
      typeof item.state.createdByLimitedAdminId !== "string" || !/^[a-f0-9]{24}$/.test(item.state.createdByLimitedAdminId))) {
      throw new DemoError("Invalid limited-admin customer creator in backup.", 400);
    }
    const name = `${item.id}.json`;
    const current = readJsonFile(join(directory, name), null);
    if (item.state.customerManaged || current?.customerManaged) item.state.customerManaged = true;
    if (item.state.customerManaged || item.state.customerSessionEpoch !== undefined || current?.customerSessionEpoch !== undefined) {
      item.state.customerSessionEpoch = randomBytes(6).readUIntBE(0, 6) + 1;
    }
    delete item.state.customerAccessVersion;
    changes.set(name, item.state);
  }
  const staffIds = new Set(), staffEmails = new Set();
  if (body.admins !== undefined && !Array.isArray(body.admins)) throw new DemoError("Invalid staff backup data.", 400);
  const currentStaff = new Map(staffEntries().map(row => [row.id, row]));
  const staff = (body.admins ?? []).map(row => {
    if (!row || typeof row.id !== "string" || !/^[a-f0-9]{24}$/.test(row.id) || staffIds.has(row.id) || typeof row.active !== "boolean") throw new DemoError("Backup contains invalid or duplicate staff identities.", 400);
    staffIds.add(row.id);
    const entry = { id: row.id, ...validateStaff(row), createdAt: cleanText(row.createdAt, 40), updatedAt: cleanText(row.updatedAt, 40) };
    if (entry.email && staffEmails.has(entry.email)) throw new DemoError("Backup contains duplicate staff emails.", 400);
    if (entry.email) staffEmails.add(entry.email);
    if (row.fundingAvailable !== undefined) entry.fundingAvailable = checkedCents(row.fundingAvailable, "Funding budget");
    const current = currentStaff.get(entry.id);
    if (entry.active && eligibleLimitedStaff(current) && current.email === entry.email && current.role === entry.role) entry.signInKeyHash = current.signInKeyHash;
    return entry;
  });
  const assignments = {};
  if (body.assignments !== undefined && (!body.assignments || typeof body.assignments !== "object" || Array.isArray(body.assignments))) throw new DemoError("Invalid assignment data.", 400);
  for (const [id, staffId] of Object.entries(body.assignments ?? {})) {
    if (!seen.has(id) || (staffId !== null && !staffIds.has(staffId))) throw new DemoError("Backup assignments must reference workspaces and staff in the backup.", 400);
    if (staffId !== null) assignments[id] = staffId;
  }
  const settings = {
    maintenanceMode: false, allowWorkspaceReset: true, allowWorkspaceDelete: true, auditRetention: 2000,
  };
  for (const key of ["maintenanceMode", "allowWorkspaceReset", "allowWorkspaceDelete"]) {
    if (body.settings[key] !== undefined) {
      if (typeof body.settings[key] !== "boolean") throw new DemoError(`Invalid ${key} setting.`, 400);
      settings[key] = body.settings[key];
    }
  }
  if (body.settings.auditRetention !== undefined) settings.auditRetention = checkedCents(body.settings.auditRetention, "Audit retention", 250, 5000);
  changes.set("admin-settings.json", settings);
  changes.set("admin-root.json", { ...defaultRootIdentity, name: cleanText(body.root?.name, 120) || defaultRootIdentity.name, email: cleanText(body.root?.email, 200), updatedAt: cleanText(body.root?.updatedAt, 40) || null });
  changes.set("admin-staff.json", { staffs: staff });
  changes.set("admin-assignments.json", assignments);
  return { changes, summary: { workspaces: seen.size, staff: staff.length, assignments: Object.keys(assignments).length } };
}

const manualEntry = (accountId, amount, description, date = day(), category = "Adjustment") => ({
  id: randomBytes(12).toString("hex"), accountId, amount, description, category, date,
  status: "posted", simulated: true, source: "admin_adjustment",
});

function checkedCents(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new DemoError(`${name} must be a valid integer number of cents.`, 400);
  return value;
}

function adjustmentDate(value) {
  if (!isLedgerDate(value) || value > day() || value < "1900-01-01") {
    throw new DemoError("Choose a valid date from January 1, 1900 through today (UTC).", 400);
  }
  return value;
}

function createDatedAccount(state, body, limited = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("Expected account details.", 400);
  if (limited && Object.keys(body).some(key => !["name", "type", "openingDate"].includes(key))) {
    throw new DemoError("Limited admins can create zero-balance accounts only.", 403);
  }
  if (state.suspended || state.status === "suspended") throw new DemoError("Restore workspace access before opening an account.", 409);
  if (state.accounts.length >= 50) throw new DemoError("This workspace has reached its account limit.", 409);
  const id = randomBytes(12).toString("hex");
  const type = { "credit-card": "credit", "auto-loan": "loan", mortgage: "loan" }[body.type] || body.type || "checking";
  if (!(limited ? ["checking", "savings", "credit", "loan"] : ["checking", "savings", "credit", "loan", "cd"]).includes(type)) {
    throw new DemoError("Choose a valid account type.", 400);
  }
  const name = cleanText(body.name, 120);
  if (!name) throw new DemoError("Enter an account name.", 400);
  const last4 = body.last4 ?? String(randomInt(10000)).padStart(4, "0");
  if (typeof last4 !== "string" || !/^\d{4}$/.test(last4)) throw new DemoError("Specify four account digits.", 400);
  const account = {
    id, name, type, last4, openingDate: adjustmentDate(limited ? body.openingDate : body.openingDate ?? day()),
    balance: checkedCents(body.balance ?? 0, "Balance"), limit: checkedCents(body.limit ?? 0, "Limit"), points: checkedCents(body.points ?? 0, "Points"),
  };
  state.accounts.push(account);
  if (account.balance > 0) state.transactions.unshift(manualEntry(account.id, account.balance, "Opening balance", account.openingDate));
  state.updated = new Date().toISOString();
  validateLedgerInvariants(state);
  return account;
}

const generatedDebits = ["Groceries", "Transport", "Dining", "Household", "Utilities"];
function generateWorkspaceActivity(state, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("Expected a generation request.", 400);
  if (state.suspended || state.status === "suspended") throw new DemoError("Restore workspace access before generating activity.", 409);
  const account = state.accounts.find(row => row.id === body.accountId);
  if (!account || !["checking", "savings"].includes(account.type) || !account.openingDate) throw new DemoError("Select a dated checking or savings account.", 400);
  const startDate = adjustmentDate(body.startDate ?? account.openingDate);
  const endDate = adjustmentDate(body.endDate);
  checkOpeningDate(account, startDate);
  if (endDate < startDate) throw new DemoError("End date must be on or after start date.", 400);
  const count = checkedCents(body.count, "Transaction count", 1, 100);
  const requestId = body.requestId;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(requestId)) throw new DemoError("A confirmation identifier is required.", 400);
  const existing = state.generatedBatches?.find(row => row.requestId === requestId);
  if (existing) {
    if (existing.accountId !== account.id || existing.startDate !== startDate || existing.endDate !== endDate || existing.count !== count) throw new DemoError("This confirmation already belongs to another batch.", 409);
    return { batch: existing, created: false };
  }
  if ((state.generatedBatches?.length ?? 0) >= 100) throw new DemoError("The workspace has reached its generation limit.", 409);
  const batch = { requestId, accountId: account.id, startDate, endDate, count };
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
  const rows = [];
  let net = 0;
  for (let index = 0; index < count; index++) {
    const date = day(index === 0 ? 0 : Math.floor(index * days / (count - 1)), startDate);
    // Generated debits can only spend prior generated credits; no existing or held funds are consumed.
    const debit = net >= 500 && randomInt(3) !== 0;
    const amount = debit ? -randomInt(200, Math.min(net, 5000) + 1) : randomInt(2500, 12001);
    const category = debit ? generatedDebits[randomInt(generatedDebits.length)] : "Income";
    net += amount;
    rows.unshift({ ...manualEntry(account.id, amount, `Generated activity: ${category}`, date, category), source: "generated", reference: `generated-${requestId}` });
  }
  changeLedgerBalance(state, account, net);
  state.transactions = [...rows, ...state.transactions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  (state.generatedBatches ||= []).push(batch);
  state.updated = new Date().toISOString();
  validateLedgerInvariants(state);
  return { batch, created: true };
}

function changeLedgerBalance(state, account, delta) {
  if (delta < 0 && -delta > availableBalance(state, account)) throw new DemoError("The adjustment exceeds available funds.", 409);
  account.balance = checkedCents(account.balance + delta, "Account balance");
}

async function mutateAdminLedger(req, res, route) {
  const [, id, collection, itemId] = route;
  const method = req.method;
  if (!(method === "POST" && !itemId) && !(["PUT", "DELETE"].includes(method) && itemId)) throw new DemoError("Method not allowed.", 405);
  requireSameOrigin(req);
  const body = method === "DELETE" ? {} : await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("Expected a JSON object.", 400);
  if (!adminGuard(req, res)) return;
  const file = join(directory, `${id}.json`);
  if (!existsSync(file)) throw new DemoError("Customer workspace not found.", 404);
  const state = JSON.parse(readFileSync(file, "utf8"));
  validateLedgerInvariants(state);
  let action, output;
  if (collection === "accounts") {
    if (method === "POST") {
      const account = createDatedAccount(state, body);
      action = "account_created";
      output = { account };
    } else {
      const account = state.accounts.find(entry => entry.id === itemId);
      if (!account) throw new DemoError("Account not found.", 404);
      if (method === "DELETE") {
        if (!canCloseAccount(state, account)) {
          throw new DemoError("An account with a balance or linked activity cannot be deleted.", 409);
        }
        state.accounts = state.accounts.filter(entry => entry !== account);
        if (state.preferences?.depositDefault === itemId) state.preferences.depositDefault = null;
        action = "account_deleted";
      } else {
        if (Object.hasOwn(body, "openingDate")) throw new DemoError("Opening dates cannot be changed after account creation.", 409);
        for (const key of ["name", "nickname"]) if (Object.hasOwn(body, key)) {
          const value = cleanText(body[key], 120);
          if (key === "name" && !value) throw new DemoError("Account name is required.", 400);
          account[key] = value;
        }
        for (const key of ["limit", "points"]) if (Object.hasOwn(body, key)) account[key] = checkedCents(body[key], key);
        for (const key of ["locked", "autopay", "hidden", "favorite", "primary"]) if (Object.hasOwn(body, key)) {
          if (typeof body[key] !== "boolean") throw new DemoError(`Invalid ${key} value.`, 400);
          account[key] = body[key];
        }
        if (Object.hasOwn(body, "apr")) {
          if (!Number.isFinite(body.apr) || body.apr < 0 || body.apr > 1) throw new DemoError("APR must be between 0 and 1.", 400);
          account.apr = body.apr;
        }
        if (Object.hasOwn(body, "balance")) {
          const delta = checkedCents(body.balance, "Balance") - account.balance;
          if (delta) {
            changeLedgerBalance(state, account, delta);
            state.transactions.unshift(manualEntry(account.id, delta, "Balance adjustment"));
          }
        }
        action = "account_updated";
        output = { account };
      }
    }
  } else {
    const tx = itemId ? state.transactions.find(entry => entry.id === itemId) : null;
    if (itemId && !tx) throw new DemoError("Transaction not found.", 404);
    if (tx && !canEditAdjustment(tx)) throw new DemoError("Only posted manual adjustments can be edited or deleted.", 409);
    const account = state.accounts.find(entry => entry.id === (tx?.accountId ?? body.accountId));
    if (!account) throw new DemoError("Account not found.", 404);
    if (method === "DELETE") {
      changeLedgerBalance(state, account, -tx.amount);
      state.transactions = state.transactions.filter(entry => entry !== tx);
      action = "transaction_deleted";
    } else {
      if (body.status !== undefined && body.status !== "posted") throw new DemoError("Manual adjustments must be posted immediately.", 400);
      const amount = checkedCents(body.amount ?? tx?.amount, "Amount", -10000000, 10000000);
      if (amount === 0) throw new DemoError("Adjustment amount cannot be zero.", 400);
      const date = adjustmentDate(body.date ?? tx?.date ?? day());
      checkOpeningDate(account, date);
      const category = cleanText(body.category, 80) || tx?.category || "Adjustment";
      if (category === "Mobile deposit") throw new DemoError("Use the deposit flow for mobile check deposits.", 400);
      const description = cleanText(body.description, 200) || tx?.description || "Admin adjustment";
      let receipt;
      if (!tx && body.requestId !== undefined) {
        if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(body.requestId)) throw new DemoError("Invalid adjustment confirmation identifier.", 400);
        const fingerprint = digest(JSON.stringify([account.id, amount, date, category, description]));
        const key = digest(body.requestId);
        const prior = state.adjustmentReceipts?.[key];
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new DemoError("This confirmation already belongs to another adjustment.", 409);
          const transaction = state.transactions.find(entry => entry.id === prior.id);
          if (!transaction) throw new DemoError("This adjustment was already posted and then removed.", 409);
          return res.end(JSON.stringify({ success: true, transaction }));
        }
        receipt = { key, fingerprint };
      }
      changeLedgerBalance(state, account, amount - (tx?.amount ?? 0));
      const entry = tx ? Object.assign(tx, { amount, date, category, description }) : manualEntry(account.id, amount, description, date, category);
      if (!tx) state.transactions.unshift(entry);
      if (receipt) (state.adjustmentReceipts ||= {})[receipt.key] = { fingerprint: receipt.fingerprint, id: entry.id };
      output = { transaction: entry };
      action = tx ? "transaction_updated" : "transaction_posted";
    }
  }
  state.updated = new Date().toISOString();
  validateLedgerInvariants(state);
  save(file, state);
  auditAdmin(action, id);
  res.end(JSON.stringify({ success: true, ...output }));
}

function save(file, state) {
  writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

function resetWorkspace(file) {
  const current = JSON.parse(readFileSync(file, "utf8"));
  const state = createWorkspace();
  for (const key of ["customerSessionEpoch", "customerManaged", "customerAccessVersion", "status", "suspended", "created", "createdByLimitedAdminId"]) {
    if (current[key] !== undefined) state[key] = current[key];
  }
  if (current.customerManaged && current.profile) state.profile = current.profile;
  if (state.createdByLimitedAdminId) clearStarterActivity(state);
  save(file, state);
  return state;
}

function getWorkspace(req, res, allowCreate = true) {
  const session = validCustomerSession(req);
  if (session) {
    validateLedgerInvariants(session.state);
    if (settleDue(session.state)) save(session.file, session.state);
    return session;
  }
  if (req.headers["x-demo-session"] === "required") throw new DemoError("Your session has ended. Please sign on again.", 401);
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
      if (state.customerManaged || state.customerSessionEpoch !== undefined) throw new DemoError("A signed-in session is required.", 401);
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
  if (role && !["limited", "root", "administrator", "staff", "viewer"].includes(role)) throw new DemoError("Staff role is invalid.", 400);
  if (role === "limited" && !email) throw new DemoError("Email is required for limited admin sign-in.", 400);
  if (body?.password !== undefined) throw new DemoError("Use a generated access code instead of a password.", 400);
  return { name, email, role: role || "staff", active: body?.active !== false };
}

function adminEpoch() {
  const value = readJsonFile(adminEpochFile, { epoch: 0 });
  return Number.isInteger(value?.epoch) ? value.epoch : 0;
}

function bumpAdminEpoch() {
  rootSessions.clear();
  const epoch = adminEpoch() + 1;
  writeJsonFile(adminEpochFile, { epoch, updatedAt: new Date().toISOString() });
  return epoch;
}

let customerSecret;
function customerSessionSecret() {
  if (customerSecret) return customerSecret;
  const configured = process.env.DEMO_CUSTOMER_TOKEN;
  if (configured && configured.length >= 32) return (customerSecret = configured);
  try {
    writeFileSync(customerKeyFile, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return (customerSecret = readFileSync(customerKeyFile, "utf8"));
}

function customerCookie(req, value, age) {
  const secure = browserUsesHttps(req);
  const attributes = secure ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax";
  return `${CUSTOMER_COOKIE}=${value}; HttpOnly; ${attributes}; Path=/; Max-Age=${age}`;
}

function signCustomerSession(expiry, nonce, workspaceId, epoch) {
  const secret = customerSessionSecret();
  if (!secret) return null;
  const payload = `${expiry}.${nonce}.${workspaceId}.${epoch}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function validCustomerSession(req) {
  const raw = (req.headers.cookie || "").match(/(?:^|;\s*)banking_customer=([^;]+)/)?.[1];
  const decoded = raw || "";
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
  const accountIds = new Map();
  for (const account of state.accounts) {
    if (!account?.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(account.id)) throw new DemoError("Invalid account identifier.", 400);
    if (accountIds.has(account.id)) throw new DemoError("Duplicate account identifier.", 409);
    accountIds.set(account.id, account);
    if (account.openingDate !== undefined) adjustmentDate(account.openingDate);
    if (!Number.isSafeInteger(account.balance)) throw new DemoError("Invalid account balance.", 400);
  }
  const transactionIds = new Set();
  for (const tx of state.transactions) {
    if (!tx?.id) throw new DemoError("Transaction identifier is missing.", 400);
    if (transactionIds.has(tx.id)) throw new DemoError("Duplicate transaction identifier.", 409);
    transactionIds.add(tx.id);
    if (!accountIds.has(tx.accountId)) throw new DemoError("Transaction references an unknown account.", 409);
    checkOpeningDate(accountIds.get(tx.accountId), tx.date);
    if (!Number.isSafeInteger(tx.amount)) throw new DemoError("Invalid transaction amount.", 400);
    if (tx.availableOn !== undefined && (
      tx.category !== "Mobile deposit" || !Number.isSafeInteger(tx.amount) || tx.amount <= 0 ||
      typeof tx.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || !Number.isFinite(Date.parse(tx.date)) ||
      day(0, tx.date) !== tx.date || tx.availableOn !== nextDepositAvailability(tx.date)
    )) throw new DemoError("Invalid deposit availability date.", 400);
  }
  for (const payment of state.payments) {
    if (!payment?.id || !payment?.kind || !["once", "weekly", "monthly"].includes(payment.frequency || "once")) throw new DemoError("Invalid scheduled instruction.", 400);
    if (!Number.isSafeInteger(payment.amount) || payment.amount < 1) throw new DemoError("Invalid scheduled instruction amount.", 400);
    if (typeof payment.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) throw new DemoError("Invalid scheduled instruction date.", 400);
    if (payment?.from && !accountIds.has(payment.from)) throw new DemoError("Scheduled instruction references an unknown source account.", 409);
    if (payment?.to && payment.kind !== "person" && payment.kind !== "wire" && payment.kind !== "bill" && !accountIds.has(payment.to)) throw new DemoError("Scheduled instruction references an unknown destination.", 409);
    checkOpeningDate(accountIds.get(payment.from), payment.date);
    if (["deposit", "transfer", "external", "payment"].includes(payment.kind)) checkOpeningDate(accountIds.get(payment.to), payment.date);
  }
  return true;
}

function revokeCustomerSessions({ file, state }) {
  state.customerSessionEpoch = Number(state.customerSessionEpoch || 0) + 1;
  state.revokedSessionsAt = new Date().toISOString();
  save(file, state);
}

function startCustomerSession(req, res, session) {
  const expiry = Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_SECONDS;
  const cookie = signCustomerSession(expiry, randomBytes(16).toString("hex"), session.workspaceId, session.state.customerSessionEpoch || 1);
  res.setHeader("Set-Cookie", customerCookie(req, cookie, CUSTOMER_SESSION_SECONDS));
  return res.end(JSON.stringify({ authenticated: true, workspaceId: session.workspaceId, expiresAt: new Date(expiry * 1000).toISOString() }));
}

// A disposable preview ledger, never associated with any customer ID, cookie or disk record.
async function embeddedPreviewApi(req, res, path) {
  // Some preview proxies rewrite the upstream Host to the loopback dev server.
  const devHost = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(String(req.headers.host ?? ""));
  if (process.env.NODE_ENV === "production" || (!arenaPreviewHost(req) && !devHost)) throw new DemoError("Not found.", 404);
  const method = req.method;
  const route = path.slice("/api/demo/preview/".length);
  if (!((method === "GET" && ["session", "workspace"].includes(route)) || (method === "POST" && ["session", "action", "exit"].includes(route)))) {
    throw new DemoError("Not found.", 404);
  }
  const now = Date.now();
  for (const [key, session] of previewSessions) if (session.expiresAt <= now) previewSessions.delete(key);
  if (route !== "exit" && adminSettings().maintenanceMode) throw new DemoError("Online banking is temporarily unavailable for maintenance.", 503);
  let command;
  if (method === "POST") {
    requireSameOrigin(req);
    command = await readJsonBody(req);
  }
  if (route === "session" && method === "POST") {
    if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).length !== 0) {
      throw new DemoError("Do not send sign-on details to this service.", 400);
    }
    if (previewSessions.size >= 128) throw new DemoError("Preview sign-in is busy. Please try again later.", 503);
    const token = randomBytes(32).toString("hex");
    previewSessions.set(digest(token), { state: createWorkspace(), expiresAt: Date.now() + PREVIEW_SESSION_MS });
    return res.end(JSON.stringify({ authenticated: true, token }));
  }
  const token = req.headers["x-workspace-preview-session"];
  const key = typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? digest(token) : "";
  const session = previewSessions.get(key);
  if (session && session.expiresAt <= Date.now()) previewSessions.delete(key);
  const active = session && session.expiresAt > Date.now();
  if (route === "session") return res.end(JSON.stringify({ authenticated: Boolean(active) }));
  if (route === "exit") {
    previewSessions.delete(key);
    return res.end(JSON.stringify({ success: true, managed: false }));
  }
  if (!active) throw new DemoError("Your preview session has ended. Please sign in again.", 401);
  settleDue(session.state);
  if (route === "workspace") return res.end(JSON.stringify({ state: session.state }));
  const result = applyAction(session.state, command);
  validateLedgerInvariants(result.state);
  session.state = result.state;
  return res.end(JSON.stringify(result));
}

export async function demoApi(req, res, next) {
  const path = (req.url || "/").split("?")[0];
   if (!path.startsWith("/api/demo/")) return next();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    ensureRestoreRecovered();
    if (path.startsWith("/api/demo/preview/")) return await embeddedPreviewApi(req, res, path);
    if (adminSettings().maintenanceMode && (
      path === "/api/demo/action" || path === "/api/demo/workspace" || path.startsWith("/api/demo/customer-access/") || (path === "/api/demo/session" && req.method === "POST")
    )) throw new DemoError("Online banking is temporarily unavailable for maintenance.", 503);
    if (req.method === "POST" && ["/api/demo/customer-access/claim", "/api/demo/customer-access/session"].includes(path)) {
      return await useCustomerAccess(req, res, path.endsWith("/claim"));
    }
    if (path === "/api/demo/session" && req.method === "GET") {
      const session = validCustomerSession(req);
      res.end(JSON.stringify({ authenticated: Boolean(session), workspaceId: session?.workspaceId || null }));
      return;
    }
    if (path === "/api/demo/session" && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req, 4096);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
        throw new DemoError("Do not send sign-on details to this service.", 400);
      }
      let session = validCustomerSession(req);
      if (!session) {
        const token = randomBytes(24).toString("hex");
        const file = join(directory, `${token}.json`);
        const state = createWorkspace();
        state.customerSessionEpoch = 1;
        save(file, state);
        session = { workspaceId: token, state, file };
      }
      return startCustomerSession(req, res, session);
    }
    if (path === "/api/demo/session" && req.method === "DELETE") {
      requireSameOrigin(req);
      const session = validCustomerSession(req);
      if (session) revokeCustomerSessions(session);
      res.setHeader("Set-Cookie", customerCookie(req, "", 0));
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (path === "/api/demo/workspace" && req.method === "GET") {
      const result = getWorkspace(req, res);
      const id = result.file ? result.file.slice(result.file.lastIndexOf("/") + 1, -5) : null;
      if (id) res.setHeader("X-Demo-Workspace", id);
      res.end(JSON.stringify({ state: result.state, workspaceId: id || result.state.id, status: result.state.status || "active", suspended: Boolean(result.state.suspended), profile: result.state.profile || null }));
      return;
    }
    if (path === "/api/demo/action" && req.method === "POST") {
      requireSameOrigin(req);
      const body = await readJsonBody(req, 4096);
      const { file, state } = getWorkspace(req, res, false);
      const output = applyAction(state, body);
      validateLedgerInvariants(output.state);
      save(file, output.state);
      res.end(JSON.stringify(output));
      return;
    }
    if (path === "/api/demo/exit" && req.method === "POST") {
      requireSameOrigin(req);
      const session = validCustomerSession(req);
      if (session) revokeCustomerSessions(session);
      else if (req.headers["x-demo-session"] !== "required") {
        try { unlinkSync(getWorkspace(req, res, false).file); }
        catch (error) { if (!(error instanceof DemoError)) throw error; }
      }
      res.removeHeader("X-Demo-Workspace");
      res.setHeader("Set-Cookie", [customerCookie(req, "", 0), "banking_demo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"]);
      res.end(JSON.stringify({ success: true, managed: session?.state.customerManaged === true }));
      return;
    }
    throw new DemoError("Not found.", 404);
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(JSON.stringify({ error: error instanceof DemoError ? error.message : "The change could not be saved. Please try again." }));
  }
}
