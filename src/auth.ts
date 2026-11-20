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

async function signInRequest(path: string, credentials: RequestCredentials) {
  const response = await fetch(path, {
    method: "POST", credentials, headers: { "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.authenticated !== true) throw new Error(body.error || "Online banking is unavailable. Please try again.");
  return body;
}

export async function signDemoIn() {
  await signInRequest("/api/demo/session", "same-origin");
  if (await checkDemoSession(AbortSignal.timeout(10000), true)) {
    clearPreviewSession();
    return;
  }
  if (!/^(?:sbx-[a-z0-9-]+\.arena\.site|\d+-[a-z0-9-]+\.e2b\.app)$/i.test(window.location.hostname)) {
    throw new SessionCookieError();
  }
  const body = await signInRequest("/api/demo/preview/session", "omit");
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) throw new SessionCookieError();
  previewToken = body.token;
  try {
    if (!await checkDemoSession(AbortSignal.timeout(10000))) throw new SessionCookieError();
  } catch (error) {
    clearPreviewSession();
    throw error;
  }
}
