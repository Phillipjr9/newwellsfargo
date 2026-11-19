import { useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  History,
  Landmark,
  Link2,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  day,
  LINKED_SAMPLES,
  PEOPLE,
  validateDraft,
  WIRE_RECIPIENTS,
} from "../../shared/ledger.mjs";
import { useRouter } from "../router/RouterContext";
import Dialog from "../components/Dialog";
import { PageBack, PageIntro, SideHelp } from "./Chrome";
import {
  actionPaths,
  dateLabel,
  frequencyNames,
  isDeposit,
  kindNames,
  money,
  type Account,
  type Draft,
  type Frequency,
  type Payment,
  type PaymentKind,
  type Workspace,
} from "./model";
import { runCommand } from "./store";

const pages: Record<PaymentKind, { title: string; description: string }> = {
  transfer: {
    title: "Transfer money",
    description:
      "Move money between your sample checking and savings accounts.",
  },
  external: {
    title: "Bank-to-bank transfers",
    description: "Practice moving money to or from a linked sample bank.",
  },
  person: {
    title: "Send with Zelle\u00ae",
    description: "Try a person-to-person payment with a fictional recipient.",
  },
  wire: {
    title: "Wire money",
    description:
      "Explore a domestic wire with a preconfigured sample recipient.",
  },
  bill: {
    title: "Pay bills",
    description:
      "Choose a sample bill, pick a payment date, and review the details.",
  },
  payment: {
    title: "Pay a card or loan",
    description:
      "Make a sample payment toward your credit card or mortgage balance.",
  },
  deposit: {
    title: "Mobile deposit",
    description: "Deposit a check with your device's camera.",
  },
};

export function PaymentNav({ kind }: { kind: PaymentKind | "activity" }) {
  const items: [PaymentKind | "activity", string][] = [
    ["deposit", "Deposit checks"],
    ["transfer", "Between accounts"],
    ["external", "External transfers"],
    ["person", "Zelle"],
    ["wire", "Wire money"],
    ["bill", "Bill Pay"],
    ["payment", "Card & loan payments"],
    ["activity", "Activity"],
  ];
  return (
    <nav className="pb-subnav" aria-label="Payment services">
      {items.map(([key, text]) => (
        <a
          key={key}
          href={key === "activity" ? "/portal/payments" : actionPaths[key]}
          aria-current={kind === key ? "page" : undefined}
          className={kind === key ? "active" : ""}
        >
          {text}
        </a>
      ))}
    </nav>
  );
}

const optionName = (a: Account) => `${a.name} (${a.last4})`;
const errText = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
export const ErrorMessage = ({ text }: { text: string }) =>
  text ? (
    <p role="alert" className="pb-error">
      <CircleAlert size={17} />
      {text}
    </p>
  ) : null;
function AmountField({
  value,
  setValue,
  readOnly = false,
}: {
  value: string;
  setValue: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="pb-field">
      Amount
      <div className="pb-money-input">
        <span>$</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          pattern="[0-9]+(\.[0-9]{1,2})?"
          title="A positive amount with up to two decimal places"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={readOnly}
          required
          maxLength={12}
        />
        <small>USD</small>
      </div>
    </label>
  );
}

function LinkSampleBank({
  state,
  onLinked,
  onClose,
}: {
  state: Workspace;
  onLinked: (id: string) => void;
  onClose: () => void;
}) {
  const options = LINKED_SAMPLES.filter(
    (a) => !state.accounts.some((b) => a.id === b.id),
  );
  const [id, setId] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function link(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runCommand({ action: "link", payload: { id } });
      onLinked(id);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      label="Link a sample bank"
      className="pb-detail-dialog"
      onClose={onClose}
    >
      <button
        className="pb-dialog-x"
        aria-label="Close linked banks"
        onClick={onClose}
      >
        <X size={19} />
      </button>
      <span className="pb-soft-icon">
        <Landmark size={24} />
      </span>
      <h2>Linked sample banks</h2>
      <p className="pb-muted-copy">
        Use a fictional bank from the list. No login or account numbers are
        needed.
      </p>
      {state.accounts
        .filter((a) => a.type === "external")
        .map((a) => (
          <p className="pb-linked-item" key={a.id}>
            <CircleCheck size={16} />
            {a.name} &middot; {a.last4}
          </p>
        ))}
      {options.length ? (
        <form onSubmit={link} className="pb-form-body">
          <label className="pb-field">
            Sample bank
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {optionName(a)}
                </option>
              ))}
            </select>
          </label>
          <ErrorMessage text={error} />
          <button className="pb-button pb-solid" disabled={busy}>
            {busy ? "Linking..." : "Link sample bank"}
          </button>
        </form>
      ) : (
        <button className="pb-button" onClick={onClose}>
          Done
        </button>
      )}
    </Dialog>
  );
}

export function MoneyPage({
  state,
  kind,
  ready,
}: {
  state: Workspace;
  kind: PaymentKind;
  ready: boolean;
}) {
  const { query, navigate } = useRouter();
  const sources = state.accounts.filter((a) =>
    kind === "bill"
      ? a.type === "checking"
      : isDeposit(a) || (kind === "external" && a.type === "external"),
  );
  const [from, setFrom] = useState(
    sources.find((a) => a.id === query.from)?.id ?? sources[0].id,
  );
  const linked = state.accounts.filter((a) => a.type === "external");
  const outstanding = state.bills.filter(
    (b) =>
      !state.payments.some(
        (p) =>
          p.kind === "bill" &&
          p.to === b.id &&
          ["completed", "scheduled"].includes(p.status),
      ),
  );
  const optionsFor = (source: string) => {
    if (kind === "person") return PEOPLE;
    if (kind === "wire") return WIRE_RECIPIENTS;
    if (kind === "bill")
      return outstanding.map((b) => ({
        id: b.id,
        name: b.name,
        detail: `Due ${dateLabel(b.due)}: ${money(b.amount)}`,
      }));
    return state.accounts
      .filter(
        (a) =>
          a.id !== source &&
          (kind === "payment"
            ? ["credit", "loan"].includes(a.type) && a.balance > 0
            : kind === "external"
              ? linked.some((b) => b.id === source)
                ? isDeposit(a)
                : a.type === "external"
              : isDeposit(a)),
      )
      .map((a) => ({
        id: a.id,
        name: optionName(a),
        detail:
          kind === "payment" ? `Outstanding balance: ${money(a.balance)}` : "",
      }));
  };
  const options = optionsFor(from);
  const [to, setTo] = useState(
    options.find((a) => a.id === query.to)?.id ?? options[0]?.id ?? "",
  );
  const [value, setValue] = useState("");
  const [date, setDate] = useState(day());
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [linking, setLinking] = useState(false);
  const [review, setReview] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const source = sources.find((a) => a.id === from) ?? sources[0];
  const target = options.find((a) => a.id === to) ?? options[0];
  const displayAmount =
    kind === "bill"
      ? (
          (outstanding.find((b) => b.id === target?.id)?.amount ?? 0) / 100
        ).toFixed(2)
      : value;
  const canRecur = kind === "transfer" || kind === "external";
  const recipientLabel =
    kind === "bill"
      ? "Payee"
      : ["wire", "person"].includes(kind)
        ? "Sample recipient"
        : "To account";
  function chooseFrom(id: string) {
    setFrom(id);
    const targets = optionsFor(id);
    setTo(targets.some((a) => a.id === to) ? to : (targets[0]?.id ?? ""));
    setError("");
  }
  function prepare(e: FormEvent) {
    e.preventDefault();
    setError("");
    const requestId = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const input = {
      kind,
      amount: Math.round(Number(displayAmount) * 100),
      from: source.id,
      to: target?.id ?? "",
      date,
      frequency,
      requestId,
    };
    try {
      validateDraft(state, input);
      setReview(input);
    } catch (e) {
      setError(errText(e));
    }
  }
  async function submit() {
    if (!review || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await runCommand({ action: "submit", payload: review });
      navigate(`/portal/payments/${id}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Transfer & pay"
        title={pages[kind].title}
        description={pages[kind].description}
      />
      <PaymentNav kind={kind} />
      <div className="pb-form-layout">
        <section className="pb-panel pb-payment-form">
          <div className="pb-stepper">
            <span className="current">
              <i>{review ? <Check size={13} /> : "1"}</i>Details
            </span>
            <b />
            <span className={review ? "current" : ""}>
              <i>2</i>Review
            </span>
            <b />
            <span>
              <i>3</i>Confirmation
            </span>
          </div>
          {kind === "external" && !linked.length ? (
            <div className="pb-state-message">
              <span className="pb-soft-icon">
                <Landmark />
              </span>
              <h2>Connect a sample bank</h2>
              <p>Link a demo account to practice transferring between banks.</p>
              <button
                className="pb-button pb-solid"
                onClick={() => setLinking(true)}
                disabled={!ready}
              >
                <Plus size={16} />
                Link a sample bank
              </button>
            </div>
          ) : !options.length ? (
            <div className="pb-state-message">
              <CircleCheck className="pb-success-icon" />
              <h2>You're all caught up</h2>
              <p>There are no outstanding sample payments of this type.</p>
              <a className="pb-button" href="/portal/payments">
                View payment activity
              </a>
            </div>
          ) : review ? (
            <div className="pb-form-body">
              <p className="pb-eyebrow">Review your details</p>
              <h2>
                {date === day()
                  ? "Ready to confirm?"
                  : "Review scheduled payment"}
              </h2>
              <p className="pb-muted-copy">
                Verify the amount and destination before updating your demo
                ledger.
              </p>
              <div className="pb-review-total">
                <small>Amount</small>
                <strong>{money(review.amount)}</strong>
              </div>
              <dl className="pb-details">
                <div>
                  <dt>From</dt>
                  <dd>{optionName(source)}</dd>
                </div>
                <div>
                  <dt>{recipientLabel}</dt>
                  <dd>{target?.name}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{dateLabel(date, true)}</dd>
                </div>
                <div>
                  <dt>Frequency</dt>
                  <dd>{frequencyNames[frequency]}</dd>
                </div>
                <div>
                  <dt>Demo fee</dt>
                  <dd>$0.00</dd>
                </div>
              </dl>
              <ErrorMessage text={error} />
              <div className="pb-form-buttons">
                <button
                  className="pb-text-btn"
                  onClick={() => setReview(null)}
                  disabled={busy}
                >
                  <ArrowLeft size={15} />
                  Edit details
                </button>
                <button
                  className="pb-button pb-solid"
                  onClick={submit}
                  disabled={busy || !ready}
                >
                  {busy ? "Saving..." : "Confirm demo payment"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            <form className="pb-form-body" onSubmit={prepare}>
              <h2>
                {kind === "bill" ? "Payment details" : "Transfer details"}
              </h2>
              <label className="pb-field">
                From account
                <select
                  value={from}
                  onChange={(e) => chooseFrom(e.target.value)}
                >
                  {sources.map((a) => (
                    <option key={a.id} value={a.id}>
                      {optionName(a)}
                    </option>
                  ))}
                </select>
                <small>
                  Available:{" "}
                  {state.preferences.hideBalances
                    ? "Hidden"
                    : money(source.balance)}
                </small>
              </label>
              <label className="pb-field">
                {recipientLabel}
                <select
                  value={target?.id ?? ""}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setError("");
                  }}
                >
                  {options.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {target?.detail && <small>{target.detail}</small>}
              </label>
              {kind === "external" && (
                <button
                  type="button"
                  className="pb-action-link"
                  onClick={() => setLinking(true)}
                >
                  <Link2 size={15} />
                  Manage linked sample banks
                </button>
              )}
              <div className="pb-form-pair">
                <AmountField
                  value={displayAmount}
                  setValue={setValue}
                  readOnly={kind === "bill"}
                />
                <label className="pb-field">
                  {kind === "bill" ? "Pay on" : "Transfer date"}
                  <input
                    type="date"
                    value={date}
                    min={day()}
                    max={day(365)}
                    required
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              {canRecur && (
                <label className="pb-field">
                  Frequency
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                  >
                    {Object.entries(frequencyNames).map(([k, name]) => (
                      <option key={k} value={k}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <ErrorMessage text={error} />
              <div className="pb-form-buttons">
                <span className="pb-small-note">
                  <ShieldCheck size={15} />
                  Simulation only
                </span>
                <button className="pb-button pb-solid" disabled={!ready}>
                  Review{" "}
                  {kind === "transfer" || kind === "external"
                    ? "transfer"
                    : "payment"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
        </section>
        <SideHelp />
      </div>
      {linking && (
        <LinkSampleBank
          state={state}
          onClose={() => setLinking(false)}
          onLinked={(id) => {
            setFrom("checking");
            setTo(id);
            setLinking(false);
          }}
        />
      )}
    </>
  );
}

function EditPayment({
  payment,
  close,
}: {
  payment: Payment;
  close: () => void;
}) {
  const [value, setValue] = useState((payment.amount / 100).toFixed(2));
  const [date, setDate] = useState(payment.date),
    [frequency, setFreq] = useState(payment.frequency);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function edit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runCommand({
        action: "edit",
        payload: {
          id: payment.id,
          amount: Math.round(Number(value) * 100),
          date,
          frequency,
        },
      });
      close();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      label="Edit scheduled payment"
      className="pb-detail-dialog"
      onClose={close}
    >
      <h2>Edit scheduled payment</h2>
      <p className="pb-muted-copy">
        {payment.fromName} to {payment.toName}
      </p>
      <form className="pb-form-body" onSubmit={edit}>
        <AmountField
          value={value}
          setValue={setValue}
          readOnly={payment.kind === "bill"}
        />
        <label className="pb-field">
          Payment date
          <input
            type="date"
            min={day()}
            max={day(365)}
            value={date}
            required
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {["transfer", "external"].includes(payment.kind) && (
          <label className="pb-field">
            Frequency
            <select
              value={frequency}
              onChange={(e) => setFreq(e.target.value as Frequency)}
            >
              {Object.entries(frequencyNames).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        {date === day() && (
          <p className="pb-muted-copy">
            Saving today's date will post this sample payment immediately.
          </p>
        )}
        <ErrorMessage text={error} />
        <div className="pb-form-buttons">
          <button type="button" className="pb-text-btn" onClick={close}>
            Back
          </button>
          <button className="pb-button pb-solid" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PaymentDetail({ state, id }: { state: Workspace; id: string }) {
  const record = state.payments.find(
    (p) => p.id.toLowerCase() === id.toLowerCase(),
  );
  const [editing, setEditing] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!record) return <MissingPage />;
  const p = record;
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await runCommand({ action: "cancel", payload: { id: p.id } });
      setCancelling(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const isTransfer = ["transfer", "external"].includes(p.kind);
  return (
    <>
      <PageBack href="/portal/payments" label="Transfer & payment activity" />
      <div className="pb-receipt-wrap">
        <section className="pb-panel pb-receipt">
          <span className={`pb-receipt-icon ${p.status}`}>
            {p.status === "completed" ? (
              <Check size={32} />
            ) : p.status === "scheduled" ? (
              <CalendarClock size={31} />
            ) : (
              <History size={30} />
            )}
          </span>
          <p className="pb-eyebrow">Demo confirmation</p>
          <h1>
            {isTransfer ? "Transfer" : "Payment"} {p.status}
          </h1>
          <p className="pb-muted-copy">
            {p.status === "completed"
              ? "Your sample balances have been updated."
              : p.status === "scheduled"
                ? "Your sample payment is on the calendar. No funds have moved yet."
                : p.status === "cancelled"
                  ? "This payment will not be processed."
                  : p.reason}
          </p>
          <strong className="pb-receipt-amount">
            {state.preferences.hideBalances ? "Hidden" : money(p.amount)}
          </strong>
          <dl className="pb-details">
            <div>
              <dt>From</dt>
              <dd>{p.fromName}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{p.toName}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{dateLabel(p.date, true)}</dd>
            </div>
            <div>
              <dt>Frequency</dt>
              <dd>{frequencyNames[p.frequency]}</dd>
            </div>
            <div>
              <dt>Preview reference</dt>
              <dd>{p.id}</dd>
            </div>
          </dl>
          <p className="pb-simulation-note">
            <ShieldCheck size={16} />
            Fictional activity. Not a bank payment confirmation.
          </p>
          {p.status === "scheduled" && (
            <div className="pb-receipt-actions">
              <button className="pb-button" onClick={() => setEditing(true)}>
                Edit payment
              </button>
              <button
                className="pb-text-btn"
                onClick={() => setCancelling(true)}
              >
                Cancel payment
              </button>
            </div>
          )}
          <div className="pb-receipt-actions">
            <a className="pb-button pb-solid" href="/portal">
              Account summary
            </a>
            <a className="pb-action-link" href={actionPaths[p.kind]}>
              Make another <ArrowRight size={15} />
            </a>
          </div>
        </section>
      </div>
      {editing && <EditPayment payment={p} close={() => setEditing(false)} />}
      {cancelling && (
        <Dialog
          label="Cancel scheduled payment"
          className="pb-detail-dialog"
          onClose={() => setCancelling(false)}
        >
          <h2>
            Cancel this {p.frequency === "once" ? "payment" : "payment series"}?
          </h2>
          <p className="pb-muted-copy">
            The {money(p.amount)} payment to {p.toName} on {dateLabel(p.date)}
            {p.frequency !== "once" ? " and future repeats" : ""} will be
            cancelled. Your balance will not change.
          </p>
          <ErrorMessage text={error} />
          <div className="pb-form-buttons">
            <button className="pb-button" onClick={() => setCancelling(false)}>
              Keep payment
            </button>
            <button
              className="pb-button pb-solid"
              disabled={busy}
              onClick={cancel}
            >
              Confirm cancellation
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function PaymentActivity({ state }: { state: Workspace }) {
  const { query } = useRouter();
  const [filter, setFilter] = useState(query.filter ?? "all");
  const visible = state.payments.filter(
    (p) => filter === "all" || p.status === filter,
  );
  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Transfer & pay"
        title="Transfer & payment activity"
        description="Review completed payments or manage your scheduled transfers."
      />
      <PaymentNav kind="activity" />
      <section className="pb-panel">
        <div className="pb-panel-head">
          <h2>Payment history</h2>
          <label className="pb-inline-select">
            <span className="sr-only">Filter payment activity</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {["all", "scheduled", "completed", "cancelled", "failed"].map(
                (v) => (
                  <option key={v} value={v}>
                    {v === "all"
                      ? "All activity"
                      : v[0].toUpperCase() + v.slice(1)}
                  </option>
                ),
              )}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        {visible.length ? (
          visible.map((p) => (
            <a
              key={p.id}
              className="pb-payment-row"
              href={`/portal/payments/${p.id}`}
            >
              <span className="pb-soft-icon">
                {p.status === "scheduled" ? (
                  <Clock3 size={21} />
                ) : (
                  <ArrowLeftRight size={21} />
                )}
              </span>
              <span className="pb-payment-name">
                <strong>{p.toName}</strong>
                <small>
                  {kindNames[p.kind]} &middot; {dateLabel(p.date)}
                </small>
              </span>
              <span className={`pb-status ${p.status}`}>{p.status}</span>
              <b>{state.preferences.hideBalances ? "••••" : money(p.amount)}</b>
              <ChevronRight size={16} />
            </a>
          ))
        ) : (
          <div className="pb-empty">
            <History size={26} />
            <strong>No {filter === "all" ? "" : filter} payments yet</strong>
            <p>New demo transfers appear here after you confirm them.</p>
            <a className="pb-action-link" href="/portal/transfers">
              Make a transfer <ArrowRight size={15} />
            </a>
          </div>
        )}
      </section>
    </>
  );
}

export function MissingPage() {
  return (
    <section className="pb-panel pb-state-message">
      <h1>Page not found</h1>
      <p>This page or sample record is not in your workspace.</p>
      <a href="/portal" className="pb-button pb-solid">
        Back to account summary
      </a>
    </section>
  );
}
