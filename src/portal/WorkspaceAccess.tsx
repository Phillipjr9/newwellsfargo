import { useState, type FormEvent } from "react";
import { checkDemoSession, SessionCookieError } from "../auth";
import { PageIntro } from "./Chrome";

export default function WorkspaceAccess() {
  const [mode, setMode] = useState<"session" | "claim">("session");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cookieError, setCookieError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setCookieError(false);
    const action = issued ? "session" : mode;
    const value = (issued || code).trim();
    const prefix = action === "claim" ? "join" : "access";
    if (!new RegExp(`^${prefix}-[a-f0-9]{48}-[a-f0-9]{48}$`).test(value)) {
      setError(`Enter a workspace code that starts with ${prefix}-. Do not enter bank sign-in details.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/demo/customer-access/${action}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Workspace access is unavailable. Please try again.");
      if (action === "claim" && typeof result.accessCode === "string") {
        setIssued(result.accessCode);
        setCode("");
      } else {
        if (result.authenticated !== true || !await checkDemoSession(AbortSignal.timeout(10000), true)) {
          throw new SessionCookieError();
        }
        // Reload to ensure no previously opened workspace remains in the browser cache.
        window.location.replace("/portal");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open your workspace.");
      setCookieError(e instanceof SessionCookieError);
    } finally { setBusy(false); }
  }

  return <div className="pb-workspace">
    <main id="portal-main" className="pb-wrap pb-main">
      <div className="pb-page">
        <PageIntro eyebrow="Workspace access" title={issued ? "Save your access code" : mode === "claim" ? "Accept a workspace invitation" : "Sign in to your workspace"}
          description="Use only codes issued for this workspace. Do not enter your bank username, password, or account details."/>
        <div className="pb-form-layout">
          <section className="pb-panel">
            <form className="pb-form-body" onSubmit={submit}>
              {issued ? <>
                <p>Your invitation has been used. Save this access code somewhere private; it won’t be shown again.</p>
                <label className="pb-field"><span>New workspace access code</span><input readOnly value={issued} spellCheck={false} onFocus={event => event.target.select()}/></label>
                <label><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/> I’ve saved my workspace access code</label>
              </> : <label className="pb-field">
                <span>{mode === "claim" ? "Invitation code" : "Workspace access code"}</span>
                <input type="password" autoComplete="off" spellCheck={false} required value={code} maxLength={120} onChange={event => setCode(event.target.value)}/>
              </label>}
              {error && <p className="pb-error" role="alert">{error}{cookieError && <> <a href="/portal/access" target="_blank" rel="noopener noreferrer">Open workspace sign-in in a new tab</a> and use your saved access code.</>}</p>}
              <div className="pb-form-buttons">
                <button className="pb-button pb-solid" disabled={busy || (issued ? !saved : !code.trim())}>{busy ? "Please wait…" : issued ? "Continue to workspace" : mode === "claim" ? "Accept invitation" : "Sign in to workspace"}</button>
                {!issued && <button type="button" className="pb-button" disabled={busy} onClick={() => { setMode(mode === "claim" ? "session" : "claim"); setError(""); setCookieError(false); setCode(""); }}>{mode === "claim" ? "I have an access code" : "I have an invitation code"}</button>}
              </div>
            </form>
          </section>
          <aside className="pb-panel pb-side-help"><h2>Need help with access?</h2><p>If your code is lost or expired, ask your workspace administrator for a replacement invitation.</p></aside>
        </div>
      </div>
    </main>
  </div>;
}
