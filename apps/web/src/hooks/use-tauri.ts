/**
 * Tauri integration hooks for Drovi desktop app
 * These hooks provide access to native desktop features when running in Tauri
 */

import { useCallback, useEffect, useState } from "react";
import { isDesktop } from "@/lib/platform";

// Type imports - these are only available in Tauri context
type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

/**
 * Hook for auto-updater functionality
 * Only works when running in Tauri desktop environment
 */
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }

    try {
      setStatus("checking");
      setError(null);

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
        setUpdateInfo({
          version: update.version,
          date: update.date,
          body: update.body,
        });
        setStatus("available");
      } else {
        setStatus("idle");
      }
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to check for updates"
      );
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }

    try {
      setStatus("downloading");
      setError(null);

      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");

      const update = await check();
      if (!update) {
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === "Finished") {
          setStatus("ready");
        }
      });

      // Relaunch the app after update
      await relaunch();
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Failed to download update"
      );
    }
  }, []);

  // Listen for check-for-updates event from tray
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("check-for-updates", () => {
        checkForUpdates();
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [checkForUpdates]);

  return {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    isDesktop: isDesktop(),
  };
}

/**
 * Hook for system notifications
 * Only works when running in Tauri desktop environment
 */
export function useNotifications() {
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    if (!isDesktop()) {
      return;
    }

    (async () => {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );

      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      setPermissionGranted(granted);
    })();
  }, []);

  const sendNotification = useCallback(
    async (title: string, body?: string, options?: { icon?: string }) => {
      if (!(isDesktop() && permissionGranted)) {
        return;
      }

      const { sendNotification: send } = await import(
        "@tauri-apps/plugin-notification"
      );
      send({ title, body, icon: options?.icon });
    },
    [permissionGranted]
  );

  return {
    permissionGranted,
    sendNotification,
    isDesktop: isDesktop(),
  };
}

/**
 * Hook for deep link handling
 * Listens for drovi:// URLs
 */
export function useDeepLinks(onDeepLink?: (url: string) => void) {
  useEffect(() => {
    if (!(isDesktop() && onDeepLink)) {
      return;
    }

    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("deep-link", (event) => {
        onDeepLink(event.payload);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [onDeepLink]);
}

/**
 * Hook for global keyboard shortcuts
 * Only works when running in Tauri desktop environment
 */
export function useGlobalShortcut(shortcut: string, callback: () => void) {
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }

    let registered = false;

    (async () => {
      const { register, unregister } = await import(
        "@tauri-apps/plugin-global-shortcut"
      );

      try {
        await register(shortcut, callback);
        registered = true;
      } catch (error) {
        // Non-critical feature - log in dev, continue gracefully
        if (import.meta.env.DEV) {
          console.warn(`Failed to register shortcut "${shortcut}":`, error);
        }
      }
    })();

    return () => {
      if (registered) {
        (async () => {
          const { unregister } = await import(
            "@tauri-apps/plugin-global-shortcut"
          );
          await unregister(shortcut);
        })();
      }
    };
  }, [shortcut, callback]);
}

/**
 * Hook for window management
 * Only works when running in Tauri desktop environment
 */
export function useWindow() {
  const minimize = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to minimize window:", error);
      }
    }
  }, []);

  const maximize = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().maximize();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to maximize window:", error);
      }
    }
  }, []);

  const unmaximize = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().unmaximize();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to unmaximize window:", error);
      }
    }
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to toggle maximize:", error);
      }
    }
  }, []);

  const close = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to close window:", error);
      }
    }
  }, []);

  const hide = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to hide window:", error);
      }
    }
  }, []);

  const show = useCallback(async () => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().show();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to show window:", error);
      }
    }
  }, []);

  const setTitle = useCallback(async (title: string) => {
    if (!isDesktop()) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to set window title:", error);
      }
    }
  }, []);

  return {
    minimize,
    maximize,
    unmaximize,
    toggleMaximize,
    close,
    hide,
    show,
    setTitle,
    isDesktop: isDesktop(),
  };
}

/**
 * Hook for opening URLs/files with default application
 */
export function useOpener() {
  const openUrl = useCallback(async (url: string) => {
    if (!isDesktop()) {
      // Fallback to window.open for web
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    try {
      const { openUrl: open } = await import("@tauri-apps/plugin-opener");
      await open(url);
    } catch (error) {
      // Fallback to window.open if Tauri opener fails
      window.open(url, "_blank", "noopener,noreferrer");
      if (import.meta.env.DEV) {
        console.warn("Failed to open URL with Tauri, using fallback:", error);
      }
    }
  }, []);

  const openPath = useCallback(async (path: string) => {
    if (!isDesktop()) {
      return;
    }

    try {
      const { openPath: open } = await import("@tauri-apps/plugin-opener");
      await open(path);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to open path:", error);
      }
    }
  }, []);

  return {
    openUrl,
    openPath,
    isDesktop: isDesktop(),
  };
}

/**
 * Combined hook for common Tauri features
 * Provides a unified interface for desktop-specific functionality
 */
export function useTauri() {
  const updater = useUpdater();
  const notifications = useNotifications();
  const window = useWindow();
  const opener = useOpener();

  return {
    isDesktop: isDesktop(),
    updater,
    notifications,
    window,
    opener,
  };
}
