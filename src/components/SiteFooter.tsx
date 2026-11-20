import { bankUrl, FOOTER_LINKS, SOCIAL } from "../data";
import type { OutsideLinkHandler } from "./ContentSections";

const SIPC_URL = "https://www.sipc.org/";

const originalPages: Record<string, string> = {
  "Careers": "https://www.wellsfargojobs.com/",
  "Inclusion and Accessibility": "https://www.wellsfargo.com/about/inclusion/",
};

export default function SiteFooter({ onLeave, portal = false, children }: { onLeave: OutsideLinkHandler; portal?: boolean; children?: React.ReactNode }) {
  return (
    <footer className={`footer${portal ? " pb-legal-footer" : ""}`}>
      {children}
      <div className="site-width footer-inner">
        <nav aria-label="Footer">
          <ul className="footer-nav">
            {FOOTER_LINKS.map(({ label, href }) => <li key={label}><a href={originalPages[label] ?? bankUrl(href)}>{label}</a></li>)}
          </ul>
        </nav>
        <ul className="footer-social" aria-label="Social media">
          {SOCIAL.map(({ label, href, icon }) => (
            <li key={label}>
              <a className="wf-sprite" style={{ backgroundPosition: icon }} href={href} aria-label={label} aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave(href); }} />
            </li>
          ))}
        </ul>
        {portal && <p className="pb-footer-disclaimer">Account activity, transfers, and payment tools are provided in this online banking workspace. Legal and social links open official resources.</p>}
        <div className="footer-investment">
          <p>Investment and Insurance Products are:</p>
          <ul>
            <li>Not Insured by the FDIC or Any Federal Government Agency</li>
            <li>Not a Deposit or Other Obligation of, or Guaranteed by, the Bank or Any Bank Affiliate</li>
            <li>Subject to Investment Risks, Including Possible Loss of the Principal Amount Invested</li>
          </ul>
        </div>
        <div className="footer-legal">
          <p>
            Investment products and services are offered through Wells Fargo Advisors. Wells Fargo Advisors is a trade name used by Wells Fargo Clearing Services, LLC (WFCS) and Wells Fargo Advisors Financial Network, LLC, Members{" "}
            <a href={SIPC_URL} aria-haspopup="dialog" onClick={(event) => { event.preventDefault(); onLeave(SIPC_URL); }}>SIPC</a>, separate registered broker-dealers and non-bank affiliates of Wells Fargo &amp; Company.
          </p>
          <p>1. Availability may be affected by your mobile carrier's coverage area. Your mobile carrier's message and data rates may apply. Fargo is only available on the smartphone versions of the Wells Fargo Mobile<sup>&reg;</sup> app.</p>
          <p>Android, Google Play, Chrome, Pixel and other marks are trademarks of Google LLC.</p>
          <p>Apple, the Apple logo, Apple Pay, Apple Watch, Face ID, iCloud Keychain, iPad, iPad Pro, iPhone, iTunes, Mac, Safari, and Touch ID are trademarks of Apple Inc., registered in the U.S. and other countries. Apple Wallet is a trademark of Apple Inc. App Store is a service mark of Apple Inc.</p>
          <p>Deposit products offered by Wells Fargo Bank, N.A. Member FDIC.</p>
          <p className="equal-housing">
            <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
              <path d="M1.5 6 8 2l6.5 4M3 5.5v6h10v-6M5.5 7h5m-5 2h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            Equal Housing Lender
          </p>
          <p>PM-09192027-5314505</p>
          <p>DT2-09192027-12-8840298-1.1</p>
        </div>
        <p className="copyright">&copy; 1999 - 2026 Wells Fargo. NMLSR ID 399801</p>
      </div>
    </footer>
  );
}