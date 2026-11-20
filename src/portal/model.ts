export type AccountType =
  "checking" | "savings" | "credit" | "loan" | "external";
export type PaymentKind =
  | "transfer"
  | "external"
  | "person"
  | "wire"
  | "bill"
  | "payment"
  | "deposit";
export type Frequency = "once" | "weekly" | "monthly";
export interface Account {
  id: string;
  name: string;
  last4: string;
  type: AccountType;
  balance: number;
  openingDate?: string;
  limit?: number;
  points?: number;
}
export interface Entry {
  id: string;
  accountId: string;
  description: string;
  category: string;
  date: string;
  amount: number;
  status: string;
  reference?: string;
  availableOn?: string;
}
export interface Draft {
  kind: PaymentKind;
  from: string;
  to: string;
  amount: number;
  date: string;
  frequency: Frequency;
  requestId: string;
}
export interface Payment extends Draft {
  id: string;
  fromName: string;
  toName: string;
  status: "completed" | "scheduled" | "cancelled" | "failed";
  created: string;
  reason?: string;
}
export interface Workspace {
  version: number;
  updated: string;
  demo: true;
  profile: { name: string; firstName: string; initials: string };
  accounts: Account[];
  transactions: Entry[];
  payments: Payment[];
  messages?: { id: string; direction: string; subject: string; body: string; createdAt: string }[];
  bills: {
    id: string;
    name: string;
    amount: number;
    due: string;
    category: string;
  }[];
  preferences: {
    hideBalances: boolean;
    largeTransactions: boolean;
    lowBalance: boolean;
    paymentAlerts: boolean;
    paperless: boolean;
    cardLocked: boolean;
    inboxRead: boolean;
    depositDefault: string | null;
  };
}
export interface Command {
  action: "submit" | "cancel" | "edit" | "link" | "preference";
  payload: object;
}
export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const dateLabel = (date: string, long = false) =>
  new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
export const isDeposit = (a: Account) =>
  a.type === "checking" || a.type === "savings";
export const balanceLabel = (a: Account) =>
  a.type === "credit"
    ? "Current balance"
    : a.type === "loan"
      ? "Principal balance"
      : "Available balance";
export const actionPaths: Record<PaymentKind, string> = {
  transfer: "/portal/transfers",
  external: "/portal/transfers/external",
  person: "/portal/send-money",
  wire: "/portal/wires",
  bill: "/portal/bill-pay",
  payment: "/portal/account-payment",
  deposit: "/portal/mobile-deposit",
};
export const kindNames: Record<PaymentKind, string> = {
  transfer: "Between my accounts",
  external: "External transfer",
  person: "Send with Zelle",
  wire: "Wire money",
  bill: "Bill Pay",
  payment: "Account payment",
  deposit: "Mobile deposit",
};
export const frequencyNames: Record<Frequency, string> = {
  once: "One time",
  weekly: "Weekly",
  monthly: "Monthly",
};
export const spendingColors = [
  "#842639",
  "#c78b5e",
  "#d8b986",
  "#a8a299",
  "#a296bb",
];
export function spending(state: Workspace, previous = false) {
  const d = new Date();
  const month = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (previous ? 1 : 0), 1),
  )
    .toISOString()
    .slice(0, 7);
  const groups: Record<string, number> = {};
  const entries = state.transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      t.amount < 0 &&
      !["Transfer", "Send money", "Wire", "Account payment"].includes(
        t.category,
      ),
  );
  entries.forEach((t) => {
    groups[t.category] = (groups[t.category] || 0) - t.amount;
  });
  const values = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  return { entries, values, total: values.reduce((sum, [, n]) => sum + n, 0) };
}

export function normalizedPortalPath(path: string) {
  const p = path.replace(/\/+$/, "") || "/";
  if (/^\/dashboard(?:\/|$)/.test(p))
    return normalizedPortalPath(p.replace(/^\/dashboard/, "/portal"));
  if (
    [
      "/transfer",
      "/transfers",
      "/transfer-pay",
      "/transfer-and-pay",
      "/portal/transfer",
      "/portal/transfer-pay",
      "/portal/transfer-and-pay",
    ].includes(p)
  )
    return actionPaths.transfer;
  if (["/bill-pay", "/portal/bills"].includes(p))
    return actionPaths.bill;
  if (
    ["/portal/deposit", "/portal/deposit-checks", "/mobile-deposit"].includes(p)
  )
    return actionPaths.deposit;
  if (["/zelle", "/portal/zelle"].includes(p)) return actionPaths.person;
  if (p === "/portal/transfer-activity") return "/portal/payments";
  const aliases: Record<string, string> = {
    "/transfer-money": actionPaths.transfer,
    "/portal/transfer-money": actionPaths.transfer,
    "/portal/transfer-and-pay/between-accounts": actionPaths.transfer,
    "/portal/external-transfers": actionPaths.external,
    "/transfers/external": actionPaths.external,
    "/wire-transfer": actionPaths.wire,
    "/portal/wire": actionPaths.wire,
    "/portal/transactions": "/portal/activity",
    "/portal/security": "/portal/settings",
    "/portal/transfer-history": "/portal/payments",
    "/portal/transfer-and-pay/activity": "/portal/payments",
  };
  if (Object.prototype.hasOwnProperty.call(aliases, p)) return aliases[p];
  return p;
}
