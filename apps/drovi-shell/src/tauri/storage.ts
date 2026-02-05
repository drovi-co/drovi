import { invoke } from "@tauri-apps/api/core";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

/**
 * Token types that can be stored securely
 */
export type TokenType = "session_token" | "refresh_token" | "access_token";

/**
 * Securely store an authentication token using the system keychain
 */
export async function storeAuthToken(
  token: string,
  tokenType: TokenType
): Promise<void> {
  if (!isTauri) {
    // Fallback to localStorage for web development
    localStorage.setItem(`drovi_${tokenType}`, token);
    return;
  }

  await invoke("store_auth_token", { token, tokenType });
}

/**
 * Retrieve an authentication token from secure storage
 */
export async function getAuthToken(
  tokenType: TokenType
): Promise<string | null> {
  if (!isTauri) {
    // Fallback to localStorage for web development
    return localStorage.getItem(`drovi_${tokenType}`);
  }

  return await invoke<string | null>("get_auth_token", { tokenType });
}

/**
 * Delete a specific authentication token from secure storage
 */
export async function deleteAuthToken(tokenType: TokenType): Promise<void> {
  if (!isTauri) {
    // Fallback to localStorage for web development
    localStorage.removeItem(`drovi_${tokenType}`);
    return;
  }

  await invoke("delete_auth_token", { tokenType });
}

/**
 * Clear all authentication tokens from secure storage
 */
export async function clearAuthTokens(): Promise<void> {
  if (!isTauri) {
    // Fallback to localStorage for web development
    localStorage.removeItem("drovi_session_token");
    localStorage.removeItem("drovi_refresh_token");
    localStorage.removeItem("drovi_access_token");
    return;
  }

  await invoke("clear_auth_tokens");
}

/**
 * Open a URL in the system's default browser
 * Useful for OAuth flows
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri) {
    // Fallback to window.open for web development
    window.open(url, "_blank");
    return;
  }

  await invoke("open_external_url", { url });
}

/**
 * Check if running in Tauri environment
 */
export function isTauriEnvironment(): boolean {
  return isTauri;
}
