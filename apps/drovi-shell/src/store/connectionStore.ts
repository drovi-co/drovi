import { create } from "zustand";
import { connectionEndpoints } from "../api";
import type { Connection, ConnectorType, SyncStatusResponse } from "../api/schemas";

interface ConnectionState {
  // State
  connections: Connection[];
  syncStatus: Record<string, SyncStatusResponse>;
  isLoading: boolean;
  error: string | null;

  // Available connectors with metadata
  availableConnectors: ConnectorInfo[];

  // Actions
  setConnections: (connections: Connection[]) => void;
  setSyncStatus: (connectionId: string, status: SyncStatusResponse) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Async actions
  loadConnections: (organizationId: string) => Promise<void>;
  initiateOAuth: (provider: ConnectorType, organizationId: string) => Promise<string>;
  triggerSync: (connectionId: string, organizationId: string) => Promise<void>;
  checkSyncStatus: (connectionId: string, organizationId: string) => Promise<void>;
  deleteConnection: (connectionId: string, organizationId: string) => Promise<void>;
}

interface ConnectorInfo {
  type: ConnectorType;
  name: string;
  description: string;
  icon: string;
  available: boolean;
  comingSoon?: boolean;
}

const availableConnectors: ConnectorInfo[] = [
  {
    type: "gmail",
    name: "Gmail",
    description: "Connect your Gmail account to sync emails",
    icon: "mail",
    available: true,
  },
  {
    type: "outlook",
    name: "Outlook",
    description: "Connect Microsoft 365 to sync emails and calendar",
    icon: "mail",
    available: true,
  },
  {
    type: "slack",
    name: "Slack",
    description: "Connect Slack to sync messages and channels",
    icon: "message-square",
    available: true,
  },
  {
    type: "notion",
    name: "Notion",
    description: "Connect Notion to sync pages and databases",
    icon: "file-text",
    available: true,
  },
  {
    type: "google_calendar",
    name: "Google Calendar",
    description: "Connect Google Calendar for meeting context",
    icon: "calendar",
    available: true,
  },
  {
    type: "hubspot",
    name: "HubSpot",
    description: "Connect HubSpot for CRM context",
    icon: "building",
    available: true,
  },
  {
    type: "whatsapp",
    name: "WhatsApp Business",
    description: "Connect WhatsApp Business for messaging",
    icon: "phone",
    available: false,
    comingSoon: true,
  },
  {
    type: "teams",
    name: "Microsoft Teams",
    description: "Connect Teams for chat and meeting context",
    icon: "users",
    available: false,
    comingSoon: true,
  },
];

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  syncStatus: {},
  isLoading: false,
  error: null,
  availableConnectors,

  setConnections: (connections) => set({ connections }),
  setSyncStatus: (connectionId, status) =>
    set((state) => ({
      syncStatus: { ...state.syncStatus, [connectionId]: status },
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadConnections: async (organizationId) => {
    try {
      set({ isLoading: true, error: null });
      const response = await connectionEndpoints.list(organizationId);
      set({ connections: response.connections, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load connections";
      set({ error: message, isLoading: false });
    }
  },

  initiateOAuth: async (provider, organizationId) => {
    try {
      set({ error: null });
      const response = await connectionEndpoints.initiateOAuth(provider, organizationId);
      return response.auth_url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initiate OAuth";
      set({ error: message });
      throw error;
    }
  },

  triggerSync: async (connectionId, organizationId) => {
    try {
      set({ error: null });
      await connectionEndpoints.triggerSync(connectionId, organizationId);
      // Update sync status after triggering
      await get().checkSyncStatus(connectionId, organizationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to trigger sync";
      set({ error: message });
    }
  },

  checkSyncStatus: async (connectionId, organizationId) => {
    try {
      const status = await connectionEndpoints.getSyncStatus(connectionId, organizationId);
      get().setSyncStatus(connectionId, status);
    } catch {
      // Silently fail for status checks
    }
  },

  deleteConnection: async (connectionId, organizationId) => {
    try {
      set({ error: null });
      await connectionEndpoints.delete(connectionId, organizationId);
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== connectionId),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete connection";
      set({ error: message });
    }
  },
}));

// Selector hooks
export const useConnections = () => useConnectionStore((s) => s.connections);
export const useAvailableConnectors = () => useConnectionStore((s) => s.availableConnectors);
export const useSyncStatus = (connectionId: string) =>
  useConnectionStore((s) => s.syncStatus[connectionId]);
