import { useEffect, useSyncExternalStore } from "react";
import { createWorkspace } from "../../shared/ledger.mjs";
import { clearPreviewSession, isPreviewSession, previewSessionHeaders } from "../auth";
import type { Command, Workspace } from "./model";

const headers = { "X-Demo-Session": "required", "Content-Type": "application/json" };
type Snapshot = { state: Workspace; ready: boolean; error: string };
const empty = (): Snapshot => ({ state: createWorkspace(), ready: false, error: "" });
let snapshot = empty();
let pending: Promise<void> | null = null;
let generation = 0;
const subscribers = new Set<() => void>();
function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  subscribers.forEach((fn) => fn());
}
const listen = (fn: () => void) => {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
};

function clearWorkspace() {
  generation++;
  pending = null;
  publish(empty());
}

async function request(path: string, init: RequestInit = {}, active = generation) {
  const preview = isPreviewSession();
  const response = await fetch(`/api/demo/${preview ? "preview/" : ""}${path}`, {
    ...init, headers: preview ? { ...headers, ...previewSessionHeaders() } : headers, cache: "no-store",
    credentials: preview ? "omit" : "same-origin", signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && active === generation) {
      clearPreviewSession();
      clearWorkspace();
      window.dispatchEvent(new Event("workspace-session-ended"));
    }
    throw new Error(body.error || "The workspace is unavailable. Please try again.");
  }
  return body;
}

export function refreshWorkspace() {
  if (pending) return pending;
  const active = generation;
  return pending = (async () => {
    try {
      const { state } = await request("workspace", {}, active);
      if (!state?.demo || state.version !== 2) throw new Error("Unexpected workspace response. Please try again.");
      if (active === generation) publish({ state, ready: true, error: "" });
    } catch (e) {
      if (active === generation) publish({ ready: false, error: e instanceof Error ? e.message : "Could not load the workspace." });
    } finally {
      if (active === generation) pending = null;
    }
  })();
}

export async function runCommand(command: Command) {
  if (!snapshot.ready) throw new Error("Wait for the workspace to finish loading, then try again.");
  const active = generation;
  const out = await request("action", { method: "POST", body: JSON.stringify(command) }, active);
  if (active === generation) publish({ state: out.state, error: "" });
  return out.result as string | null;
}

export async function exitWorkspace() {
  const result = await request("exit", { method: "POST", body: "{}" });
  clearPreviewSession();
  clearWorkspace();
  return result.managed === true;
}

export const workspaceAvailable = () => snapshot.ready;

export function useWorkspace() {
  const current = useSyncExternalStore(listen, () => snapshot);
  useEffect(() => {
    void refreshWorkspace();
    const sync = () => { if (document.visibilityState === "visible") void refreshWorkspace(); };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return current;
}
