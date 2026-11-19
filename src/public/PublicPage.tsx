import { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import globalSourceCss from "./public-global.css?raw";
import { catalogData } from "./catalog-data";
import { styleData } from "./style-data";
import { useRouter } from "../router/RouterContext";

export type PublicPageRecord = {
  source: string;
  title: string;
  html: string;
  styles: string[];
  status: number;
};

async function inflate(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

const pageCache = new Map<string, Promise<PublicPageRecord>>();
const styleCache = new Map<string, Promise<string>>();

function loadCachedPage(route: string): Promise<PublicPageRecord> {
  let work = pageCache.get(route);
  if (!work) {
    const packed = catalogData[route];
    if (!packed) return Promise.reject(new Error("No saved page for this route."));
    work = inflate(packed).then((text) => JSON.parse(text) as PublicPageRecord);
    pageCache.set(route, work);
  }
  return work;
}

function loadSourceStyle(url: string): Promise<string> {
  let work = styleCache.get(url);
  if (!work) {
    const packed = styleData[url];
    if (!packed) return Promise.reject(new Error("No saved stylesheet."));
    work = inflate(packed);
    styleCache.set(url, work);
  }
  return work;
}
const secureHosts = [
  "secure.wellsfargo.com",
  "oam.wellsfargo.com",
  "accountoffers.wellsfargo.com",
  "appointments.wellsfargo.com",
  "icomplete.wellsfargo.com",
  "confirmcard.wellsfargo.com",
];
function isSecure(url: URL) {
  return secureHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function officialSource(path: string) {
  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
  if (normalized === "/home/") return "https://www.wellsfargo.com/";
  if (normalized.startsWith("/credit-cards/")) return `https://creditcards.wellsfargo.com${normalized.slice(13) || "/"}`;
  if (normalized.startsWith("/guidance/")) return `https://getmoneyready.wf.com${normalized.slice(9) || "/"}`;
  if (normalized.startsWith("/stories/")) return `https://stories.wf.com${normalized.slice(8) || "/"}`;
  if (normalized === "/careers/" || normalized === "/jobs/") return "https://www.wellsfargojobs.com/";
  if (normalized === "/espanol/") return "https://www.wellsfargo.com/es/";
  if (normalized === "/savings/") return "https://www.wellsfargo.com/savings-cds/";
  if (normalized === "/cds/") return "https://www.wellsfargo.com/savings-cds/certificate-of-deposit/";
  if (normalized === "/home-loans/") return "https://www.wellsfargo.com/mortgage/";
  if (normalized === "/business/") return "https://www.wellsfargo.com/biz/";
  if (normalized === "/commercial/") return "https://www.wellsfargo.com/com/";
  if (normalized === "/corporate/") return "https://www.wellsfargo.com/cib/";
  if (normalized === "/investing/") return "https://www.wellsfargo.com/investing-wealth/";
  if (normalized === "/lifesync/") return "https://www.wellsfargo.com/mobile-online-banking/lifesync/";
  if (normalized === "/routing-number/") return "https://www.wellsfargo.com/help/routing-number/";
  if (normalized === "/rates/") return "https://www.wellsfargo.com/help/rates/";
  if (normalized === "/sign-on/" || normalized === "/login/") return "/login";
  if (normalized === "/locations/") return "https://locations.wellsfargo.com/search";
  if (normalized === "/appointments/") return "https://appointments.wellsfargo.com/maa/appointment/";
  return `https://www.wellsfargo.com${normalized}`;
}

// The source pages' interactive widgets run on Wells Fargo's own JavaScript,
// which is not included. These handlers restore the basic behavior the public
// markup describes: tab panels, footnote dialogs, and search category filters.
function wireTabs(root: ShadowRoot) {
  const activate = (tab: Element) => {
    const group = tab.closest('[role="tablist"]') || tab.parentElement;
    const tabs = Array.from(group?.querySelectorAll('[role="tab"]') ?? [tab]);
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.setAttribute("tabindex", selected ? "0" : "-1");
      const panelId = t.getAttribute("aria-controls");
      const panel = panelId ? root.getElementById(panelId) : null;
      if (panel) panel.classList.toggle("is-tab-hidden", !selected);
    });
  };
  const onClick = (event: Event) => {
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (tab) activate(tab);
  };
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return;
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (!tab || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const group = tab.closest('[role="tablist"]') || tab.parentElement;
    const tabs = Array.from(group?.querySelectorAll('[role="tab"]') ?? []);
    const index = tabs.indexOf(tab);
    if (index < 0 || tabs.length < 2) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    (tabs[next] as HTMLElement).focus();
    activate(tabs[next]);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
  };
}

function wireFootnotes(root: ShadowRoot) {
  const onClick = (event: Event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#tcm:"]') : null;
    if (!link) return;
    const id = (link.getAttribute("href") || "").slice(1);
    const target = id ? root.getElementById(id) : null;
    if (!target || !target.classList.contains("ps-footnote-text")) return;
    event.preventDefault();
    event.stopPropagation();
    const dialog = document.createElement("dialog");
    dialog.className = "footnote-dialog";
    dialog.setAttribute("aria-label", link.getAttribute("aria-label") || "Footnote");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "footnote-dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => dialog.close());
    const body = target.cloneNode(true) as HTMLElement;
    body.removeAttribute("id");
    dialog.append(close, body);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => dialog.remove());
    root.appendChild(dialog);
    dialog.showModal();
    close.focus();
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}

function wireSearchFilters(root: ShadowRoot, onCount?: (visible: number, total: number) => void) {
  const boxes = Array.from(root.querySelectorAll('[role="checkbox"]'));
  if (!boxes.length) return () => {};
  const results = Array.from(root.querySelectorAll('[class*="FusionResultsTextTiles__link"]'))
    .map((link) => {
      const card = link.closest('[class*="FusionResultsListItem__item"]') || link.closest("li") || link.parentElement;
      const category = card?.querySelector('[class*="FusionResultsTextTiles__category"]')?.textContent?.trim() || "";
      return { card, category };
    })
    .filter((r): r is { card: Element; category: string } => Boolean(r.card && r.category));
  const applyFilter = () => {
    const checked = new Set(
      boxes.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent?.trim() || ""),
    );
    const filterActive = checked.size > 0;
    let visible = 0;
    results.forEach(({ card, category }) => {
      const show = !filterActive || checked.has(category);
      (card as HTMLElement).style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    onCount?.(visible, results.length);
  };
  const toggle = (box: Element) => {
    const next = box.getAttribute("aria-checked") !== "true";
    box.setAttribute("aria-checked", String(next));
    const icon = box.querySelector('[class*="CheckboxIcon__checkbox"]');
    icon?.classList.toggle("CheckboxIcon__checked___w0DlF", next);
    applyFilter();
  };
  const onClick = (event: Event) => {
    const box = event.target instanceof Element ? event.target.closest('[role="checkbox"]') : null;
    if (box) toggle(box);
  };
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || ![" ", "Enter"].includes(event.key)) return;
    const box = event.target instanceof Element ? event.target.closest('[role="checkbox"]') : null;
    if (box) { event.preventDefault(); toggle(box); }
  };
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  applyFilter();
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
  };
}

export default function PublicPage({ onLeave }: { onLeave: (url: string) => void }) {
  const { path, query, navigate } = useRouter();
  const normalized = path.replace(/\/+$/, "") || "/";
  const queryKey = normalized === "/search" ? query.q || "" : "";
  const isSearch = normalized === "/search";
  const hasSnapshot = !isSearch && Boolean(catalogData[normalized]);
  const [record, setRecord] = useState<PublicPageRecord | undefined>(undefined);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const source = record?.source || officialSource(normalized);

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setError("");
    if (hasSnapshot) {
      loadCachedPage(normalized)
        .then((page) => { if (active) setRecord(page); })
        .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Page unavailable."); });
      return () => { active = false; };
    }
    if (location.protocol === "file:") {
      // Live search needs the demo server; a static export offers the official link.
      setError("Live search results are only available when running the demo server.");
      return;
    }
    fetch(`/api/public-page?path=${encodeURIComponent(normalized)}${queryKey ? `&q=${encodeURIComponent(queryKey)}` : ""}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Public page unavailable.");
        return body as PublicPageRecord;
      })
      .then((page) => { if (active) setRecord(page); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Page unavailable."); });
    return () => { active = false; };
  }, [normalized, attempt, queryKey, hasSnapshot]);

  useEffect(() => {
    const element = host.current;
    if (!element || !record) return;
    let active = true;
    const root = element.shadowRoot || element.attachShadow({ mode: "open" });
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = `
      :host{display:block;isolation:isolate;color:#141414;background:#fff;font-family:'Wells Fargo Sans',Arial,sans-serif;font-size:17px;line-height:1.294;}
      .public-source-page{display:block;min-height:240px;box-sizing:border-box;}
      .public-source-page *{box-sizing:border-box;}
      .public-source-page img{max-width:100%;}
      .public-source-page .ps-body-wrapper{margin-inline:auto;}
      .footnote-dialog{position:fixed;inset:0;margin:auto;max-width:560px;width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:28px 28px 24px;border:0;border-radius:10px;background:#fff;color:#141414;font:inherit;box-shadow:0 8px 32px rgb(0 0 0 / 28%);}
      .footnote-dialog::backdrop{background:rgb(0 0 0 / 45%);}
      .footnote-dialog-close{position:absolute;top:12px;right:12px;border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#3b3331;padding:4px 8px;}
      .footnote-dialog .ps-footnote-text{margin:0;font-size:14px;}
      ${globalSourceCss}
    `;
    root.appendChild(style);
    for (const url of record.styles) {
      if (url.includes("ps-global")) continue;
      if (styleData[url]) {
        loadSourceStyle(url).then((css) => {
          if (!active) return;
          const extra = document.createElement("style");
          extra.textContent = css;
          root.appendChild(extra);
        }).catch(() => {});
        continue;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      root.appendChild(link);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "public-source-page ps-body-container";
    wrapper.innerHTML = record.html;
    root.appendChild(wrapper);

    const unwires = [wireTabs(root), wireFootnotes(root)];
    if (normalized === "/search") {
      unwires.push(wireSearchFilters(root));
    }

    const onClick = (event: Event) => {
      const origin = event.target instanceof Element ? event.target : null;
      const anchor = origin?.closest("a");
      if (!anchor) return;
      event.stopPropagation();
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("#")) {
        // Footnote links open a dialog; wireFootnotes handles those.
        const footnoteId = href.slice(1);
        const footnoteTarget = footnoteId ? root.getElementById(footnoteId) : null;
        if (footnoteTarget?.classList.contains("ps-footnote-text")) return;
        event.preventDefault();
        const id = href.slice(1);
        if (id) {
          const target = root.getElementById(id);
          if (target) {
            navigate(`${normalized}${window.location.search}#${id}`);
            target.scrollIntoView();
          }
        } else {
          const exit = anchor.closest("[data-exit], .ps-exit-disclaimer, .ps-exit-modal")?.querySelector<HTMLAnchorElement>("a[href^='http']");
          if (exit?.href) onLeave(exit.href);
        }
        return;
      }
      let url: URL;
      try { url = new URL(href, record.source); } catch { return; }
      event.preventDefault();
      if (/\.(pdf|xlsx?|docx?|zip)$/i.test(url.pathname)) {
        // Documents aren't pages; hand them to the official site directly.
        onLeave(url.href);
        return;
      }
      if (isSecure(url) || url.origin !== "https://preview.local" && !["www.wellsfargo.com", "creditcards.wellsfargo.com", "getmoneyready.wf.com", "stories.wf.com"].includes(url.hostname)) {
        onLeave(url.href);
      } else {
        navigate(`${url.pathname}${url.search}${url.hash}`);
      }
    };
    const onToggle = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement) {
        event.target.querySelector("summary")?.setAttribute("aria-expanded", String(event.target.open));
      }
    };
    const onSubmit = (event: Event) => {
      if (normalized !== "/search") return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      event.preventDefault();
      const data = new FormData(form);
      const value =
        data.get("q") ||
        data.get("search-input") ||
        form.querySelector<HTMLInputElement>(
          'input[type="search"], input[name="search-input"], input[type="text"]',
        )?.value;
      if (typeof value === "string" && value.trim()) navigate(`/search?q=${encodeURIComponent(value.trim())}`);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("toggle", onToggle, true);
    root.addEventListener("submit", onSubmit);
    document.title = `${record.title} | Public page preview`;
    const hash = window.location.hash.startsWith("#") && !window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "";
    if (hash) requestAnimationFrame(() => root.getElementById(hash)?.scrollIntoView());
    return () => {
      active = false;
      root.removeEventListener("click", onClick);
      root.removeEventListener("toggle", onToggle, true);
      root.removeEventListener("submit", onSubmit);
      unwires.forEach((unwire) => unwire());
    };
  }, [record, normalized, navigate, onLeave]);

  if (error && !record) {
    return <main className="public-page-error" id="main-content">
      <h1>Public page unavailable</h1>
      <p>{error}</p>
      <div><button className="wf-button" onClick={() => setAttempt(attempt + 1)}><RotateCw size={16}/>Retry</button>
      <a className="wf-button wf-button-red" href={source} target="_blank" rel="noreferrer">Open official page<ExternalLink size={15}/></a></div>
    </main>;
  }
  return <>
    {!record && <div className="public-page-loading" role="status">Loading the original public page…</div>}
    <div className="public-page-host" ref={host} data-source={source} />
    {error && <p className="public-page-cache-note" role="status">Showing the saved public page. <a href={source} target="_blank" rel="noreferrer">Check the live version</a></p>}
  </>;
}
