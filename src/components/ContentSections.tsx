import { useId, useLayoutEffect, useRef, useState } from "react";
import ratesIcon from "../assets/rates.png";
import oneKeyDesktop from "../assets/onekey-desktop.webp";
import oneKeyMobile from "../assets/onekey-mobile.avif";
import fargoPhone from "../assets/fargo-phone.png";
import appleBadge from "../assets/app-store.png";
import googleBadge from "../assets/google-play.png";
import { COMMUNITY_STORIES, GUIDANCE_STORIES, ONEKEY_OFFER_URL, PROMOTIONS, type Promotion, type Story } from "../campaigns";
import { APP_STORE_URL, bankUrl, GOOGLE_PLAY_URL, RATE_HREFS, RATE_OPTIONS } from "../data";
import { ChevronDown, ChevronRight, CloseIcon } from "./Icons";

export type OutsideLinkHandler = (url: string) => void;

function RatesTile() {
  const [expanded, setExpanded] = useState(false);
  const [rate, setRate] = useState("mortgage");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const hasOpened = useRef(false);

  useLayoutEffect(() => {
    if (expanded) {
      hasOpened.current = true;
      select.current?.focus();
    } else if (hasOpened.current) {
      trigger.current?.focus();
    }
  }, [expanded]);

  return (
    <article className={`offer-tile rates-tile${expanded ? " rates-expanded" : ""}`} aria-labelledby="rates-title">
      <h2 id="rates-title">Interest rates today</h2>
      <div className="rates-mobile">
        <a className="tile-link" href={bankUrl("/help/rates/?linkLoc=taskbar")} aria-label="Learn more about interest rates">
          Learn more <ChevronRight size={16} />
        </a>
      </div>
      <img className="rates-image" src={ratesIcon} width="148" height="100" alt="" />
      <button className="tile-link rates-trigger" onClick={() => setExpanded(true)} type="button" ref={trigger} aria-expanded={expanded} aria-controls={id}>
        Check rates <ChevronDown size={17} />
      </button>
      <form id={id} hidden={!expanded} className="rates-form" onSubmit={(event) => {
        event.preventDefault();
        window.location.assign(bankUrl(RATE_HREFS[rate]));
      }} onKeyDown={(event) => { if (event.key === "Escape") setExpanded(false); }}>
        <button type="button" className="rates-close" aria-label="Close rate selector" onClick={() => setExpanded(false)}><CloseIcon size={16} /></button>
        <label className="rate-select">
          <span>Check rates</span>
          <select ref={select} value={rate} onChange={(event) => setRate(event.target.value)}>
            {RATE_OPTIONS.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown size={15} />
        </label>
        <button type="submit" className="wf-button wf-button-dark">Go</button>
      </form>
    </article>
  );
}

function TileContent({ promotion, className = "" }: { promotion: Promotion; className?: string }) {
  return (
    <div className={`tile-content ${className}`}>
      <img className="tile-icon" src={promotion.icon} width="64" height="64" alt="" />
      <div className="tile-copy">
        <h2>{promotion.title}</h2>
        <p>{promotion.body}</p>
        <a className="tile-link" href={bankUrl(promotion.href)} aria-label={`${promotion.cta}: ${promotion.title}`}>
          {promotion.cta} <ChevronRight size={17} strokeWidth={3} />
        </a>
      </div>
    </div>
  );
}

export function OfferTiles() {
  return (
    <section className="offer-tiles" aria-label="Product highlights and rates">
      {PROMOTIONS.map((promo) => (
        <article className="offer-tile promotion-tile" key={promo.title}>
          <TileContent promotion={promo} className={promo.mobile ? "tile-large" : ""} />
          {promo.mobile && <TileContent promotion={promo.mobile} className="tile-small" />}
        </article>
      ))}
      <RatesTile />
    </section>
  );
}

export function OneKeyPromo() {
  return (
    <section className="onekey-promo" aria-labelledby="onekey-title">
      <picture>
        <source media="(max-width: 569px)" srcSet={oneKeyMobile} />
        <img src={oneKeyDesktop} width="1080" height="502" loading="lazy" alt="One Key credit card overlooking a pool and coastal mountains" />
      </picture>
      <div className="onekey-copy">
        <h2 id="onekey-title">Earn $250 in OneKeyCash&reg;</h2>
        <p>Use travel rewards on Expedia<sup>&reg;</sup>, Hotels.com<sup>&reg;</sup>, and Vrbo<sup>&reg;</sup>. Terms apply.</p>
        <a className="wf-button" href={ONEKEY_OFFER_URL} aria-label="Learn more about the One Key credit card">Learn more</a>
      </div>
    </section>
  );
}

function StoryCards({ stories }: { stories: Story[] }) {
  return (
    <div className={`story-grid story-grid-${stories.length}`}>
      {stories.map(({ image, title, body, href, cta }) => (
        <article className="story-card" key={title}>
          <img src={image} width="616" height="353" loading="lazy" alt="" />
          <div className="story-copy">
            <h3>{title}</h3>
            <p>{body}</p>
            <a className="wf-button" href={bankUrl(href)}>{cta}</a>
          </div>
        </article>
      ))}
    </div>
  );
}

export function GuidanceSection() {
  return (
    <section className="story-section" aria-labelledby="guidance-title">
      <h2 className="section-heading" id="guidance-title">Financial guidance and support</h2>
      <StoryCards stories={GUIDANCE_STORIES} />
    </section>
  );
}

export function FargoSection({ onLeave }: { onLeave: OutsideLinkHandler }) {
  const platform = /iP(?:hone|ad|od)/i.test(navigator.userAgent) ? "apple" : /Android/i.test(navigator.userAgent) ? "android" : "all";

  return (
    <section className="fargo" aria-labelledby="fargo-title" data-platform={platform}>
      <div className="fargo-copy">
        <h2 id="fargo-title">Need help? Ask Fargo<sup>&reg;</sup></h2>
        <p>Fargo<sup>1</sup> gives you valuable insights like a summary of your spending by category, retailer and across accounts. Find it only in the Wells Fargo Mobile<sup>&reg;</sup> app.</p>
      </div>
      <img className="fargo-phone" src={fargoPhone} width="288" height="582" loading="lazy" alt="Fargo spending summary in the Wells Fargo Mobile app" />
      <div className="fargo-downloads">
        <div className="store-badges">
          <a className="store-apple" href={APP_STORE_URL} onClick={(event) => { event.preventDefault(); onLeave(APP_STORE_URL); }} aria-haspopup="dialog">
            <img src={appleBadge} width="156" height="52" alt="Download on the App Store" loading="lazy" />
          </a>
          <a className="store-google" href={GOOGLE_PLAY_URL} onClick={(event) => { event.preventDefault(); onLeave(GOOGLE_PLAY_URL); }} aria-haspopup="dialog">
            <img src={googleBadge} width="176" height="52" alt="Get it on Google Play" loading="lazy" />
          </a>
        </div>
        <p>*Screen image shown for reference</p>
      </div>
    </section>
  );
}

export function CommunitiesSection() {
  return (
    <section className="story-section community" aria-labelledby="communities-title">
      <h2 className="section-heading" id="communities-title">Serving our customers and communities</h2>
      <p className="community-summary">It doesn't happen with one transaction, in one day on the job, or in one quarter. It's earned relationship by relationship.</p>
      <StoryCards stories={COMMUNITY_STORIES} />
    </section>
  );
}