"use client";

/**
 * PresenceProvider
 *
 * Provides real-time presence context via WebSocket.
 * Wrap your app or organization-scoped layouts with this provider.
 */

import { type ReactNode } from "react";
import {
  PresenceContext,
  usePresenceWebSocket,
  type PresenceStatus,
} from "@/hooks/use-presence";

interface PresenceProviderProps {
  organizationId: string;
  token?: string;
  enabled?: boolean;
  children: ReactNode;
}

export function PresenceProvider({
  organizationId,
  token,
  enabled = true,
  children,
}: PresenceProviderProps) {
  const presence = usePresenceWebSocket({
    organizationId,
    token,
    enabled,
  });

  return (
    <PresenceContext.Provider value={presence}>
      {children}
    </PresenceContext.Provider>
  );
}

/**
 * ConnectionStatus
 *
 * Shows the current WebSocket connection status.
 * Useful for debugging.
 */
export function ConnectionStatus() {
  const presence = usePresenceWebSocket({
    organizationId: "",
    token: "",
    enabled: false,
  });

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={`h-2 w-2 rounded-full ${
          presence.isConnected ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span>{presence.isConnected ? "Connected" : "Disconnected"}</span>
    </div>
  );
}
