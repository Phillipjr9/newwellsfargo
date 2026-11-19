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

function configuredAdminSecret() {
  if (process.env.DEMO_ADMIN_TOKEN) {
    if (process.env.NODE_ENV === "production" && process.env.DEMO_ADMIN_TOKEN.length < 32) return null;
    return process.env.DEMO_ADMIN_TOKEN;
  }
  if (process.env.NODE_ENV === "production") return null;
  return "preview-admin";
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
  entries.push({ at: new Date().toISOString(), actor: "super-admin", action, scope: "fictional demo only", workspace: workspace ? `${workspace.slice(0, 8)}…` : null });
  writeFileSync(auditFile, entries.slice(-2000).map(entry => JSON.stringify(entry)).join("\n") + "\n", { mode: 0o600 });
}

function safeWorkspaceSummary(id, state) {
  const deposits = state.accounts.filter(account => ["checking", "savings"].includes(account.type));
  const scheduled = state.payments.filter(payment => payment.status === "scheduled");
  const latest = [...state.payments].sort((a, b) => (b.created || "").localeCompare(a.created || ""))[0];
  return {
    id,
    label: `Demo ${id.slice(0, 8).toUpperCase()}`,
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
    sampleProfile: state.profile?.name === "Henry Johnson" ? "Sample customer" : "Sample profile",
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

function auditEntries() {
  try {
    return readFileSync(auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-250)
      .reverse()
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
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
        demoHint: process.env.NODE_ENV === "production" ? null : "preview-admin",
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
      res.end(JSON.stringify({ workspaces, totals: { ...totals, workspaces: workspaces.length }, dailyActivity, audit: auditEntries().slice(0, 12), readOnly: true }));
      return;
    }
    if (req.method === "GET" && path === "/api/admin/audit") {
      res.end(JSON.stringify({ entries: auditEntries() }));
      return;
    }
    const match = path.match(/^\/api\/admin\/workspaces\/([a-f0-9]{48})(?:\/(reset))?$/);
    if (!match) throw new DemoError("Not found.", 404);
    const [, id, action] = match;
    const file = join(directory, `${id}.json`);
    if (!existsSync(file)) throw new DemoError("Demo workspace not found.", 404);
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
      await publicPost(req);
      const state = createWorkspace();
      save(file, state);
      auditAdmin("demo_workspace_reset", id);
      res.end(JSON.stringify({ success: true, summary: summarizeWorkspace(id, state) }));
      return;
    }
    if (req.method === "DELETE" && !action) {
      requireSameOrigin(req);
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
      "This demo session has ended. Refresh the page to start a new workspace.",
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
    if (
      req.method !== "POST" ||
      !["/api/demo/action", "/api/demo/exit"].includes(path)
    )
      throw new DemoError("Not found.", 404);
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new DemoError("Cross-site requests are not allowed.", 403);
    if (
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      throw new DemoError("Origin mismatch.", 403);
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new DemoError("Use JSON for demo operations.", 415);
    if (path === "/api/demo/exit") {
      const { file } = getWorkspace(req, res, false);
      unlinkSync(file);
      res.removeHeader("X-Demo-Workspace");
      res.setHeader(
        "Set-Cookie",
        "banking_demo=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
      res.end(JSON.stringify({ success: true }));
      return;
    }
    let body = "";
    for await (const part of req) {
      body += part;
      if (Buffer.byteLength(body) > 4096)
        throw new DemoError("Request too large.", 413);
    }
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      throw new DemoError("Invalid JSON.", 400);
    }
    // Keep the read, validation and atomic replace together; no await between them.
    const { file, state } = getWorkspace(req, res, false);
    const output = applyAction(state, command);
    save(file, output.state);
    res.end(JSON.stringify(output));
  } catch (error) {
    res.statusCode = error instanceof DemoError ? error.code : 500;
    res.end(
      JSON.stringify({
        error:
          error instanceof DemoError
            ? error.message
            : "The demo could not save this change. Please try again.",
      }),
    );
  }
}
