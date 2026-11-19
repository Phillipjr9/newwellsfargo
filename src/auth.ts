export const DEMO_AUTH_KEY = "wells-fargo-demo-auth-v1";

export function isDemoSignedIn() {
  try {
    return localStorage.getItem(DEMO_AUTH_KEY) === "signed-in";
  } catch {
    return false;
  }
}

export function signDemoIn(username?: string) {
  try {
    localStorage.setItem(DEMO_AUTH_KEY, "signed-in");
    if (username) localStorage.setItem(`${DEMO_AUTH_KEY}-username`, username);
  } catch {
    // Session still works in memory for the current route.
  }
}

export function signDemoOut() {
  try {
    localStorage.removeItem(DEMO_AUTH_KEY);
  } catch {
    // Nothing to clear in storage if storage is unavailable.
  }
}
