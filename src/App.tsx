import { useState } from "react";
import favicon from "./assets/favicon.jpg";
import Header from "./components/Header";
import SiteFooter from "./components/SiteFooter";
import ExternalLinkDialog from "./components/ExternalLinkDialog";
import { RouterProvider, useRouter } from "./router/RouterContext";

// The public product and help pages are rendered from the original public source.
import HomePage from "./pages/HomePage";
import { DemoAccess } from "./pages/DemoAccess";
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
    return <BankingWorkspace onLeave={onLeave} />;
  }
  if (/^\/admin(?:\/|$)/.test(p)) return <AdminApp />;
  if (p === "/" || p === "/home") return <HomePage onLeave={onLeave} />;
  // Demo sign-on stays local (no credentials are collected). Locations and
  // appointments live on their real interactive services, not public pages.
  if (p === "/sign-on" || p === "/login") return <DemoAccess />;
  if (["/locations", "/appointments", "/atms", "/maa"].includes(p) || p.startsWith("/auth/login")) {
    return <SecureDestination path={p} />;
  }
  return <PublicPage key={p} onLeave={onLeave} />;
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

  return (
    <>
      <link rel="icon" type="image/jpeg" href={favicon} />
      {!isPortal && !isAdmin && !isStandalonePublic && <Header key={path} />}
      <AppRoutes onLeave={setLeaveUrl} />
      {!isPortal && !isAdmin && !isStandalonePublic && <SiteFooter onLeave={setLeaveUrl} />}
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
