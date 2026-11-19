import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Download,
  FileText,
  Info,
  Inbox,
  LockKeyhole,
  MailOpen,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { day } from "../../shared/ledger.mjs";
import { useRouter } from "../router/RouterContext";
import Dialog from "../components/Dialog";
import { AccountArt, ActivityRows, SpendChart } from "./Overview";
import { PageBack, PageIntro, SideHelp } from "./Chrome";
import {
  balanceLabel,
  dateLabel,
  isDeposit,
  money,
  type Account,
  type Entry,
  type Workspace,
} from "./model";
import { ErrorMessage, MissingPage } from "./Payments";
import { runCommand } from "./store";

function downloadFile(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ActivitySection({
  state,
  account,
}: {
  state: Workspace;
  account?: Account;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(account?.id ?? "all"),
    [direction, setDirection] = useState("all");
  const [limit, setLimit] = useState(12);
  const transactions = state.transactions.filter(
    (t) =>
      (selected === "all" || selected === t.accountId) &&
      (direction === "all" ||
        (direction === "in" ? t.amount > 0 : t.amount < 0)) &&
      `${t.description} ${t.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function exportActivity() {
    const cell = (text: string) => `"${text.replace(/"/g, '""')}"`;
    const rows = transactions.map((t) =>
      [
        t.date,
        t.description,
        state.accounts.find((a) => a.id === t.accountId)?.name || "",
        t.category,
        (t.amount / 100).toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
    downloadFile(
      "DEMO-sample-activity.csv",
      [
        "SIMULATED DATA - NOT A BANK STATEMENT",
        "Date,Description,Sample account,Category,Amount (USD)",
        ...rows,
      ].join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }
  return (
    <section className="pb-panel pb-activity-panel">
      <div className="pb-panel-head">
        <h2>Account activity</h2>
        <button
          className="pb-action-link"
          onClick={exportActivity}
          disabled={!transactions.length || state.preferences.hideBalances}
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>
      <div className="pb-activity-filters">
        <label className="pb-searchbox">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search transactions"
            placeholder="Search transactions"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(12);
            }}
          />
        </label>
        {!account && (
          <label className="pb-inline-select">
            <span className="sr-only">Account</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="all">All accounts</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        )}
        <label className="pb-inline-select">
          <span className="sr-only">Transaction direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="all">All transactions</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
          <ChevronDown size={14} />
        </label>
      </div>
      <ActivityRows state={state} entries={transactions.slice(0, limit)} />
      <div className="pb-panel-foot pb-activity-count">
        <span>
          {Math.min(limit, transactions.length)} of {transactions.length}{" "}
          transactions
        </span>
        {limit < transactions.length && (
          <button
            className="pb-action-link"
            onClick={() => setLimit(limit + 12)}
          >
            Show more <ChevronDown size={14} />
          </button>
        )}
      </div>
    </section>
  );
}

export function AccountActivity({
  state,
  id,
}: {
  state: Workspace;
  id?: string;
}) {
  const account = state.accounts.find((a) => a.id === id);
  if (id && !account) return <MissingPage />;
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="My accounts"
        title={account?.name ?? "Account activity"}
        description={
          account
            ? `Sample account ending in ${account.last4}`
            : "Search and explore transactions across your sample accounts."
        }
      />
      {account && (
        <section className="pb-panel pb-account-details">
          <div className="pb-detail-account">
            <AccountArt account={account} />
            <span>
              <small>{balanceLabel(account)}</small>
              <strong>
                {state.preferences.hideBalances
                  ? "••••••"
                  : money(account.balance)}
              </strong>
            </span>
          </div>
          <div className="pb-detail-account-facts">
            {account.type === "credit" ? (
              <>
                <span>
                  Available credit
                  <b>
                    {state.preferences.hideBalances
                      ? "Hidden"
                      : money((account.limit ?? 0) - account.balance)}
                  </b>
                </span>
                <span>
                  Sample rewards<b>{account.points?.toLocaleString()} points</b>
                </span>
              </>
            ) : (
              <span>
                Account type
                <b>
                  {account.type === "loan"
                    ? "Home loan"
                    : account.type === "savings"
                      ? "Savings"
                      : account.type === "external"
                        ? "Linked bank"
                        : "Checking"}
                </b>
              </span>
            )}
          </div>
          <div className="pb-detail-links">
            <a
              className="pb-button pb-solid"
              href={
                isDeposit(account)
                  ? `/portal/transfers?from=${account.id}`
                  : account.type === "external"
                    ? `/portal/transfers/external?from=${account.id}`
                    : `/portal/account-payment?to=${account.id}`
              }
            >
              <ArrowLeftRight size={16} />
              {isDeposit(account) || account.type === "external"
                ? "Transfer money"
                : "Make a payment"}
            </a>
            <a
              className="pb-action-link"
              href={`/portal/statements?account=${account.id}`}
            >
              View documents <ChevronRight size={14} />
            </a>
          </div>
        </section>
      )}
      {account && (
        <dl className="pb-balance-facts">
          <div>
            <dt>Account ending</dt>
            <dd>{account.last4}</dd>
          </div>
          <div>
            <dt>
              {isDeposit(account)
                ? "Posted balance"
                : account.type === "credit"
                  ? "Credit limit"
                  : "Principal balance"}
            </dt>
            <dd>
              {state.preferences.hideBalances
                ? "Hidden"
                : money(
                    account.type === "credit"
                      ? (account.limit ?? 0)
                      : account.balance,
                  )}
            </dd>
          </div>
          <div>
            <dt>
              {account.type === "credit" ? "Card status" : "Account status"}
            </dt>
            <dd>
              {account.type === "credit" && state.preferences.cardLocked
                ? "Locked in demo"
                : "Active sample account"}
            </dd>
          </div>
        </dl>
      )}
      <ActivitySection state={state} account={account} />
    </>
  );
}

export function Statements({ state }: { state: Workspace }) {
  const { query } = useRouter();
  const [account, setAccount] = useState(
    state.accounts.some((a) => a.id === query.account) ? query.account : "all",
  );
  const [period, setPeriod] = useState(day().slice(0, 7));
  const [preview, setPreview] = useState<Account | null>(null);
  const periods = [
    ...new Set([
      day().slice(0, 7),
      ...state.transactions.map((t) => t.date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  const name = (p: string) =>
    new Date(`${p}-15T12:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const entries = (a: Account) =>
    state.transactions.filter(
      (t) => t.accountId === a.id && t.date.startsWith(period),
    );
  const formatLine = (t: Entry) =>
    `${t.date}   ${t.description}   ${money(t.amount)}`;
  function save(a: Account) {
    downloadFile(
      `DEMO-${a.id}-${period}-activity.txt`,
      [
        "SIMULATED ACTIVITY REPORT",
        "NOT A BANK STATEMENT. NOT PROOF OF FUNDS OR PAYMENT.",
        "",
        `Sample account: ${a.name} ending ${a.last4}`,
        `Month: ${name(period)}`,
        "Currency: USD",
        "",
        ...(entries(a).length
          ? entries(a).map(formatLine)
          : ["No sample transactions in this period."]),
        "",
        "Generated by an independent banking demonstration. No real funds or accounts are involved.",
      ].join("\n"),
    );
  }
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Account services"
        title="Statements & documents"
        description="Review and download monthly activity reports for your sample accounts."
      />
      <div className="pb-form-layout">
        <section className="pb-panel">
          <div className="pb-panel-head">
            <h2>My documents</h2>
            <FileText size={18} className="pb-muted" />
          </div>
          <div className="pb-document-filters">
            <label className="pb-field">
              Account
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="all">All accounts</option>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="pb-field">
              Statement period
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {name(p)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {state.accounts
            .filter((a) => account === "all" || a.id === account)
            .map((a) => (
              <div className="pb-document-row" key={a.id}>
                <span className="pb-soft-icon">
                  <FileText size={20} />
                </span>
                <div>
                  <strong>{a.name}</strong>
                  <small>
                    {name(period)} &middot; ending {a.last4}
                  </small>
                </div>
                <button
                  className="pb-action-link"
                  onClick={() => setPreview(a)}
                >
                  View report
                  <ChevronRight size={15} />
                </button>
              </div>
            ))}
          <div className="pb-panel-foot">
            <span className="pb-small-note">
              <Info size={15} />
              Demo reports are not official bank statements.
            </span>
          </div>
        </section>
        <SideHelp />
      </div>
      {preview && (
        <Dialog
          className="pb-detail-dialog"
          label="Sample monthly report"
          onClose={() => setPreview(null)}
        >
          <p className="pb-eyebrow">Demo report</p>
          <h2>{preview.name}</h2>
          <p className="pb-muted-copy">
            {name(period)} &middot; Sample account {preview.last4}
          </p>
          <div className="pb-report-entries">
            {entries(preview).length ? (
              entries(preview).map((t) => (
                <div key={t.id}>
                  <span>
                    {t.description}
                    <small>{dateLabel(t.date)}</small>
                  </span>
                  <b>
                    {state.preferences.hideBalances
                      ? "Hidden"
                      : money(t.amount)}
                  </b>
                </div>
              ))
            ) : (
              <p>No sample activity during this month.</p>
            )}
          </div>
          <p className="pb-simulation-note">
            Simulated activity only. Not proof of funds or payment.
          </p>
          <div className="pb-form-buttons">
            <button className="pb-text-btn" onClick={() => setPreview(null)}>
              Close
            </button>
            <button
              className="pb-button pb-solid"
              disabled={state.preferences.hideBalances}
              onClick={() => save(preview)}
            >
              <Download size={15} />
              Download demo report
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

type BooleanPreference = {
  [K in keyof Workspace["preferences"]]: Workspace["preferences"][K] extends boolean
    ? K
    : never;
}[keyof Workspace["preferences"]];

const settings: {
  key: BooleanPreference;
  title: string;
  detail: string;
}[] = [
  {
    key: "hideBalances",
    title: "Hide balances",
    detail: "Mask amounts on the summary, account activity, and reports.",
  },
  {
    key: "cardLocked",
    title: "Lock sample card",
    detail: "Mark the demo Autograph Card as locked in your workspace.",
  },
  {
    key: "paymentAlerts",
    title: "Payment updates",
    detail: "Show completed and scheduled demo payments in your inbox.",
  },
  {
    key: "largeTransactions",
    title: "Large transaction alerts",
    detail: "Show a message for demo payments of $500 or more.",
  },
  {
    key: "lowBalance",
    title: "Low balance alerts",
    detail: "Flag sample deposit balances below $100 in your inbox.",
  },
  {
    key: "paperless",
    title: "Paperless preference",
    detail:
      "Save your delivery preference. No paper or email is sent in this demo.",
  },
];
export function Preferences({ state }: { state: Workspace }) {
  const [saving, setSaving] = useState(""),
    [error, setError] = useState("");
  async function change(key: BooleanPreference) {
    setSaving(key);
    setError("");
    try {
      await runCommand({
        action: "preference",
        payload: { key, value: !state.preferences[key] },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save preference.");
    } finally {
      setSaving("");
    }
  }
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Security & support"
        title="Security & preferences"
        description="Personalize your demo workspace and notification settings."
      />
      <div className="pb-form-layout">
        <section className="pb-panel">
          <div className="pb-panel-head">
            <h2>Workspace preferences</h2>
            <Settings2 size={18} />
          </div>
          <ErrorMessage text={error} />
          {settings.map(({ key, title, detail }) => (
            <div className="pb-setting-row" key={key}>
              <div>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
              <button
                className={`pb-switch ${state.preferences[key] ? "on" : ""}`}
                role="switch"
                aria-label={title}
                aria-checked={Boolean(state.preferences[key])}
                disabled={!!saving}
                onClick={() => change(key)}
              >
                <span />
              </button>
            </div>
          ))}
          <div className="pb-panel-foot">
            <span className="pb-small-note">
              <CircleCheck size={15} />
              {saving
                ? "Saving..."
                : "Preferences are saved in this workspace."}
            </span>
          </div>
        </section>
        <aside className="pb-panel pb-side-help">
          <span className="pb-large-avatar">HJ</span>
          <h2>Henry Johnson</h2>
          <p>Sample customer profile</p>
          <div className="pb-rail-divider" />
          <p>
            No real customer profile, credentials, or contact details are used
            here.
          </p>
          <a
            href="https://www.wellsfargo.com/privacy-security/"
            target="_blank"
            rel="noreferrer"
          >
            <ShieldCheck size={17} />
            Official security center
          </a>
        </aside>
      </div>
    </>
  );
}

export function MessageCenter({ state }: { state: Workspace }) {
  const [error, setError] = useState("");
  const messages = [
    ...state.payments
      .filter(
        (p) => state.preferences.paymentAlerts && p.status !== "cancelled",
      )
      .slice(0, 5)
      .map((p) => ({
        title: `${p.status === "scheduled" ? "Upcoming" : "Updated"} ${p.kind === "transfer" ? "transfer" : "payment"}`,
        text: `Your sample transaction to ${p.toName} is ${p.status}.`,
        href: `/portal/payments/${p.id}`,
        icon: Bell,
      })),
    ...state.payments
      .filter(
        (p) =>
          state.preferences.largeTransactions &&
          p.status === "completed" &&
          p.amount >= 50000,
      )
      .slice(0, 2)
      .map((p) => ({
        title: "Large demo transaction",
        text: `A payment to ${p.toName} exceeded the $500 alert threshold.`,
        href: `/portal/payments/${p.id}`,
        icon: Bell,
      })),
    ...state.accounts
      .filter(
        (a) =>
          isDeposit(a) && a.balance < 10000 && state.preferences.lowBalance,
      )
      .map((a) => ({
        title: "Low balance alert",
        text: `Your ${a.name} sample balance is below $100.`,
        href: `/portal/accounts/${a.id}`,
        icon: Bell,
      })),
    {
      title: "Your account documents are ready",
      text: "Monthly sample activity reports are available in Statements & documents.",
      href: "/portal/statements",
      icon: FileText,
    },
    {
      title: "A reminder about this demo",
      text: "Never enter a real banking password, account number, or payment recipient here.",
      href: "/portal/settings",
      icon: LockKeyhole,
    },
  ];
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Account services"
        title="Messages & alerts"
        description="Updates, reminders, and insights from your demo workspace."
      />
      <section className="pb-panel">
        <div className="pb-panel-head">
          <h2>
            <Inbox size={20} />
            Your inbox
          </h2>
          <button
            className="pb-action-link"
            disabled={state.preferences.inboxRead}
            onClick={async () => {
              try {
                await runCommand({
                  action: "preference",
                  payload: { key: "inboxRead", value: true },
                });
              } catch {
                setError(
                  "Your read status could not be saved. Please try again.",
                );
              }
            }}
          >
            <MailOpen size={15} />
            {state.preferences.inboxRead
              ? "All marked as read"
              : "Mark all as read"}
          </button>
        </div>
        <ErrorMessage text={error} />
        {messages.map(({ title, text, href, icon: Icon }, i) => (
          <a className="pb-message-row" key={i} href={href}>
            <span className="pb-soft-icon">
              <Icon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
            <ChevronRight size={17} />
          </a>
        ))}
      </section>
    </>
  );
}

export function SpendingPage({ state }: { state: Workspace }) {
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Plan & learn"
        title="Spending insights"
        description="See how your spending adds up by category. Transfers and loan payments are excluded."
      />
      <div className="pb-form-layout">
        <SpendChart state={state} expanded />
        <aside className="pb-panel pb-side-help">
          <span className="pb-soft-icon">
            <SlidersHorizontal size={22} />
          </span>
          <h2>About this view</h2>
          <p>
            Totals are calculated from posted purchases and bill payments in
            your sample accounts. Switch months to compare your activity.
          </p>
          <div className="pb-rail-divider" />
          <a href="/portal/activity">
            Explore all activity <ArrowRight size={15} />
          </a>
        </aside>
      </div>
    </>
  );
}

export function Brokerage() {
  return (
    <>
      <PageBack />
      <PageIntro eyebrow="Investing" title="Brokerage accounts" />
      <section className="pb-panel pb-state-message">
        <span className="pb-soft-icon">
          <CreditCard size={24} />
        </span>
        <h2>No brokerage accounts in this workspace</h2>
        <p>
          The sample profile includes two deposit accounts, a credit card, and a
          mortgage.
        </p>
        <a className="pb-button" href="/investing-wealth">
          Explore investing options <ArrowRight size={15} />
        </a>
      </section>
    </>
  );
}
