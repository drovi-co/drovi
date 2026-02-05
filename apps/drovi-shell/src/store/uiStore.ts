import { create } from "zustand";
import type { UIOBase, UIODetail } from "../api/schemas";

export type ViewType = "intent" | "chat" | "render" | "timeline" | "deck" | "connections" | "settings" | "brief" | "continuums" | "actuations";
export type CommandMode = "ask" | "command" | "search" | "navigate";

interface UIState {
  // View state
  activeView: ViewType;
  previousView: ViewType | null;

  // Command palette state
  commandPaletteOpen: boolean;
  commandMode: CommandMode;
  commandQuery: string;
  commandResults: unknown[];
  commandSelectedIndex: number;
  commandLoading: boolean;

  // Detail panel state
  detailPanelOpen: boolean;
  selectedUIO: UIODetail | null;
  selectedUIOId: string | null;

  // Evidence lens
  evidenceLensOpen: boolean;
  evidenceLensId: string | null;

  // Notifications
  notifications: Notification[];

  // Actions
  setActiveView: (view: ViewType) => void;
  goBack: () => void;

  // Command palette actions
  openCommandPalette: (mode?: CommandMode) => void;
  closeCommandPalette: () => void;
  setCommandMode: (mode: CommandMode) => void;
  setCommandQuery: (query: string) => void;
  setCommandResults: (results: unknown[]) => void;
  setCommandSelectedIndex: (index: number) => void;
  setCommandLoading: (loading: boolean) => void;
  navigateResults: (direction: "up" | "down") => void;

  // Detail panel actions
  openDetailPanel: (uio: UIODetail) => void;
  closeDetailPanel: () => void;
  selectUIO: (id: string) => void;

  // Evidence lens actions
  openEvidenceLens: (evidenceId: string) => void;
  closeEvidenceLens: () => void;

  // Notification actions
  addNotification: (notification: Omit<Notification, "id">) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

let notificationId = 0;

export const useUIStore = create<UIState>((set, get) => ({
  // Initial state
  activeView: "intent",
  previousView: null,
  commandPaletteOpen: false,
  commandMode: "ask",
  commandQuery: "",
  commandResults: [],
  commandSelectedIndex: 0,
  commandLoading: false,
  detailPanelOpen: false,
  selectedUIO: null,
  selectedUIOId: null,
  evidenceLensOpen: false,
  evidenceLensId: null,
  notifications: [],

  // View actions
  setActiveView: (view) => {
    const { activeView } = get();
    set({ activeView: view, previousView: activeView });
  },

  goBack: () => {
    const { previousView } = get();
    if (previousView) {
      set({ activeView: previousView, previousView: null });
    }
  },

  // Command palette actions
  openCommandPalette: (mode = "ask") => {
    set({
      commandPaletteOpen: true,
      commandMode: mode,
      commandQuery: "",
      commandResults: [],
      commandSelectedIndex: 0,
    });
  },

  closeCommandPalette: () => {
    set({
      commandPaletteOpen: false,
      commandQuery: "",
      commandResults: [],
      commandSelectedIndex: 0,
    });
  },

  setCommandMode: (mode) => {
    set({ commandMode: mode, commandQuery: "", commandResults: [], commandSelectedIndex: 0 });
  },

  setCommandQuery: (query) => set({ commandQuery: query }),
  setCommandResults: (results) => set({ commandResults: results, commandSelectedIndex: 0 }),
  setCommandSelectedIndex: (index) => set({ commandSelectedIndex: index }),
  setCommandLoading: (loading) => set({ commandLoading: loading }),

  navigateResults: (direction) => {
    const { commandResults, commandSelectedIndex } = get();
    if (direction === "up") {
      set({ commandSelectedIndex: Math.max(0, commandSelectedIndex - 1) });
    } else {
      set({ commandSelectedIndex: Math.min(commandResults.length - 1, commandSelectedIndex + 1) });
    }
  },

  // Detail panel actions
  openDetailPanel: (uio) => {
    set({ detailPanelOpen: true, selectedUIO: uio, selectedUIOId: uio.id });
  },

  closeDetailPanel: () => {
    set({ detailPanelOpen: false, selectedUIO: null, selectedUIOId: null });
  },

  selectUIO: (id) => {
    set({ selectedUIOId: id });
  },

  // Evidence lens actions
  openEvidenceLens: (evidenceId) => {
    set({ evidenceLensOpen: true, evidenceLensId: evidenceId });
  },

  closeEvidenceLens: () => {
    set({ evidenceLensOpen: false, evidenceLensId: null });
  },

  // Notification actions
  addNotification: (notification) => {
    const id = `notification-${++notificationId}`;
    const newNotification: Notification = { ...notification, id };
    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    // Auto-remove after duration
    const duration = notification.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, duration);
    }
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },
}));

// Selector hooks
export const useActiveView = () => useUIStore((s) => s.activeView);
export const useCommandPalette = () =>
  useUIStore((s) => ({
    isOpen: s.commandPaletteOpen,
    mode: s.commandMode,
    query: s.commandQuery,
    results: s.commandResults,
    selectedIndex: s.commandSelectedIndex,
    loading: s.commandLoading,
  }));
export const useDetailPanel = () =>
  useUIStore((s) => ({
    isOpen: s.detailPanelOpen,
    uio: s.selectedUIO,
  }));
export const useNotifications = () => useUIStore((s) => s.notifications);
