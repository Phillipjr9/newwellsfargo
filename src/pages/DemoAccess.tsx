import { ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { useRouter } from "../router/RouterContext";

export function DemoAccess() {
  return (
    <main id="main-content" className="pb-handoff">
      <p className="pb-eyebrow">
        <span />
        Online Banking Workspace
      </p>
      <h1>Explore your account workspace</h1>
      <p>
        Review account activity, transfers, and bill payments. No username,
        password, or real bank information is needed.
      </p>
      <a className="pb-button pb-solid" href="/portal">
        Enter account dashboard
        <ArrowRight size={16} />
      </a>
      <a
        className="pb-action-link"
        href="https://www.wellsfargo.com/"
        target="_blank"
        rel="noreferrer"
      >
        Visit wellsfargo.com <ExternalLink size={14} />
      </a>
    </main>
  );
}

export function ApplicationHandoff() {
  const { query } = useRouter();
  const product = query.product || "a banking product";
  const source = /card/i.test(product)
    ? "https://creditcards.wellsfargo.com/"
    : /saving|deposit|\bcd\b/i.test(product)
      ? "https://www.wellsfargo.com/savings-cds/"
      : /mortgage/i.test(product)
        ? "https://www.wellsfargo.com/mortgage/"
        : /loan/i.test(product)
          ? "https://www.wellsfargo.com/personal-loans/"
          : "https://www.wellsfargo.com/checking/";
  return (
    <main id="main-content" className="pb-handoff">
      <p className="pb-eyebrow">
        <ShieldCheck size={16} />
        Official applications
      </p>
      <h1>Continue on the bank's website</h1>
      <p>
        You're exploring {product}. Account applications are completed only on
        Wells Fargo's official website.
      </p>
      <a
        className="pb-button pb-solid"
        href={source}
        target="_blank"
        rel="noreferrer"
      >
        Visit Wells Fargo
        <ExternalLink size={15} />
      </a>
      <a className="pb-action-link" href="/portal">
        Explore the account dashboard <ArrowRight size={15} />
      </a>
    </main>
  );
}
