export const DEMO_AUTH_KEY = "wells-fargo-online-auth-v1";
let signedIn = false;

export function isDemoSignedIn() { return signedIn; }

export async function checkDemoSession() {
  try {
    const response = await fetch("/api/demo/session", { credentials: "same-origin", cache: "no-store" });
    signedIn = response.ok && (await response.json()).authenticated === true;
  } catch { signedIn = false; }
  return signedIn;
}

export async function signDemoIn(username = "demo-user", password = "demo-password") {
  const response = await fetch("/api/demo/session", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Sign-on details weren't recognized.");
  signedIn = body.authenticated === true;
  try { localStorage.setItem(`${DEMO_AUTH_KEY}-username`, username); } catch { /* optional */ }
  return signedIn;
}

export async function signDemoOut() {
  try { await fetch("/api/demo/session", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* clear client state anyway */ }
  signedIn = false;
  try { localStorage.removeItem(DEMO_AUTH_KEY); } catch { /* optional */ }
}
