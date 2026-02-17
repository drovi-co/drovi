import { useCallback, useState } from "react";

export interface SourceSyncEvent {
  connection_id: string;
  event_type: string;
  status?: string | null;
  progress?: number | null;
  records_synced?: number | null;
  error?: string | null;
  timestamp?: string | null;
  sync_params?: Record<string, unknown> | null;
}

export interface SourceConnectionState {
  id: string;
  provider: string;
  status?: string;
  progress?: number | null;
  messages_synced?: number;
  last_error?: string | null;
  live_status?: string | null;
  last_sync?: string | null;
}

export type SourceSyncMap = Record<string, SourceSyncEvent>;

export function mergeSourceSyncEvent(
  current: SourceConnectionState,
  event: SourceSyncEvent
): Partial<SourceConnectionState> {
  return {
    status: event.status ?? current.status ?? "ready",
    progress:
      typeof event.progress === "number"
        ? event.progress
        : (current.progress ?? null),
    messages_synced:
      typeof event.records_synced === "number"
        ? event.records_synced
        : (current.messages_synced ?? 0),
    last_error: event.error ?? current.last_error ?? null,
    live_status: event.event_type,
    last_sync:
      event.event_type === "completed"
        ? (event.timestamp ?? current.last_sync ?? null)
        : current.last_sync,
  };
}

export function countActiveSourceSyncs(
  connections: SourceConnectionState[],
  liveSync: SourceSyncMap
): number {
  return connections.filter((connection) => {
    const live = liveSync[connection.id];
    return (
      live?.event_type === "started" ||
      live?.event_type === "progress" ||
      connection.status === "syncing" ||
      connection.progress !== null
    );
  }).length;
}

export interface GroupedSourceConnections<TConnection> {
  all: TConnection[];
  email: TConnection[];
  messaging: TConnection[];
  calendar: TConnection[];
  other: TConnection[];
}

function classifyProvider(provider: string): keyof GroupedSourceConnections<unknown> {
  if (provider === "gmail" || provider === "outlook") {
    return "email";
  }
  if (provider === "slack" || provider === "teams" || provider === "whatsapp") {
    return "messaging";
  }
  if (provider === "google_calendar") {
    return "calendar";
  }
  return "other";
}

export function groupSourceConnections<TConnection extends { provider: string }>(
  connections: TConnection[]
): GroupedSourceConnections<TConnection> {
  const grouped: GroupedSourceConnections<TConnection> = {
    all: connections,
    email: [],
    messaging: [],
    calendar: [],
    other: [],
  };

  for (const connection of connections) {
    grouped[classifyProvider(connection.provider)].push(connection);
  }

  return grouped;
}

export function useSourceLiveSyncState() {
  const [liveSync, setLiveSync] = useState<SourceSyncMap>({});

  const applyEvent = useCallback((event: SourceSyncEvent) => {
    setLiveSync((current: SourceSyncMap) => ({
      ...current,
      [event.connection_id]: {
        ...current[event.connection_id],
        ...event,
      },
    }));
  }, []);

  const reset = useCallback(() => {
    setLiveSync({});
  }, []);

  return {
    liveSync,
    applyEvent,
    reset,
  };
}
