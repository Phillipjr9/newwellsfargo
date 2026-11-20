import { useCallback, useEffect, useState, type FormEvent } from "react";
import SiteFooter from "../components/SiteFooter";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  Clock3,
  Eye,
  History as HistoryIcon,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import wordmark from "../assets/wf-logo.png";
import { useRouter } from "../router/RouterContext";
import { dateLabel, money } from "../portal/model";
import { day } from "../../shared/ledger.mjs";
import "./admin.css";

interface WorkspaceSummary {
  id: string;
  label: string;
  created: string;
  updated: string;
  accountCount: number;
  transactionCount: number;
  paymentCount: number;
  scheduledCount: number;
  sampleDepositTotal: number;
  checkingBalances: number;
  savingsBalances: number;
  completedToday: number;
  todayOutflow: number;
  lastPayment: { kind: string; status: string; date: string } | null;
}

function DepositMix({ checking, savings }: { checking: number; savings: number }) {
  const total = checking + savings;
  const divider = total > 0 ? (checking / total) * 100 : 50;
  return (
    <div className="ad-deposit-panel">
      <div className="ad-deposit-chart" style={{ background: `conic-gradient(#81283c 0%, #81283c ${divider}%, #c18b5f ${divider}%, #c18b5f 100%)` }}>
        <div className="ad-deposit-hole"><small>Deposit balances</small><strong>{money(total)}</strong><span>Workspace balances</span></div>
      </div>
      <div className="ad-deposit-legend">
        <div><i className="checking"/><span>Checking</span><strong>{money(checking)}</strong></div>
        <div><i className="savings"/><span>Savings</span><strong>{money(savings)}</strong></div>
      </div>
    </div>
  );
}

interface AdminData {
  workspaces: WorkspaceSummary[];
  totals: {
    accounts: number;
    transactions: number;
    payments: number;
    scheduled: number;
    demoDeposits: number;
    checkingBalances: number;
    savingsBalances: number;
    completedToday: number;
    todayOutflow: number;
    workspaces: number;
  };
  dailyActivity: { date: string; count: number }[];
  audit: AuditEntry[];
  telemetry?: { node: string; uptimeSeconds: number; ledgerFiles: number; auditEntries: number; memoryBytes: number; heapUsedBytes: number; maintenanceMode: boolean; externalMoneyRails: string };
  readOnly: true;
}

interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  scope: string;
  workspace: string | null;
}

interface WorkspaceHistoryEntry {
  id: string;
  at: string;
  action: string;
  actor: string;
  details?: { amount?: number; actorName?: string; previousOwnerName?: string | null; nextOwnerName?: string | null };
}

interface WorkspaceHistoryData {
  entries: WorkspaceHistoryEntry[];
  hasMore: boolean;
}

interface StaffEntry {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  signInEnabled: boolean;
  fundingAvailable: number;
}

interface RootIdentity {
  id: "root";
  name: string;
  email: string;
  role: "root";
  active: boolean;
}

interface WorkspaceDetail {
  summary: WorkspaceSummary;
  canFund?: boolean;
  accounts: { id: string; name: string; type: string; last4: string; balance: number; limit?: number; points?: number; openingDate?: string }[];
  recentPayments: { id: string; kind: string; status: string; amount: number; date: string; toName: string }[];
}

type Page = "overview" | "workspaces" | "customers" | "transactions" | "messages" | "activity" | "settings";

interface AdminSession {
  authenticated: boolean;
  adminEnabled: boolean;
}


class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminRequestError(body.error || "Admin request failed. Please try again.", response.status);
  return body as T;
}

function stamp(date: string | undefined) {
  if (!date) return "Just now";
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function Trend({ rows }: { rows: AdminData["dailyActivity"] }) {
  const data = rows.map(row => ({ ...row, key: row.date, label: new Date(`${row.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) }));
  while(data.length < 7) data.unshift({ date: "", key: `empty-${data.length}`, count: 0, label: "" });
  const max = Math.max(...data.map(d => d.count), 1);
  return <div className="ad-trend-chart"><div className="ad-chart-lines"><i/><i/><i/></div><svg viewBox="0 0 560 170" preserveAspectRatio="none" role="img" aria-label="Transaction counts for the last seven days">
    <defs><linearGradient id="admin-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#902e43" stopOpacity=".18"/><stop offset="1" stopColor="#902e43" stopOpacity=".015"/></linearGradient></defs>
    <path d={`M ${data.map((d, i) => `${i * 93 + 6},${145 - (d.count / max) * 111}`).join(" L ")} L 564 170 L 6 170 Z`} fill="url(#admin-area-fill)"/>
    <path d={`M ${data.map((d, i) => `${i * 93 + 6},${145 - (d.count / max) * 111}`).join(" L ")}`} fill="none" stroke="#842b3f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    {data.map((d, i) => <circle key={d.key} cx={i * 93 + 6} cy={145 - (d.count / max) * 111} r="4" fill="#fff" stroke="#842b3f" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}
  </svg><div className="ad-chart-labels">{data.map(d => <span key={d.key}>{d.label}</span>)}</div></div>;
}

function Login({ enabled, statusError, onLogin, onLeave }: { enabled: boolean; statusError: string; onLogin: () => void; onLeave?: (url: string) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cookieError, setCookieError] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setCookieError(false);
    try {
      await api("session", { method: "POST", body: JSON.stringify({ token }) });
      const status = await api<AdminSession>("session");
      if (!status.authenticated) { setCookieError(true); setError("This browser didn't keep your admin session."); return; }
      setToken("");
      onLogin();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Admin access unavailable."); }
    finally { setBusy(false); }
  }
  return <main className="ad-login-screen">
    <section className="ad-login-card">
      <div className="ad-login-brand"><img src={wordmark} alt="Wells Fargo"/><span>Super administration</span></div>
      <div className="ad-security-badge"><LockKeyhole size={16}/> RESTRICTED ACCESS</div>
      <h1>Administration</h1>
      <p className="ad-login-copy">Manage the banking workspace administration console. This console is separate from Wells Fargo production systems and customer accounts.</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-access-token">Admin access code</label>
        <input id="admin-access-token" name="admin-code" type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} placeholder="Enter server access code"/>
        {error && <p className="ad-login-error" role="alert">{error}{cookieError && <> <a href={window.location.href} target="_blank" rel="noopener noreferrer">Open admin sign-in in a new tab</a> and try again.</>}</p>}
        <button className="ad-primary-btn" disabled={!enabled || busy}>{busy ? "Verifying…" : "Open admin console"}<ArrowRight size={16}/></button>
      </form>
      {!enabled && <p className="ad-demo-hint">{statusError || "Configure the server access code to enable admin access."}</p>}
      <p className="ad-login-foot"><ShieldCheck size={15}/> Activity is limited to configured workspaces.</p>
      <a className="ad-link-btn" href="/admin/limited">Limited admin sign-in</a>
    </section>
    <SiteFooter onLeave={onLeave || (() => {})}/>
  </main>;
}

function Overview({ data, onSelect }: { data: AdminData; onSelect: (id: string) => void }) {
  const kpis = [
    { label: "Workspaces", value: data.totals.workspaces.toLocaleString(), delta: "Active workspace inventory", icon: UsersRound, tone: "wine" },
    { label: "Accounts", value: data.totals.accounts.toLocaleString(), delta: "Across all workspaces", icon: CreditCard, tone: "blue" },
    { label: "Payments processed today", value: data.totals.completedToday.toLocaleString(), delta: `${money(data.totals.todayOutflow)} payment outflow`, icon: ArrowUpRight, tone: "green" },
    { label: "Pending schedules", value: data.totals.scheduled.toLocaleString(), delta: "Not real or bank-submitted", icon: Clock3, tone: "gold" },
  ];
  return <>
    <div className="ad-page-intro"><div><p className="ad-eyebrow">OPERATIONS</p><h1>System overview</h1><p>Live aggregates from workspace activity. No real customers or accounts are processed.</p></div><span className="ad-live"><i/> Local administration API</span></div>
    <section className="ad-kpis">{kpis.map(({label,value,delta,icon:Icon,tone})=><article className="ad-kpi" key={label}><span className={`ad-kpi-icon ${tone}`}><Icon size={19}/></span><span className="ad-kpi-title">{label}</span><strong>{value}</strong><small>{delta}</small></article>)}</section>
    <div className="ad-main-grid">
      <section className="ad-panel ad-trend-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">BANKING PLATFORM</p><h2>Ledger activity</h2></div><span className="ad-select-label">Last 7 days</span></div><Trend rows={data.dailyActivity}/><div className="ad-chart-legend"><span><i/> Transaction entries dated that day</span><span>Workspace ledger only · not bank traffic</span></div></section>
      <section className="ad-panel ad-platform-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">WORKSPACE STATUS</p><h2>Environment status</h2></div><ShieldCheck size={19} className="ad-ok"/></div><div className="ad-environment"><span>Public website</span><strong><i/> Read-only source pages</strong></div><div className="ad-environment"><span>Ledger API</span><strong><i/> Operational</strong></div><div className="ad-environment"><span>External money rails</span><strong className="ad-disabled"><i/> Disabled</strong></div><div className="ad-demo-note"><ShieldCheck size={16}/><span>Balances, recipients, and transactions are workspace records.</span></div></section>
    </div>
    <section className="ad-panel ad-balance-mix"><div className="ad-panel-head"><div><p className="ad-eyebrow">DEPOSIT OVERVIEW</p><h2>Deposit balances</h2></div><span className="ad-readonly-pill"><Eye size={13}/> Anonymized workspace aggregates</span></div><DepositMix checking={data.totals.checkingBalances} savings={data.totals.savingsBalances}/></section>
    <section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">SESSION INVENTORY</p><h2>Recent workspaces</h2></div><a className="ad-link-btn" href="/admin/workspaces">All workspaces<ArrowRight size={14}/></a></div><WorkspaceTable rows={data.workspaces.slice(0,6)} onSelect={onSelect}/></section>
  </>;
}

function WorkspaceTable({ rows, onSelect, search = "" }: { rows: WorkspaceSummary[]; onSelect: (id: string) => void; search?: string }) {
  const filtered = rows.filter(w => `${w.label} ${w.id}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>WORKSPACE</th><th>ACCOUNTS</th><th>LEDGER ENTRIES</th><th>PAYMENTS</th><th>SCHEDULED</th><th>LAST UPDATED</th><th/></tr></thead><tbody>
    {filtered.map(w=><tr key={w.id}><td><button className="ad-workspace-link" onClick={()=>onSelect(w.id)}><span className="ad-workspace-dot" aria-hidden="true">D</span><span><strong>{w.label}</strong><small>Customer workspace</small></span></button></td><td>{w.accountCount}</td><td>{w.transactionCount}</td><td>{w.paymentCount}</td><td><span className={`ad-count-pill ${w.scheduledCount ? "scheduled" : ""}`}>{w.scheduledCount}</span></td><td>{stamp(w.updated)}</td><td><button className="ad-table-arrow" aria-label={`View ${w.label}`} onClick={()=>onSelect(w.id)}><ArrowRight size={16}/></button></td></tr>)}
    {filtered.length===0 && <tr><td colSpan={7} className="ad-empty-table">No workspaces match.</td></tr>}
  </tbody></table></div>;
}

function Workspaces({ rows, onSelect, refresh }: { rows: WorkspaceSummary[]; onSelect: (id: string) => void; refresh: () => void }) {
  const [search,setSearch]=useState("");
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">OPERATIONS</p><h1>Workspaces</h1><p>Inspect aggregate metadata for workspace sessions.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh inventory</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>All workspaces <span className="ad-table-count">{rows.length}</span></h2></div><label className="ad-searchbox"><Search size={15}/><input aria-label="Search workspace IDs" placeholder="Search workspace ID" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><WorkspaceTable rows={rows} onSelect={onSelect} search={search}/></section><p className="ad-safe-foot"><LockKeyhole size={14}/> Customer names, messages, account identifiers, and transaction descriptions are not exposed.</p></>;
}

function WorkspaceRecords({ details }: { details: WorkspaceDetail }) {
  return <><p className="ad-tenant-disclaimer"><ShieldCheck size={15}/>Customer profile and workspace balances.</p><div className="ad-detail-metrics"><span><small>Accounts</small><strong>{details.summary.accountCount}</strong></span><span><small>Transactions</small><strong>{details.summary.transactionCount}</strong></span><span><small>Schedules</small><strong>{details.summary.scheduledCount}</strong></span><span><small>Deposits</small><strong>{money(details.summary.sampleDepositTotal)}</strong></span></div>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Accounts</h3><Eye size={15}/></div>{details.accounts.map(a=><div className="ad-detail-row" key={a.id}><span><strong>{a.name}</strong><small>{a.type} ····{a.last4}{a.openingDate && ` · Opened ${dateLabel(a.openingDate, true)}`}</small></span><b>{money(a.balance)}</b></div>)}</section>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Recent payments</h3><Activity size={15}/></div>{details.recentPayments.length?details.recentPayments.map(p=><div className="ad-detail-row" key={p.id}><span><strong>{p.toName}</strong><small>{p.kind} · {p.status} · {p.date}</small></span><b>{money(p.amount)}</b></div>):<p className="ad-muted-empty">No payments yet.</p>}</section>
  </>;
}

const historyTitles: Record<string, string> = {
  customer_created: "Workspace created",
  customer_updated: "Customer profile updated",
  customer_revoke_sessions: "Customer sessions ended",
  customer_owner_assigned: "Assignment changed",
  customer_suspend: "Access suspended",
  customer_access_restored: "Access restored",
  support_message_sent: "Support message sent",
  staff_offboarded: "Assignment changed during staff offboarding",
  demo_workspace_reset: "Workspace reset",
  customer_invitation_issued: "Workspace invitation issued",
  customer_access_recovery_issued: "Workspace recovery invitation issued",
  customer_invitation_accepted: "Workspace invitation accepted",
  account_created: "Account opened",
  account_updated: "Account updated",
  account_deleted: "Account closed",
  transaction_posted: "Manual adjustment posted",
  transaction_updated: "Manual adjustment corrected",
  transaction_deleted: "Manual adjustment removed",
  customers_bulk_suspend: "Access suspended in bulk",
  customers_bulk_activate: "Access restored in bulk",
  customers_bulk_reassign: "Assignment changed in bulk",
  transactions_generated: "Workspace transactions generated",
  staff_funding_allocated: "Customer account funded",
};

function WorkspaceHistory({ history }: { history: WorkspaceHistoryData }) {
  const [open, setOpen] = useState(false);
  return <details className="ad-detail-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Workspace history</summary>
    {open && <>
      {!history.entries.length && <p className="ad-muted-empty">No recorded administrator activity for this workspace.</p>}
      {history.entries.map(entry => <div className="ad-detail-row" key={entry.id}>
        <span>
          <strong>{historyTitles[entry.action] ?? entry.action.replace(/_/g, " ")}</strong>
          {entry.details && "nextOwnerName" in entry.details && <small>{entry.details.previousOwnerName ?? "Unassigned"} → {entry.details.nextOwnerName ?? "Unassigned"}</small>}
          {entry.details?.amount !== undefined && <small>{money(entry.details.amount)}</small>}
          <small>{entry.details?.actorName ?? (entry.actor === "super-admin" ? "Super administrator" : entry.actor === "workspace-customer" ? "Workspace customer" : entry.actor)}</small>
        </span>
        <time className="ad-detail-stamp" dateTime={entry.at}>{stamp(entry.at)}</time>
      </div>)}
      {history.hasMore && <p className="ad-detail-stamp">Showing the 50 most recent events.</p>}
    </>}
  </details>;
}

type CustomerAccess = { status: "not_enrolled" | "invited" | "expired" | "enrolled"; expiresAt?: string; suspended: boolean };
type CustomerProfile = { name: string; email: string };
type SuperWorkspaceDetail = WorkspaceDetail & { history: WorkspaceHistoryData; access: CustomerAccess; profile: CustomerProfile;
  accountControls: { id: string; nickname: string; canClose: boolean }[];
};

function CustomerAccessControls({ id, access, onIssued }: { id: string; access: CustomerAccess; onIssued: (access: CustomerAccess) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const statusLabels = { not_enrolled: "Not enrolled", invited: "Invitation pending", expired: "Invitation expired", enrolled: "Enrolled" };
  const action = access.status === "enrolled" ? "Issue recovery invitation" : access.status === "not_enrolled" ? "Issue invitation" : "Replace invitation";

  async function issue() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ code: string; access: CustomerAccess }>(`customers/${id}/invitation`, { method: "POST", body: JSON.stringify({ status: access.status }) });
      setCode(result.code);
      onIssued(result.access);
      setConfirm(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not issue the workspace invitation."); }
    finally { setBusy(false); }
  }

  return <section className="ad-detail-section ad-setting-card" aria-label="Customer sign-in access">
    <h3>Customer sign-in access</h3>
    <p>{statusLabels[access.status]}{access.expiresAt && ` · Expires ${stamp(access.expiresAt)}`}</p>
    {access.suspended && <p>Restore workspace access before issuing an invitation.</p>}
    {error && <p className="ad-alert" role="alert">{error}</p>}
    {code ? <>
      <p>Share this single-use code privately with the intended customer. It expires in 24 hours and won’t be shown again after dismissal.</p>
      <label>Invitation code<input readOnly value={code} onFocus={event => event.target.select()}/></label>
      <p>Customer entry: <a className="ad-link-btn" href="/portal/access" target="_blank" rel="noreferrer">Workspace access</a></p>
      <button className="ad-outline-btn" onClick={() => setCode("")}>Dismiss invitation code</button>
    </> : confirm ? <>
      <p>This ends any current customer sessions and replaces any previous invitations or access code. It does not change workspace balances or activity.</p>
      <div className="ad-inline-actions"><button className="ad-outline-btn" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button className="ad-primary-small" disabled={busy} onClick={() => void issue()}>Confirm invitation</button></div>
    </> : <button className="ad-outline-btn" disabled={access.suspended} onClick={() => { setError(""); setConfirm(true); }}>{action}</button>}
  </section>;
}

function fundingCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return 0;
  const [dollars, cents = ""] = value.split(".");
  const amount = Number(`${dollars}${cents.padEnd(2, "0")}`);
  return Number.isSafeInteger(amount) ? amount : 0;
}

function FundingForm({ endpoint, accounts, onDone, disabled }: {
  endpoint: string;
  accounts?: WorkspaceDetail["accounts"];
  onDone: (result: { admin?: StaffEntry; fundingAvailable?: number }) => void;
  disabled?: boolean;
}) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ payload: string; id: string } | null>(null);
  const cents = fundingCents(amount);
  const accountId = accounts?.some(account => account.id === target) ? target : accounts?.[0]?.id;
  const ready = cents > 0 && (!accounts || accountId) && !disabled;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true); setError("");
    const payload = JSON.stringify({ amount: cents, accountId });
    try {
      const requestId = accounts ? (retry?.payload === payload ? retry.id : crypto.randomUUID()) : undefined;
      if (requestId) setRetry({ payload, id: requestId });
      const result = await api<{ admin?: StaffEntry; fundingAvailable?: number }>(endpoint, {
        method: "POST", body: JSON.stringify({ amount: cents, accountId, requestId }),
      });
      setAmount(""); setRetry(null); onDone(result);
    } catch (e) { setError(e instanceof Error ? e.message : "The funding request failed."); }
    finally { setBusy(false); }
  }
  return <form className="ad-setting-card" onSubmit={submit}>
    {accounts && <label>Funding account<select value={accountId ?? ""} onChange={event => setTarget(event.target.value)} disabled={busy || disabled}>
      {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.last4}</option>)}
    </select></label>}
    <label>{accounts ? "Funding amount (USD)" : "Budget grant (USD)"}<input type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy || disabled}/></label>
    {error && <p className="ad-alert" role="alert">{error}</p>}
    <button className="ad-primary-small" disabled={busy || !ready}>{accounts ? "Fund customer account" : "Add to funding budget"}</button>
  </form>;
}

function OpenAccountForm({ endpoint, allowBalance = false, disabled, onChanged }: {
  endpoint: string;
  allowBalance?: boolean;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [date, setDate] = useState(day);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ account: { name: string } }>(endpoint, { method: "POST", body: JSON.stringify({
        name: name.trim(), type, openingDate: date, ...(allowBalance && amount !== "" ? { balance: Math.round(Number(amount) * 100) } : {}),
      }) });
      setNotice(`${result.account.name} opened.`);
      setName(""); setAmount("");
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open this account."); }
    finally { setBusy(false); }
  }
  return <details className="ad-detail-section ad-setting-card shrink-0">
    <summary>Open an account</summary>
    {disabled ? <p>Restore workspace access before opening an account.</p> : <form onSubmit={submit}>
      <label>Account name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)}/></label>
      <label>Account type<select value={type} onChange={event => setType(event.target.value)}>
        <option value="checking">Checking</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="loan">Loan</option>
      </select></label>
      <label>Opening date<input required type="date" min="1900-01-01" max={day()} value={date} onChange={event => setDate(event.target.value)}/></label>
      {allowBalance ? <label>Opening balance (USD)<input type="number" min={0} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00"/></label> : <p>Limited admins can open accounts with a zero starting balance.</p>}
      {error && <p className="ad-alert" role="alert">{error}</p>}
      {notice && <p className="ad-success" role="status">{notice}</p>}
      <button className="ad-primary-small" disabled={busy || !name.trim() || !date}>{busy ? "Opening…" : "Open account"}</button>
    </form>}
  </details>;
}

function GenerateActivityForm({ id, accounts, disabled, onChanged }: { id: string; accounts: WorkspaceDetail["accounts"]; disabled: boolean; onChanged: () => void }) {
  const eligible = accounts.filter(account => account.openingDate && ["checking", "savings"].includes(account.type));
  const [accountId, setAccountId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(day);
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryKey, setRetryKey] = useState<{ payload: string; id: string } | null>(null);
  const account = eligible.find(item => item.id === accountId) ?? eligible[0];
  const start = startDate || account?.openingDate || "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account || busy || disabled) return;
    setBusy(true); setError(""); setNotice("");
    const request = { accountId: account.id, startDate: start, endDate, count: Number(count) };
    const payload = JSON.stringify(request);
    const requestId = retryKey?.payload === payload ? retryKey.id : crypto.randomUUID();
    setRetryKey({ payload, id: requestId });
    try {
      const result = await api<{ count: number }>(`workspaces/${id}/transactions/generate`, { method: "POST", body: JSON.stringify({ ...request, requestId }) });
      setNotice(`${result.count} generated ${result.count === 1 ? "transaction added" : "transactions added"}.`);
      setRetryKey(null);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate activity."); }
    finally { setBusy(false); }
  }
  return <details className="ad-detail-section ad-setting-card shrink-0">
    <summary>Generate transactions</summary>
    <p>Creates labeled generated activity and updates the workspace balance. The start date defaults to the account opening date.</p>
    {disabled ? <p>Restore workspace access before generating activity.</p> : !account ? <p>Open a checking or savings account with an opening date first.</p> : <form onSubmit={submit}>
      <label>Account for generated activity<select value={account.id} onChange={event => { setAccountId(event.target.value); setStartDate(""); }}>
        {eligible.map(item => <option key={item.id} value={item.id}>{item.name} ····{item.last4}</option>)}
      </select></label>
      <label>Start date<input type="date" required min={account.openingDate} max={day()} value={start} onChange={event => setStartDate(event.target.value)}/></label>
      <label>End date<input type="date" required min={start} max={day()} value={endDate} onChange={event => setEndDate(event.target.value)}/></label>
      <label>Transaction count<input type="number" required min="1" max="100" step="1" value={count} onChange={event => setCount(event.target.value)}/></label>
      {error && <p className="ad-alert" role="alert">{error}</p>}
      {notice && <p className="ad-success" role="status">{notice}</p>}
      <button className="ad-primary-small" disabled={busy || !start || !endDate || !count}>{busy ? "Generating…" : "Generate transactions"}</button>
    </form>}
  </details>;
}

function CustomerProfileControls({ id, profile, enrolled, onChanged }: {
  id: string; profile: CustomerProfile; enrolled: boolean; onChanged: (profileChanged: boolean) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (busy || confirm) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const { customer } = await api<{ customer: { profile: CustomerProfile } }>(`customers/${id}`, {
        method: "PUT", body: JSON.stringify({ name, email }),
      });
      setName(customer.profile.name); setEmail(customer.profile.email);
      setNotice("Customer profile saved."); onChanged(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the customer profile."); }
    finally { setBusy(false); }
  }

  async function endSessions() {
    if (busy || !confirm) return;
    setBusy(true); setNotice(""); setError("");
    try {
      await api(`customers/${id}/revoke-sessions`, { method: "POST", body: "{}" });
      setConfirm(false); setNotice("Customer sessions ended."); onChanged(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not end customer sessions."); }
    finally { setBusy(false); }
  }
  return <details className="ad-detail-section ad-setting-card shrink-0">
    <summary>Customer profile</summary>
    <form onSubmit={saveProfile}>
      <label>Customer name<input maxLength={120} required value={name} onChange={e => setName(e.target.value)}/></label>
      <label>Customer email<input maxLength={200} type="email" value={email} onChange={e => setEmail(e.target.value)}/></label>
      <p>Changing the contact email does not change how the customer signs in.</p>
      <button className="ad-primary-small" disabled={busy || confirm || !name.trim() || (name === profile.name && email === profile.email)}>Save customer profile</button>
    </form>
    {enrolled && (confirm ? <div>
      <p>End all current sessions for this customer? Their existing access code will still work.</p>
      <div className="ad-inline-actions"><button type="button" className="ad-outline-btn" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="ad-danger-btn" disabled={busy} onClick={endSessions}>Confirm end sessions</button></div>
    </div> : <button type="button" className="ad-outline-btn" disabled={busy} onClick={() => setConfirm(true)}>End customer sessions</button>)}
    {error && <p role="alert" className="ad-alert">{error}</p>}
    {notice && <p role="status" className="ad-success">{notice}</p>}
  </details>;
}

function ManageAccounts({ id, details, onChanged }: { id: string; details: SuperWorkspaceDetail; onChanged: () => void }) {
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const account = details.accounts.find(item => item.id === selected);
  const controls = details.accountControls.find(item => item.id === selected);
  return <details className="ad-detail-section ad-setting-card shrink-0">
    <summary>Manage accounts</summary>
    {!details.accounts.length ? <p>No accounts to manage.</p> : <label>Account to manage<select value={account?.id ?? ""} onChange={e => { setSelected(e.target.value); setNotice(""); }}>
      <option value="">Choose an account</option>
      {details.accounts.map(item => <option key={item.id} value={item.id}>{item.name} ····{item.last4}</option>)}
    </select></label>}
    {account && controls && <EditAccount key={account.id} id={id} account={account} controls={controls} onDone={closed => {
      setNotice(closed ? "Account closed." : "Account details saved.");
      if (closed) setSelected("");
      onChanged();
    }}/>}
    {notice && <p role="status" className="ad-success">{notice}</p>}
  </details>;
}

function EditAccount({ id, account, controls, onDone }: { id: string; account: WorkspaceDetail["accounts"][number];
  controls: SuperWorkspaceDetail["accountControls"][number]; onDone: (closed: boolean) => void }) {
  const [name, setName] = useState(account.name);
  const [nickname, setNickname] = useState(controls.nickname);
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(close: boolean) {
    if (busy || (close && (!confirmation || !controls.canClose))) return;
    setBusy(true); setError("");
    try {
      await api(`users/${id}/accounts/${account.id}`, { method: close ? "DELETE" : "PUT", body: JSON.stringify(close ? {} : { name: name.trim(), nickname: nickname.trim() }) });
      if (!close) { setName(name.trim()); setNickname(nickname.trim()); }
      setConfirmation(false); onDone(close);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update this account."); }
    finally { setBusy(false); }
  }
  return <>
    <form onSubmit={e => { e.preventDefault(); void update(false); }}>
      <label>Edit account name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy || confirmation}/></label>
      <label>Account nickname<input maxLength={120} value={nickname} onChange={e => setNickname(e.target.value)} disabled={busy || confirmation}/></label>
      <button className="ad-primary-small" disabled={busy || confirmation || !name.trim()}>Save account details</button>
    </form>
    {!controls.canClose ? <p>Only zero-balance accounts without linked activity can be closed.</p> : confirmation ? <div>
      <p>Close {account.name}? This removes the account from the workspace.</p>
      <div className="ad-inline-actions"><button className="ad-outline-btn" disabled={busy} onClick={() => setConfirmation(false)}>Cancel</button><button className="ad-danger-btn" disabled={busy} onClick={() => void update(true)}>Confirm close account</button></div>
    </div> : <button className="ad-outline-btn" disabled={busy} onClick={() => setConfirmation(true)}>Close account</button>}
    {error && <p role="alert" className="ad-alert">{error}</p>}
  </>;
}

type AdminTransaction = { id: string; workspaceId: string; accountId: string; accountName: string; openingDate?: string;
  date: string; description: string; category: string; status: string; source?: string; amount: number; editable: boolean };

function AdjustmentForm({ id, accounts, transaction, onSaved, onCancel }: {
  id: string; accounts?: WorkspaceDetail["accounts"]; transaction?: AdminTransaction; onSaved: (removed: boolean) => void; onCancel?: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState(transaction && transaction.amount < 0 ? "decrease" : "increase");
  const [amount, setAmount] = useState(transaction ? (Math.abs(transaction.amount) / 100).toFixed(2) : "");
  const [date, setDate] = useState(transaction?.date || day());
  const [description, setDescription] = useState(transaction?.description || "");
  const [category, setCategory] = useState(transaction?.category || "Adjustment");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ payload: string; id: string } | null>(null);
  const target = accounts?.find(item => item.id === accountId) ?? accounts?.[0];
  const cents = fundingCents(amount);
  const endpoint = `users/${id}/transactions${transaction ? `/${transaction.id}` : ""}`;
  async function submit(remove: boolean) {
    if (busy || (remove ? !confirmation : confirmation || !cents || (!target && !transaction))) return;
    setBusy(true); setError("");
    try {
      const details = { accountId: target?.id, amount: direction === "increase" ? cents : -cents, date, description, category };
      const payload = JSON.stringify(details);
      const requestId = transaction ? undefined : retry?.payload === payload ? retry.id : crypto.randomUUID();
      if (requestId) setRetry({ payload, id: requestId });
      await api(endpoint, { method: remove ? "DELETE" : transaction ? "PUT" : "POST", body: JSON.stringify(remove ? {} : { ...details, requestId }) });
      if (!transaction) { setAmount(""); setDescription(""); setRetry(null); }
      onSaved(remove);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this adjustment."); }
    finally { setBusy(false); }
  }
  return <div className="ad-setting-card">
    <form onSubmit={e => { e.preventDefault(); void submit(false); }}>
      <fieldset disabled={busy || confirmation}>
        {accounts && <label>Adjustment account<select value={target?.id ?? ""} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name} ····{account.last4}</option>)}
        </select></label>}
        {transaction && <p>Account: {transaction.accountName}</p>}
        <label>Balance change<select value={direction} onChange={e => setDirection(e.target.value)}><option value="increase">Increase recorded balance</option><option value="decrease">Decrease recorded balance</option></select></label>
        <label>Adjustment amount (USD)<input type="number" required min="0.01" max="100000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label>
        <label>Adjustment date<input type="date" required min={target?.openingDate ?? transaction?.openingDate ?? "1900-01-01"} max={day()} value={date} onChange={e => setDate(e.target.value)}/></label>
        <label>Adjustment description<input required maxLength={200} value={description} onChange={e => setDescription(e.target.value)}/></label>
        <label>Adjustment category<input required maxLength={80} value={category} onChange={e => setCategory(e.target.value)}/></label>
        <button className="ad-primary-small" disabled={!cents || !description.trim()}>{transaction ? "Save correction" : "Post manual adjustment"}</button>
      </fieldset>
    </form>
    {transaction && (confirmation ? <div><p>Remove this adjustment and reverse its effect on the balance?</p><div className="ad-inline-actions">
      <button className="ad-outline-btn" disabled={busy} onClick={() => setConfirmation(false)}>Keep adjustment</button><button className="ad-danger-btn" disabled={busy} onClick={() => void submit(true)}>Confirm remove adjustment</button>
    </div></div> : <div className="ad-inline-actions"><button className="ad-outline-btn" disabled={busy} onClick={onCancel}>Cancel correction</button><button className="ad-danger-btn" disabled={busy} onClick={() => setConfirmation(true)}>Remove adjustment</button></div>)}
    {error && <p role="alert" className="ad-alert">{error}</p>}
  </div>;
}

function WorkspaceDetails({ id, onClose, refresh, onProfileChanged }: { id: string; onClose: () => void; refresh: () => void; onProfileChanged: () => void }) {
  const [details,setDetails]=useState<SuperWorkspaceDetail|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<"reset"|"remove"|null>(null),[toast,setToast]=useState("");
  useEffect(()=>{let active=true;api<SuperWorkspaceDetail>(`workspaces/${id}`).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[id]);
  async function act(kind: "reset"|"remove") {setBusy(true);setError("");try{if(kind==="reset"){await api(`workspaces/${id}/reset`,{method:"POST",body:"{}"});setDetails(await api(`workspaces/${id}`));setToast("Workspace reset to its original account data.");refresh();}else{await api(`workspaces/${id}`,{method:"DELETE",body:"{}"});refresh();onClose();return;}setConfirm(null)}catch(e){setError(e instanceof Error?e.message:"Admin action failed.")}finally{setBusy(false)}}
  function refreshDetails() {
    void api<SuperWorkspaceDetail>(`workspaces/${id}`).then(result => setDetails(current => current?.summary.id === id ? result : current)).catch(e => setError(e.message));
    refresh();
  }
  return <div className="ad-drawer-shade" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ad-workspace-drawer" role="dialog" aria-modal="true" aria-label="Workspace details"><div className="ad-drawer-head"><div><p className="ad-eyebrow">WORKSPACE</p><h2>{details?.summary.label ?? id.slice(0,12)}</h2></div><button className="ad-icon-btn" aria-label="Close workspace details" onClick={onClose}><X size={19}/></button></div>{error&&<p className="ad-alert">{error}</p>}{toast&&<p className="ad-success"><Check size={14}/>{toast}</p>}
    {details&&<><WorkspaceRecords details={details} />
      <WorkspaceHistory history={details.history} />
      <CustomerProfileControls key={`profile:${id}`} id={id} profile={details.profile} enrolled={details.access.status === "enrolled"} onChanged={changed => {
        refreshDetails();
        if (changed) onProfileChanged();
      }}/>
      <OpenAccountForm key={`open:${id}`} endpoint={`users/${id}/accounts`} allowBalance disabled={details.access.suspended} onChanged={() => { refreshDetails(); onProfileChanged(); }}/>
      <ManageAccounts key={`manage:${id}`} id={id} details={details} onChanged={() => { refreshDetails(); onProfileChanged(); }}/>
      <details className="ad-detail-section ad-setting-card shrink-0" key={`adjust:${id}`}>
        <summary>Post a ledger adjustment</summary>
        <p>This changes the account’s recorded balance. It does not transfer money.</p>
        {details.accounts.length ? <AdjustmentForm id={id} accounts={details.accounts} onSaved={() => { setToast("Manual adjustment posted."); refreshDetails(); }}/> : <p>Open an account before posting an adjustment.</p>}
      </details>
      <GenerateActivityForm key={`generate:${id}`} id={id} accounts={details.accounts} disabled={details.access.suspended} onChanged={refreshDetails}/>
      <CustomerAccessControls key={id} id={id} access={details.access} onIssued={(access) => {
        setDetails(current => current ? { ...current, access } : current);
        void api<SuperWorkspaceDetail>(`workspaces/${id}`).then(result => setDetails(current => current?.summary.id === id ? result : current)).catch(() => {});
      }}/>
      <div className="ad-tenant-actions"><button className="ad-outline-btn" onClick={()=>setConfirm("reset")}><RotateCcw size={15}/>Reset workspace</button><button className="ad-danger-btn" onClick={()=>setConfirm("remove")}><Trash2 size={15}/>Delete workspace</button></div>
      <p className="ad-detail-stamp">Last activity · {stamp(details.summary.updated)}</p>
    </>}
    {confirm&&<div className="ad-confirm-shade"><div className="ad-confirm-dialog" role="alertdialog"><h3>{confirm==="reset"?"Reset workspace?":"Delete workspace?"}</h3><p>{confirm==="reset"?"This removes transfers and preferences and restores the original accounts. The workspace identifier stays the same.":"This permanently removes this workspace and all its transactions."}</p>{error&&<p className="ad-login-error">{error}</p>}<div><button className="ad-outline-btn" onClick={()=>{setConfirm(null);setError("")}}>Keep workspace</button><button className="ad-danger-btn" disabled={busy} onClick={()=>act(confirm)}>{busy?"Working…":confirm==="reset"?"Reset workspace":"Delete workspace"}</button></div></div></div>}</aside></div>;
}

function Audit({ rows, refresh }: { rows: AuditEntry[]; refresh: () => void }) {
  const [action,setAction]=useState(""),[actor,setActor]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[filtered,setFiltered]=useState(rows),[busy,setBusy]=useState(false);
  const [integrity, setIntegrity] = useState<{ integrity: boolean; entries: number } | null>(null);
  const [integrityError, setIntegrityError] = useState("");
  const [checking, setChecking] = useState(false);
  async function verifyIntegrity() {
    setChecking(true); setIntegrity(null); setIntegrityError("");
    try { setIntegrity(await api<{ integrity: boolean; entries: number }>("audit/integrity")); }
    catch (e) { setIntegrityError(e instanceof Error ? e.message : "Could not check audit integrity."); }
    finally { setChecking(false); }
  }
  async function apply(){setBusy(true);try{const q=new URLSearchParams();if(action)q.set("action",action);if(actor)q.set("actor",actor);if(from)q.set("from",from);if(to)q.set("to",to);const r=await api<{entries:AuditEntry[]}>(`audit?${q}`);setFiltered(r.entries);}finally{setBusy(false)}}
  async function exportCsv(){const r=await fetch("/api/admin/audit?format=csv",{credentials:"same-origin",headers:{"Content-Type":"application/json"}});const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="admin-audit.csv";a.click();URL.revokeObjectURL(url)}
  useEffect(()=>setFiltered(rows),[rows]);
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">RESTRICTED OPERATIONS</p><h1>Audit trail</h1><p>Records of admin access and workspace actions.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh log</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>Admin activity</h2><p>Newest first · server-filtered records</p></div><div className="ad-inline-actions"><button className="ad-outline-btn" onClick={exportCsv}>Export CSV</button><a className="ad-outline-btn" href="/api/admin/audit/proof" download>Export JSON proof</a><button className="ad-outline-btn" disabled={checking} onClick={verifyIntegrity}>Verify audit integrity</button><LockKeyhole size={17} className="ad-muted"/></div></div>{integrity && <p role="status" className={integrity.integrity ? "ad-success" : "ad-alert"}>{integrity.integrity ? `Stored audit chain verified (${integrity.entries} records).` : "The stored audit chain did not pass verification."}</p>}{integrityError && <p role="alert" className="ad-alert">{integrityError}</p>}<div className="ad-audit-filters"><input aria-label="Action filter" placeholder="Action" value={action} onChange={e=>setAction(e.target.value)}/><input aria-label="Actor filter" placeholder="Actor" value={actor} onChange={e=>setActor(e.target.value)}/><input aria-label="From date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input aria-label="To date" type="date" value={to} onChange={e=>setTo(e.target.value)}/><button className="ad-primary-small" disabled={busy} onClick={apply}>{busy?"Filtering…":"Apply filters"}</button></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>WORKSPACE</th><th>SCOPE</th></tr></thead><tbody>{filtered.map((e,i)=><tr key={`${e.at}-${i}`}><td>{stamp(e.at)}</td><td><span className="ad-role-pill">{e.actor}</span></td><td>{e.action.replace(/_/g," ")}</td><td>{e.workspace||"—"}</td><td>{e.scope}</td></tr>)}{!filtered.length&&<tr><td colSpan={5} className="ad-empty-table">No admin actions match.</td></tr>}</tbody></table></div></section><p className="ad-safe-foot"><ShieldCheck size={14}/>Audit history contains workspace identifiers only; no customers or transaction descriptions.</p></>;
}

type Customer = { id: string; name: string; suspended: boolean; status: string; accountCount: number; ownerAdminId: string | null };

function Customers({ onSelect, profileVersion }: { onSelect: (id: string) => void; profileVersion: number }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [staff, setStaff] = useState<StaffEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"suspend" | "activate" | "reassign">("suspend");
  const [bulkOwner, setBulkOwner] = useState("");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const bulkLabels = { suspend: "Suspend access", activate: "Restore access", reassign: "Change owner" };
  useEffect(() => {
    let active = true;
    api<{ customers: Customer[] }>(`customers?${new URLSearchParams({ search })}`)
      .then(data => { if (active) setRows(data.customers); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [search, refresh, profileVersion]);
  useEffect(() => {
    let active = true;
    api<{ admins: StaffEntry[] }>("admins")
      .then(data => { if (active) setStaff(data.admins); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      const { customer } = await api<{ customer: Customer }>("customers", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setSearch(""); setSelected([]); setConfirmBulk(false); setName(""); setRefresh(n => n + 1);
      setNotice(`${customer.name} was created.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create this workspace."); }
    finally { setBusy(""); }
  }

  async function changeAccess(row: Customer) {
    const suspended = !row.suspended;
    setBusy(row.id); setError(""); setNotice("");
    try {
      await api(`customers/${row.id}/suspend`, { method: "POST", body: JSON.stringify({ suspended }) });
      setRows(current => current.map(item => item.id === row.id ? { ...item, suspended, status: suspended ? "suspended" : "active" } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update workspace access."); }
    finally { setBusy(""); }
  }

  async function assign(row: Customer, id: string) {
    setBusy(row.id); setError(""); setNotice("");
    try {
      const { ownerAdminId } = await api<{ ownerAdminId: string | null }>(`users/${row.id}/assign-admin`, { method: "PUT", body: JSON.stringify({ ownerAdminId: id || null }) });
      setRows(current => current.map(item => item.id === row.id ? { ...item, ownerAdminId } : item));
      setNotice(ownerAdminId ? "Workspace assigned." : "Workspace assignment removed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update the assignment."); }
    finally { setBusy(""); }
  }

  async function applyBulk() {
    if (!confirmBulk || busy || !selected.length) return;
    setBusy("bulk"); setError(""); setNotice("");
    try {
      const { affected } = await api<{ affected: number }>("customers/bulk", { method: "POST", body: JSON.stringify({
        action: bulkAction, ids: selected, ...(bulkAction === "reassign" ? { ownerAdminId: bulkOwner || null } : {}),
      }) });
      setRefresh(n => n + 1); setSelected([]); setConfirmBulk(false);
      setNotice(`Bulk action complete: ${affected} ${affected === 1 ? "workspace" : "workspaces"} updated.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply the bulk action."); }
    finally { setBusy(""); }
  }

  return <>
    <div className="ad-page-intro"><div><p className="ad-eyebrow">CUSTOMER ADMINISTRATION</p><h1>Customers</h1><p>Create, assign, suspend, restore, and inspect banking workspaces.</p></div></div>
    {error && <p className="ad-alert" role="alert">{error}</p>}
    {notice && <p className="ad-success" role="status"><Check size={14}/>{notice}</p>}
    <section className="ad-panel ad-table-panel">
      <div className="ad-panel-head">
        <form className="ad-staff-form" onSubmit={create}>
          <input aria-label="Customer display name" placeholder="Customer display name" required maxLength={120} value={name} onChange={e => setName(e.target.value)}/>
          <button className="ad-primary-small" disabled={!!busy || !name.trim()}>Create customer</button>
        </form>
        <label className="ad-searchbox"><Search size={15}/><input aria-label="Search customers" placeholder="Search customers" value={search} disabled={!!busy} onChange={e => { setSearch(e.target.value); setRows([]); setSelected([]); setConfirmBulk(false); }}/></label>
      </div>
      {!!selected.length && <section className="ad-detail-section ad-setting-card" aria-label="Bulk customer actions">
        <p>{selected.length} {selected.length === 1 ? "workspace selected" : "workspaces selected"}</p>
        <label>Bulk action<select aria-label="Bulk action" value={bulkAction} disabled={!!busy || confirmBulk} onChange={e => setBulkAction(e.target.value as typeof bulkAction)}>
          {Object.entries(bulkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {bulkAction === "reassign" && <label>New owner<select aria-label="New owner" value={bulkOwner} disabled={!!busy || confirmBulk} onChange={e => setBulkOwner(e.target.value)}>
          <option value="">Super administrator (unassigned)</option>{staff.filter(person => person.signInEnabled).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>}
        {confirmBulk ? <><p>{bulkLabels[bulkAction]} for the {selected.length} selected {selected.length === 1 ? "workspace" : "workspaces"}{bulkAction === "reassign" ? ` to ${staff.find(person => person.id === bulkOwner)?.name ?? "Super administrator"}` : ""}?</p><div className="ad-inline-actions">
          <button className="ad-outline-btn" disabled={!!busy} onClick={() => setConfirmBulk(false)}>Cancel bulk action</button>
          <button className="ad-primary-small" disabled={!!busy} onClick={() => void applyBulk()}>Confirm bulk action</button>
        </div></> : <div className="ad-inline-actions"><button className="ad-primary-small" disabled={!!busy} onClick={() => setConfirmBulk(true)}>Review bulk action</button><button className="ad-outline-btn" disabled={!!busy} onClick={() => setSelected([])}>Clear selection</button></div>}
      </section>}
      <div className="ad-table-scroll"><table className="ad-table">
        <thead><tr><th>SELECT</th><th>CUSTOMER</th><th>STATUS</th><th>ACCOUNTS</th><th>OWNER</th><th>ACTIONS</th></tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.id}>
            <td><input type="checkbox" aria-label={`Select ${row.name} (${row.id.slice(0, 8)})`} checked={selected.includes(row.id)} disabled={!!busy || confirmBulk || (selected.length >= 50 && !selected.includes(row.id))}
              onChange={e => { const checked = e.target.checked; setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id)); }}/></td>
            <td><button className="ad-workspace-link" onClick={() => onSelect(row.id)}><strong>{row.name}</strong></button></td>
            <td>{row.status}</td><td>{row.accountCount}</td>
            <td><select aria-label={`Assigned admin for ${row.name} (${row.id.slice(0, 8)})`} disabled={!!busy} value={row.ownerAdminId || ""} onChange={e => void assign(row, e.target.value)}>
              <option value="">Super administrator</option>
              {staff.filter(person => person.signInEnabled || person.id === row.ownerAdminId).map(person => <option key={person.id} value={person.id} disabled={!person.signInEnabled}>{person.name}{!person.signInEnabled ? " (inactive)" : ""}</option>)}
              {row.ownerAdminId && !staff.some(person => person.id === row.ownerAdminId) && <option value={row.ownerAdminId} disabled>Unavailable</option>}
            </select></td>
            <td><div className="ad-inline-actions"><button className="ad-outline-btn" onClick={() => onSelect(row.id)}>View workspace</button><button className="ad-outline-btn" disabled={!!busy} onClick={() => void changeAccess(row)}>{row.suspended ? "Restore access" : "Suspend access"}</button></div></td>
          </tr>)}
          {!rows.length && <tr><td colSpan={6} className="ad-empty-table">No workspaces match.</td></tr>}
        </tbody>
      </table></div>
    </section>
  </>;
}

function Transactions() {
  const [rows, setRows] = useState<AdminTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [edit, setEdit] = useState<AdminTransaction | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const query = new URLSearchParams(Object.entries({ search, status, source, from, to }).filter(([, value]) => value)).toString();
  const invalidRange = !!(from && to && from > to);
  useEffect(() => {
    if (invalidRange) return;
    let active = true;
    setLoading(true); setError("");
    api<{ transactions: AdminTransaction[]; total: number }>(`transactions?${query}`).then(result => {
      if (active) { setRows(result.transactions); setTotal(result.total); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Transactions unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, invalidRange, refresh]);
  const exportParams = new URLSearchParams(query);
  exportParams.set("format", "csv");
  const sources: Record<string, string> = { admin_adjustment: "Manual adjustment", generated: "Generated activity", staff_funding: "Staff funding" };
  return <>
    <div className="ad-page-intro"><div><p className="ad-eyebrow">LEDGER ADMINISTRATION</p><h1>Transactions</h1><p>Review ledger activity and correct posted manual adjustments.</p></div></div>
    {error && <p className="ad-alert" role="alert">{error}</p>}
    {invalidRange && <p className="ad-alert" role="alert">End date must be on or after the start date.</p>}
    {notice && <p className="ad-success" role="status">{notice}</p>}
    {edit && <section className="ad-panel ad-setting-card" aria-label="Correct manual adjustment">
      <h2>Correct manual adjustment</h2><p>Workspace {edit.workspaceId.slice(0, 8).toUpperCase()} · {edit.description}</p>
      <AdjustmentForm key={`${edit.workspaceId}:${edit.id}`} id={edit.workspaceId} transaction={edit} onCancel={() => setEdit(null)} onSaved={removed => {
        setEdit(null); setRefresh(value => value + 1); setNotice(removed ? "Manual adjustment removed." : "Manual adjustment corrected.");
      }}/>
    </section>}
    <section className="ad-panel ad-table-panel">
      <div className="ad-panel-head"><div><h2>Workspace ledger</h2><p>{loading || invalidRange ? "Filter by date, status, or source." : `Showing ${rows.length} of ${total} matches${total > 5000 ? "; CSV includes the newest 5,000" : ""}.`}</p></div>
        {!invalidRange && <a className="ad-outline-btn" href={`/api/admin/transactions?${exportParams}`} download>Export filtered CSV</a>}
      </div>
      <div className="ad-audit-filters">
        <input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e => setSearch(e.target.value)}/>
        <input aria-label="Transaction start date" type="date" value={from} onChange={e => setFrom(e.target.value)}/>
        <input aria-label="Transaction end date" type="date" value={to} onChange={e => setTo(e.target.value)}/>
        <select aria-label="Transaction status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Any status</option><option value="posted">Posted</option><option value="pending">Pending</option><option value="refund-reversed">Refund reversed</option>
        </select>
        <select aria-label="Transaction source" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">Any source</option>{Object.entries(sources).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>DATE</th><th>WORKSPACE / ACCOUNT</th><th>DESCRIPTION</th><th>CATEGORY</th><th>STATUS</th><th>SOURCE</th><th>AMOUNT</th><th>ACTIONS</th></tr></thead>
        <tbody>{!invalidRange && !loading && !error && rows.map(row => <tr key={`${row.workspaceId}:${row.id}`}>
          <td>{row.date}</td><td>{row.workspaceId.slice(0, 8).toUpperCase()} · {row.accountName}</td><td>{row.description}</td><td>{row.category}</td><td>{row.status}</td><td>{sources[row.source ?? ""] ?? "—"}</td><td>{money(row.amount)}</td>
          <td>{row.editable && <button className="ad-outline-btn" disabled={!!edit} onClick={() => { setEdit(row); setNotice(""); }}>Correct adjustment</button>}</td>
        </tr>)}
        {!invalidRange && !loading && !error && !rows.length && <tr><td className="ad-empty-table" colSpan={8}>No transactions match.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}

function Messages() {
  const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(""),[subject,setSubject]=useState(""),[body,setBody]=useState(""),[workspace,setWorkspace]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;api<{messages:any[]}>('messages').then(r=>{if(active)setRows(r.messages||[])}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Messages unavailable.")});return()=>{active=false}},[]);
  async function send() {
    if (busy) return;
    const id = workspace.trim();
    if (!/^[a-f0-9]{48}$/.test(id) || !subject.trim() || !body.trim()) return setError("Enter a valid workspace ID, subject, and message.");
    setBusy(true); setError("");
    try {
      const { message } = await api<{ message: { id: string; direction: string; subject: string; body: string } }>(`users/${id}/messages`, { method: "POST", body: JSON.stringify({ subject, body }) });
      setRows(current => [{ ...message, workspaceId: id }, ...current]);
      setSubject(""); setBody("");
    } catch (e) { setError(e instanceof Error ? e.message : "Message failed."); }
    finally { setBusy(false); }
  }
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">SUPPORT ADMINISTRATION</p><h1>Messages</h1><p>Send support messages and review customer conversations.</p></div></div>{error&&<p className="ad-alert">{error}</p>}<section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div className="ad-staff-form"><input aria-label="Workspace ID" placeholder="Workspace ID" value={workspace} onChange={e=>setWorkspace(e.target.value)}/><input aria-label="Subject" placeholder="Subject" maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)}/><input aria-label="Message" placeholder="Message" maxLength={450} value={body} onChange={e=>setBody(e.target.value)}/><button className="ad-primary-small" disabled={busy} onClick={send}>Send</button></div></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>WORKSPACE</th><th>DIRECTION</th><th>SUBJECT</th><th>MESSAGE</th></tr></thead><tbody>{rows.map((r,i)=> <tr key={`${r.id||i}`}><td>{r.workspaceId||"—"}</td><td>{r.direction||"customer"}</td><td>{r.subject||"—"}</td><td>{r.body||r.message||"—"}</td></tr>)}</tbody></table></div></section></>;
}

function OffboardStaff({ staff, admins, onCancel, onDone }: {
  staff: StaffEntry;
  admins: StaffEntry[];
  onCancel: () => void;
  onDone: (staff: StaffEntry, affected: number) => void;
}) {
  const [plan, setPlan] = useState<{ workspaceCount: number; version: string } | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const endpoint = `admins/${staff.id}/offboard`;
  useEffect(() => {
    let active = true;
    api<{ workspaceCount: number; version: string }>(endpoint)
      .then(result => { if (active) setPlan(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [endpoint, reload]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!plan || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ admin: StaffEntry; affected: number }>(endpoint, {
        method: "POST", body: JSON.stringify({ version: plan.version, replacementId: plan.workspaceCount ? replacementId || null : null }),
      });
      onDone(result.admin, result.affected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not offboard this staff member.");
      if (e instanceof AdminRequestError && e.status === 409) { setPlan(null); setReload(n => n + 1); }
    } finally { setBusy(false); }
  }

  return <section className="ad-detail-section" aria-labelledby="staff-offboard-title">
    <h3 id="staff-offboard-title">Offboard {staff.name}</h3>
    <p>This ends their sessions, disables sign-in, and invalidates their access code. The staff record stays in Settings.</p>
    {error && <p className="ad-alert" role="alert">{error}</p>}
    <form onSubmit={confirm}>
      {!plan && !error && <p role="status">Checking assigned workspaces…</p>}
      {plan && <p>{plan.workspaceCount === 1 ? "1 assigned workspace" : `${plan.workspaceCount} assigned workspaces`}</p>}
      {!!plan?.workspaceCount && <label>Move assigned workspaces to
        <select value={replacementId} disabled={busy} onChange={e => setReplacementId(e.target.value)}>
          <option value="">Leave unassigned</option>
          {admins.filter(person => person.id !== staff.id && person.signInEnabled).map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}
        </select>
      </label>}
      <div className="ad-inline-actions">
        <button type="button" className="ad-outline-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="ad-danger-btn" disabled={!plan || busy}>{busy ? "Offboarding…" : "Confirm offboarding"}</button>
      </div>
    </form>
  </section>;
}

function AdminSettings() {
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [offboarding, setOffboarding] = useState<StaffEntry | null>(null);
  const [root,setRoot]=useState<RootIdentity|null>(null),[admins,setAdmins]=useState<StaffEntry[]>([]),[settings,setSettings]=useState<any>(null);
  const [rootName,setRootName]=useState(""),[rootEmail,setRootEmail]=useState(""),[staffName,setStaffName]=useState(""),[staffEmail,setStaffEmail]=useState(""),[issued,setIssued]=useState<{ email: string; code: string } | null>(null),[staffBusy,setStaffBusy]=useState(false);
  const [confirm,setConfirm]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let active=true;Promise.all([api<{identity:RootIdentity}>('me'),api<{admins:StaffEntry[]}>('admins'),api<{settings:any}>('settings')]).then(([m,a,s])=>{if(active){setRoot(m.identity);setRootName(m.identity.name);setRootEmail(m.identity.email);setAdmins(a.admins);setSettings(s.settings)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load settings.')});return()=>{active=false}},[]);
  async function saveIdentity(){try{const r=await api<{identity:RootIdentity}>('me',{method:'PUT',body:JSON.stringify({name:rootName,email:rootEmail})});setRoot(r.identity);setMessage('Root identity updated.')}catch(e){setError(e instanceof Error?e.message:'Update failed.')}}
  async function addStaff(event: FormEvent) {
    event.preventDefault();
    if (staffBusy) return;
    setStaffBusy(true); setError(""); setMessage(""); setIssued(null);
    try {
      const { admin, accessCode } = await api<{ admin: StaffEntry; accessCode: string }>("admins", { method: "POST", body: JSON.stringify({ name: staffName, email: staffEmail, role: "limited" }) });
      setAdmins(current => [...current, admin]);
      setIssued({ email: admin.email, code: accessCode });
      setStaffName(""); setStaffEmail("");
      setMessage("Limited admin created.");
    } catch (e) { setError(e instanceof Error ? e.message : "Creation failed."); }
    finally { setStaffBusy(false); }
  }
  async function replaceCode(staff: StaffEntry) {
    if (!window.confirm(`Replace the access code for ${staff.name}? Their current session will end.`)) return;
    setStaffBusy(true); setError(""); setMessage(""); setIssued(null);
    try {
      const { admin, accessCode } = await api<{ admin: StaffEntry; accessCode: string }>(`admins/${staff.id}/access-code`, { method: "POST", body: "{}" });
      setAdmins(current => current.map(person => person.id === admin.id ? admin : person));
      setIssued({ email: admin.email, code: accessCode });
      setMessage("Access code replaced.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not replace the access code."); }
    finally { setStaffBusy(false); }
  }
  async function saveSettings(){try{const r=await api<{settings:any}>('settings',{method:'PUT',body:JSON.stringify(settings)});setSettings(r.settings);setMessage('Settings saved.')}catch(e){setError(e instanceof Error?e.message:'Save failed.')}}
  async function updateStaff(id:string, changes:{name:string;role:string;active:boolean}){try{const r=await api<{admin:StaffEntry}>(`admins/${id}`,{method:'PUT',body:JSON.stringify(changes)});setAdmins(v=>v.map(a=>a.id===id?r.admin:a));setMessage('Staff identity updated.')}catch(e){setError(e instanceof Error?e.message:'Staff update failed.')}}
  async function deleteStaff(id:string){if(!window.confirm('Delete this staff identity?'))return;try{await api(`admins/${id}`,{method:'DELETE',body:'{}'});setAdmins(v=>v.filter(a=>a.id!==id));setMessage('Staff identity deleted.')}catch(e){setError(e instanceof Error?e.message:'Staff deletion failed.')}}
  async function backup(){const r=await fetch('/api/admin/backup',{credentials:'same-origin',headers:{'Content-Type':'application/json'}});if(!r.ok){setError('Backup export failed.');return;}const b=await r.blob();const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='banking-workspace-backup.json';a.click();URL.revokeObjectURL(u);setMessage('Backup downloaded.')}
  const [restoreReview, setRestoreReview] = useState<{ backup: object; workspaces: number; staff: number; assignments: number } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  async function restore() {
    if (confirm !== "RESTORE" || restoreBusy) return setError("Type RESTORE first.");
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setRestoreBusy(true); setError(""); setMessage(""); setRestoreReview(null);
      try {
        const backup = JSON.parse(await file.text());
        const plan = await api<{ workspaces: number; staff: number; assignments: number }>("restore", { method: "POST", body: JSON.stringify({ ...backup, dryRun: true }) });
        setRestoreReview({ backup, ...plan });
      } catch (e) { setError(e instanceof Error ? e.message : "Backup validation failed."); }
      finally { setRestoreBusy(false); }
    };
    input.click();
  }
  async function confirmRestore() {
    if (!restoreReview || restoreBusy || confirm !== "RESTORE") return;
    setRestoreBusy(true); setError("");
    try {
      await api("restore", { method: "POST", body: JSON.stringify({ ...restoreReview.backup, dryRun: false, confirmation: "RESTORE" }) });
      setRestoreReview(null); setConfirm(""); setMessage("Backup restored.");
      const [identity, staff, options] = await Promise.all([api<{ identity: RootIdentity }>("me"), api<{ admins: StaffEntry[] }>("admins"), api<{ settings: any }>("settings")]);
      setRoot(identity.identity); setRootName(identity.identity.name); setRootEmail(identity.identity.email);
      setAdmins(staff.admins); setSettings(options.settings);
    } catch (e) { setError(e instanceof Error ? e.message : "Restore failed."); }
    finally { setRestoreBusy(false); }
  }
  async function resetAll(){if(confirm!=="RESET ALL WORKSPACE DATA")return setError('Typed confirmation is required.');try{await api('reset',{method:'POST',body:JSON.stringify({confirmation:'RESET ALL WORKSPACE DATA'})});setMessage('All workspaces reset.');setConfirm('')}catch(e){setError(e instanceof Error?e.message:'Reset failed.')}}
  async function operation(path:string,label:string){try{await api(path,{method:'POST',body:'{}'});setMessage(`${label} completed.`)}catch(e){setError(e instanceof Error?e.message:`${label} failed.`)}}
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">CONFIGURATION</p><h1>Admin settings</h1><p>Root identity, staff, settings, backup, and typed destructive operations.</p></div></div>{error&&<p className="ad-alert">{error}</p>}{message&&<p className="ad-success" role="status"><Check size={14}/>{message}</p>}<section className="ad-settings-grid"><article className="ad-panel ad-setting-card"><h2>Root identity</h2>{root&&<><label>Name<input value={rootName} onChange={e=>setRootName(e.target.value)}/></label><label>Email<input value={rootEmail} onChange={e=>setRootEmail(e.target.value)}/></label><button className="ad-primary-small" onClick={saveIdentity}>Save identity</button></>}</article><article className="ad-panel ad-setting-card">
    <h2>Staff identities</h2>
    <a className="ad-link-btn" href="/admin/limited">Limited admin sign-in</a>
    <form className="ad-staff-form" onSubmit={addStaff}>
      <input aria-label="Staff name" required maxLength={120} placeholder="Name" value={staffName} onChange={e => setStaffName(e.target.value)}/>
      <input aria-label="Staff email" required type="email" maxLength={200} placeholder="Email" value={staffEmail} onChange={e => setStaffEmail(e.target.value)}/>
      <button className="ad-primary-small" disabled={staffBusy}>Create limited admin</button>
    </form>
    {issued && <div>
      <p>Share this access code privately with {issued.email}. It won’t be shown again after dismissal.</p>
      <label>Generated access code<input readOnly value={issued.code} onFocus={e => e.target.select()}/></label>
      <button type="button" className="ad-outline-btn" onClick={() => setIssued(null)}>Dismiss access code</button>
    </div>}
    <div className="ad-staff-list">{admins.map(person => <div className="flex-wrap" key={person.id}>
      <strong>{person.name}</strong><span>{person.role === "limited" ? "Limited admin" : person.role} · {person.active ? "Active" : "Inactive"}</span>
      <button type="button" className="ad-outline-btn" disabled={staffBusy || !!offboarding} onClick={() => updateStaff(person.id, { name: person.name, role: person.role, active: !person.active })}>{person.active ? "Suspend" : "Activate"}</button>
      {person.role === "limited" && <button type="button" className="ad-outline-btn" disabled={staffBusy || !!offboarding} onClick={() => void replaceCode(person)}>Replace code</button>}
      {person.role === "limited" && <span>Funding budget: {money(person.fundingAvailable)}</span>}
      {person.signInEnabled && <button type="button" className="ad-outline-btn" disabled={staffBusy || !!offboarding} onClick={() => { setMessage(""); setGrantFor(current => current === person.id ? null : person.id); }}>Grant funding budget</button>}
      {person.role === "limited" && <button type="button" className="ad-outline-btn" disabled={staffBusy || !!offboarding} onClick={() => { setIssued(null); setMessage(""); setError(""); setOffboarding(person); }}>Offboard</button>}
      <button type="button" className="ad-danger-btn" disabled={staffBusy || !!offboarding} onClick={() => deleteStaff(person.id)}><Trash2 size={14}/>Delete</button>
    </div>)}</div>
    {admins.filter(person => person.id === grantFor && person.signInEnabled).map(person => <section className="ad-detail-section" key={person.id} aria-label={`Funding budget for ${person.name}`}>
      <h3>Funding budget for {person.name}</h3>
      <p>This grant adds to the amount available for eligible customer accounts, not to a personal balance.</p>
      <FundingForm endpoint={`admins/${person.id}/funding`} disabled={staffBusy || !!offboarding} onDone={({ admin }) => {
        if (admin) setAdmins(current => current.map(row => row.id === admin.id ? admin : row));
        setMessage(`Funding budget added for ${person.name}.`);
        setGrantFor(null);
      }}/>
    </section>)}
    {offboarding && <OffboardStaff key={offboarding.id} staff={offboarding} admins={admins} onCancel={() => setOffboarding(null)} onDone={(admin, affected) => {
      setAdmins(current => current.map(person => person.id === admin.id ? admin : person));
      setOffboarding(null);
      setMessage(`${admin.name} was offboarded. ${affected} ${affected === 1 ? "workspace updated" : "workspaces updated"}.`);
    }}/>}
  </article><article className="ad-panel ad-setting-card"><h2>Runtime settings</h2>{settings&&<><label><input type="checkbox" checked={settings.maintenanceMode} onChange={e=>setSettings({...settings,maintenanceMode:e.target.checked})}/>Maintenance mode</label><label><input type="checkbox" checked={settings.allowWorkspaceReset} onChange={e=>setSettings({...settings,allowWorkspaceReset:e.target.checked})}/>Allow workspace reset</label><label><input type="checkbox" checked={settings.allowWorkspaceDelete} onChange={e=>setSettings({...settings,allowWorkspaceDelete:e.target.checked})}/>Allow workspace delete</label><button className="ad-primary-small" onClick={saveSettings}>Save settings</button></>}</article><article className="ad-panel ad-setting-card"><h2>Backup and operations</h2><div className="ad-inline-actions"><button className="ad-outline-btn" onClick={()=>operation('process-scheduled','Scheduled processing')}>Process scheduled</button><button className="ad-outline-btn" onClick={()=>operation('month-end-close','Month-end close')}>Month-end close</button></div><button className="ad-outline-btn" onClick={backup}>Download backup</button><label>Type <code>RESTORE</code><input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="ad-outline-btn" disabled={restoreBusy} onClick={restore}>Review backup</button>{restoreReview && <section className="ad-detail-section" aria-label="Backup restore review"><p>Restore {restoreReview.workspaces} workspaces, {restoreReview.staff} staff records and {restoreReview.assignments} assignments? This replaces the current records and ends customer and limited-admin sessions.</p><div className="ad-inline-actions"><button className="ad-outline-btn" disabled={restoreBusy} onClick={() => setRestoreReview(null)}>Cancel</button><button className="ad-danger-btn" disabled={restoreBusy || confirm !== "RESTORE"} onClick={confirmRestore}>Confirm backup restore</button></div></section>}<hr/><label>Type <code>RESET ALL WORKSPACE DATA</code><input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="ad-danger-btn" onClick={()=>confirm==='RESET ALL WORKSPACE DATA'?resetAll():setError('Typed confirmation is required.')}>Reset all workspace data</button></article></section></>;
}

function Skeleton() { return <div className="ad-admin-loading"><span/><span/><span/></div>; }

export default function AdminApp({ onLeave }: { onLeave?: (url: string) => void } = {}) {
  const { path } = useRouter();
  return /^\/admin\/limited(?:\/|$)/i.test(path) ? <LimitedAdmin onLeave={onLeave} /> : <SuperAdmin onLeave={onLeave} />;
}

function SuperAdmin({ onLeave }: { onLeave?: (url: string) => void }) {
  const { path: raw, navigate } = useRouter();
  const [auth,setAuth]=useState<boolean|null>(null),[enabled,setEnabled]=useState(false),[data,setData]=useState<AdminData|null>(null),[audit,setAudit]=useState<AuditEntry[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[drawer,setDrawer]=useState("");
  const [profileVersion, setProfileVersion] = useState(0);
  const path=raw.toLowerCase().replace(/\/+$/,"")||"/admin";
  const page:Page=path.startsWith("/admin/workspaces")?"workspaces":path==="/admin/customers"?"customers":path==="/admin/transactions"?"transactions":path==="/admin/messages"?"messages":path==="/admin/activity"?"activity":path==="/admin/settings"?"settings":"overview";
  useEffect(()=>{let active=true;api<AdminSession>("session").then(s=>{if(active){setAuth(s.authenticated);setEnabled(s.adminEnabled)}}).catch(e=>{if(active){setAuth(false);setError(e.message)}});return()=>{active=false}},[]);
  const load=useCallback(async()=>{setLoading(true);setError("");try{const d=await api<AdminData>("overview");setData(d);setAudit(d.audit)}catch(e){setError(e instanceof Error?e.message:"Could not load administration operations.")}finally{setLoading(false)}},[]);
  useEffect(()=>{if(auth)void load()},[auth,load,page]);
  const select=(id:string)=>setDrawer(id);
  async function signout() {
    try { await api("session", { method: "DELETE", body: "{}" }); }
    catch (e) {
      if (!(e instanceof AdminRequestError && e.status === 401)) {
        setError("Couldn’t end your admin session. Try signing out again.");
        return;
      }
    }
    setAuth(false); setData(null); setDrawer(""); navigate("/admin");
  }
  return <main className="ad-shell"><header className="ad-top"><a href="/admin" className="ad-brand"><img src={wordmark} alt="Wells Fargo"/><span/><b>Administration control room</b></a>{auth&&<div className="ad-top-right"><span><i/> Workspace environment</span><button onClick={signout}><LogOut size={15}/>Sign out</button></div>}</header>{auth===null?<Skeleton/>:!auth?<Login enabled={enabled} statusError={error} onLogin={()=>{setAuth(true);setError("")}} onLeave={onLeave}/>:<div className="ad-layout"><aside className="ad-sidebar"><p className="ad-side-label">CONTROL ROOM</p>{([{id:"overview",label:"Overview",icon:LayoutDashboard,href:"/admin"},{id:"workspaces",label:"Workspaces",icon:UsersRound,href:"/admin/workspaces"},{id:"customers",label:"Customers",icon:UsersRound,href:"/admin/customers"},{id:"transactions",label:"Transactions",icon:Activity,href:"/admin/transactions"},{id:"messages",label:"Messages",icon:HistoryIcon,href:"/admin/messages"},{id:"activity",label:"Audit trail",icon:HistoryIcon,href:"/admin/activity"},{id:"settings",label:"Settings",icon:Settings2,href:"/admin/settings"}] as const).map(({id,label,icon:Icon,href})=><a key={id} href={href} className={page===id?"active":""}><Icon size={17}/>{label}</a>)}<div className="ad-sidebar-bottom"><ShieldCheck size={18}/><span>Server-authenticated. Workspace records only.</span></div></aside><section className="ad-content"><div className="ad-content-head"><div><span>WELLS FARGO <b>/</b> ADMIN</span><div>Operations</div></div><button disabled={loading} onClick={load}><RefreshCw size={15} className={loading?"ad-spin":""}/>Refresh</button></div>{error&&<p className="ad-alert" role="alert">{error} <button onClick={load}>Retry</button></p>}{!data?<Skeleton/>:page==="overview"?<Overview data={data} onSelect={select}/>:page==="workspaces"?<Workspaces rows={data.workspaces} onSelect={select} refresh={load}/>:page==="activity"?<Audit rows={audit} refresh={load}/>:page==="customers"?<Customers onSelect={select} profileVersion={profileVersion}/>:page==="transactions"?<Transactions/>:page==="messages"?<Messages/>:<AdminSettings/>}<footer className="ad-legal"><ShieldCheck size={14}/>Administration console · separate from Wells Fargo production systems · workspace records only</footer><SiteFooter onLeave={onLeave || (() => {})}/></section>{drawer&&<WorkspaceDetails id={drawer} onClose={()=>setDrawer("")} refresh={load} onProfileChanged={() => setProfileVersion(value => value + 1)}/>}</div>}</main>;
}
interface LimitedSession {
  authenticated: boolean;
  staff: { name: string } | null;
}

type AssignedWorkspace = { id: string; name: string; accountCount: number; suspended: boolean };

function LimitedAdmin({ onLeave }: { onLeave?: (url: string) => void }) {
  const [session, setSession] = useState<LimitedSession | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [fundingAvailable, setFundingAvailable] = useState(0);
  const [rows, setRows] = useState<AssignedWorkspace[]>([]);
  const [selected, setSelected] = useState("");
  const [details, setDetails] = useState<WorkspaceDetail | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const clear = useCallback(() => {
    setSession({ authenticated: false, staff: null });
    setRows([]); setDetails(null); setSelected(""); setNotice("");
    setCustomerName(""); setFundingAvailable(0);
    setSubject(""); setMessage(""); setCode("");
  }, []);
  const handleError = useCallback((e: unknown) => {
    if (e instanceof AdminRequestError && e.status === 401) clear();
    if (e instanceof AdminRequestError && e.status === 404) {
      setSelected(""); setDetails(null); setReload(n => n + 1);
    }
    setError(e instanceof Error ? e.message : "Could not complete the request.");
  }, [clear]);

  useEffect(() => {
    let active = true;
    api<LimitedSession>("staff/session").then(result => { if (active) setSession(result); })
      .catch(e => { if (active) { clear(); handleError(e); } });
    return () => { active = false; };
  }, [clear, handleError]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    api<{ workspaces: AssignedWorkspace[]; fundingAvailable: number }>("staff/workspaces").then(({ workspaces, fundingAvailable }) => {
      if (!active) return;
      setRows(workspaces);
      setFundingAvailable(fundingAvailable);
      setSelected(current => workspaces.some(row => row.id === current) ? current : "");
    }).catch(e => { if (active) { setRows([]); setSelected(""); handleError(e); } });
    return () => { active = false; };
  }, [session, reload, handleError]);

  useEffect(() => {
    setDetails(null);
    if (!session?.authenticated || !selected) return;
    let active = true;
    api<WorkspaceDetail>(`staff/workspaces/${selected}`).then(result => { if (active) setDetails(result); })
      .catch(e => { if (active) handleError(e); });
    return () => { active = false; };
  }, [selected, session, reload, handleError]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api("staff/session", { method: "POST", body: JSON.stringify({ email, code }) });
      const status = await api<LimitedSession>("staff/session");
      if (!status.authenticated) throw new Error("Cookies are blocked. Open the page in its own tab and try again.");
      setSession(status); setCode("");
    } catch (e) { handleError(e); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError("");
    try { await api("staff/session", { method: "DELETE", body: "{}" }); clear(); }
    catch (e) { handleError(e); }
    finally { setBusy(false); }
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    if (busy || !customerName.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { customer } = await api<{ customer: AssignedWorkspace }>("staff/workspaces", { method: "POST", body: JSON.stringify({ name: customerName.trim() }) });
      setRows(current => [...current, customer]); setSelected(customer.id); setCustomerName("");
      setSubject(""); setMessage("");
      setNotice(`${customer.name} was created. Open an account to get started.`);
    } catch (e) { handleError(e); }
    finally { setBusy(false); }
  }

  async function changeAccess(row: AssignedWorkspace) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { suspended } = await api<{ suspended: boolean }>(`staff/workspaces/${row.id}/access`, { method: "PUT", body: JSON.stringify({ suspended: !row.suspended }) });
      setRows(current => current.map(item => item.id === row.id ? { ...item, suspended } : item));
      setNotice(suspended ? "Workspace access suspended." : "Workspace access restored.");
    } catch (e) { handleError(e); }
    finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (busy || !selected || !subject.trim() || !message.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`staff/workspaces/${selected}/messages`, { method: "POST", body: JSON.stringify({ subject, body: message }) });
      setSubject(""); setMessage(""); setNotice("Message sent to the workspace inbox.");
    } catch (e) { handleError(e); }
    finally { setBusy(false); }
  }

  return <div className="ad-shell">
    <header className="ad-top">
      <a href="/admin/limited" className="ad-brand"><img src={wordmark} alt="Wells Fargo"/><span/><b>Limited administration</b></a>
      {session?.authenticated && <div className="ad-top-right"><span>{session.staff?.name}</span><button disabled={busy} onClick={() => void signOut()}><LogOut size={15}/>Sign out</button></div>}
    </header>
    {!session ? <Skeleton/> : !session.authenticated ? <main className="ad-login-screen">
      <section className="ad-login-card">
        <div className="ad-security-badge"><LockKeyhole size={16}/> RESTRICTED ACCESS</div>
        <h1>Limited admin sign-in</h1>
        <p className="ad-login-copy">Use the email and access code issued by your super administrator.</p>
        <form onSubmit={signIn}>
          <label htmlFor="limited-email">Staff email</label>
          <input id="limited-email" type="email" maxLength={200} required value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="limited-code">Staff access code</label>
          <input id="limited-code" type="password" autoComplete="off" maxLength={100} required value={code} onChange={event => setCode(event.target.value)} />
          {error && <p className="ad-login-error" role="alert">{error}</p>}
          <button className="ad-primary-btn" disabled={busy}>Sign in as limited admin<ArrowRight size={16}/></button>
        </form>
        <a className="ad-link-btn" href="/admin">Super-admin sign-in</a>
      </section>
    </main> : <div className="ad-layout">
      <aside className="ad-sidebar"><p className="ad-side-label">LIMITED ACCESS</p><a className="active" href="/admin/limited"><UsersRound size={17}/>Assigned workspaces</a></aside>
      <main className="ad-content">
        <div className="ad-page-intro"><div><p className="ad-eyebrow">WORKSPACE ADMINISTRATION</p><h1>Assigned workspaces</h1><p>Create customer workspaces and manage the workspaces assigned to you.</p></div><button className="ad-outline-btn" disabled={busy} onClick={() => { setError(""); setReload(n => n + 1); }}><RefreshCw size={15}/>Refresh</button></div>
        {error && <p className="ad-alert" role="alert">{error}</p>}
        {notice && <p className="ad-success" role="status"><Check size={14}/>{notice}</p>}
        <section className="ad-panel ad-setting-card" aria-label="Customer workspace setup">
          <h2>Create customer workspace</h2>
          <p>Remaining funding budget: <strong>{money(fundingAvailable)}</strong></p>
          <p>Funding can only go to eligible customer workspaces you created and still manage. A super admin issues customer sign-in access.</p>
          <form className="ad-staff-form" onSubmit={createCustomer}>
            <input aria-label="Customer display name" placeholder="Display name" required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)}/>
            <button className="ad-primary-small" disabled={busy || !customerName.trim()}>Create customer</button>
          </form>
        </section>
        <section className="ad-panel ad-table-panel"><div className="ad-table-scroll"><table className="ad-table">
          <thead><tr><th>WORKSPACE</th><th>STATUS</th><th>ACCOUNTS</th><th>ACTIONS</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.suspended ? "Suspended" : "Active"}</td><td>{row.accountCount}</td><td><div className="ad-inline-actions">
            <button className="ad-outline-btn" disabled={busy} onClick={() => { setSelected(row.id); setSubject(""); setMessage(""); setNotice(""); setError(""); }}>View workspace</button>
            <button className="ad-outline-btn" disabled={busy} onClick={() => void changeAccess(row)}>{row.suspended ? "Restore access" : "Suspend access"}</button>
          </div></td></tr>)}{!rows.length && <tr><td colSpan={4} className="ad-empty-table">No workspaces are assigned to you.</td></tr>}</tbody>
        </table></div></section>
        {details?.summary.id === selected && <section className="ad-panel ad-setting-card" aria-label="Assigned workspace details">
          <h2>{rows.find(row => row.id === selected)?.name ?? details.summary.label}</h2>
          <WorkspaceRecords details={details}/>
          <OpenAccountForm key={selected} endpoint={`staff/workspaces/${selected}/accounts`} disabled={rows.find(row => row.id === selected)?.suspended} onChanged={() => setReload(n => n + 1)}/>
          {details.canFund && <details className="ad-detail-section ad-setting-card" key={`fund:${selected}`}>
            <summary>Allocate funding</summary>
            {rows.find(row => row.id === selected)?.suspended ? <p>Restore workspace access before allocating funds.</p> :
              details.accounts.some(account => account.openingDate && ["checking", "savings"].includes(account.type)) ?
                <FundingForm endpoint={`staff/workspaces/${selected}/funding`}
                  accounts={details.accounts.filter(account => account.openingDate && ["checking", "savings"].includes(account.type))}
                  onDone={({ fundingAvailable }) => {
                    if (fundingAvailable !== undefined) setFundingAvailable(fundingAvailable);
                    setNotice("Customer account funded."); setReload(n => n + 1);
                  }}/> : <p>Open a dated checking or savings account first.</p>}
          </details>}
          <form className="ad-staff-form" onSubmit={sendMessage}>
            <input aria-label="Message subject" placeholder="Subject" maxLength={160} required value={subject} onChange={event => setSubject(event.target.value)}/>
            <input aria-label="Workspace message" placeholder="Message" maxLength={450} required value={message} onChange={event => setMessage(event.target.value)}/>
            <button className="ad-primary-small" disabled={busy || !subject.trim() || !message.trim()}>Send message</button>
          </form>
        </section>}
      </main>
    </div>}
    <SiteFooter onLeave={onLeave || (() => {})}/>
  </div>;
}
