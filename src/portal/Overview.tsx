import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronRight,
  Coffee,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  Landmark,
  ListFilter,
  LockKeyhole,
  ReceiptText,
  RotateCw,
  ShoppingBag,
  ShoppingBasket,
  Wallet,
  Zap,
} from "lucide-react";
import { day } from "../../shared/ledger.mjs";
import {
  balanceLabel,
  dateLabel,
  isDeposit,
  money,
  spending,
  spendingColors,
  type Account,
  type Entry,
  type Workspace,
} from "./model";
import { PageIntro, Today } from "./Chrome";
import { refreshWorkspace, runCommand, workspaceAvailable } from "./store";
import Dialog from "../components/Dialog";
import everydayCard from "../assets/card-everyday.svg";
import autographCard from "../assets/card-autograph.webp";
import savingsIcon from "../assets/icon-savings.png";
import mortgageIcon from "../assets/icon-mortgage.png";

// Product art comes from Wells Fargo's public product pages. Accounts with no
// physical card (savings, home loan) use the icon Wells Fargo shows for them.
const productArt: Partial<
  Record<Account["type"], { src: string; kind: "photo" | "glyph" }>
> = {
  checking: { src: everydayCard, kind: "photo" },
  credit: { src: autographCard, kind: "photo" },
  savings: { src: savingsIcon, kind: "glyph" },
  loan: { src: mortgageIcon, kind: "glyph" },
};

export function AccountArt({ account }: { account: Account }) {
  const art = productArt[account.type];
  if (!art)
    return (
      <div className="pb-account-art pb-art-glyph" aria-hidden="true">
        <Landmark size={20} strokeWidth={1.4} />
      </div>
    );
  return (
    <div className={`pb-account-art pb-art-${art.kind}`} aria-hidden="true">
      <img src={art.src} alt="" />
    </div>
  );
}

export function AccountRows({ state }: { state: Workspace }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Element && !e.target.closest(".pb-account-menu"))
        setOpen("");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        ref.current
          ?.querySelector<HTMLButtonElement>(`[data-account="${open}"]`)
          ?.focus();
        setOpen("");
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const list = state.accounts.filter(
    (a) =>
      a.type !== "external" &&
      (filter === "all" ||
        (filter === "deposit" ? isDeposit(a) : !isDeposit(a))),
  );
  return (
    <section className="pb-panel pb-accounts" ref={ref}>
      <div className="pb-panel-head">
        <h2>
          My accounts <span className="pb-count">{list.length}</span>
        </h2>
        <label className="pb-inline-select">
          <span className="sr-only">Filter accounts</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setOpen("");
            }}
          >
            <option value="all">All accounts</option>
            <option value="deposit">Checking & savings</option>
            <option value="borrow">Credit & loans</option>
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      <ul className="pb-account-rows">
        {list.map((a) => (
          <li key={a.id}>
            <a className="pb-account-link" href={`/portal/accounts/${a.id}`}>
              <AccountArt account={a} />
              <span className="pb-account-title">
                <strong>{a.name}</strong>
                <small>
                  {a.type === "credit"
                    ? "Credit card"
                    : a.type === "loan"
                      ? "Loan"
                      : a.type === "savings"
                        ? "Savings"
                        : "Checking"}
                  <span className="pb-account-number">
                    &middot;&middot;&middot;&middot; {a.last4}
                  </span>
                </small>
              </span>
              <span className="pb-account-balance">
                <strong>
                  {state.preferences.hideBalances ? "••••••" : money(a.balance)}
                </strong>
                <small>{balanceLabel(a)}</small>
              </span>
            </a>
            <div className="pb-account-menu">
              <button
                className="pb-icon-btn"
                data-account={a.id}
                aria-label={`Options for ${a.name}`}
                aria-expanded={open === a.id}
                onClick={() => setOpen(open === a.id ? "" : a.id)}
              >
                <Ellipsis size={20} />
              </button>
              {open === a.id && (
                <div className="pb-dropdown pb-account-dropdown">
                  <a href={`/portal/accounts/${a.id}`}>View account activity</a>
                  <a
                    href={
                      isDeposit(a)
                        ? `/portal/transfers?from=${a.id}`
                        : `/portal/account-payment?to=${a.id}`
                    }
                  >
                    {isDeposit(a) ? "Transfer money" : "Make a payment"}
                  </a>
                  <a href={`/portal/statements?account=${a.id}`}>
                    View statements
                  </a>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="pb-panel-foot">
        <a href="/portal/activity">
          View all account activity <ArrowRight size={15} />
        </a>
      </div>
    </section>
  );
}

export function QuickActions() {
  return (
    <section className="pb-panel pb-quick">
      <div className="pb-panel-head">
        <h2>Quick actions</h2>
        <Zap size={18} className="pb-muted" />
      </div>
      <div className="pb-action-grid">
        <a href="/portal/transfers">
          <span className="pb-quick-icon">
            <ArrowLeftRight />
          </span>
          Transfer money
        </a>
        <a href="/portal/bill-pay">
          <span className="pb-quick-icon">
            <ReceiptText />
          </span>
          Pay bills
        </a>
        <a href="/portal/send-money">
          <span className="pb-quick-icon pb-zelle-icon">Z</span>
          <span>
            Send with Zelle<sup>&reg;</sup>
          </span>
        </a>
      <a href="/portal/mobile-deposit">
        <span className="pb-quick-icon">
          <Camera />
        </span>
        Deposit checks
      </a>
      <a href="/portal/statements">
        <span className="pb-quick-icon">
          <FileText />
        </span>
        Statements
      </a>
      </div>
    </section>
  );
}

export function SpendChart({
  state,
  expanded = false,
}: {
  state: Workspace;
  expanded?: boolean;
}) {
  const [period, setPeriod] = useState("current");
  const { values, total, entries } = spending(state, period === "previous");
  let pos = 0;
  const fill = values
    .map(([, n], i) => {
      const from = pos;
      pos += (n / total) * 100;
      return `${spendingColors[i % 5]} ${from}% ${pos - 0.55}%, #fff ${pos - 0.55}% ${pos}%`;
    })
    .join(", ");
  return (
    <section
      className={`pb-panel pb-spending ${expanded ? "pb-spending-full" : ""}`}
    >
      <div className="pb-panel-head">
        <h2>Spending snapshot</h2>
      </div>
      <label className="pb-inline-select pb-period">
        <span className="sr-only">Spending period</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="current">This month</option>
          <option value="previous">Last month</option>
        </select>
        <ChevronDown size={13} />
      </label>
      <div className="pb-spending-content">
        <div
          className="pb-donut"
          style={{ background: total ? `conic-gradient(${fill})` : "#e7e2de" }}
          aria-label={`Total spending ${state.preferences.hideBalances ? "hidden" : money(total)}`}
        >
          <div>
            <small>Total spent</small>
            <strong>
              {state.preferences.hideBalances ? "••••" : money(total)}
            </strong>
          </div>
        </div>
        <div className="pb-legend">
          {values.map(([name, value], i) => (
            <div key={name}>
              <i style={{ background: spendingColors[i % 5] }} />
              <span>{name}</span>
              <strong>
                {state.preferences.hideBalances ? "••••" : money(value)}
              </strong>
            </div>
          ))}
        </div>
      </div>
      {expanded ? (
        <ActivityRows state={state} entries={entries} />
      ) : (
        <div className="pb-panel-foot">
          <a href="/portal/spending">
            Explore spending <ArrowRight size={15} />
          </a>
        </div>
      )}
    </section>
  );
}

export function ActivityRows({
  state,
  entries,
}: {
  state: Workspace;
  entries: Entry[];
}) {
  const [detail, setDetail] = useState<Entry | null>(null);
  return (
    <>
      <div className="pb-transactions">
        {entries.length === 0 ? (
          <div className="pb-empty">
            <ListFilter size={24} />
            <strong>No matching activity</strong>
            <p>Try another account or search term.</p>
          </div>
        ) : (
          entries.map((t) => {
            const positive = t.amount > 0,
              acct = state.accounts.find((a) => a.id === t.accountId);
            const Icon =
              t.category === "Income"
                ? BriefcaseBusiness
                : t.category === "Groceries"
                  ? ShoppingBasket
                  : t.category === "Food & dining"
                    ? Coffee
                    : t.category === "Shopping"
                      ? ShoppingBag
                      : t.category === "Bills & utilities"
                        ? Zap
                        : ArrowLeftRight;
            return (
              <button
                key={t.id}
                className="pb-tx-row"
                onClick={() => setDetail(t)}
              >
                <span className={`pb-tx-icon ${positive ? "positive" : ""}`}>
                  <Icon size={18} />
                </span>
                <span className="pb-tx-name">
                  <strong>{t.description}</strong>
                  <small>
                    {acct?.name} &middot; {acct?.last4}
                  </small>
                </span>
                <span className="pb-tx-date">{dateLabel(t.date)}</span>
                <span className={`pb-tx-amount ${positive ? "positive" : ""}`}>
                  {state.preferences.hideBalances
                    ? "••••"
                    : `${positive ? "+" : ""}${money(t.amount)}`}
                </span>
              </button>
            );
          })
        )}
      </div>
      {detail && (
        <Dialog
          label="Sample transaction details"
          className="pb-detail-dialog"
          onClose={() => setDetail(null)}
        >
          <p className="pb-eyebrow">SAMPLE TRANSACTION</p>
          <h2>{detail.description}</h2>
          <strong className="pb-receipt-amount">
            {state.preferences.hideBalances ? "••••" : money(detail.amount)}
          </strong>
          <dl className="pb-details">
            <div>
              <dt>Account</dt>
              <dd>
                {state.accounts.find((a) => a.id === detail.accountId)?.name}
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{dateLabel(detail.date, true)}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{detail.category}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Posted to demo ledger</dd>
            </div>
          </dl>
          <button
            className="pb-button pb-solid"
            onClick={() => setDetail(null)}
          >
            Close details
          </button>
        </Dialog>
      )}
    </>
  );
}

export function Upcoming({ state }: { state: Workspace }) {
  const planned = state.payments
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => a.date.localeCompare(b.date));
  const bills = state.bills.filter(
    (b) =>
      !state.payments.some(
        (p) =>
          p.kind === "bill" &&
          p.to === b.id &&
          ["scheduled", "completed"].includes(p.status),
      ),
  );
  const items = [
    ...planned.map((p) => ({
      id: p.id,
      label: p.toName,
      when: p.date,
      amount: p.amount,
      href: "/portal/payments?filter=scheduled",
      text: "Scheduled",
    })),
    ...bills.map((b) => ({
      id: b.id,
      label: b.name,
      when: b.due,
      amount: b.amount,
      href: `/portal/bill-pay?to=${b.id}`,
      text: "Due",
    })),
  ]
    .sort((a, b) => a.when.localeCompare(b.when))
    .slice(0, 2);
  return (
    <section className="pb-panel pb-upcoming">
      <div className="pb-panel-head">
        <h2>Upcoming payments</h2>
        <CalendarDays size={17} className="pb-muted" />
      </div>
      {items.length ? (
        items.map((item) => (
          <a key={item.id} className="pb-upcoming-row" href={item.href}>
            <span>
              <strong>{item.label}</strong>
              <small>
                {item.text} {dateLabel(item.when)}
              </small>
            </span>
            <b>
              {state.preferences.hideBalances ? "••••" : money(item.amount)}
            </b>
          </a>
        ))
      ) : (
        <p className="pb-empty-text">
          You're all caught up. No upcoming payments.
        </p>
      )}
    </section>
  );
}

export default function Overview({
  state,
  ready,
}: {
  state: Workspace;
  ready: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const deposits = state.accounts.filter(isDeposit);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  async function toggleBalances() {
    try {
      await runCommand({
        action: "preference",
        payload: {
          key: "hideBalances",
          value: !state.preferences.hideBalances,
        },
      });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Couldn't update your preference.",
      );
    }
  }
  async function refresh() {
    setRefreshing(true);
    await refreshWorkspace();
    setRefreshing(false);
    setMessage(
      workspaceAvailable() ? "Your account summary is up to date." : "",
    );
  }
  return (
    <>
      <PageIntro
        eyebrow="Account overview"
        title={`${greeting}, ${state.profile.firstName}`}
        description="Here's your financial picture at a glance."
      >
        <Today />
      </PageIntro>
      <div className="pb-overview-grid">
        <div className="pb-main-column">
          <section
            className="pb-balance-banner"
            aria-label="Deposit balance overview"
          >
            <div className="pb-balance-copy">
              <div className="pb-balance-label">
                <Wallet size={17} strokeWidth={1.6} />
                Total deposit balance
              </div>
              <div className="pb-balance-value">
                <strong>
                  {state.preferences.hideBalances
                    ? "••••••"
                    : money(deposits.reduce((s, a) => s + a.balance, 0))}
                </strong>
                <button
                  disabled={!ready}
                  aria-label={
                    state.preferences.hideBalances
                      ? "Show balances"
                      : "Hide balances"
                  }
                  onClick={toggleBalances}
                >
                  {state.preferences.hideBalances ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
              <p>Across {deposits.length} checking and savings accounts</p>
            </div>
          </section>
          {message && (
            <p role="status" className="pb-inline-notice">
              {message}
              <button onClick={() => setMessage("")}>Dismiss</button>
            </p>
          )}
          <AccountRows state={state} />
          <section className="pb-panel pb-recent">
            <div className="pb-panel-head">
              <h2>Recent activity</h2>
              <a className="pb-action-link" href="/portal/activity">
                View all <ChevronRight size={15} />
              </a>
            </div>
            <ActivityRows
              entries={state.transactions.slice(0, 5)}
              state={state}
            />
          </section>
          <div className="pb-last-updated">
            <LockKeyhole size={13} />
            <span>Sample balances as of {dateLabel(day())}</span>
            <button onClick={refresh} disabled={refreshing}>
              <RotateCw size={13} className={refreshing ? "pb-spin" : ""} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>
        <aside className="pb-rail" aria-label="Account tools and insights">
          <QuickActions />
          <SpendChart state={state} />
          <Upcoming state={state} />
        </aside>
      </div>
    </>
  );
}
