import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleCheck,
  ImagePlus,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "../router/RouterContext";
import { PageBack, PageIntro } from "./Chrome";
import { PaymentNav } from "./Payments";
import { dateLabel, isDeposit, money, type Workspace } from "./model";
import { availableBalance, day, mobileDepositUsage, MOBILE_DEPOSIT_LIMITS } from "../../shared/ledger.mjs";
import { runCommand } from "./store";
import heroImg from "../assets/deposit-hero.jpg";
import getStartedImg from "../assets/deposit-get-started.png";
import selectAccountImg from "../assets/deposit-select-account.png";
import enterAmountImg from "../assets/deposit-enter-amount.png";
import takePhotosImg from "../assets/deposit-take-photos.png";
import submitImg from "../assets/deposit-submit.png";

// Guidance text and screen imagery from Wells Fargo's public mobile deposit page.
const STEPS = [
  {
    id: "start",
    title: "Get started",
    image: getStartedImg,
    alt: "Wells Fargo Mobile app shortcut to Deposit Checks",
    guide: [
      "Download the Wells Fargo Mobile app to your smartphone.",
      "Sign on to your account.",
      "Select Deposit in the bottom bar, or long press the app for the Deposit Checks shortcut.",
    ],
  },
  {
    id: "account",
    title: "Select account",
    image: selectAccountImg,
    alt: "Wells Fargo Mobile Deposit account selection screen",
    guide: [
      "Select an account from the Deposit to dropdown. If you have set up a default account, it will already be pre-selected.",
      "To change your default, select the account and choose Make selected account my default.",
    ],
  },
  {
    id: "amount",
    title: "Enter amount",
    image: enterAmountImg,
    alt: "Wells Fargo Mobile Deposit amount entry screen",
    guide: [
      "Enter the check amount. Your account's remaining daily and 30-day mobile deposit limit will also display on the screen.",
      "Make sure the amount entered matches the amount on your check, then select Done.",
    ],
  },
  {
    id: "photos",
    title: "Take photos",
    image: takePhotosImg,
    alt: "Wells Fargo Mobile Deposit check photo screens",
    guide: [
      "Sign the back of your check and write “For Mobile Deposit at Wells Fargo Only” below your signature (or if available, check the box that reads: “Check here if mobile deposit”).",
      "Place the check on a dark-colored, plain surface that's well lit.",
      "Position the camera directly over the check (not angled).",
      "Fit all 4 corners inside the guides on your mobile device's screen.",
    ],
  },
  {
    id: "submit",
    title: "Submit deposit",
    image: submitImg,
    alt: "Wells Fargo Mobile Deposit review and submit screen",
    guide: [
      "Make sure your deposit information is correct, then select Deposit.",
      "You'll get an on-screen confirmation and an email letting you know we've received your deposit.",
      "After your deposit, write “mobile deposit” and the date on the front of the check. Keep the check secure for 5 days before tearing it up.",
    ],
  },
] as const;

function PhotoSlot({
  label,
  file,
  onPick,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className={`pb-photo-slot ${file ? "has-photo" : ""}`}>
      <span className="pb-photo-label">{label}</span>
      <button
        type="button"
        className="pb-photo-target"
        onClick={() => input.current?.click()}
        aria-label={`${file ? "Retake" : "Take or upload"} photo of ${label.toLowerCase()}`}
      >
        {preview ? (
          <img src={preview} alt={`${label} check image`} />
        ) : (
          <span className="pb-photo-empty">
            <ImagePlus size={22} strokeWidth={1.4} />
            Add photo
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export default function DepositChecks({
  state,
  ready,
}: {
  state: Workspace;
  ready: boolean;
}) {
  const { navigate } = useRouter();
  const [step, setStep] = useState(0);
  const accounts = useMemo(() => state.accounts.filter(isDeposit), [state.accounts]);
  const [accountId, setAccountId] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  // Preselect the saved default account once the workspace is ready.
  useEffect(() => {
    if (!accountId && accounts.length) {
      const saved = state.preferences.depositDefault;
      setAccountId(accounts.some((a) => a.id === saved) ? (saved as string) : accounts[0].id);
    }
  }, [accounts, accountId, state.preferences.depositDefault]);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const usage = mobileDepositUsage(state, day());
  const remainingDaily = Math.max(0, MOBILE_DEPOSIT_LIMITS.daily - usage.todayTotal);
  const remaining30 = Math.max(0, MOBILE_DEPOSIT_LIMITS.rolling30 - usage.rollingTotal);
  const amountCents = Math.round(Number(amountText) * 100);

  const stepError = (): string => {
    if (step === 1 && !account) return "Choose an account for this deposit.";
    if (step === 2) {
      if (!amountText || !(amountCents > 0)) return "Enter the check amount.";
      if (amountCents > 10000000) return "Enter an amount no greater than $100,000.00.";
      if (amountCents > remainingDaily)
        return "This amount is more than your remaining daily mobile deposit limit.";
      if (amountCents > remaining30)
        return "This amount is more than your remaining 30-day mobile deposit limit.";
    }
    if (step === 3 && (!front || !back))
      return "Add front and back sample images to continue.";
    return "";
  };

  const continueStep = async () => {
    const err = stepError();
    setError(err);
    if (err) return;
    if (step === 1 && makeDefault) {
      try {
        await runCommand({
          action: "preference",
          payload: { key: "depositDefault", value: account.id },
        });
      } catch {
        /* The default preference is a convenience; a failed save doesn't block the deposit. */
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submitDeposit = async () => {
    const err = stepError();
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      const id = await runCommand({
        action: "submit",
        payload: {
          kind: "deposit",
          from: "",
          to: account.id,
          amount: amountCents,
          date: day(),
          frequency: "once",
          requestId: requestId.current,
        },
      });
      setConfirmedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The deposit could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(0);
    setAmountText("");
    setFront(null);
    setBack(null);
    setError("");
    setConfirmedId(null);
    requestId.current = crypto.randomUUID();
  };

  const current = STEPS[step];
  const releaseDate = confirmedId ? state.transactions.find(entry => entry.reference === confirmedId && entry.category === "Mobile deposit")?.availableOn : undefined;

  return (
    <>
      <PageBack />
      <PageIntro
        eyebrow="Transfer & pay"
        title="Mobile check deposit"
        description="Follow Wells Fargo's five-step app flow using public deposit instructions."
      />
      <PaymentNav kind="deposit" />
      <div className="pb-deposit-hero">
        <img src={heroImg} alt="" />
        <div>
          <h2>Lights, camera, deposit</h2>
          <p>Deposit checks from virtually anywhere with the app-style flow below.</p>
        </div>
      </div>

      <div className="pb-deposit-grid">
        {/* Left: the real guide for the current step */}
        <section className="pb-panel pb-deposit-guide" aria-label="How this step works">
          <div className="pb-deposit-guide-media">
            <img src={current.image} alt={current.alt} />
          </div>
          <div className="pb-deposit-guide-copy">
            <h2>{current.title}</h2>
            <ol>
              {current.guide.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>
        </section>

        {/* Right: the interactive flow */}
        <section className="pb-panel pb-deposit-flow" aria-label="Deposit check">
          <div className="pb-stepper pb-deposit-steps">
            {STEPS.map((s, i) => (
              <span key={s.id} className={i === step ? "current" : i < step ? "done" : ""}>
                <i>{i < step ? <Check size={12} /> : i + 1}</i>
                {s.title}
              </span>
            ))}
          </div>

          {confirmedId ? (
            <div className="pb-deposit-confirm">
              <span className="pb-receipt-icon completed">
                <CircleCheck size={30} />
              </span>
              <h2>Deposit recorded</h2>
              <p className="pb-muted-copy">
                {state.preferences.hideBalances ? "Your deposit" : `A deposit of ${money(amountCents)}`} has been added to {account?.name}. No check image was sent to or processed by a bank. Reference {confirmedId}.
              </p>
              <ul className="pb-deposit-aftercare">
                <li>Write “mobile deposit” and the date on the front of the check.</li>
                <li>Keep the check in a safe place for 5 days, then destroy it.</li>
                {releaseDate && <li>Included in your current balance and available to spend on {dateLabel(releaseDate, true)} (UTC).</li>}
              </ul>
              <div className="pb-receipt-actions">
                <a className="pb-button pb-solid" href={`/portal/accounts/${account?.id}`}>
                  View account activity <ArrowRight size={15} />
                </a>
                <button type="button" className="pb-text-btn" onClick={restart}>
                  Make another deposit
                </button>
              </div>
            </div>
          ) : (
            <div className="pb-form-body">
              {step === 1 && (
                <fieldset className="pb-deposit-accounts">
                  <legend>Deposit to</legend>
                  {accounts.map((a) => {
                    const selected = a.id === account?.id;
                    return (
                      <label key={a.id} className={`pb-deposit-account ${selected ? "selected" : ""}`}>
                        <input
                          type="radio"
                          name="deposit-account"
                          checked={selected}
                          onChange={() => setAccountId(a.id)}
                        />
                        <span className="pb-deposit-account-main">
                          <strong>{a.name} ····{a.last4}</strong>
                          <small>
                            Available balance:{" "}
                            {state.preferences.hideBalances ? "hidden" : money(availableBalance(state, a))}
                          </small>
                          <small>
                            Daily limit {money(MOBILE_DEPOSIT_LIMITS.daily)} · 30-day limit{" "}
                            {money(MOBILE_DEPOSIT_LIMITS.rolling30)}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                  <label className="pb-deposit-default">
                    <input
                      type="checkbox"
                      checked={makeDefault}
                      onChange={(e) => setMakeDefault(e.target.checked)}
                    />
                    Make selected account my default
                  </label>
                </fieldset>
              )}

              {step === 2 && (
                <div className="pb-deposit-amount">
                  <label className="pb-field">
                    Check amount
                    <div className="pb-money-input">
                      <span>$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amountText}
                        onChange={(e) => setAmountText(e.target.value)}
                        autoFocus
                      />
                      <small>USD</small>
                    </div>
                  </label>
                  <p className="pb-deposit-limits">
                    Remaining daily limit:{" "}
                    {state.preferences.hideBalances ? "hidden" : money(remainingDaily)} · Remaining
                    30-day limit: {state.preferences.hideBalances ? "hidden" : money(remaining30)}
                  </p>
                  <p className="pb-small-note">
                    <ShieldCheck size={15} />
                    This workspace adds the deposit to your current balance immediately and makes it available on the next weekday (UTC).
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className="pb-deposit-photos">
                  <div className="pb-photo-pair">
                    <PhotoSlot label="Front of check" file={front} onPick={setFront} />
                    <PhotoSlot label="Back of check" file={back} onPick={setBack} />
                  </div>
                  <p className="pb-small-note">
                    <Camera size={15} />
                    Do not upload a real check. Images stay in this browser.
                  </p>
                </div>
              )}

              {step === 4 && (
                <div className="pb-deposit-review">
                  <h2>Review your deposit</h2>
                  <dl className="pb-details">
                    <div>
                      <dt>Deposit to</dt>
                      <dd>
                        {account?.name} ····{account?.last4}
                      </dd>
                    </div>
                    <div>
                      <dt>Amount</dt>
                      <dd>{state.preferences.hideBalances ? "Hidden" : money(amountCents)}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{dateLabel(day(), true)}</dd>
                    </div>
                    <div>
                      <dt>Check photos</dt>
                      <dd>
                        Front {front ? "✓" : "—"} · Back {back ? "✓" : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {step === 0 && (
                <div className="pb-deposit-intro">
                  <h2>Deposit a check in minutes</h2>
                  <p className="pb-muted-copy">
                    This workspace follows the same five steps as the Wells Fargo Mobile app. No real
                    check images leave your device, and no real deposit is made.
                  </p>
                </div>
              )}

              {error && (
                <p role="alert" className="pb-error">
                  {error}
                </p>
              )}

              <div className="pb-form-buttons">
                {step > 0 ? (
                  <button type="button" className="pb-text-btn" onClick={() => setStep(step - 1)}>
                    <ArrowLeft size={15} /> Back
                  </button>
                ) : (
                  <button type="button" className="pb-text-btn" onClick={() => navigate("/portal")}>
                    <ArrowLeft size={15} /> Cancel
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    className="pb-button pb-solid"
                    onClick={continueStep}
                    disabled={!ready}
                  >
                    {step === 0 ? "Start a deposit" : "Continue"} <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pb-button pb-solid"
                    onClick={submitDeposit}
                    disabled={!ready || busy}
                  >
                    {busy ? "Depositing…" : "Deposit"} <Check size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
