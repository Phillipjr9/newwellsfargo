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
  KeyRound,
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
import { money } from "../portal/model";
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

interface StaffEntry {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
  accounts: { id: string; name: string; type: string; last4: string; balance: number; limit?: number; points?: number }[];
  recentPayments: { id: string; kind: string; status: string; amount: number; date: string; toName: string }[];
}

type Page = "overview" | "workspaces" | "customers" | "transactions" | "messages" | "activity" | "settings";

interface AdminSession {
  authenticated: boolean;
  adminEnabled: boolean;
  demoHint: string | null;
}


async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Admin request failed. Please try again.");
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

function Login({ hint, onLogin, onLeave }: { hint?: string | null; onLogin: () => void; onLeave?: (url: string) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("session", { method: "POST", body: JSON.stringify({ token }) }); onLogin(); }
    catch (e) { setError(e instanceof Error ? e.message : "Admin access unavailable."); }
    finally { setBusy(false); }
  }
  async function quickLogin() {
    setBusy(true);
    setError("");
    try {
      const quickToken = hint || "";
      await api("session", { method: "POST", body: JSON.stringify({ token: quickToken }) });
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admin access unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="ad-login-screen">
    <section className="ad-login-card">
      <div className="ad-login-brand"><img src={wordmark} alt="Wells Fargo"/><span>Super administration</span></div>
      <div className="ad-security-badge"><LockKeyhole size={16}/> RESTRICTED ACCESS</div>
      <h1>Administration</h1>
      <p className="ad-login-copy">Manage the banking workspace administration console. This console is separate from Wells Fargo production systems and customer accounts.</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-access-token">Admin access code</label>
        <input id="admin-access-token" name="password" type="password" autoComplete="current-password" required value={token} onChange={e => setToken(e.target.value)} placeholder="Enter server access code"/>
        {error && <p className="ad-login-error" role="alert">{error}</p>}
        <button className="ad-primary-btn" disabled={busy}>{busy ? "Verifying…" : "Open admin console"}<ArrowRight size={16}/></button>
      </form>
      {hint && <button type="button" className="ad-primary-btn ad-one-click-admin" disabled={busy} onClick={quickLogin}>{busy ? "Opening…" : "One-click super admin"}<KeyRound size={16}/></button>}
      {hint && <p className="ad-demo-hint">Local access code: <code>{hint}</code></p>}
      {!hint && <p className="ad-demo-hint">Configure the server access code to enable admin access.</p>}
      <p className="ad-login-foot"><ShieldCheck size={15}/> Activity is limited to configured workspaces.</p>
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
    {filtered.map(w=><tr key={w.id}><td><button className="ad-workspace-link" onClick={()=>onSelect(w.id)}><span className="ad-workspace-dot">D</span><span><strong>{w.label}</strong><small>Customer workspace</small></span></button></td><td>{w.accountCount}</td><td>{w.transactionCount}</td><td>{w.paymentCount}</td><td><span className={`ad-count-pill ${w.scheduledCount ? "scheduled" : ""}`}>{w.scheduledCount}</span></td><td>{stamp(w.updated)}</td><td><button className="ad-table-arrow" aria-label={`View ${w.label}`} onClick={()=>onSelect(w.id)}><ArrowRight size={16}/></button></td></tr>)}
    {filtered.length===0 && <tr><td colSpan={7} className="ad-empty-table">No workspaces match.</td></tr>}
  </tbody></table></div>;
}

function Workspaces({ rows, onSelect, refresh }: { rows: WorkspaceSummary[]; onSelect: (id: string) => void; refresh: () => void }) {
  const [search,setSearch]=useState("");
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">OPERATIONS</p><h1>Workspaces</h1><p>Inspect aggregate metadata for workspace sessions.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh inventory</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>All workspaces <span className="ad-table-count">{rows.length}</span></h2></div><label className="ad-searchbox"><Search size={15}/><input aria-label="Search workspace IDs" placeholder="Search workspace ID" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><WorkspaceTable rows={rows} onSelect={onSelect} search={search}/></section><p className="ad-safe-foot"><LockKeyhole size={14}/> Customer names, messages, account identifiers, and transaction descriptions are not exposed.</p></>;
}

function WorkspaceDetails({ id, onClose, refresh }: { id: string; onClose: () => void; refresh: () => void }) {
  const [details,setDetails]=useState<WorkspaceDetail|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<"reset"|"remove"|null>(null),[toast,setToast]=useState("");
  useEffect(()=>{let active=true;api<WorkspaceDetail>(`workspaces/${id}`).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[id]);
  async function act(kind: "reset"|"remove") {setBusy(true);setError("");try{if(kind==="reset"){await api(`workspaces/${id}/reset`,{method:"POST",body:"{}"});setDetails(await api(`workspaces/${id}`));setToast("Workspace reset to its original account data.");}else{await api(`workspaces/${id}`,{method:"DELETE",body:"{}"});refresh();onClose();return;}setConfirm(null)}catch(e){setError(e instanceof Error?e.message:"Admin action failed.")}finally{setBusy(false)}}
  return <div className="ad-drawer-shade" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ad-workspace-drawer" role="dialog" aria-modal="true" aria-label="Workspace details"><div className="ad-drawer-head"><div><p className="ad-eyebrow">WORKSPACE</p><h2>{details?.summary.label ?? id.slice(0,12)}</h2></div><button className="ad-icon-btn" aria-label="Close workspace details" onClick={onClose}><X size={19}/></button></div>{error&&<p className="ad-alert">{error}</p>}{toast&&<p className="ad-success"><Check size={14}/>{toast}</p>}
    {details&&<><p className="ad-tenant-disclaimer"><ShieldCheck size={15}/>Customer profile and workspace balances.</p><div className="ad-detail-metrics"><span><small>Accounts</small><strong>{details.summary.accountCount}</strong></span><span><small>Transactions</small><strong>{details.summary.transactionCount}</strong></span><span><small>Schedules</small><strong>{details.summary.scheduledCount}</strong></span><span><small>Deposits</small><strong>{money(details.summary.sampleDepositTotal)}</strong></span></div>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Accounts</h3><Eye size={15}/></div>{details.accounts.map(a=><div className="ad-detail-row" key={a.id}><span><strong>{a.name}</strong><small>{a.type} ····{a.last4}</small></span><b>{money(a.balance)}</b></div>)}</section>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Recent payments</h3><Activity size={15}/></div>{details.recentPayments.length?details.recentPayments.map(p=><div className="ad-detail-row" key={p.id}><span><strong>{p.toName}</strong><small>{p.kind} · {p.status} · {p.date}</small></span><b>{money(p.amount)}</b></div>):<p className="ad-muted-empty">No payments yet.</p>}</section>
      <div className="ad-tenant-actions"><button className="ad-outline-btn" onClick={()=>setConfirm("reset")}><RotateCcw size={15}/>Reset workspace</button><button className="ad-danger-btn" onClick={()=>setConfirm("remove")}><Trash2 size={15}/>Delete workspace</button></div>
      <p className="ad-detail-stamp">Last activity · {stamp(details.summary.updated)}</p>
    </>}
    {confirm&&<div className="ad-confirm-shade"><div className="ad-confirm-dialog" role="alertdialog"><h3>{confirm==="reset"?"Reset workspace?":"Delete workspace?"}</h3><p>{confirm==="reset"?"This removes transfers and preferences and restores the original accounts. The workspace identifier stays the same.":"This permanently removes this workspace and all its transactions."}</p>{error&&<p className="ad-login-error">{error}</p>}<div><button className="ad-outline-btn" onClick={()=>{setConfirm(null);setError("")}}>Keep workspace</button><button className="ad-danger-btn" disabled={busy} onClick={()=>act(confirm)}>{busy?"Working…":confirm==="reset"?"Reset workspace":"Delete workspace"}</button></div></div></div>}</aside></div>;
}

function Audit({ rows, refresh }: { rows: AuditEntry[]; refresh: () => void }) {
  const [action,setAction]=useState(""),[actor,setActor]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[filtered,setFiltered]=useState(rows),[busy,setBusy]=useState(false);
  async function apply(){setBusy(true);try{const q=new URLSearchParams();if(action)q.set("action",action);if(actor)q.set("actor",actor);if(from)q.set("from",from);if(to)q.set("to",to);const r=await api<{entries:AuditEntry[]}>(`audit?${q}`);setFiltered(r.entries);}finally{setBusy(false)}}
  async function exportCsv(){const r=await fetch("/api/admin/audit?format=csv",{credentials:"same-origin",headers:{"Content-Type":"application/json"}});const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="admin-audit.csv";a.click();URL.revokeObjectURL(url)}
  useEffect(()=>setFiltered(rows),[rows]);
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">RESTRICTED OPERATIONS</p><h1>Audit trail</h1><p>Records of admin access and workspace actions.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh log</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>Admin activity</h2><p>Newest first · server-filtered records</p></div><div className="ad-inline-actions"><button className="ad-outline-btn" onClick={exportCsv}>Export CSV</button><LockKeyhole size={17} className="ad-muted"/></div></div><div className="ad-audit-filters"><input aria-label="Action filter" placeholder="Action" value={action} onChange={e=>setAction(e.target.value)}/><input aria-label="Actor filter" placeholder="Actor" value={actor} onChange={e=>setActor(e.target.value)}/><input aria-label="From date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input aria-label="To date" type="date" value={to} onChange={e=>setTo(e.target.value)}/><button className="ad-primary-small" disabled={busy} onClick={apply}>{busy?"Filtering…":"Apply filters"}</button></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>WORKSPACE</th><th>SCOPE</th></tr></thead><tbody>{filtered.map((e,i)=><tr key={`${e.at}-${i}`}><td>{stamp(e.at)}</td><td><span className="ad-role-pill">{e.actor}</span></td><td>{e.action.replace(/_/g," ")}</td><td>{e.workspace||"—"}</td><td>{e.scope}</td></tr>)}{!filtered.length&&<tr><td colSpan={5} className="ad-empty-table">No admin actions match.</td></tr>}</tbody></table></div></section><p className="ad-safe-foot"><ShieldCheck size={14}/>Audit history contains workspace identifiers only; no customers or transaction descriptions.</p></>;
}

function Customers({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(""),[search,setSearch]=useState("");
  useEffect(()=>{let active=true;api<{customers:any[]}>(`customers${search ? `?search=${encodeURIComponent(search)}` : ""}`).then(r=>{if(active)setRows(r.customers||[])}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Customer records unavailable.")});return()=>{active=false}},[search]);
  async function action(id:string, route:string){try{await api(`customers/${id}/${route}`,{method:"POST",body:"{}"});setRows(v=>v.filter(r=>r.id!==id||route!=="suspend"));}catch(e){setError(e instanceof Error?e.message:"Customer action failed.")}}
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">CUSTOMER ADMINISTRATION</p><h1>Customers</h1><p>Search, assign, suspend, restore, and inspect banking workspaces.</p></div></div>{error&&<p className="ad-alert">{error}</p>}<section className="ad-panel ad-table-panel"><div className="ad-panel-head"><label className="ad-searchbox"><Search size={15}/><input aria-label="Search customers" placeholder="Search customers" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>CUSTOMER</th><th>STATUS</th><th>ACCOUNTS</th><th>OWNER</th><th>ACTIONS</th></tr></thead><tbody>{rows.map(r=> <tr key={r.id}><td><button className="ad-workspace-link" onClick={()=>onSelect(r.id)}><strong>{r.name}</strong></button></td><td>{r.status}</td><td>{r.accountCount}</td><td>{r.ownerAdminId||"Super administrator"}</td><td><button className="ad-outline-btn" onClick={()=>action(r.id,"impersonate")}>Open banking</button></td></tr>)}</tbody></table></div></section></>;
}

function Transactions() {
  const [rows,setRows]=useState<any[]>([]),[search,setSearch]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let active=true;api<{transactions:any[]}>(`transactions${search ? `?search=${encodeURIComponent(search)}` : ""}`).then(r=>{if(active)setRows(r.transactions||[])}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Transactions unavailable.")});return()=>{active=false}},[search]);
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">LEDGER ADMINISTRATION</p><h1>Transactions</h1><p>Review and search ledger activity across every workspace.</p></div></div>{error&&<p className="ad-alert">{error}</p>}<section className="ad-panel ad-table-panel"><div className="ad-panel-head"><label className="ad-searchbox"><Search size={15}/><input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>DATE</th><th>DESCRIPTION</th><th>CATEGORY</th><th>STATUS</th><th>AMOUNT</th></tr></thead><tbody>{rows.map(r=> <tr key={r.id}><td>{r.date}</td><td>{r.description}</td><td>{r.category}</td><td>{r.status}</td><td>{money(r.amount)}</td></tr>)}</tbody></table></div></section></>;
}

function Messages() {
  const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(""),[subject,setSubject]=useState(""),[body,setBody]=useState(""),[workspace,setWorkspace]=useState("");
  useEffect(()=>{let active=true;api<{messages:any[]}>('messages').then(r=>{if(active)setRows(r.messages||[])}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Messages unavailable.")});return()=>{active=false}},[]);
  async function send(){if(!workspace)return setError("Select a workspace ID.");try{await api(`users/${workspace}/messages`,{method:"POST",body:JSON.stringify({subject,body})});setSubject("");setBody("");setError("");}catch(e){setError(e instanceof Error?e.message:"Message failed.")}}
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">SUPPORT ADMINISTRATION</p><h1>Messages</h1><p>Send support messages and review customer conversations.</p></div></div>{error&&<p className="ad-alert">{error}</p>}<section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div className="ad-staff-form"><input placeholder="Workspace ID" value={workspace} onChange={e=>setWorkspace(e.target.value)}/><input placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)}/><input placeholder="Message" value={body} onChange={e=>setBody(e.target.value)}/><button className="ad-primary-small" onClick={send}>Send</button></div></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>WORKSPACE</th><th>DIRECTION</th><th>SUBJECT</th><th>MESSAGE</th></tr></thead><tbody>{rows.map((r,i)=> <tr key={`${r.id||i}`}><td>{r.workspaceId||"—"}</td><td>{r.direction||"customer"}</td><td>{r.subject||"—"}</td><td>{r.body||r.message||"—"}</td></tr>)}</tbody></table></div></section></>;
}

function AdminSettings() {
  const [root,setRoot]=useState<RootIdentity|null>(null),[admins,setAdmins]=useState<StaffEntry[]>([]),[settings,setSettings]=useState<any>(null);
  const [rootName,setRootName]=useState(""),[rootEmail,setRootEmail]=useState(""),[staffName,setStaffName]=useState(""),[staffEmail,setStaffEmail]=useState(""),[staffRole,setStaffRole]=useState("staff");
  const [confirm,setConfirm]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let active=true;Promise.all([api<{identity:RootIdentity}>('me'),api<{admins:StaffEntry[]}>('admins'),api<{settings:any}>('settings')]).then(([m,a,s])=>{if(active){setRoot(m.identity);setRootName(m.identity.name);setRootEmail(m.identity.email);setAdmins(a.admins);setSettings(s.settings)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load settings.')});return()=>{active=false}},[]);
  async function saveIdentity(){try{const r=await api<{identity:RootIdentity}>('me',{method:'PUT',body:JSON.stringify({name:rootName,email:rootEmail})});setRoot(r.identity);setMessage('Root identity updated.')}catch(e){setError(e instanceof Error?e.message:'Update failed.')}}
  async function addStaff(e:FormEvent){e.preventDefault();try{const r=await api<{admin:StaffEntry}>('admins',{method:'POST',body:JSON.stringify({name:staffName,email:staffEmail,role:staffRole,active:true})});setAdmins(v=>[...v,r.admin]);setStaffName('');setStaffEmail('');setMessage('Staff identity created.')}catch(e){setError(e instanceof Error?e.message:'Creation failed.')}}
  async function saveSettings(){try{const r=await api<{settings:any}>('settings',{method:'PUT',body:JSON.stringify(settings)});setSettings(r.settings);setMessage('Settings saved.')}catch(e){setError(e instanceof Error?e.message:'Save failed.')}}
  async function updateStaff(id:string, changes:{name:string;role:string;active:boolean}){try{const r=await api<{admin:StaffEntry}>(`admins/${id}`,{method:'PUT',body:JSON.stringify(changes)});setAdmins(v=>v.map(a=>a.id===id?r.admin:a));setMessage('Staff identity updated.')}catch(e){setError(e instanceof Error?e.message:'Staff update failed.')}}
  async function deleteStaff(id:string){if(!window.confirm('Delete this staff identity?'))return;try{await api(`admins/${id}`,{method:'DELETE',body:'{}'});setAdmins(v=>v.filter(a=>a.id!==id));setMessage('Staff identity deleted.')}catch(e){setError(e instanceof Error?e.message:'Staff deletion failed.')}}
  async function backup(){const r=await fetch('/api/admin/backup',{credentials:'same-origin',headers:{'Content-Type':'application/json'}});if(!r.ok){setError('Backup export failed.');return;}const b=await r.blob();const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='banking-workspace-backup.json';a.click();URL.revokeObjectURL(u);setMessage('Backup downloaded.')}
  async function restore(){if(confirm!=="RESTORE")return setError('Type RESTORE first.');const input=document.createElement('input');input.type='file';input.accept='application/json';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{await api('restore',{method:'POST',body:JSON.stringify({...JSON.parse(await f.text()),confirmation:'RESTORE'})});setMessage('Backup restored.');setConfirm('')}catch(e){setError(e instanceof Error?e.message:'Restore failed.')}};input.click()}
  async function resetAll(){if(confirm!=="RESET ALL WORKSPACE DATA")return setError('Typed confirmation is required.');try{await api('reset',{method:'POST',body:JSON.stringify({confirmation:'RESET ALL WORKSPACE DATA'})});setMessage('All workspaces reset.');setConfirm('')}catch(e){setError(e instanceof Error?e.message:'Reset failed.')}}
  async function operation(path:string,label:string){try{await api(path,{method:'POST',body:'{}'});setMessage(`${label} completed.`)}catch(e){setError(e instanceof Error?e.message:`${label} failed.`)}}
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">CONFIGURATION</p><h1>Admin settings</h1><p>Root identity, staff, settings, backup, and typed destructive operations.</p></div></div>{error&&<p className="ad-alert">{error}</p>}{message&&<p className="ad-success"><Check size={14}/>{message}</p>}<section className="ad-settings-grid"><article className="ad-panel ad-setting-card"><h2>Root identity</h2>{root&&<><label>Name<input value={rootName} onChange={e=>setRootName(e.target.value)}/></label><label>Email<input value={rootEmail} onChange={e=>setRootEmail(e.target.value)}/></label><button className="ad-primary-small" onClick={saveIdentity}>Save identity</button></>}</article><article className="ad-panel ad-setting-card"><h2>Staff identities</h2><form className="ad-staff-form" onSubmit={addStaff}><input required placeholder="Name" value={staffName} onChange={e=>setStaffName(e.target.value)}/><input placeholder="Email" value={staffEmail} onChange={e=>setStaffEmail(e.target.value)}/><select value={staffRole} onChange={e=>setStaffRole(e.target.value)}><option value="staff">Staff</option><option value="administrator">Administrator</option><option value="viewer">Viewer</option></select><button className="ad-primary-small">Add staff</button></form><div className="ad-staff-list">{admins.map(a=> <div key={a.id}><strong>{a.name}</strong><span>{a.role}</span><button type="button" className="ad-outline-btn" onClick={()=>updateStaff(a.id,{name:a.name,role:a.role,active:!a.active})}>{a.active?'Suspend':'Activate'}</button><button type="button" className="ad-danger-btn" onClick={()=>deleteStaff(a.id)}><Trash2 size={14}/>Delete</button></div>)}</div></article><article className="ad-panel ad-setting-card"><h2>Runtime settings</h2>{settings&&<><label><input type="checkbox" checked={settings.maintenanceMode} onChange={e=>setSettings({...settings,maintenanceMode:e.target.checked})}/>Maintenance mode</label><label><input type="checkbox" checked={settings.allowWorkspaceReset} onChange={e=>setSettings({...settings,allowWorkspaceReset:e.target.checked})}/>Allow workspace reset</label><label><input type="checkbox" checked={settings.allowWorkspaceDelete} onChange={e=>setSettings({...settings,allowWorkspaceDelete:e.target.checked})}/>Allow workspace delete</label><button className="ad-primary-small" onClick={saveSettings}>Save settings</button></>}</article><article className="ad-panel ad-setting-card"><h2>Backup and operations</h2><div className="ad-inline-actions"><button className="ad-outline-btn" onClick={()=>operation('process-scheduled','Scheduled processing')}>Process scheduled</button><button className="ad-outline-btn" onClick={()=>operation('month-end-close','Month-end close')}>Month-end close</button></div><button className="ad-outline-btn" onClick={backup}>Download backup</button><label>Type <code>RESTORE</code><input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="ad-outline-btn" onClick={restore}>Restore backup</button><hr/><label>Type <code>RESET ALL WORKSPACE DATA</code><input value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="ad-danger-btn" onClick={()=>confirm==='RESET ALL WORKSPACE DATA'?resetAll():setError('Typed confirmation is required.')}>Reset all workspace data</button></article></section></>;
}

function Skeleton() { return <div className="ad-admin-loading"><span/><span/><span/></div>; }

export default function AdminApp({ onLeave }: { onLeave?: (url: string) => void } = {}) {
  const { path: raw, navigate } = useRouter();
  const [auth,setAuth]=useState<boolean|null>(null),[hint,setHint]=useState<string|null>(null),[data,setData]=useState<AdminData|null>(null),[audit,setAudit]=useState<AuditEntry[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[drawer,setDrawer]=useState("");
  const path=raw.toLowerCase().replace(/\/+$/,"")||"/admin";
  const page:Page=path.startsWith("/admin/workspaces")?"workspaces":path==="/admin/customers"?"customers":path==="/admin/transactions"?"transactions":path==="/admin/messages"?"messages":path==="/admin/activity"?"activity":path==="/admin/settings"?"settings":"overview";
  useEffect(()=>{let active=true;api<AdminSession>("session").then(s=>{if(active){setAuth(s.authenticated);setHint(s.demoHint);if(!s.adminEnabled)setError("Super admin access is disabled until a server access code is configured.")}}).catch(e=>{if(active){setAuth(false);setError(e.message)}});return()=>{active=false}},[]);
  const load=useCallback(async()=>{setLoading(true);setError("");try{const d=await api<AdminData>("overview");setData(d);setAudit(d.audit)}catch(e){setError(e instanceof Error?e.message:"Could not load administration operations.")}finally{setLoading(false)}},[]);
  useEffect(()=>{if(auth)void load()},[auth,load,page]);
  const select=(id:string)=>setDrawer(id);
  async function signout(){try{await api("session",{method:"DELETE",body:"{}"})}finally{setAuth(false);setData(null);setDrawer("");navigate("/admin")}}
  return <main className="ad-shell"><header className="ad-top"><a href="/admin" className="ad-brand"><img src={wordmark} alt="Wells Fargo"/><span/><b>Administration control room</b></a>{auth&&<div className="ad-top-right"><span><i/> Workspace environment</span><button onClick={signout}><LogOut size={15}/>Sign out</button></div>}</header>{!auth?<Login hint={hint} onLogin={()=>{setAuth(true);setError("")}} onLeave={onLeave}/>:<div className="ad-layout"><aside className="ad-sidebar"><p className="ad-side-label">CONTROL ROOM</p>{([{id:"overview",label:"Overview",icon:LayoutDashboard,href:"/admin"},{id:"workspaces",label:"Workspaces",icon:UsersRound,href:"/admin/workspaces"},{id:"customers",label:"Customers",icon:UsersRound,href:"/admin/customers"},{id:"transactions",label:"Transactions",icon:Activity,href:"/admin/transactions"},{id:"messages",label:"Messages",icon:HistoryIcon,href:"/admin/messages"},{id:"activity",label:"Audit trail",icon:HistoryIcon,href:"/admin/activity"},{id:"settings",label:"Settings",icon:Settings2,href:"/admin/settings"}] as const).map(({id,label,icon:Icon,href})=><a key={id} href={href} className={page===id?"active":""}><Icon size={17}/>{label}</a>)}<div className="ad-sidebar-bottom"><ShieldCheck size={18}/><span>Server-authenticated. Workspace records only.</span></div></aside><section className="ad-content"><div className="ad-content-head"><div><span>WELLS FARGO <b>/</b> ADMIN</span><div>Operations</div></div><button disabled={loading} onClick={load}><RefreshCw size={15} className={loading?"ad-spin":""}/>Refresh</button></div>{error&&<p className="ad-alert" role="alert">{error} <button onClick={load}>Retry</button></p>}{!data?<Skeleton/>:page==="overview"?<Overview data={data} onSelect={select}/>:page==="workspaces"?<Workspaces rows={data.workspaces} onSelect={select} refresh={load}/>:page==="activity"?<Audit rows={audit} refresh={load}/>:page==="customers"?<Customers onSelect={select}/>:page==="transactions"?<Transactions/>:page==="messages"?<Messages/>:<AdminSettings/>}<footer className="ad-legal"><ShieldCheck size={14}/>Administration console · separate from Wells Fargo production systems · workspace records only</footer><SiteFooter onLeave={onLeave || (() => {})}/></section>{drawer&&<WorkspaceDetails id={drawer} onClose={()=>setDrawer("")} refresh={load}/>}</div>}</main>;
}