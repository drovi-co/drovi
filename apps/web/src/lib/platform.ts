/**
 * Platform detection utilities for Drovi
 * Detects whether the app is running in a web browser or Tauri desktop environment
 */

export type Platform = "web" | "macos" | "windows" | "linux";

/**
 * Check if the app is running in a Tauri desktop environment
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Check if the app is running in a web browser
 */
export function isWeb(): boolean {
  return !isDesktop();
}

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  if (!isDesktop()) {
    return "web";
  }

  // Use navigator.userAgent to detect the OS in Tauri
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("mac") || ua.includes("darwin")) {
    return "macos";
  }

  if (ua.includes("windows") || ua.includes("win32") || ua.includes("win64")) {
    return "windows";
  }

  // Default to linux for all other desktop platforms
  return "linux";
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return getPlatform() === "macos";
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getPlatform() === "windows";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getPlatform() === "linux";
}

/**
 * Get the keyboard modifier key for the current platform
 * Returns "Cmd" on macOS, "Ctrl" on other platforms
 */
export function getModifierKey(): "Cmd" | "Ctrl" {
  return isMacOS() ? "Cmd" : "Ctrl";
}

/**
 * Format a keyboard shortcut for display based on current platform
 * Example: formatShortcut("Mod+K") returns "Cmd+K" on macOS, "Ctrl+K" elsewhere
 */
export function formatShortcut(shortcut: string): string {
  const modifier = getModifierKey();
  return shortcut.replace(/Mod/g, modifier);
}

/**
 * Get platform-specific configuration
 */
export interface PlatformConfig {
  /** Whether to use native title bar */
  useNativeTitleBar: boolean;
  /** Whether to show window controls (minimize, maximize, close) */
  showWindowControls: boolean;
  /** The modifier key for keyboard shortcuts */
  modifierKey: "Cmd" | "Ctrl";
  /** Whether system tray is available */
  hasTray: boolean;
  /** Whether notifications are available */
  hasNotifications: boolean;
  /** Whether global shortcuts are available */
  hasGlobalShortcuts: boolean;
}

export function getPlatformConfig(): PlatformConfig {
  const platform = getPlatform();
  const desktop = isDesktop();

  return {
    useNativeTitleBar: desktop,
    showWindowControls: platform !== "macos",
    modifierKey: platform === "macos" ? "Cmd" : "Ctrl",
    hasTray: desktop,
    hasNotifications: desktop,
    hasGlobalShortcuts: desktop,
  };
}
