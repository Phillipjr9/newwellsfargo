import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  Fullscreen,
  Globe2,
  IdCard,
  Landmark,
  ListClock,
  LogOut,
  Mail,
  Menu,
  ReceiptText,
  Send,
  Settings2,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import wordmark from "../assets/wf-logo.png";
import { exitWorkspace } from "./store";
import type { Workspace } from "./model";

type MenuEntry = { label: string; href: string; icon: ComponentType<{ size: number; strokeWidth?: number }> };
export const accountDetailsRoute = (type: string) => `/portal/account-details/${type}`;
export const accountLinksByType: Record<string, MenuEntry[]> = {
  checking: [
    { label: "Checking", href: "/portal/account-details/checking", icon: IdCard },
    { label: "Checking activity", href: "/portal/account-details/transactions", icon: Fullscreen },
  ],
  savings: [
    { label: "Savings", href: "/portal/account-details/savings", icon: Wallet },
    { label: "Savings activity", href: "/portal/account-details/transactions", icon: Fullscreen },
  ],
  credit: [
    { label: "Credit card", href: "/portal/account-details/credit", icon: CreditCard },
    { label: "My cards", href: "/portal/cards", icon: IdCard },
    { label: "Card activity", href: "/portal/account-details/transactions", icon: Fullscreen },
  ],
  loan: [
    { label: "Home loan", href: "/portal/account-details/loan", icon: Landmark },
    { label: "Loan activity", href: "/portal/account-details/transactions", icon: Fullscreen },
  ],
};
export const paymentLinks: MenuEntry[] = [
  { label: "Transfer money", href: "/portal/transfers", icon: ArrowLeftRight },
  {
    label: "External transfers",
    href: "/portal/transfers/external",
    icon: Landmark,
  },
  { label: "Send with Zelle", href: "/portal/send-money", icon: Send },
  { label: "Pay bills", href: "/portal/bill-pay", icon: ReceiptText },
  { label: "Wire money", href: "/portal/wires", icon: Globe2 },
  {
    label: "Pay a card or loan",
    href: "/portal/account-payment",
    icon: CreditCard,
  },
  {
    label: "Deposit checks",
    href: "/portal/mobile-deposit",
    icon: Camera,
  },
  {
    label: "Transfer & payment activity",
    href: "/portal/payments",
    icon: ListClock,
  },
];
const planningLinks = [
  { label: "Spending insights", href: "/portal/spending", icon: Wallet },
  { label: "Financial guidance", href: "/guidance", icon: BookOpen },
  { label: "Brokerage accounts", href: "/portal/brokerage", icon: Wallet },
  { label: "Investing & wealth", href: "/investing-wealth", icon: Landmark },
];
const supportLinks = [
  {
    label: "Security & preferences",
    href: "/portal/settings",
    icon: ShieldCheck,
  },
  { label: "Messages & alerts", href: "/portal/inbox", icon: Mail },
  { label: "Help center", href: "/help", icon: CircleHelp },
];

export function PortalHeader({
  state,
  path,
}: {
  state: Workspace;
  path: string;
}) {
  const [menu, setMenu] = useState("");
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState("");
  const lastInitial = [...state.profile.name.trim().split(/\s+/).slice(1).at(-1) || ""][0];
  const shortName = lastInitial ? `${state.profile.firstName} ${lastInitial.toUpperCase()}.` : state.profile.firstName;
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // The router is used via AppRoutes navigation; leave() calls exitWorkspaceToLogin().
  const toggle = (key: string, el: HTMLButtonElement) => {
    trigger.current = el;
    setMenu(menu === key ? "" : key);
  };
  useEffect(() => {
    setMenu("");
  }, [path]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !header.current?.contains(e.target))
        setMenu("");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu("");
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const links = (entries: MenuEntry[]) =>
    entries.map(({ label, icon: Icon, href }) => (
      <a key={href} href={href} onClick={() => setMenu("")}>
        <Icon size={17} />
        {label}
      </a>
    ));
  const dropdown = (
    key: string,
    label: string,
    entries: MenuEntry[],
    active: boolean,
  ) => (
    <div className="pb-nav-item">
      <button
        className={`pb-nav-link ${active ? "selected" : ""}`}
        aria-expanded={menu === key}
        onClick={(e) => toggle(key, e.currentTarget)}
      >
        {label}
        <ChevronDown size={13} />
      </button>
      {menu === key && <div className="pb-dropdown">{links(entries)}</div>}
    </div>
  );
  async function leave() {
    setExiting(true);
    try {
      const managed = await exitWorkspace();
      if (managed) { window.location.replace("/portal/access"); }
      else { window.location.replace("/login"); }
    } catch {
      setExitError("Couldn't end this session. Please try again.");
      setExiting(false);
    }
  }
  return (
    <header ref={header} className="pb-header">
      <a href="#portal-main" className="skip-link">
        Skip to account content
      </a>
      <div className="pb-masthead">
        <div className="pb-wrap pb-mast-inner">
          <div className="pb-brand">
            <a href="/portal" aria-label="Wells Fargo account overview">
              <img src={wordmark} alt="Wells Fargo" />
            </a>
            <span className="pb-brand-rule" />
            <span className="pb-brand-title">Online Banking</span>
          </div>
          <div className="pb-utilities">
            <span className="pb-demo">
              <span />
              Customer banking
            </span>
            <a
              className="pb-inbox-btn"
              href="/portal/inbox"
              aria-label={`Inbox, ${state.preferences.inboxRead ? "no unread" : "unread"} messages`}
            >
              <Bell size={20} />
              {!state.preferences.inboxRead && <i />}
            </a>
            <button
              className="pb-profile-trigger"
              aria-label="Customer profile menu"
              aria-expanded={menu === "profile"}
              onClick={(e) => toggle("profile", e.currentTarget)}
            >
              <span className="pb-avatar">{state.profile.initials}</span>
              <span className="pb-profile-name">{shortName}</span>
              <ChevronDown size={14} />
            </button>
            {menu === "profile" && (
              <div className="pb-dropdown pb-profile-menu">
                <div className="pb-profile-lead">
                  <strong>{state.profile.name}</strong>
                  <span>Customer profile</span>
                </div>
                {links([
                  {
                    label: "Profile & preferences",
                    icon: UserRound,
                    href: "/portal/settings",
                  },
                  { label: "Public homepage", icon: Landmark, href: "/home" },
                ])}
                <button onClick={leave} disabled={exiting}>
                  <LogOut size={17} />
                  {exiting ? "Ending session..." : "Sign out"}
                </button>
                {exitError && <p role="alert">{exitError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="pb-nav-bar">
        <nav className="pb-wrap pb-nav" aria-label="Online banking">
          <a
            href="/portal"
            className={`pb-nav-link ${path === "/portal" || path.startsWith("/portal/accounts") || path === "/portal/activity" ? "selected" : ""}`}
          >
            Account summary
          </a>
          {dropdown(
            "payments",
            "Transfer & pay",
            paymentLinks,
            paymentLinks.some((l) => l.href === path),
          )}
          <a
            className={`pb-nav-link pb-desktop-nav ${path === "/portal/statements" ? "selected" : ""}`}
            href="/portal/statements"
          >
            Statements & documents
          </a>
          <div className="pb-desktop-nav">
            {dropdown(
              "plan",
              "Plan & learn",
              planningLinks,
              path === "/portal/spending",
            )}
          </div>
          <div className="pb-desktop-nav">
            {dropdown(
              "support",
              "Security & support",
              supportLinks,
              path === "/portal/settings" || path === "/portal/inbox",
            )}
          </div>
          <a className="pb-help-nav" href="/help">
            <CircleHelp size={16} />
            Help
          </a>
          <button
            className="pb-small-menu"
            aria-label="More navigation"
            aria-expanded={menu === "mobile"}
            onClick={(e) => toggle("mobile", e.currentTarget)}
          >
            {menu === "mobile" ? <X size={18} /> : <Menu size={18} />}
          </button>
          {menu === "mobile" && (
            <div className="pb-dropdown pb-mobile-list">
              {links([
                {
                  label: "Statements & documents",
                  href: "/portal/statements",
                  icon: FileText,
                },
                ...planningLinks,
                ...supportLinks,
              ])}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="pb-page-intro">
      <div>
        <p className="pb-eyebrow">
          <span />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        {description && <p className="pb-intro-desc">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Today() {
  return (
    <span className="pb-today">
      <CalendarDays size={16} />
      {new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
    </span>
  );
}

export function PortalResourceFooter() {
  return (
    <div className="pb-resource-footer">
      <div className="pb-wrap pb-footer-groups">
        <div>
          <div
            className="pb-footer-wordmark"
            role="img"
            aria-label="Wells Fargo"
            style={{
              maskImage: `url(${wordmark})`,
              WebkitMaskImage: `url(${wordmark})`,
            }}
          />
          <p>Online Banking</p>
          <small>Customer accounts and transactions</small>
        </div>
        <div>
          <h2>Banking services</h2>
          <a href="/portal">Account summary</a>
          <a href="/portal/transfers">Transfer & pay</a>
          <a href="/portal/statements">Statements & documents</a>
        </div>
        <div>
          <h2>Help & support</h2>
          <a href="/help">Customer service</a>
          <a href="/portal/settings">Security & preferences</a>
          <a
            href="https://locations.wellsfargo.com/search"
            target="_blank"
            rel="noreferrer"
          >
            ATM & branch locations
          </a>
        </div>
        <div>
          <h2>Explore more</h2>
          <a href="/home">Personal banking home</a>
          <a href="/guidance">Financial guidance</a>
          <a
            href="https://www.wellsfargo.com/"
            target="_blank"
            rel="noreferrer"
          >
            Official Wells Fargo site <ArrowRight size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

export function PageBack({
  href = "/portal",
  label = "Account summary",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <a className="pb-back" href={href}>
      <ArrowRight size={15} />
      {label}
    </a>
  );
}

export function SideHelp() {
  return (
    <aside className="pb-panel pb-side-help">
      <span className="pb-soft-icon">
        <ShieldCheck size={23} />
      </span>
      <h2>A space to practice</h2>
      <p>
        All accounts, recipients, and amounts in this workspace are examples.
        Nothing here sends real money.
      </p>
      <div className="pb-rail-divider" />
      <a href="/portal/payments">
        <ListClock size={17} />
        Transfer & payment activity
      </a>
      <a href="/portal/settings">
        <Settings2 size={17} />
        Workspace preferences
      </a>
      <a
        href="https://www.wellsfargo.com/online-banking/transfers/"
        target="_blank"
        rel="noreferrer"
      >
        <CircleHelp size={17} />
        Official transfer guide
      </a>
    </aside>
  );
}
