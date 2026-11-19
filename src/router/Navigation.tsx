import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Location = { path: string; query: Record<string, string> };
type Router = Location & {
  navigate: (to: string, params?: Record<string, string>) => void;
  goBack: () => void;
};
const context = createContext<Router>({
  path: "/",
  query: {},
  navigate() {},
  goBack() {},
});
const origin = "https://preview.local";
function parse(url: URL): Location {
  return {
    path: url.pathname.replace(/\/+$/, "") || "/",
    query: Object.fromEntries(url.searchParams),
  };
}
function current() {
  const raw = location.hash.startsWith("#/")
    ? location.hash.slice(1)
    : location.protocol === "file:"
      ? "/"
      : location.pathname + location.search;
  return parse(new URL(raw, origin));
}
export const useRouter = () => useContext(context);
export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(current);
  const navigate = useCallback(
    (to: string, params?: Record<string, string>) => {
      const url = new URL(to, origin);
      if (url.origin !== origin) return;
      Object.entries(params ?? {}).forEach(([key, value]) =>
        url.searchParams.set(key, value),
      );
      const target = url.pathname + url.search + url.hash;
      history.pushState(
        null,
        "",
        location.protocol === "file:" ? `#${target}` : target,
      );
      setRoute(parse(url));
      window.scrollTo(0, 0);
      if (url.hash)
        requestAnimationFrame(() =>
          document.getElementById(url.hash.slice(1))?.scrollIntoView(),
        );
    },
    [],
  );
  useEffect(() => {
    const update = () => {
      setRoute(current());
      window.scrollTo(0, 0);
    };
    const follow = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href");
      if (
        !link ||
        !href?.startsWith("/") ||
        href.startsWith("//") ||
        link.hasAttribute("download") ||
        link.target === "_blank"
      )
        return;
      event.preventDefault();
      navigate(href);
    };
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    document.addEventListener("click", follow);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      document.removeEventListener("click", follow);
    };
  }, [navigate]);
  return (
    <context.Provider
      value={{
        ...route,
        navigate,
        goBack: () => (history.length > 1 ? history.back() : navigate("/")),
      }}
    >
      {children}
    </context.Provider>
  );
}
