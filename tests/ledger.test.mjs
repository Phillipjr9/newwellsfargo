import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  availableBalance,
  heldDepositAmount,
  nextDepositAvailability,
  createWorkspace,
  day,
  settleDue,
} from "../shared/ledger.mjs";

const base = (overrides = {}) => ({
  kind: "transfer",
  from: "checking",
  to: "savings",
  amount: 12500,
  date: day(),
  frequency: "once",
  requestId: crypto.randomUUID(),
  ...overrides,
});
const send = (state, payload) =>
  applyAction(state, { action: "submit", payload });
const balance = (state, id) => state.accounts.find((a) => a.id === id).balance;

test("an immediate transfer changes both sides by the exact cent amount", () => {
  const before = createWorkspace();
  const after = send(before, base({ amount: 12345 }));
  assert.equal(
    balance(after.state, "checking"),
    balance(before, "checking") - 12345,
  );
  assert.equal(
    balance(after.state, "savings"),
    balance(before, "savings") + 12345,
  );
  const entries = after.state.transactions.filter(
    (t) => t.reference === after.result,
  );
  assert.equal(entries.length, 2);
  assert.equal(
    entries.reduce((sum, t) => sum + t.amount, 0),
    0,
  );
  assert.equal(after.state.payments[0].status, "completed");
});

test("a retried confirmation returns the same receipt without a second debit", () => {
  const input = base();
  const first = send(createWorkspace(), input);
  const second = send(first.state, input);
  assert.equal(second.result, first.result);
  assert.deepEqual(second.state, first.state);
  assert.throws(
    () => send(first.state, { ...input, amount: 999 }),
    /different payment/,
  );
});

test("invalid, ineligible, self, and over-balance transfers leave the ledger untouched", () => {
  const initial = createWorkspace(),
    copy = structuredClone(initial);
  for (const change of [
    { amount: 0 },
    { amount: -100 },
    { amount: NaN },
    { amount: Infinity },
    { amount: 2.2 },
    { amount: 500000 },
    { from: "credit" },
    { from: "mortgage" },
    { to: "checking" },
    { to: "missing" },
    { to: "credit" },
    { date: day(-1) },
    { date: "2027-02-31" },
    { date: day(366) },
    { frequency: "hourly" },
    { requestId: "" },
  ]) {
    assert.throws(() => send(initial, base(change)));
  }
  assert.deepEqual(initial, copy);
});

test("sample banks must be linked before external transfers in either direction", () => {
  const s = createWorkspace();
  assert.throws(() => send(s, base({ kind: "external", to: "harbor" })));
  const linked = applyAction(s, {
    action: "link",
    payload: { id: "harbor" },
  }).state;
  assert.throws(() =>
    applyAction(linked, { action: "link", payload: { id: "harbor" } }),
  );
  const first = send(linked, base({ kind: "external", to: "harbor" })).state;
  const next = send(
    first,
    base({ kind: "external", from: "harbor", to: "savings" }),
  ).state;
  assert.equal(balance(linked, "harbor"), balance(next, "harbor"));
  assert.equal(balance(next, "checking"), balance(s, "checking") - 12500);
  assert.equal(balance(next, "savings"), balance(s, "savings") + 12500);
});

test("person and wire payments only accept built-in fictional recipients", () => {
  for (const [kind, to] of [
    ["person", "sarah"],
    ["wire", "studio"],
  ]) {
    const state = createWorkspace();
    assert.throws(() => send(state, base({ kind, to: "someone@example.com" })));
    const after = send(state, base({ kind, to }));
    assert.equal(
      balance(after.state, "checking"),
      balance(state, "checking") - 12500,
    );
    assert.ok(after.state.payments[0].toName);
  }
});

test("paying a card or mortgage reduces what is owed", () => {
  for (const to of ["credit", "mortgage"]) {
    const state = createWorkspace();
    const after = send(state, base({ kind: "payment", to })).state;
    assert.equal(balance(after, to), balance(state, to) - 12500);
  }
  assert.throws(() =>
    send(
      createWorkspace(),
      base({ kind: "payment", to: "credit", amount: 34216 }),
    ),
  );
});

test("a bill cannot be confirmed or scheduled twice", () => {
  const state = createWorkspace();
  const bill = base({ kind: "bill", to: "pge", amount: 12845, date: day(3) });
  const scheduled = send(state, bill);
  assert.equal(
    balance(scheduled.state, "checking"),
    balance(state, "checking"),
  );
  assert.throws(() =>
    send(scheduled.state, { ...bill, requestId: crypto.randomUUID() }),
  );
  const undone = applyAction(scheduled.state, {
    action: "cancel",
    payload: { id: scheduled.result },
  });
  assert.doesNotThrow(() =>
    send(undone.state, {
      ...bill,
      date: day(),
      requestId: crypto.randomUUID(),
    }),
  );
});

test("scheduled payments can be edited and cancelled without moving funds", () => {
  const before = createWorkspace(),
    first = send(before, base({ date: day(5), frequency: "weekly" }));
  const edited = applyAction(first.state, {
    action: "edit",
    payload: { id: first.result, amount: 3500, date: day(2) },
  });
  const row = edited.state.payments.find((p) => p.id === first.result);
  assert.equal(row.amount, 3500);
  assert.equal(row.date, day(2));
  const done = applyAction(edited.state, {
    action: "cancel",
    payload: { id: first.result },
  });
  settleDue(done.state, day(2));
  assert.equal(balance(done.state, "checking"), balance(before, "checking"));
  assert.equal(
    done.state.payments.find((p) => p.id === first.result).status,
    "cancelled",
  );
});

test("monthly schedules preserve the original day after a short month", () => {
  const start = "2026-01-31";
  const state = createWorkspace();
  state.payments = [];
  const payment = applyAction(
    state,
    { action: "submit", payload: base({ date: start, frequency: "monthly" }) },
    start,
  );
  assert.equal(payment.state.payments[0].date, "2026-02-28");
  settleDue(payment.state, "2026-02-28");
  assert.equal(payment.state.payments[0].date, "2026-03-31");
  assert.equal(
    payment.state.payments.filter((p) => p.status === "completed").length,
    2,
  );
  assert.equal(settleDue(payment.state, "2026-02-28"), false);
});

test("scheduled payments re-check available funds when due", () => {
  const state = createWorkspace();
  state.payments = [];
  const scheduled = send(state, base({ date: day(1), amount: 480000 }));
  const spent = send(
    scheduled.state,
    base({ kind: "person", to: "alex", amount: 20000 }),
  );
  const before = balance(spent.state, "checking");
  settleDue(spent.state, day(1));
  assert.equal(balance(spent.state, "checking"), before);
  assert.equal(
    spent.state.payments.find((p) => p.id === scheduled.result).status,
    "failed",
  );
});

test("mobile check deposits post to the account and enforce limits", () => {
  const state = createWorkspace();
  const before = balance(state, "savings");
  const out = send(state, {
    kind: "deposit",
    from: "",
    to: "savings",
    amount: 25000,
    date: day(),
    frequency: "once",
    requestId: crypto.randomUUID(),
  });
  assert.equal(balance(out.state, "savings"), before + 25000);
  const tx = out.state.transactions.find((t) => t.reference === out.result);
  assert.equal(tx.category, "Mobile deposit");
  assert.equal(tx.amount, 25000);
  // Not a deposit account
  assert.throws(() =>
    send(state, { kind: "deposit", from: "", to: "credit", amount: 100, date: day(), frequency: "once", requestId: crypto.randomUUID() }),
  );
  // Deposits post the same day only
  assert.throws(() =>
    send(state, { kind: "deposit", from: "", to: "savings", amount: 100, date: day(1), frequency: "once", requestId: crypto.randomUUID() }),
  );
  // Remaining daily limit is enforced against today's deposits
  let s = createWorkspace();
  s = send(s, { kind: "deposit", from: "", to: "checking", amount: 490000, date: day(), frequency: "once", requestId: crypto.randomUUID() }).state;
  assert.throws(() =>
    send(s, { kind: "deposit", from: "", to: "checking", amount: 20000, date: day(), frequency: "once", requestId: crypto.randomUUID() }),
  );
});

test("a Friday sample deposit is posted once and unavailable until Monday UTC", () => {
  const friday = "2026-11-20";
  const monday = "2026-11-23";
  const account = state => state.accounts.find(a => a.id === "checking");
  const ledger = createWorkspace();
  ledger.payments = [];
  account(ledger).balance = 50000;
  const deposit = base({ kind: "deposit", from: "", to: "checking", amount: 20000, date: friday });
  const initial = applyAction(ledger, { action: "submit", payload: deposit }, friday);
  const retry = applyAction(initial.state, { action: "submit", payload: deposit }, friday);
  assert.equal(retry.result, initial.result);
  assert.equal(retry.state.transactions.filter(tx => tx.reference === retry.result).length, 1);
  assert.equal(account(retry.state).balance, 70000);
  assert.equal(heldDepositAmount(retry.state, account(retry.state), friday), 20000);
  assert.equal(availableBalance(retry.state, account(retry.state), "2026-11-22"), 50000);
  assert.equal(availableBalance(retry.state, account(retry.state), monday), 70000);
  assert.equal(nextDepositAvailability("2026-11-22"), monday);
  assert.equal(nextDepositAvailability(monday), "2026-11-24");
  assert.equal(heldDepositAmount(retry.state, retry.state.accounts.find(a => a.id === "savings"), friday), 0);
  for (const payment of [base({ amount: 50001, date: friday }), base({ kind: "person", to: "alex", amount: 50001, date: friday })]) {
    assert.throws(() => applyAction(retry.state, { action: "submit", payload: payment }, friday), /more than your available balance/);
  }
  const later = applyAction(retry.state, { action: "submit", payload: base({ amount: 50001, date: monday }) }, monday);
  assert.equal(account(later.state).balance, 19999);
  // Historical deposits with no stored release date continue to be available immediately.
  const legacy = structuredClone(retry.state);
  delete legacy.transactions.find(tx => tx.reference === retry.result).availableOn;
  assert.equal(availableBalance(legacy, account(legacy), friday), 70000);
});

test("scheduled transfers cannot use a held deposit before its release date", () => {
  const friday = "2026-11-20";
  const saturday = "2026-11-21";
  const monday = "2026-11-23";
  const ledger = createWorkspace();
  ledger.payments = [];
  const submit = (state, overrides) => applyAction(state, { action: "submit", payload: base(overrides) }, friday);
  const early = submit(ledger, { date: saturday, amount: 480000 });
  const later = submit(early.state, { date: monday, amount: 480000 });
  const spent = submit(later.state, { date: friday, kind: "person", to: "alex", amount: 20000 });
  const deposited = submit(spent.state, { date: friday, kind: "deposit", from: "", to: "checking", amount: 20000 });
  assert.equal(balance(deposited.state, "checking"), 485022);
  assert.equal(settleDue(deposited.state, monday), true);
  assert.equal(deposited.state.payments.find(p => p.id === early.result).status, "failed");
  assert.equal(deposited.state.payments.find(p => p.id === later.result).status, "completed");
  assert.equal(balance(deposited.state, "checking"), 5022);
});

test("dated accounts reject payments and deposits from before opening day", () => {
  const openingDate = "2026-11-20";
  const previous = "2026-11-19";
  const ledger = createWorkspace();
  ledger.payments = [];
  ledger.accounts.find(a => a.id === "savings").openingDate = openingDate;
  const submit = (payload, today = previous) => applyAction(ledger, { action: "submit", payload: base(payload) }, today);
  assert.throws(() => submit({ date: previous }), /before the account opened/);
  assert.throws(() => submit({ from: "savings", to: "checking", date: previous }), /before the account opened/);
  assert.throws(() => submit({ kind: "deposit", from: "", to: "savings", date: previous }), /before the account opened/);
  const valid = submit({ date: openingDate }, openingDate);
  assert.equal(valid.state.transactions.find(t => t.reference === valid.result).date, openingDate);
});
