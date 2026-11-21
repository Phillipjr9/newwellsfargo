import { useEffect, useRef, useState } from "react";
import favicon from "./assets/favicon.jpg";
import Header from "./components/Header";
import SiteFooter from "./components/SiteFooter";
import ExternalLinkDialog from "./components/ExternalLinkDialog";
import { RouterProvider, useRouter } from "./router/RouterContext";
import { checkPortalSession } from "./auth";

// The public product and help pages are rendered from the original public source.
import HomePage from "./pages/HomePage";
import SecureLogin from "./pages/SecureLogin";
import BankingWorkspace from "./portal/BankingWorkspace";
import WorkspaceAccess from "./portal/WorkspaceAccess";
import AdminApp from "./admin/AdminApp";
import PublicPage from "./public/PublicPage";
import officialDestinations from "../shared/official-destinations.json";
import { normalizedPortalPath } from "./portal/model";

import "./homepage.css";
import "./public/public-page.css";

function AppRoutes({ onLeave }: { onLeave: (url: string) => void }) {
  const { path, query } = useRouter();
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/portal/access") return <WorkspaceAccess />;
  if (/^\/portal(?:\/|$)/.test(normalizedPortalPath(p))) return <ProtectedPortal onLeave={onLeave} />;
  if (/^\/admin(?:\/|$)/.test(p)) return <AdminApp onLeave={onLeave} />;
  if (p === "/" || p === "/home") return <HomePage onLeave={onLeave} />;
  if ((p === "/login" || p === "/sign-on") && query.passkey !== "1") return <SecureLogin onLeave={onLeave} />;
  const destination = Object.prototype.hasOwnProperty.call(officialDestinations, p)
    ? officialDestinations[p as keyof typeof officialDestinations]
    : p.startsWith("/auth/login/") || query.passkey === "1" && ["/login", "/sign-on"].includes(p)
      ? officialDestinations["/auth/login"] : undefined;
  if (destination) return <SecureDestination source={destination} />;
  return <PublicPage key={p} onLeave={onLeave} />;
}

function ProtectedPortal({ onLeave }: { onLeave: (url: string) => void }) {
  const [session, setSession] = useState<"checking" | "signedIn" | "signedOut" | "unavailable">("checking");
  const [retry, setRetry] = useState(0);
  void useRef({ done: false });
  useEffect(() => {
    const controller = new AbortController();
    void checkPortalSession()
      .then((ok) => { if (!controller.signal.aborted) setSession(ok ? "signedIn" : "signedOut"); })
      .catch(() => { if (!controller.signal.aborted) setSession("unavailable"); });
    const expired = () => setSession("signedOut");
    window.addEventListener("workspace-session-ended", expired);
    return () => { controller.abort(); window.removeEventListener("workspace-session-ended", expired); };
  }, [retry]);
  if (session === "checking") return null;
  if (session === "unavailable") return <main className="public-page-error"><h1>Online banking unavailable</h1><p>Please try again in a moment.</p><button className="wf-button" onClick={() => { setSession("checking"); setRetry((n) => n + 1); }}>Retry</button></main>;
  if (session === "signedOut") return <SecureLogin onLeave={onLeave} onSignedIn={() => setSession("signedIn")} forceFreshSignIn />;
  return <BankingWorkspace onLeave={onLeave} />;
}

function SecureDestination({ source }: { source: string }) {
  const requested = useRef("");
  useEffect(() => {
    if (requested.current !== source) {
      requested.current = source;
      const alreadySignedIn = !!document.querySelector("#portal-main, .pb-form-body, [name=\"email\"]");
      if (!alreadySignedIn) {
        void fetch("/api/protected-session-cleanup", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      }
      window.location.replace(source);
    }
  }, [source]);
  return <main className="public-page-loading" id="main-content">Opening the official secure destination… <a href={source}>Continue</a></main>;
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
