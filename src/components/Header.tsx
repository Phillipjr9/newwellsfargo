import { useEffect, useRef, useState } from "react";
import { useRouter } from "../router/RouterContext";
import { bankUrl, LOCATIONS_URL, MENU_CATEGORIES, MENU_LINKS, SIGN_ON_URL, type MenuCategory } from "../data";
import { MENU_ICONS } from "../menuIcons";
import Dialog from "./Dialog";
import { ChevronLeft, ChevronRight, CloseIcon, SearchIcon } from "./Icons";
import Logo from "./Logo";
import { HelpDialog } from "./Support";
import "../navigation.css";

type Panel = "menu" | "help" | "search" | null;

function SearchForm({ drawer = false, onSubmitted }: { drawer?: boolean; onSubmitted?: () => void }) {
  const { navigate } = useRouter();
  const [val, setVal] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (val.trim()) {
      navigate("/search", { q: val.trim() });
      if (onSubmitted) onSubmitted();
    }
  };

  return (
    <form onSubmit={handleSearchSubmit} className={`site-search${drawer ? " drawer-search" : ""}`} role="search">
      <label>
        <span className="sr-only">Search Wells Fargo</span>
        <SearchIcon size={drawer ? 22 : 24} />
        <input
          autoFocus={!drawer}
          type="search"
          name="q"
          placeholder="Search"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          required
        />
      </label>
      {!drawer && <button type="submit" className="wf-button wf-button-dark">Search</button>}
    </form>
  );
}

function CategoryContents({ category }: { category: MenuCategory }) {
  const [products, ...groups] = category.groups ?? [];
  return (
    <div className="category-content">
      <div className="category-products">
        <div className="category-featured">
          {category.featured?.map(({ label, href }, index) => (
            <a key={label} href={bankUrl(href)} className={`wf-button${index === 0 ? " wf-button-red" : ""}`}>{label}</a>
          ))}
        </div>
        <ul className="category-list">
          {products?.links.map(({ label, href, desc }, index) => (
            <li key={label}>
              <a href={bankUrl(href)}>
                <span className="category-icon" aria-hidden="true" style={{ backgroundPosition: MENU_ICONS[category.id]?.[index] }} />
                <div className="category-text">
                  <span>{label}<ChevronRight size={17} strokeWidth={1.3} /></span>
                  {desc && <p>{desc}</p>}
                </div>
                <ChevronRight size={18} strokeWidth={1.3} className="category-mobile-arrow" />
              </a>
            </li>
          ))}
        </ul>
      </div>
      {groups.length > 0 && (
        <div className="category-resources">
          {groups.map(({ title, links }) => (
            <section key={title}>
              <h3>{title}</h3>
              <ul>
                {links.map(({ label, href }) => <li key={label}><a href={bankUrl(href)}>{label}</a></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopNavigation({ showProducts = false }: { showProducts?: boolean }) {
  const [open, setOpen] = useState<MenuCategory | null>(null);
  const navigation = useRef<HTMLElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clickedTab = useRef<string | null>(null);
  const [panelPointer, setPanelPointer] = useState(0);

  function reveal(category: MenuCategory, button: HTMLButtonElement) {
    setPanelPointer(button.offsetLeft + 15);
    setOpen(category);
  }

  function dismiss() {
    clearTimeout(hoverTimer.current);
    clickedTab.current = null;
    setOpen(null);
  }

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      clearTimeout(hoverTimer.current);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);

  return (
    <div className="site-width desktop-navigation">
      <nav className="audience-nav" aria-label="Banking areas">
        <ul>
          <li><a className="audience-current" href="/home">Personal</a></li>
          {MENU_LINKS.slice(0, 5).map(({ label, href }) => <li key={label}><a href={bankUrl(href)}>{label}</a></li>)}
        </ul>
      </nav>
      {showProducts && <nav
        ref={navigation}
        className="desktop-products"
        aria-label="Personal banking"
        onPointerLeave={() => {
          clearTimeout(hoverTimer.current);
          if (!clickedTab.current) hoverTimer.current = setTimeout(dismiss, 120);
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) dismiss();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            navigation.current?.querySelector<HTMLButtonElement>(`#product-${open.id}`)?.focus();
            dismiss();
          }
        }}
      >
        <ul>
          {MENU_CATEGORIES.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                id={`product-${category.id}`}
                aria-expanded={open?.id === category.id}
                aria-controls={open?.id === category.id ? "category-panel" : undefined}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "mouse") return;
                  clearTimeout(hoverTimer.current);
                  const button = event.currentTarget;
                  hoverTimer.current = setTimeout(() => { clickedTab.current = null; reveal(category, button); }, 240);
                }}
                onPointerLeave={() => clearTimeout(hoverTimer.current)}
                onClick={(event) => {
                  clearTimeout(hoverTimer.current);
                  if (clickedTab.current === category.id) dismiss();
                  else {
                    clickedTab.current = category.id;
                    reveal(category, event.currentTarget);
                    if (event.detail === 0) requestAnimationFrame(() => navigation.current?.querySelector<HTMLAnchorElement>("#category-panel a")?.focus());
                  }
                }}
              >
                {category.label}
              </button>
              {open?.id === category.id && (
                <section id="category-panel" aria-labelledby={`product-${category.id}`} className="desktop-mega" onPointerEnter={() => clearTimeout(hoverTimer.current)}>
                  <span className="menu-pointer" aria-hidden="true" style={{ left: panelPointer }} />
                  <CategoryContents category={category} />
                </section>
              )}
            </li>
          ))}
        </ul>
      </nav>}
    </div>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<MenuCategory | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  function openCategory(item: MenuCategory) {
    setCategory(item);
    setPrevious(item.id);
    requestAnimationFrame(() => { sheet.current?.scrollTo(0, 0); backButton.current?.focus(); });
  }

  function back() {
    setCategory(null);
    requestAnimationFrame(() => sheet.current?.querySelector<HTMLButtonElement>(`#drawer-${previous}`)?.focus());
  }

  return (
    <Dialog label="Site menu" className="mobile-menu" id="mobile-menu" onClose={onClose}>
      <button autoFocus className="menu-close" type="button" onClick={onClose} aria-label="Close menu">
        <CloseIcon size={25} /> <span>CLOSE</span>
      </button>
      <div
        className="drawer-sheet"
        ref={sheet}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) {
            onClose();
          }
        }}
      >
        <SearchForm drawer onSubmitted={onClose} />
        {category ? (
          <>
            <button type="button" className="drawer-back" onClick={back} ref={backButton}><ChevronLeft size={18} /> Back</button>
            <div className="drawer-category" aria-label={category.label}>
              <CategoryContents category={category} />
            </div>
          </>
        ) : (
          <nav aria-label="Mobile banking navigation">
            <a href="/home" className="drawer-personal" onClick={onClose}>Personal</a>
            <ul className="drawer-products">
              {MENU_CATEGORIES.map((item) => (
                <li key={item.id}>
                  <button id={`drawer-${item.id}`} onClick={() => openCategory(item)} type="button">
                    {item.label}<ChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <ul className="drawer-links">
              {MENU_LINKS.map(({ label, href }) => <li key={label}><a href={bankUrl(href)}>{label}</a></li>)}
            </ul>
          </nav>
        )}
      </div>
    </Dialog>
  );
}

export default function Header() {
  const { path } = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1080px)");
    const onResize = () => setPanel(null);
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, []);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header>
        <div className="masthead">
          <div className="site-width masthead-inner">
            <Logo />
            <nav className="utility-nav" aria-label="Header navigation">
              <a className="utility-link" href={LOCATIONS_URL}>ATMs/Locations</a>
              <button className="utility-link" type="button" onClick={() => setPanel("help")} aria-haspopup="dialog">Help</button>
              <a className="utility-link" href={bankUrl("/es/")} lang="es">Espa&ntilde;ol</a>
              <button className="utility-link masthead-search" type="button" aria-label="Search" aria-haspopup="dialog" onClick={() => setPanel("search")}>
                <SearchIcon size={27} strokeWidth={1.05} />
              </button>
              <a className="masthead-signon" href={SIGN_ON_URL}>Sign On</a>
              <button className="masthead-menu" type="button" onClick={() => setPanel("menu")} aria-haspopup="dialog" aria-expanded={panel === "menu"} aria-label="Open menu">
                <span className="menu-lines" aria-hidden="true"><i /><i /><i /></span>
                <span>MENU</span>
              </button>
            </nav>
          </div>
        </div>
        <DesktopNavigation showProducts={path === "/" || path === "/home"} />
      </header>
      {panel === "help" && <HelpDialog onClose={close} />}
      {panel === "menu" && <MobileMenu onClose={close} />}
      {panel === "search" && (
        <Dialog label="Search Wells Fargo" className="search-dialog" onClose={close}>
          <div className="flex items-center justify-between gap-4">
            <h2>Search Wells Fargo</h2>
            <button type="button" aria-label="Close search" onClick={close}><CloseIcon /></button>
          </div>
          <SearchForm onSubmitted={close} />
        </Dialog>
      )}
    </>
  );
}