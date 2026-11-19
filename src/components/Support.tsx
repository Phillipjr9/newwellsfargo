import { useId, useState } from "react";
import { APPOINTMENT_URL, bankUrl, HELP_FAQS, LOCATIONS_URL } from "../data";
import { ChevronDown, ChevronRight, CloseIcon } from "./Icons";
import Dialog from "./Dialog";

function SupportActions() {
  const [open, setOpen] = useState<"location" | "help" | null>(null);
  const id = useId();

  return (
    <ul className="support-actions">
      <li>
        <button type="button" className="support-action" aria-expanded={open === "location"} aria-controls={`${id}-location`} onClick={() => setOpen(open === "location" ? null : "location")}>
          <span className="wf-sprite support-pin" aria-hidden="true" />
          <span>Find a location <ChevronDown size={15} /></span>
        </button>
        <div id={`${id}-location`} className="support-details" hidden={open !== "location"}>
          <form action={LOCATIONS_URL} method="get" className="location-form">
            <label>
              <span className="sr-only">City, State or ZIP</span>
              <input type="search" name="qp" placeholder="City, State or ZIP" required />
            </label>
            <button type="submit" className="wf-button wf-button-dark">Go</button>
          </form>
        </div>
      </li>
      <li>
        <a className="support-action support-appointment" href={APPOINTMENT_URL}>
          <span className="wf-sprite support-calendar" aria-hidden="true" />
          Make an appointment
        </a>
      </li>
      <li>
        <button type="button" className="support-action" aria-expanded={open === "help"} aria-controls={`${id}-help`} onClick={() => setOpen(open === "help" ? null : "help")}>
          <span className="wf-sprite support-question" aria-hidden="true" />
          <span>Quick help <ChevronDown size={15} /></span>
        </button>
        <div id={`${id}-help`} className="support-details quick-help-links" hidden={open !== "help"}>
          <a href={bankUrl("/help/")}>Customer service and FAQs</a>
          <a href={bankUrl("/help/routing-number/")}>Find routing and account numbers</a>
        </div>
      </li>
    </ul>
  );
}

export function ContactBar() {
  return (
    <section className="contact-bar" aria-labelledby="contact-heading">
      <h2 id="contact-heading">How can we help?</h2>
      <SupportActions />
    </section>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog className="help-dialog" label="How can we help?" id="header-help" onClose={onClose}>
      <div className="help-actions">
        <div className="flex items-start justify-between">
          <h2>How can we help?</h2>
          <button type="button" aria-label="Close help" onClick={onClose}><CloseIcon size={18} /></button>
        </div>
        <SupportActions />
      </div>
      <div className="popular-faqs">
        <h3>Popular FAQs</h3>
        <ul>
          {[...HELP_FAQS, { label: "See more FAQs", href: "/help/" }].map(({ label, href }) => (
            <li key={label}><a href={bankUrl(href)}>{label}<ChevronRight size={18} /></a></li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}