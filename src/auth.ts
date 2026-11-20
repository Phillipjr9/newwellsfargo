export class SessionCookieError extends Error {
  constructor() {
    super("This browser didn't keep your sign-in session.");
  }
}

// Only a disposable sample ledger uses this credential. Keep it in memory;
// never put it in a URL, browser storage, or a customer/admin request.
let previewToken = "";
export const isPreviewSession = () => previewToken !== "";
export function clearPreviewSession() { previewToken = ""; }
export function previewSessionHeaders(): Record<string, string> {
  return previewToken ? { "X-Workspace-Preview-Session": previewToken } : {};
}

export async function checkDemoSession(signal?: AbortSignal, cookieOnly = false) {
  const preview = !cookieOnly && isPreviewSession();
  const response = await fetch(`/api/demo/${preview ? "preview/" : ""}session`, {
    credentials: preview ? "omit" : "same-origin", headers: preview ? previewSessionHeaders() : undefined, cache: "no-store", signal,
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("Online banking is unavailable. Please try again.");
  }
  const authenticated = (await response.json()).authenticated === true;
  if (preview && !authenticated) clearPreviewSession();
  return authenticated;
}

async function signInRequest(path: string, credentials: RequestCredentials, body: Record<string, string> = {}) {
  const response = await fetch(path, {
    method: "POST", credentials, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.authenticated !== true) throw new Error(result.error || "Online banking is unavailable. Please try again.");
  return result;
}

export async function signDemoIn(email: string, password: string) {
  await signInRequest("/api/demo/session", "same-origin", { email, password });
  if (await checkDemoSession(AbortSignal.timeout(10000), true)) {
    clearPreviewSession();
    return;
  }
  throw new SessionCookieError();
}
