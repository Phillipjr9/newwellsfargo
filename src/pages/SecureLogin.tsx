import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "../router/RouterContext";
import Logo from "../components/Logo";
import SiteFooter from "../components/SiteFooter";
import type { OutsideLinkHandler } from "../components/ContentSections";
import { SessionCookieError, cleanupPortalBeforeSecureLogin, signOnWithCredentials } from "../auth";
import officialDestinations from "../../shared/official-destinations.json";
import "./secure-login.css";

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
}

function PasskeyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M12 13.2c1.4 1.1 2.3 2.7 2.5 4.5M15 15l4.5 4.5M18 18l2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

export default function SecureLogin({ onLeave, onSignedIn, forceFreshSignIn }: { onLeave: OutsideLinkHandler; onSignedIn?: () => void; forceFreshSignIn?: boolean }) {
  const { navigate } = useRouter();
  // ProtectedPortal → SecureLogin on session end: clear old banking_customer + bump epoch
  useEffect(() => {
    if (forceFreshSignIn) void cleanupPortalBeforeSecureLogin();
  }, [forceFreshSignIn]);
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem("banking-saved-email") || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saveUsername, setSaveUsername] = useState(Boolean(username));
  const [searchOpen, setSearchOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [cookieError, setCookieError] = useState(false);
  const [busy, setBusy] = useState(false);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function enter() {
    if (busy) return;
    setBusy(true);
    setLoginError("");
    setCookieError(false);
    try {
      await signOnWithCredentials(username.trim(), password);
      setPassword("");
      if (onSignedIn) onSignedIn();
      else navigate("/portal");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-on failed.");
      setCookieError(error instanceof SessionCookieError);
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setCookieError(false);
    if (!/^\S+@\S+\.\S+$/.test(username.trim())) {
      setLoginError("Enter a valid email address.");
      return;
    }
    if (saveUsername) { try { localStorage.setItem("banking-saved-email", username.trim()); } catch { /* optional */ } }
    else { try { localStorage.removeItem("banking-saved-email"); } catch { /* optional */ } }
    void enter();
  }

  return (
    <div className="secure-login-page">
      <header className="secure-login-header">
        <div className="secure-login-header-inner">
          <Logo />
          <nav className="secure-login-utility" aria-label="Header navigation">
            <a href="/enroll" aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); navigate("/enroll"); }}>Enroll</a>
            <a href="https://www.wellsfargo.com/help/" aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave("https://www.wellsfargo.com/help/"); }}>Customer Service</a>
            <a href="/locations">ATMs/Locations</a>
            <a href="https://www.wellsfargo.com/es/" lang="es" aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave("https://www.wellsfargo.com/es/"); }}>Español</a>
            <button type="button" className="secure-login-search" aria-label="Search" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}>
              {searchOpen ? <span>Close</span> : <SearchIcon />}
            </button>
          </nav>
        </div>
        {searchOpen && (
          <form className="secure-login-search-form" role="search" onSubmit={(event) => { event.preventDefault(); const q = String(new FormData(event.currentTarget).get("q") || "").trim(); navigate("/search", q ? { q } : undefined); }}>
            <label><span>Search Wells Fargo</span><input type="search" name="q" placeholder="Search" /></label>
            <button type="submit" className="secure-login-search-submit">Search</button>
          </form>
        )}
      </header>

      <main id="main-content" className="secure-login-main">
        <section className="secure-login-card" aria-labelledby="secure-login-title">
          <h1 id="secure-login-title">{greeting}</h1>
          <form onSubmit={submit}>
            <label className="secure-login-field">
              <span className="secure-login-label">Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              {username && <button type="button" className="secure-login-clear" aria-label="Clear username" onClick={() => setUsername("")}>×</button>}
            </label>

            <label className="secure-login-field">
              <span className="secure-login-label">Password</span>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" className="secure-login-show" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </label>

            <label className="secure-login-save">
              <input type="checkbox" checked={saveUsername} onChange={(event) => setSaveUsername(event.target.checked)} />
              <span>Save username</span>
            </label>
            <p className="secure-login-save-copy">To help keep your account secure, save your username only on devices that aren't used by other people.</p>

            {loginError && <p className="ad-login-error" role="alert">{loginError}{cookieError && <> <a href={window.location.href} target="_blank" rel="noopener noreferrer">Open sign-in in a new tab</a> and try again.</>}</p>}

            <button type="submit" className="secure-login-submit" disabled={busy || !username || !password}>Sign on</button>
          </form>

          <div className="secure-login-divider"><span>or</span></div>
          <button type="button" className="secure-login-passkey" onClick={() => onLeave(officialDestinations["/auth/login"])}><PasskeyIcon />Use a passkey</button>
          <p className="secure-login-passkey-copy">Don't have one? Create a passkey after signing on and skip the password next time.</p>

          <button
            type="button"
            className="secure-one-click-admin"
            onClick={() => navigate("/admin")}
          >
            Super admin login
          </button>

          <a href="/portal/access" className="secure-login-forgot">Have a workspace invitation or access code?</a>
          <a className="secure-login-forgot" href="https://oam.wellsfargo.com/oamo/identity/help/passwordhelp/" aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave("https://oam.wellsfargo.com/oamo/identity/help/passwordhelp/"); }}><span aria-hidden="true">→</span> Forgot username or password?</a>
        </section>
      </main>

      <SiteFooter onLeave={onLeave} />
    </div>
  );
}
