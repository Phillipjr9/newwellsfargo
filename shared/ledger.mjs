export function day(offset = 0, base = new Date()) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function isLedgerDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && day(0, value) === value;
}

export function checkOpeningDate(account, date) {
  if (account?.openingDate && (!isLedgerDate(date) || date < account.openingDate)) {
    throw new DemoError(`Activity cannot be dated before the account opened (${account.openingDate}).`, 400);
  }
}

// Workspace policy: next Monday–Friday date, measured in UTC. No holiday calendar.
export function nextDepositAvailability(postedOn) {
  let next = day(1, postedOn);
  while ([0, 6].includes(new Date(next).getUTCDay())) next = day(1, next);
  return next;
}

export function isDepositOnHold(entry, asOf = day()) {
  return entry.category === "Mobile deposit" && entry.amount > 0 && Boolean(entry.availableOn && entry.availableOn > asOf);
}

export function heldDepositAmount(state, account, asOf = day()) {
  if (!deposits(account)) return 0;
  return state.transactions.reduce((sum, entry) => sum + (entry.accountId === account.id && isDepositOnHold(entry, asOf) ? entry.amount : 0), 0);
}

export function availableBalance(state, account, asOf = day()) {
  return account.balance - heldDepositAmount(state, account, asOf);
}

export const PEOPLE = [
  { id: "sarah", name: "Sarah Miller", detail: "Contact" },
  { id: "alex", name: "Alex Chen", detail: "Contact" },
  { id: "jordan", name: "Jordan Lee", detail: "Contact" },
];
export const WIRE_RECIPIENTS = [
  {
    id: "studio",
    name: "Cedar Design Studio",
    detail: "Business account ending in 2048",
  },
  {
    id: "orchard",
    name: "Orchard Property Group",
    detail: "Business account ending in 7662",
  },
];
export const LINKED_SAMPLES = [
  {
    id: "harbor",
    name: "Harbor Credit Union",
    last4: "7028",
    type: "external",
    balance: 198000,
  },
  {
    id: "maple",
    name: "Maple Community Bank",
    last4: "4160",
    type: "external",
    balance: 350000,
  },
];

// Example values from the public mobile-deposit screenshots; not live bank limits.
export const MOBILE_DEPOSIT_LIMITS = { daily: 500000, rolling30: 1500000 };
export function mobileDepositUsage(state, today) {
  const cutoff = day(-30, `${today}T12:00:00Z`);
  let todayTotal = 0;
  let rollingTotal = 0;
  for (const t of state.transactions) {
    if (t.category !== 'Mobile deposit') continue;
    if (t.date === today) todayTotal += t.amount;
    if (t.date >= cutoff) rollingTotal += t.amount;
  }
  return { todayTotal, rollingTotal };
}

export class DemoError extends Error {
  constructor(message, code = 422) {
    super(message);
    this.code = code;
  }
}

const newId = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const deposits = (a) => ["checking", "savings"].includes(a?.type);
const monthDay = (previous, n) => {
  const d = new Date();
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() - (previous ? 1 : 0),
      Math.max(1, (previous ? 24 : d.getUTCDate()) - n),
    ),
  )
    .toISOString()
    .slice(0, 10);
};

export function createWorkspace() {
  const now = new Date().toISOString();
  const ledger = {
    version: 2,
    updated: now,
    demo: true,
    profile: { name: "Henry Johnson", firstName: "Henry", initials: "HJ" },
    accounts: [
      {
        id: "checking",
        name: "Everyday Checking",
        last4: "4821",
        type: "checking",
        balance: 485022,
      },
      {
        id: "savings",
        name: "Way2Save Savings",
        last4: "9104",
        type: "savings",
        balance: 1425080,
      },
      {
        id: "credit",
        name: "Autograph Card",
        last4: "3312",
        type: "credit",
        balance: 34215,
        limit: 1250000,
        points: 24850,
      },
      {
        id: "mortgage",
        name: "Home Mortgage",
        last4: "7781",
        type: "loan",
        balance: 28431000,
      },
    ],
    transactions: [],
    payments: [],
    bills: [
      {
        id: "pge",
        name: "Pacific Gas & Electric",
        amount: 12845,
        due: day(4),
        category: "Utilities",
      },
      {
        id: "internet",
        name: "Xfinity Internet",
        amount: 8999,
        due: day(7),
        category: "Internet",
      },
      {
        id: "water",
        name: "City Water",
        amount: 5420,
        due: day(11),
        category: "Utilities",
      },
    ],
    preferences: {
      hideBalances: false,
      depositDefault: null,
      largeTransactions: true,
      lowBalance: true,
      paymentAlerts: true,
      paperless: true,
      cardLocked: false,
      inboxRead: false,
    },
  };
  const rows = [
    ["checking", "Trader Joe's", "Groceries", -7432],
    ["checking", "Payroll direct deposit", "Income", 325000],
    ["credit", "Blue Bottle Coffee", "Food & dining", -1725],
    ["checking", "Oak & Field Home", "Shopping", -18490],
    ["checking", "Pacific Gas & Electric", "Bills & utilities", -12845],
    ["checking", "Westside Market", "Groceries", -8830],
    ["checking", "Cedar Kitchen", "Food & dining", -8640],
    ["credit", "East Bay Outfitters", "Shopping", -14200],
    ["checking", "Farmers Market", "Groceries", -2640],
    ["checking", "Neighborhood Bistro", "Food & dining", -9320],
    ["credit", "Book Passage", "Shopping", -6815],
  ];
  for (const previous of [false, true]) {
    rows.forEach(([accountId, description, category, amount], i) =>
      ledger.transactions.push({
        id: `sample-${previous ? "previous" : "current"}-${i}`,
        accountId,
        description,
        category,
        date: monthDay(previous, i),
        amount: previous ? Math.round(amount * 1.13) : amount,
        status: "posted",
      }),
    );
  }
  ledger.payments.push({
    id: "DEMO-SAVINGS",
    requestId: "demo-savings-plan",
    series: "demo-savings-plan",
    kind: "transfer",
    from: "checking",
    to: "savings",
    fromName: "Everyday Checking",
    toName: "Way2Save Savings",
    amount: 25000,
    date: day(3),
    frequency: "monthly",
    anchorDay: Number(day(3).slice(-2)),
    status: "scheduled",
    created: now,
  });
  return ledger;
}

function nextDate(date, frequency, anchorDay) {
  if (frequency === "weekly") return day(7, `${date}T12:00:00Z`);
  const d = new Date(`${date}T12:00:00Z`);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      Math.min(anchorDay, last),
    ),
  )
    .toISOString()
    .slice(0, 10);
}

function execute(state, payment) {
  const from = state.accounts.find(a => a.id === payment.from);
  const dest = state.accounts.find(a => a.id === payment.to);
  checkOpeningDate(from, payment.date);
  if (["deposit", "transfer", "external", "payment"].includes(payment.kind)) checkOpeningDate(dest, payment.date);
  if (payment.kind === 'deposit') {
    if (!dest) throw new DemoError('Choose an eligible deposit account.');
    dest.balance += payment.amount;
    state.transactions.unshift({
      id: `${payment.id}-in`,
      accountId: dest.id,
      date: payment.date,
      description: 'Mobile check deposit',
      amount: payment.amount,
      category: 'Mobile deposit',
      status: 'posted',
      availableOn: nextDepositAvailability(payment.date),
      reference: payment.id,
    });
    payment.status = 'completed';
    return;
  }
  if (!from || availableBalance(state, from, payment.date) < payment.amount)
    throw new DemoError(
      "There are not enough available funds in the selected account.",
    );
  if (payment.kind === "payment" && dest && payment.amount > dest.balance)
    throw new DemoError("The payment exceeds the remaining amount owed.");
  from.balance -= payment.amount;
  if (dest)
    dest.balance +=
      payment.kind === "payment" ? -payment.amount : payment.amount;
  const category = {
    transfer: "Transfer",
    external: "Transfer",
    person: "Send money",
    wire: "Wire",
    bill: "Bills & utilities",
    payment: "Account payment",
  }[payment.kind];
  state.transactions.unshift({
    id: `${payment.id}-out`,
    accountId: from.id,
    date: payment.date,
    description: payment.toName,
    amount: -payment.amount,
    category,
    status: "posted",
    reference: payment.id,
  });
  if (dest)
    state.transactions.unshift({
      id: `${payment.id}-in`,
      accountId: dest.id,
      date: payment.date,
      description: `From ${from.name}`,
      amount: payment.amount,
      category,
      status: "posted",
      reference: payment.id,
    });
  payment.status = "completed";
  if (payment.frequency !== "once") {
    state.payments.unshift({
      ...payment,
      id: `DEMO-${newId().slice(0, 8).toUpperCase()}`,
      requestId: newId(),
      status: "scheduled",
      date: nextDate(payment.date, payment.frequency, payment.anchorDay),
    });
  }
}

// Scheduled entries settle on the next visit, not through a payment network.
export function settleDue(state, today = day()) {
  let changed = false;
  for (let pass = 0; pass < 520; pass++) {
    const due = state.payments
      .filter((p) => p.status === "scheduled" && p.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!due.length) break;
    for (const p of due) {
      try {
        execute(state, p);
      } catch (error) {
        p.status = "failed";
        p.reason = error.message;
      }
      changed = true;
    }
  }
  if (changed) state.updated = new Date().toISOString();
  return changed;
}

function validate(state, input, editingId, today) {
  const { kind, amount, from, to, date, frequency = "once" } = input;
  if (
    ![
      "transfer",
      "external",
      "person",
      "wire",
      "bill",
      "payment",
      "deposit",
    ].includes(kind)
  )
    throw new DemoError("Choose a supported transaction type.");
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000000)
    throw new DemoError("Enter an amount from $0.01 to $100,000.00.");
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    day(0, date) !== date ||
    date < today ||
    date > day(365, today)
  )
    throw new DemoError("Choose a valid date within the next year.");
  if (
    !["once", "weekly", "monthly"].includes(frequency) ||
    (frequency !== "once" && !["transfer", "external"].includes(kind))
  )
    throw new DemoError("This payment type supports one-time payments only.");
  if (kind === "deposit") {
    if (date !== today)
      throw new DemoError("Mobile deposits post on the day they are made.");
    const dest = state.accounts.find((a) => a.id === to);
    if (!dest || !deposits(dest))
      throw new DemoError("Choose an eligible checking or savings account.");
    checkOpeningDate(dest, date);
    const usage = mobileDepositUsage(state, today);
    if (usage.todayTotal + amount > MOBILE_DEPOSIT_LIMITS.daily)
      throw new DemoError(
        "This amount is more than your remaining daily mobile deposit limit.",
      );
    if (usage.rollingTotal + amount > MOBILE_DEPOSIT_LIMITS.rolling30)
      throw new DemoError(
        "This amount is more than your remaining 30-day mobile deposit limit.",
      );
    return {
      kind,
      amount,
      from: "",
      to,
      date,
      frequency: "once",
      fromName: "Mobile deposit",
      toName: dest.name,
      anchorDay: Number(date.slice(-2)),
    };
  }
  const source = state.accounts.find((a) => a.id === from);
  const dest = state.accounts.find((a) => a.id === to);
  if (
    !source ||
    !(deposits(source) || (kind === "external" && source.type === "external"))
  )
    throw new DemoError("Select an eligible funding account.");
  if (availableBalance(state, source, today) < amount)
    throw new DemoError(
      "This amount is more than your available balance. Choose a smaller amount or another account.",
    );
  checkOpeningDate(source, date);
  if (["transfer", "external", "payment"].includes(kind)) checkOpeningDate(dest, date);
  if (from === to) throw new DemoError("Choose two different accounts.");
  let toName = dest?.name;
  if (kind === "transfer" && !deposits(dest))
    throw new DemoError("Choose a checking or savings destination account.");
  if (
    kind === "external" &&
    (!dest ||
      !(
        (deposits(source) && dest.type === "external") ||
        (source.type === "external" && deposits(dest))
      ))
  )
    throw new DemoError(
      "Choose one linked bank account and one deposit account.",
    );
  if (
    kind === "payment" &&
    (!dest || !["credit", "loan"].includes(dest.type) || amount > dest.balance)
  )
    throw new DemoError(
      "Choose a credit or loan account and an amount no greater than the balance owed.",
    );
  if (kind === "person" || kind === "wire") {
    toName = (kind === "person" ? PEOPLE : WIRE_RECIPIENTS).find(
      (p) => p.id === to,
    )?.name;
    if (!toName) throw new DemoError("Choose a recipient.");
    if (kind === "person" && amount > 350000)
      throw new DemoError("The payment limit is $3,500 per payment.");
  }
  if (kind === "bill") {
    if (source.type !== "checking")
      throw new DemoError("Use an eligible checking account for Bill Pay.");
    const bill = state.bills.find((b) => b.id === to);
    if (!bill || bill.amount !== amount)
      throw new DemoError(
        "Choose an outstanding bill and its amount due.",
      );
    if (
      state.payments.some(
        (p) =>
          p.id !== editingId &&
          p.kind === "bill" &&
          p.to === to &&
          ["completed", "scheduled"].includes(p.status),
      )
    )
      throw new DemoError("This bill is already paid or scheduled.");
    toName = bill.name;
  }
  return {
    kind,
    amount,
    from,
    to,
    date,
    frequency,
    fromName: source.name,
    toName,
    anchorDay: Number(date.slice(-2)),
  };
}

export const validateDraft = (state, input) =>
  validate(state, input, null, day());

export function applyAction(original, command, today = day()) {
  const state = structuredClone(original);
  if (!command || typeof command !== "object" || Array.isArray(command))
    throw new DemoError("Invalid request.");
  const input = command.payload ?? {};
  let result = null;
  if (command.action === "submit") {
    if (
      typeof input.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,64}$/.test(input.requestId)
    )
      throw new DemoError("A request identifier is required.");
    const existing = state.payments.find(
      (p) => p.requestId === input.requestId,
    );
    if (existing) {
      if (
        ["kind", "from", "to", "amount", "date", "frequency"].some(
          (key) => existing[key] !== input[key],
        )
      )
        throw new DemoError(
          "This confirmation already belongs to a different payment. Review the new details first.",
          409,
        );
      return { state, result: existing.id };
    }
    if (state.payments.length >= 1000)
      throw new DemoError(
        "This workspace is full. Start a new workspace to continue.",
      );
    const details = validate(state, input, null, today);
    const record = {
      ...details,
      id: `DEMO-${newId().slice(0, 8).toUpperCase()}`,
      requestId: input.requestId,
      status: "scheduled",
      created: new Date().toISOString(),
      series: input.requestId,
    };
    state.payments.unshift(record);
    if (record.date === today) execute(state, record);
    result = record.id;
  } else if (command.action === "cancel" || command.action === "edit") {
    const payment = state.payments.find((p) => p.id === input.id);
    if (!payment || payment.status !== "scheduled")
      throw new DemoError("Only a scheduled payment can be changed.");
    if (command.action === "cancel") payment.status = "cancelled";
    else {
      Object.assign(
        payment,
        validate(
          state,
          {
            ...payment,
            amount: input.amount,
            date: input.date,
            frequency: input.frequency ?? payment.frequency,
          },
          payment.id,
          today,
        ),
      );
      if (payment.date === today) execute(state, payment);
    }
    result = payment.id;
  } else if (command.action === "link") {
    const sample = LINKED_SAMPLES.find((a) => a.id === input.id);
    if (!sample || state.accounts.some((a) => a.id === sample.id))
      throw new DemoError("Choose an unlinked bank account.");
    state.accounts.push({ ...sample, openingDate: today });
  } else if (command.action === "preference") {
    const key = input.key;
    if (!Object.hasOwn(state.preferences, key)) throw new DemoError("Invalid preference.");
    const valueOk =
      key === "depositDefault"
        ? input.value === null || typeof input.value === "string"
        : typeof input.value === "boolean";
    if (!valueOk) throw new DemoError("Invalid preference.");
    state.preferences[key] = input.value;
  } else throw new DemoError("Unknown workspace action.", 400);
  if (
    state.preferences.paymentAlerts &&
    ["submit", "edit", "cancel"].includes(command.action)
  )
    state.preferences.inboxRead = false;
  state.updated = new Date().toISOString();
  return { state, result };
}
