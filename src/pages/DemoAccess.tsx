import { ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { useRouter } from "../router/RouterContext";

export function DemoAccess() {
  return (
    <main id="main-content" className="pb-handoff">
      <p className="pb-eyebrow">
        <span />
        Independent banking demo
      </p>
      <h1>Explore your demo workspace</h1>
      <p>
        Try account activity, transfers, and bill payments with Henry's
        fictional accounts. No username, password, or real bank information is
        needed.
      </p>
      <a className="pb-button pb-solid" href="/portal">
        Enter demo dashboard
        <ArrowRight size={16} />
      </a>
      <a
        className="pb-action-link"
        href="https://www.wellsfargo.com/"
        target="_blank"
        rel="noreferrer"
      >
        For real banking, visit wellsfargo.com <ExternalLink size={14} />
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
        You're exploring {product}. This preview does not open accounts, check
        credit, or request identity information. Review current terms and apply
        only on the official site.
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
        Explore the sample dashboard <ArrowRight size={15} />
      </a>
    </main>
  );
}
