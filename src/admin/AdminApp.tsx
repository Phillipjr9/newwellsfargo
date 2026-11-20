import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  Clock3,
  Database,
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
import { catalogData } from "../public/catalog-data";
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
        <div className="ad-deposit-hole"><small>Sample deposits</small><strong>{money(total)}</strong><span>Fictional balances only</span></div>
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
  readOnly: true;
}

interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  scope: string;
  workspace: string | null;
}

interface WorkspaceDetail {
  summary: WorkspaceSummary;
  accounts: { id: string; name: string; type: string; last4: string; balance: number; limit?: number; points?: number }[];
  recentPayments: { id: string; kind: string; status: string; amount: number; date: string; toName: string }[];
}

type Page = "overview" | "workspaces" | "activity" | "settings";

interface AdminSession {
  authenticated: boolean;
  adminEnabled: boolean;
  demoHint: string | null;
}

const routesCount = Object.keys(catalogData).length;

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
  return <div className="ad-trend-chart"><div className="ad-chart-lines"><i/><i/><i/></div><svg viewBox="0 0 560 170" preserveAspectRatio="none" role="img" aria-label="Sample transaction counts for the last seven days">
    <defs><linearGradient id="admin-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#902e43" stopOpacity=".18"/><stop offset="1" stopColor="#902e43" stopOpacity=".015"/></linearGradient></defs>
    <path d={`M ${data.map((d, i) => `${i * 93 + 6},${145 - (d.count / max) * 111}`).join(" L ")} L 564 170 L 6 170 Z`} fill="url(#admin-area-fill)"/>
    <path d={`M ${data.map((d, i) => `${i * 93 + 6},${145 - (d.count / max) * 111}`).join(" L ")}`} fill="none" stroke="#842b3f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    {data.map((d, i) => <circle key={d.key} cx={i * 93 + 6} cy={145 - (d.count / max) * 111} r="4" fill="#fff" stroke="#842b3f" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}
  </svg><div className="ad-chart-labels">{data.map(d => <span key={d.key}>{d.label}</span>)}</div></div>;
}

function Login({ hint, onLogin }: { hint?: string | null; onLogin: () => void }) {
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
      <div className="ad-login-brand"><img src={wordmark} alt="Wells Fargo"/><span>Demo administration</span></div>
      <div className="ad-security-badge"><LockKeyhole size={16}/> RESTRICTED ACCESS</div>
      <h1>Administration</h1>
      <p className="ad-login-copy">Manage the independent banking preview workspace. This console has no connection to Wells Fargo production systems or customer accounts.</p>
      <form onSubmit={submit}>
        <label htmlFor="admin-access-token">Admin access code</label>
        <input id="admin-access-token" name="password" type="password" autoComplete="current-password" required value={token} onChange={e => setToken(e.target.value)} placeholder="Enter server access code"/>
        {error && <p className="ad-login-error" role="alert">{error}</p>}
        <button className="ad-primary-btn" disabled={busy}>{busy ? "Verifying…" : "Open admin console"}<ArrowRight size={16}/></button>
      </form>
      {hint && <button type="button" className="ad-primary-btn ad-one-click-admin" disabled={busy} onClick={quickLogin}>{busy ? "Opening…" : "One-click super admin"}<KeyRound size={16}/></button>}
      {hint && <p className="ad-demo-hint">Local preview access code: <code>{hint}</code></p>}
      {!hint && <p className="ad-demo-hint">Set <code>DEMO_ADMIN_TOKEN</code> on the server to enable admin access.</p>}
      <p className="ad-login-foot"><ShieldCheck size={15}/> Activity is limited to fictional demo workspaces.</p>
    </section>
  </main>;
}

function Overview({ data, onSelect }: { data: AdminData; onSelect: (id: string) => void }) {
  const kpis = [
    { label: "Demo workspaces", value: data.totals.workspaces.toLocaleString(), delta: "Isolated sample data only", icon: UsersRound, tone: "wine" },
    { label: "Sample accounts", value: data.totals.accounts.toLocaleString(), delta: "Across all demo workspaces", icon: CreditCard, tone: "blue" },
    { label: "Payments processed today", value: data.totals.completedToday.toLocaleString(), delta: `${money(data.totals.todayOutflow)} simulated outflow`, icon: ArrowUpRight, tone: "green" },
    { label: "Pending schedules", value: data.totals.scheduled.toLocaleString(), delta: "Not real or bank-submitted", icon: Clock3, tone: "gold" },
  ];
  return <>
    <div className="ad-page-intro"><div><p className="ad-eyebrow">DEMO OPERATIONS</p><h1>System overview</h1><p>Live aggregates from fictional preview workspaces. No real customers or accounts.</p></div><span className="ad-live"><i/> Local demo API</span></div>
    <section className="ad-kpis">{kpis.map(({label,value,delta,icon:Icon,tone})=><article className="ad-kpi" key={label}><span className={`ad-kpi-icon ${tone}`}><Icon size={19}/></span><span className="ad-kpi-title">{label}</span><strong>{value}</strong><small>{delta}</small></article>)}</section>
    <div className="ad-main-grid">
      <section className="ad-panel ad-trend-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">DEMO PLATFORM</p><h2>Sample ledger activity</h2></div><span className="ad-select-label">Last 7 days</span></div><Trend rows={data.dailyActivity}/><div className="ad-chart-legend"><span><i/> Transaction entries dated that day</span><span>Demo ledger only · not bank traffic</span></div></section>
      <section className="ad-panel ad-platform-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">SANDBOX ONLY</p><h2>Environment status</h2></div><ShieldCheck size={19} className="ad-ok"/></div><div className="ad-environment"><span>Public website</span><strong><i/> Read-only source pages</strong></div><div className="ad-environment"><span>Demo ledger API</span><strong><i/> Operational</strong></div><div className="ad-environment"><span>External money rails</span><strong className="ad-disabled"><i/> Disabled</strong></div><div className="ad-demo-note"><ShieldCheck size={16}/><span>Balances, recipients, and transactions are fictional sample data.</span></div></section>
    </div>
    <section className="ad-panel ad-balance-mix"><div className="ad-panel-head"><div><p className="ad-eyebrow">DEPOSIT OVERVIEW</p><h2>Sample deposit balances</h2></div><span className="ad-readonly-pill"><Eye size={13}/> Anonymized workspace aggregates</span></div><DepositMix checking={data.totals.checkingBalances} savings={data.totals.savingsBalances}/></section>
    <section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><p className="ad-eyebrow">SESSION INVENTORY</p><h2>Recent demo workspaces</h2></div><a className="ad-link-btn" href="/admin/workspaces">All workspaces<ArrowRight size={14}/></a></div><WorkspaceTable rows={data.workspaces.slice(0,6)} onSelect={onSelect}/></section>
  </>;
}

function WorkspaceTable({ rows, onSelect, search = "" }: { rows: WorkspaceSummary[]; onSelect: (id: string) => void; search?: string }) {
  const filtered = rows.filter(w => `${w.label} ${w.id}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>DEMO WORKSPACE</th><th>ACCOUNTS</th><th>LEDGER ENTRIES</th><th>PAYMENTS</th><th>SCHEDULED</th><th>LAST UPDATED</th><th/></tr></thead><tbody>
    {filtered.map(w=><tr key={w.id}><td><button className="ad-workspace-link" onClick={()=>onSelect(w.id)}><span className="ad-workspace-dot">D</span><span><strong>{w.label}</strong><small>Sample data workspace</small></span></button></td><td>{w.accountCount}</td><td>{w.transactionCount}</td><td>{w.paymentCount}</td><td><span className={`ad-count-pill ${w.scheduledCount ? "scheduled" : ""}`}>{w.scheduledCount}</span></td><td>{stamp(w.updated)}</td><td><button className="ad-table-arrow" aria-label={`View ${w.label}`} onClick={()=>onSelect(w.id)}><ArrowRight size={16}/></button></td></tr>)}
    {filtered.length===0 && <tr><td colSpan={7} className="ad-empty-table">No demo workspaces match.</td></tr>}
  </tbody></table></div>;
}

function Workspaces({ rows, onSelect, refresh }: { rows: WorkspaceSummary[]; onSelect: (id: string) => void; refresh: () => void }) {
  const [search,setSearch]=useState("");
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">DEMO OPERATIONS</p><h1>Workspaces</h1><p>Inspect aggregate metadata for independent, fictional demo sessions.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh inventory</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>All workspaces <span className="ad-table-count">{rows.length}</span></h2></div><label className="ad-searchbox"><Search size={15}/><input aria-label="Search workspace IDs" placeholder="Search workspace ID" value={search} onChange={e=>setSearch(e.target.value)}/></label></div><WorkspaceTable rows={rows} onSelect={onSelect} search={search}/></section><p className="ad-safe-foot"><LockKeyhole size={14}/> Customer names, messages, account identifiers, and transaction descriptions are not exposed.</p></>;
}

function WorkspaceDetails({ id, onClose, refresh }: { id: string; onClose: () => void; refresh: () => void }) {
  const [details,setDetails]=useState<WorkspaceDetail|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<"reset"|"remove"|null>(null),[toast,setToast]=useState("");
  useEffect(()=>{let active=true;api<WorkspaceDetail>(`workspaces/${id}`).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[id]);
  async function act(kind: "reset"|"remove") {setBusy(true);setError("");try{if(kind==="reset"){await api(`workspaces/${id}/reset`,{method:"POST",body:"{}"});setDetails(await api(`workspaces/${id}`));setToast("Sample workspace reset to its original fictional demo data.");}else{await api(`workspaces/${id}`,{method:"DELETE",body:"{}"});refresh();onClose();return;}setConfirm(null)}catch(e){setError(e instanceof Error?e.message:"Admin action failed.")}finally{setBusy(false)}}
  return <div className="ad-drawer-shade" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="ad-workspace-drawer" role="dialog" aria-modal="true" aria-label="Demo workspace details"><div className="ad-drawer-head"><div><p className="ad-eyebrow">SAMPLE TENANT</p><h2>{details?.summary.label ?? id.slice(0,12)}</h2></div><button className="ad-icon-btn" aria-label="Close workspace details" onClick={onClose}><X size={19}/></button></div>{error&&<p className="ad-alert">{error}</p>}{toast&&<p className="ad-success"><Check size={14}/>{toast}</p>}
    {details&&<><p className="ad-tenant-disclaimer"><ShieldCheck size={15}/>Fictional profile and balances; sandbox ledger only.</p><div className="ad-detail-metrics"><span><small>Accounts</small><strong>{details.summary.accountCount}</strong></span><span><small>Transactions</small><strong>{details.summary.transactionCount}</strong></span><span><small>Schedules</small><strong>{details.summary.scheduledCount}</strong></span><span><small>Sample deposits</small><strong>{money(details.summary.sampleDepositTotal)}</strong></span></div>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Sample accounts</h3><Eye size={15}/></div>{details.accounts.map(a=><div className="ad-detail-row" key={a.id}><span><strong>{a.name}</strong><small>{a.type} ····{a.last4}</small></span><b>{money(a.balance)}</b></div>)}</section>
      <section className="ad-detail-section"><div className="ad-panel-head"><h3>Recent simulated payments</h3><Activity size={15}/></div>{details.recentPayments.length?details.recentPayments.map(p=><div className="ad-detail-row" key={p.id}><span><strong>{p.toName}</strong><small>{p.kind} · {p.status} · {p.date}</small></span><b>{money(p.amount)}</b></div>):<p className="ad-muted-empty">No demo payments yet.</p>}</section>
      <div className="ad-tenant-actions"><button className="ad-outline-btn" onClick={()=>setConfirm("reset")}><RotateCcw size={15}/>Reset sample data</button><button className="ad-danger-btn" onClick={()=>setConfirm("remove")}><Trash2 size={15}/>Delete workspace</button></div>
      <p className="ad-detail-stamp">Last activity · {stamp(details.summary.updated)}</p>
    </>}
    {confirm&&<div className="ad-confirm-shade"><div className="ad-confirm-dialog" role="alertdialog"><h3>{confirm==="reset"?"Reset fictional data?":"Delete demo workspace?"}</h3><p>{confirm==="reset"?"This removes sample transfers and preferences and restores the original fictional accounts. The workspace identifier stays the same.":"This permanently removes this demo workspace and all its sample transactions. Real accounts are never affected."}</p>{error&&<p className="ad-login-error">{error}</p>}<div><button className="ad-outline-btn" onClick={()=>{setConfirm(null);setError("")}}>Keep workspace</button><button className="ad-danger-btn" disabled={busy} onClick={()=>act(confirm)}>{busy?"Working…":confirm==="reset"?"Reset sample data":"Delete workspace"}</button></div></div></div>}</aside></div>;
}

function Audit({ rows, refresh }: { rows: AuditEntry[]; refresh: () => void }) {
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">RESTRICTED OPERATIONS</p><h1>Audit trail</h1><p>Records of admin access and actions against fictional workspaces.</p></div><button className="ad-outline-btn" onClick={refresh}><RefreshCw size={15}/>Refresh log</button></div><section className="ad-panel ad-table-panel"><div className="ad-panel-head"><div><h2>Admin activity</h2><p>Newest first · maximum 250 recent records</p></div><LockKeyhole size={17} className="ad-muted"/></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>WORKSPACE</th><th>SCOPE</th></tr></thead><tbody>{rows.map((e,i)=><tr key={`${e.at}-${i}`}><td>{stamp(e.at)}</td><td><span className="ad-role-pill">Super admin</span></td><td>{e.action.replace(/_/g," ")}</td><td>{e.workspace||"—"}</td><td>{e.scope}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="ad-empty-table">No admin actions recorded yet.</td></tr>}</tbody></table></div></section><p className="ad-safe-foot"><ShieldCheck size={14}/>Audit history contains workspace identifiers only; no customers or transaction descriptions.</p></>;
}

function AdminSettings() {
  return <><div className="ad-page-intro"><div><p className="ad-eyebrow">CONFIGURATION</p><h1>Admin settings</h1><p>Administrative settings for the independent sample-data environment.</p></div></div><section className="ad-settings-grid"><article className="ad-panel ad-setting-card"><span className="ad-setting-symbol"><ShieldCheck size={21}/></span><h2>Workspace boundary</h2><p>This console only reads, resets, or removes fictional demo ledgers created by this application. It cannot access banking credentials, payment networks, or Wells Fargo production systems.</p><span className="ad-feature-status"><Check size={14}/>Enforced on the server</span></article><article className="ad-panel ad-setting-card"><span className="ad-setting-symbol"><KeyRound size={21}/></span><h2>Authentication</h2><p>In production, set a unique <code>DEMO_ADMIN_TOKEN</code> environment secret. Admin sessions are signed, HTTP-only, same-site cookies and expire after one hour.</p><span className="ad-feature-status"><Check size={14}/>1-hour signed session</span></article><article className="ad-panel ad-setting-card"><span className="ad-setting-symbol"><Database size={21}/></span><h2>Sample data storage</h2><p>Isolated ledger files are stored locally with owner-only file permissions. Set <code>DEMO_DATA_DIR</code> to change the directory.</p><span className="ad-feature-status"><Check size={14}/>Isolated per workspace</span></article><article className="ad-panel ad-setting-card"><span className="ad-setting-symbol"><Activity size={21}/></span><h2>Public snapshot catalog</h2><p>Captured public pages render from the catalog. Update the source snapshot with <code>npm run catalog:build</code> and <code>npm run catalog:pack</code>.</p><span className="ad-feature-status"><Check size={14}/>{routesCount.toLocaleString()} captured routes</span></article></section></>;
}

function Skeleton() { return <div className="ad-admin-loading"><span/><span/><span/></div>; }

export default function AdminApp() {
  const { path: raw, navigate } = useRouter();
  const [auth,setAuth]=useState<boolean|null>(null),[hint,setHint]=useState<string|null>(null),[data,setData]=useState<AdminData|null>(null),[audit,setAudit]=useState<AuditEntry[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[drawer,setDrawer]=useState("");
  const path=raw.toLowerCase().replace(/\/+$/,"")||"/admin";
  const page:Page=path.startsWith("/admin/workspaces")?"workspaces":path==="/admin/activity"?"activity":path==="/admin/settings"?"settings":"overview";
  useEffect(()=>{let active=true;api<AdminSession>("session").then(s=>{if(active){setAuth(s.authenticated);setHint(s.demoHint);if(!s.adminEnabled)setError("Super admin access is disabled until the server sets DEMO_ADMIN_TOKEN.")}}).catch(e=>{if(active){setAuth(false);setError(e.message)}});return()=>{active=false}},[]);
  const load=useCallback(async()=>{setLoading(true);setError("");try{const d=await api<AdminData>("overview");setData(d);setAudit(d.audit)}catch(e){setError(e instanceof Error?e.message:"Could not load demo operations.")}finally{setLoading(false)}},[]);
  useEffect(()=>{if(auth)void load()},[auth,load,page]);
  const select=(id:string)=>setDrawer(id);
  async function signout(){try{await api("session",{method:"DELETE",body:"{}"})}finally{setAuth(false);setData(null);setDrawer("");navigate("/admin")}}
  return <main className="ad-shell"><header className="ad-top"><a href="/admin" className="ad-brand"><img src={wordmark} alt="Wells Fargo"/><span/><b>Preview control room</b></a>{auth&&<div className="ad-top-right"><span><i/> Fictional-data environment</span><button onClick={signout}><LogOut size={15}/>Sign out</button></div>}</header>{!auth?<Login hint={hint} onLogin={()=>{setAuth(true);setError("")}}/>:<div className="ad-layout"><aside className="ad-sidebar"><p className="ad-side-label">CONTROL ROOM</p>{([{id:"overview",label:"Overview",icon:LayoutDashboard,href:"/admin"},{id:"workspaces",label:"Workspaces",icon:UsersRound,href:"/admin/workspaces"},{id:"activity",label:"Audit trail",icon:HistoryIcon,href:"/admin/activity"},{id:"settings",label:"Settings",icon:Settings2,href:"/admin/settings"}] as const).map(({id,label,icon:Icon,href})=><a key={id} href={href} className={page===id?"active":""}><Icon size={17}/>{label}</a>)}<div className="ad-sidebar-bottom"><ShieldCheck size={18}/><span>Server-authenticated. Sample data only.</span></div></aside><section className="ad-content"><div className="ad-content-head"><div><span>WELLS FARGO <b>/</b> ADMIN</span><div>Demo operations</div></div><button disabled={loading} onClick={load}><RefreshCw size={15} className={loading?"ad-spin":""}/>Refresh</button></div>{error&&<p className="ad-alert" role="alert">{error} <button onClick={load}>Retry</button></p>}{!data?<Skeleton/>:page==="overview"?<Overview data={data} onSelect={select}/>:page==="workspaces"?<Workspaces rows={data.workspaces} onSelect={select} refresh={load}/>:page==="activity"?<Audit rows={audit} refresh={load}/>:<AdminSettings/>}<footer className="ad-legal"><ShieldCheck size={14}/>Independent preview administration · no connection to Wells Fargo production systems · sample customer records only</footer></section>{drawer&&<WorkspaceDetails id={drawer} onClose={()=>setDrawer("")} refresh={load}/>}</div>}</main>;
}