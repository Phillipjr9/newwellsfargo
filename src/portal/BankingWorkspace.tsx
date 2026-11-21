import { useEffect } from "react";
import { isPreviewSession } from "../auth";
import { useRouter } from "../router/RouterContext";
import SiteFooter from "../components/SiteFooter";
import { actionPaths, normalizedPortalPath, type PaymentKind } from "./model";
import { PortalHeader, PortalResourceFooter } from "./Chrome";
import Overview from "./Overview";
import {
  MoneyPage,
  PaymentActivity,
  PaymentDetail,
  MissingPage,
} from "./Payments";
import {
  AccountActivity,
  Brokerage,
  MessageCenter,
  Preferences,
  SpendingPage,
  Statements,
} from "./AccountServices";
import { AccountDetails } from "./AccountDetails";
import { CardsPage } from "./Cards";
import DepositChecks from "./DepositChecks";
import { refreshWorkspace, useWorkspace } from "./store";
import "./portal.css";

export default function BankingWorkspace({
  onLeave,
}: {
  onLeave: (url: string) => void;
}) {
  const { path: raw, query } = useRouter();
  const { state, ready, error } = useWorkspace();
  const path = normalizedPortalPath(raw.toLowerCase());
  const kind = (Object.keys(actionPaths) as PaymentKind[]).find(
    (k) => actionPaths[k] === path,
  );
  const key = path + JSON.stringify(query) + (ready ? "ready" : "loading");
  useEffect(() => {
    const heading =
      document.querySelector("#portal-main h1")?.textContent ??
      "Account overview";
    document.title = `${heading} | Wells Fargo Online Banking`;
    return () => {
      document.title = "Wells Fargo | Homepage";
    };
  }, [path, ready]);
  let page;
  if (kind === "deposit")
    page = <DepositChecks key={key} state={state} ready={ready} />;
  else if (kind)
    page = <MoneyPage key={key} state={state} kind={kind} ready={ready} />;
  else if (path === "/portal") page = <Overview state={state} ready={ready} />;
  else if (path === "/portal/payments")
    page = <PaymentActivity key={key} state={state} />;
  else if (path.startsWith("/portal/payments/"))
    page =
      !ready && !error ? (
        <p className="pb-loading">Loading payment…</p>
      ) : (
        <PaymentDetail
          key={key}
          state={state}
          id={path.split("/").pop() ?? ""}
        />
      );
  else if (path.startsWith("/portal/accounts/") || path === "/portal/activity")
    page = (
      <AccountActivity
        key={key}
        state={state}
        id={path === "/portal/activity" ? undefined : path.split("/").pop()}
      />
    );
  else if (path.startsWith("/portal/account-details/transactions"))
    page = <AccountActivity key={key} state={state} />;
  else if (path.startsWith("/portal/account-details/"))
    page = <AccountDetails key={key} state={state} id={path.split("/").pop()} />;
  else if (path === "/portal/statements")
    page = <Statements state={state} key={key} />;
  else if (path === "/portal/cards")
    page = <CardsPage state={state} />;
  else if (path === "/portal/inbox") page = <MessageCenter state={state} />;
  else if (path === "/portal/settings") page = <Preferences state={state} />;
  else if (path === "/portal/spending") page = <SpendingPage state={state} />;
  else if (path === "/portal/brokerage") page = <Brokerage />;
  else page = <MissingPage />;
  return (
    <div className="pb-workspace">
      <PortalHeader state={state} path={path} />
      <main id="portal-main" className="pb-wrap pb-main" tabIndex={-1}>
        {isPreviewSession() && <p className="pb-small-note">This is a temporary workspace. Changes won’t be saved when you refresh or close the preview.</p>}
        {error && (
          <div role="alert" className="pb-error">
            {error}
            <button onClick={() => void refreshWorkspace()}>Retry</button>
          </div>
        )}
        <div className="pb-page" key={path}>
          {!ready && !error ? (
            <p className="pb-loading" role="status">Loading your workspace…</p>
          ) : (
            page
          )}
        </div>
      </main>
      <SiteFooter onLeave={onLeave} portal>
        <PortalResourceFooter />
      </SiteFooter>
    </div>
  );
}
