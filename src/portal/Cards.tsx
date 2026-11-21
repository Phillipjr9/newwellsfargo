import { IdCard, BookMarked, Scan, ShieldCheck } from "lucide-react";
import { AccountArt, SpendChart } from "./Overview";
import { PageIntro } from "./Chrome";
import { availableBalance, day } from "../../shared/ledger.mjs";
import type { Workspace, Account } from "./model";

function nameLabel(type: string) {
  return type === "checking" ? "Checking" : type === "savings" ? "Savings" : type === "loan" ? "Home loan" : type === "credit" ? "Credit card" : type === "external" ? "Linked bank" : type;
}

export function CardsPage({ state }: { state: Workspace }) {
  return (
    <>
      <PageIntro eyebrow="CARDS" title="My cards" description="View card details and account information for every card you hold." />
      {state.accounts.map((account) => (
        <div className="pb-card-detail" key={account.id}>
          <div className="pb-panel pb-panel-card">
            <div className="pb-card-head"><IdCard size={28} strokeWidth={1.2} /><span className="pb-card-num">Card ending {account.last4}</span><div className="pb-card-meta">{nameLabel(account.type)}<BookMarked size={12} strokeWidth={1.6} /></div></div>
            <div className="pb-card-info">
              {account.openingDate ? `Opened ${account.openingDate}` : null}
              {account.type === "credit" && state.preferences.cardLocked && (<div className="pb-card-status"><ShieldCheck size={14} strokeWidth={1.6} /> Card status: Locked</div>)}
              <a className="pb-action-link" href={`/portal/account-details/${account.id}`}>View full account information <Scan size={14} strokeWidth={1.8} /></a>
            </div>
            <div className="pb-card-balance"><small>{availableBalance(state, account, day())}</small><strong>{account.type === "credit" && account.limit ? account.limit - account.balance : account.balance}</strong></div>
            <SpendChart state={state} expanded={false} />
          </div>
          <AccountArt account={account} />
        </div>
      ))}
    </>
  );
}

export { SpendChart, AccountArt, type Account };

