import autographCard from "../assets/card-autograph.webp";
import { ActivityRows } from "./Overview";
import type { Workspace } from "./model";

type AccountDetailsProps = { state: Workspace; id?: string };

export function AccountDetails({ state, id }: AccountDetailsProps) {
  const account = state.accounts.find((a) => a.id === id || a.type === id);
  if (id && !account) return <div className="pb-panel pb-panel-card pb-empty">Account not found.</div>;
  const entries = state.transactions.filter((t) => account && t.accountId === account.id);
  const byType: Record<string, string> = { checking: "Checking", savings: "Savings", loan: "Home loan", credit: "Credit card", external: "Linked bank" };
  return (
    <>
      <section className="pb-panel pb-panel-card">
        <div className="pb-card-head">
          <img src={autographCard} alt="" />
          <div>
            <strong>{account ? `${account.name} · Card ending ${account.last4}` : "Autograph Card"}</strong>
            <span>{account ? byType[account.type] ?? account.type : "Card"}</span>
          </div>
        </div>
        {account?.type === "credit" && (
          <div className="pb-card-facts">
            <div>
              <span>Available credit</span>
              <b>{state.preferences.hideBalances ? "Hidden" : (account.limit ?? 0) - (account.balance ?? 0)}</b>
            </div>
            <div>
              <span>Rewards</span>
              <b>{(account.points ?? 0).toLocaleString()} points</b>
            </div>
          </div>
        )}
          {account?.openingDate && (
          <dl className="pb-balance-facts">
            <div><dt>Account ending</dt><dd>{account.last4}</dd></div>
          </dl>
        )}
        <a className="pb-action-link" href="/portal/cards">View all cards →</a>
      </section>
      {account && (
        <section className="pb-panel pb-panel-card">
          <h3>Recent activity</h3>
          <ActivityRows state={state} entries={entries} />
        </section>
      )}
      <div className="pb-card-info">
        <p>Account information for {account ? `card ending ${account.last4}` : "this account"}: full card details and recent activity.</p>
        <p>Opened {account?.openingDate ?? "n/a"} · Account ending in {account?.last4 ?? "N/A"}.</p>
      </div>
    </>
  );
}
