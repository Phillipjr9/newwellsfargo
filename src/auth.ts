export class SessionCookieError extends Error {
  constructor() {
    super("This browser didn't keep your sign-in session.");
  }
}

// Only a disposable preview ledger uses this credential. Keep it in memory;
// never put it in a URL, browser storage, or a customer/admin request.
let previewToken = "";
export const isPreviewSession = () => previewToken !== "";
export function clearPreviewSession() { previewToken = ""; }
export function previewSessionHeaders(): Record<string, string> {
  return previewToken ? { "X-Workspace-Preview-Session": previewToken } : {};
}

async function signOnRequest(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.authenticated !== true) {
    throw new Error(result.error || "Online banking is unavailable. Please try again.");
  }
  return result;
}

export async function checkPortalSession(): Promise<boolean> {
  const response = await fetch("/api/protected-session", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("Online banking is unavailable. Please try again.");
  }
  return (await response.json()).authenticated === true;
}

export async function endPortalSession(): Promise<void> {
  await fetch("/api/protected-session", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
  try {
    window.dispatchEvent(new Event("workspace-session-ended"));
  } catch { /* no listeners */ }
}

export async function clearPortalCookie(): Promise<void> {
  await fetch("/api/protected-session-cleanup", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
}

export async function cleanupPortalBeforeSecureLogin(): Promise<void> {
  await endPortalSession();
  await clearPortalCookie();
}

export async function signOnWithCredentials(email: string, password: string) {
  await signOnRequest("/api/protected-session", { email, password });
  if (!(await checkPortalSession())) throw new SessionCookieError();
}

export async function signOffFromPortal() {
  await endPortalSession();
}
