const STORAGE_KEY = "drovi:admin-session-token";

export function getAdminSessionToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return (
    window.sessionStorage.getItem(STORAGE_KEY) ||
    window.localStorage.getItem(STORAGE_KEY)
  );
}

export function setAdminSessionToken(
  token: string | null | undefined,
  options?: { persist?: boolean }
) {
  if (typeof window === "undefined") {
    return;
  }
  if (!token) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const persist = options?.persist ?? true;
  window.sessionStorage.setItem(STORAGE_KEY, token);
  if (persist) {
    window.localStorage.setItem(STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearAdminSessionToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_KEY);
}

