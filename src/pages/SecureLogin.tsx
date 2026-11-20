import { FormEvent, useState } from "react";
import { useRouter } from "../router/RouterContext";
import Logo from "../components/Logo";
import SiteFooter from "../components/SiteFooter";
import type { OutsideLinkHandler } from "../components/ContentSections";
import { signDemoIn } from "../auth";
import "./secure-login.css";

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
}

function PasskeyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M12 13.2c1.4 1.1 2.3 2.7 2.5 4.5M15 15l4.5 4.5M18 18l2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

export default function SecureLogin({ onLeave }: { onLeave: OutsideLinkHandler }) {
  const { navigate } = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saveUsername, setSaveUsername] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loginError, setLoginError] = useState("");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    try { await signDemoIn(username, password); navigate("/portal"); }
    catch (error) { setLoginError(error instanceof Error ? error.message : "Sign-on details weren't recognized."); }
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
          <form className="secure-login-search-form" role="search" onSubmit={(event) => { event.preventDefault(); navigate("/search"); }}>
            <label><span>Search Wells Fargo</span><input type="search" placeholder="Search" /></label>
            <button type="submit" className="secure-login-search-submit">Search</button>
          </form>
        )}
      </header>

      <main id="main-content" className="secure-login-main">
        <section className="secure-login-card" aria-labelledby="secure-login-title">
          <h1 id="secure-login-title">{greeting}</h1>
          <form onSubmit={submit}>
            <label className="secure-login-field">
              <span className="secure-login-label">Username</span>
              <input
                name="username"
                autoComplete="username"
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
                autoComplete="current-password"
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

            {loginError && <p className="ad-login-error" role="alert">{loginError}</p>}

            <button type="submit" className="secure-login-submit" disabled={!username || !password}>Sign on</button>
          </form>

          <div className="secure-login-divider"><span>or</span></div>
          <button type="button" className="secure-login-passkey" onClick={async () => { try { await signDemoIn(username || "customer-passkey", password || "customer-password"); navigate("/portal"); } catch (error) { setLoginError(error instanceof Error ? error.message : "Sign-on failed."); } }}><PasskeyIcon />Use a passkey</button>
          <p className="secure-login-passkey-copy">Don't have one? Create a passkey after signing on and skip the password next time.</p>

          <button
            type="button"
            className="secure-one-click-demo"
            onClick={async () => { try { await signDemoIn("customer", "customer-password"); navigate("/portal"); } catch (error) { setLoginError(error instanceof Error ? error.message : "Sign-on failed."); } }}
          >
            One-click sign in
          </button>
          <button
            type="button"
            className="secure-one-click-admin"
            onClick={() => navigate("/admin")}
          >
            Super admin login
          </button>

          <a className="secure-login-forgot" href="https://oam.wellsfargo.com/oamo/identity/help/passwordhelp/" aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave("https://oam.wellsfargo.com/oamo/identity/help/passwordhelp/"); }}><span aria-hidden="true">→</span> Forgot username or password?</a>
        </section>
      </main>

      <SiteFooter onLeave={onLeave} />
    </div>
  );
}
