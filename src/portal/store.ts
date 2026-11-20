import { useEffect, useSyncExternalStore } from "react";
import {
  applyAction,
  createWorkspace,
  settleDue,
} from "../../shared/ledger.mjs";
import type { Command, Workspace } from "./model";

const localKey = "banking-preview-ledger-v2";
const tabKey = "banking-preview-workspace";
let workspaceKey = "";
try {
  workspaceKey = sessionStorage.getItem(tabKey) ?? "";
} catch {
  /* Storage may be unavailable in an embedded browser. */
}
const workspaceHeaders = (): Record<string, string> =>
  workspaceKey ? { "X-Demo-Workspace": workspaceKey } : {};
type Snapshot = {
  state: Workspace;
  ready: boolean;
  error: string;
  local: boolean;
};
let snapshot: Snapshot = {
  state: createWorkspace(),
  ready: false,
  error: "",
  local: false,
};
const subscribers = new Set<() => void>();
let pending: Promise<void> | null = null;
let initialized = false;
function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  subscribers.forEach((fn) => fn());
}
const listen = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

function localWorkspace(): Workspace {
  let state: Workspace | null = null;
  const raw = localStorage.getItem(localKey);
  if (raw) {
    try {
      const found = JSON.parse(raw);
      if (
        found.version === 2 &&
        found.demo &&
        Array.isArray(found.payments) &&
        Array.isArray(found.accounts)
      )
        state = found;
    } catch {
      /* Ignore an incomplete old demo save. */
    }
  }
  state ??= createWorkspace();
  settleDue(state);
  localStorage.setItem(localKey, JSON.stringify(state));
  return state;
}

export function refreshWorkspace() {
  if (pending) return pending;
  pending = (async () => {
    try {
      if (location.protocol !== "file:" && !snapshot.local) {
        const response = await fetch("/api/demo/workspace", {
          credentials: "same-origin",
          headers: workspaceHeaders(),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (
          response.headers.get("Content-Type")?.includes("application/json")
        ) {
          if (!response.ok)
            throw new Error(
              "Your workspace is unavailable. Please refresh to try again.",
            );
          const { state } = await response.json();
          if (!state?.demo || state.version !== 2)
            throw new Error("Unexpected workspace response. Please refresh.");
          workspaceKey = response.headers.get("X-Demo-Workspace") ?? "";
          try {
            sessionStorage.setItem(tabKey, workspaceKey);
          } catch {
            /* The in-memory key still works without cookies or storage. */
          }
          publish({ state, ready: true, error: "", local: false });
          initialized = true;
          return;
        }
        if (!response.ok && response.status !== 404)
          throw new Error("The workspace server is unavailable. Please try again.");
      }
      // A static export uses the same validated ledger as the server, in this browser only.
      publish({ state: localWorkspace(), ready: true, error: "", local: true });
      initialized = true;
    } catch (e) {
      publish({
        ready: false,
        error:
          e instanceof Error
            ? e.message
            : "Couldn't load the workspace. Please refresh.",
      });
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function runCommand(command: Command) {
  if (!snapshot.ready)
    throw new Error(
      "Wait for the workspace to finish loading, then try again.",
    );
  if (snapshot.local) {
    const out = applyAction(localWorkspace(), command);
    localStorage.setItem(localKey, JSON.stringify(out.state));
    publish({ state: out.state, error: "" });
    return out.result;
  }
  const response = await fetch("/api/demo/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { ...workspaceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  const out = await response.json();
  if (!response.ok)
    throw new Error(out.error || "The change could not be saved.");
  publish({ state: out.state, error: "" });
  return out.result as string | null;
}

export async function exitWorkspace() {
  if (!snapshot.local) {
    const res = await fetch("/api/demo/exit", {
      method: "POST",
      headers: { ...workspaceHeaders(), "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok && res.status !== 409)
      throw new Error("Could not end the session. Please retry.");
  } else localStorage.removeItem(localKey);
  initialized = false;
  workspaceKey = "";
  try {
    sessionStorage.removeItem(tabKey);
  } catch {
    /* No persistent key to remove. */
  }
  publish({ state: createWorkspace(), ready: false, error: "", local: false });
}

export const workspaceAvailable = () => snapshot.ready;

export function useWorkspace() {
  const current = useSyncExternalStore(listen, () => snapshot);
  useEffect(() => {
    if (!initialized) void refreshWorkspace();
    const sync = () => {
      if (document.visibilityState === "visible") void refreshWorkspace();
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return current;
}
