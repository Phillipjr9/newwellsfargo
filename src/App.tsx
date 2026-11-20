import { useState } from "react";
import favicon from "./assets/favicon.jpg";
import Header from "./components/Header";
import SiteFooter from "./components/SiteFooter";
import ExternalLinkDialog from "./components/ExternalLinkDialog";
import { RouterProvider, useRouter } from "./router/RouterContext";
import { isDemoSignedIn, signDemoIn } from "./auth";

// The public product and help pages are rendered from the original public source.
import HomePage from "./pages/HomePage";
import SecureLogin from "./pages/SecureLogin";
import BankingWorkspace from "./portal/BankingWorkspace";
import AdminApp from "./admin/AdminApp";
import PublicPage, { officialSource } from "./public/PublicPage";
import { normalizedPortalPath } from "./portal/model";

import "./homepage.css";
import "./public/public-page.css";

function AppRoutes({ onLeave }: { onLeave: (url: string) => void }) {
  const { path } = useRouter();
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";

  if (/^\/portal(?:\/|$)/.test(normalizedPortalPath(p))) {
    if (!isDemoSignedIn()) return <SecureLogin onLeave={onLeave} />;
    return <BankingWorkspace onLeave={onLeave} />;
  }
  if (/^\/admin(?:\/|$)/.test(p)) return <AdminApp onLeave={onLeave} />;
  if (p === "\/" || p === "\/home") return <HomePage onLeave={onLeave} />;
  // Demo sign-on stays local (no credentials are collected). Locations and
  // appointments live on their real interactive services, not public pages.
  if (p === "/sign-on" || p === "/login") return <SecureLogin onLeave={onLeave} />;
  if (p === "/enroll") return <SecureEnrollment />;
  if (["/locations", "/appointments", "/atms", "/maa"].includes(p) || p.startsWith("/auth/login")) {
    return <SecureDestination path={p} />;
  }
  return <PublicPage key={p} onLeave={onLeave} />;
}

function SecureEnrollment() {
  const { navigate } = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  function enroll(event: React.FormEvent) {
    event.preventDefault();
    signDemoIn(username);
    navigate("/portal");
  }
  return (
    <div className="secure-login-page">
      <main id="main-content" className="secure-login-main">
        <section className="secure-login-card" aria-labelledby="enroll-title">
          <h1 id="enroll-title">Enroll in Wells Fargo Online®</h1>
          <p>Create fictional sign-on details for this preview. No real account or personal information is used.</p>
          <form onSubmit={enroll} className="secure-enrollment-form">
            <label className="secure-login-field"><span className="secure-login-label">Username</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
            <label className="secure-login-field"><span className="secure-login-label">Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></label>
            <button type="submit" className="secure-login-submit" disabled={!username || !password}>Create demo account</button>
          </form>
        </section>
      </main>
    </div>
  );
}

function SecureDestination({ path }: { path: string }) {
  const source = officialSource(path);
  if (typeof window !== "undefined") window.location.replace(source);
  return <main className="public-page-loading" id="main-content">Opening the official secure destination…</main>;
}

function MainApp() {
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const { path } = useRouter();

  const isPortal = /^\/portal(?:\/|$)/.test(normalizedPortalPath(path.toLowerCase()));
  const isAdmin = /^\/admin(?:\/|$)/.test(path.toLowerCase());
  const isStandalonePublic = path.toLowerCase().replace(/\/+$/, "") === "/search";
  const isSecureLogin = ["/sign-on", "/login", "/enroll"].includes(path.toLowerCase().replace(/\/+$/, "") || "/");

  return (
    <>
      <link rel="icon" type="image/jpeg" href={favicon} />
      {!isPortal && !isAdmin && !isStandalonePublic && !isSecureLogin && <Header key={path} />}
      <AppRoutes onLeave={setLeaveUrl} />
      {!isPortal && !isAdmin && !isStandalonePublic && !isSecureLogin && <SiteFooter onLeave={setLeaveUrl} />}
      {leaveUrl && <ExternalLinkDialog url={leaveUrl} onClose={() => setLeaveUrl(null)} />}
    </>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <MainApp />
    </RouterProvider>
  );
}
