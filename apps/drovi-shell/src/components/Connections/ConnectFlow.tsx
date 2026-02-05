import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  X,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useConnectionStore } from "../../store/connectionStore";
import { useOrgId } from "../../store/authStore";
import type { Connection, ConnectorType } from "../../api/schemas";
import { SyncStatus } from "./SyncStatus";
import { openExternalUrl } from "../../tauri";

interface ConnectFlowProps {
  connectorType: ConnectorType;
  existingConnection?: Connection;
  onClose: () => void;
}

type FlowStep = "intro" | "connecting" | "success" | "error" | "manage";

const CONNECTOR_INFO: Record<
  string,
  { name: string; scopes: string[]; privacyNote: string }
> = {
  gmail: {
    name: "Gmail",
    scopes: ["Read emails", "Access labels", "Read message metadata"],
    privacyNote:
      "Drovi only reads email metadata and content. We never send emails on your behalf.",
  },
  outlook: {
    name: "Outlook",
    scopes: ["Read emails", "Access folders", "Read calendar events"],
    privacyNote:
      "Drovi only reads your data. We never modify or send content on your behalf.",
  },
  slack: {
    name: "Slack",
    scopes: ["Read messages", "Access channels", "View user profiles"],
    privacyNote:
      "Drovi reads messages in channels you have access to. Private DMs are not synced.",
  },
  notion: {
    name: "Notion",
    scopes: ["Read pages", "Access databases", "View page history"],
    privacyNote:
      "Drovi reads pages and databases you grant access to during connection.",
  },
  google_calendar: {
    name: "Google Calendar",
    scopes: ["Read calendar events", "Access event details", "View attendees"],
    privacyNote:
      "Drovi only reads calendar events. We never create or modify events.",
  },
  hubspot: {
    name: "HubSpot",
    scopes: ["Read contacts", "Access deals", "View company data"],
    privacyNote:
      "Drovi reads CRM data to provide context. We never modify your HubSpot data.",
  },
};

export function ConnectFlow({
  connectorType,
  existingConnection,
  onClose,
}: ConnectFlowProps) {
  const orgId = useOrgId();
  const { initiateOAuth, triggerSync, deleteConnection, checkSyncStatus } =
    useConnectionStore();

  const [step, setStep] = useState<FlowStep>(
    existingConnection ? "manage" : "intro"
  );
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const connectorInfo = CONNECTOR_INFO[connectorType] || {
    name: connectorType,
    scopes: ["Access your data"],
    privacyNote: "Drovi will only read data. We never modify content on your behalf.",
  };

  const [pollAttempts, setPollAttempts] = useState(0);
  const maxPollAttempts = 60; // Poll for up to 60 seconds

  // Poll for OAuth completion
  const pollForConnection = useCallback(async () => {
    if (!orgId) return false;

    try {
      const { loadConnections, connections } = useConnectionStore.getState();
      await loadConnections(orgId);
      const newConnections = useConnectionStore.getState().connections;
      const newConnection = newConnections.find(
        (c) => c.connector_type === connectorType && c.status === "active"
      );
      return !!newConnection;
    } catch {
      return false;
    }
  }, [orgId, connectorType]);

  // Polling effect
  useEffect(() => {
    if (step !== "connecting" || pollAttempts >= maxPollAttempts) return;

    const timer = setTimeout(async () => {
      const connected = await pollForConnection();
      if (connected) {
        setStep("success");
      } else {
        setPollAttempts((prev) => prev + 1);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [step, pollAttempts, pollForConnection]);

  const handleConnect = async () => {
    if (!orgId) return;

    setStep("connecting");
    setError(null);
    setPollAttempts(0);

    try {
      const authUrl = await initiateOAuth(connectorType, orgId);

      // Try Tauri command first, fallback to window.open
      try {
        await openExternalUrl(authUrl);
      } catch {
        // Fallback for web environment
        window.open(authUrl, "_blank");
      }

      // Polling will handle the rest
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStep("error");
    }
  };

  const handleSync = async () => {
    if (!orgId || !existingConnection) return;

    setIsSyncing(true);
    try {
      await triggerSync(existingConnection.id, orgId);
      await checkSyncStatus(existingConnection.id, orgId);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!orgId || !existingConnection) return;

    setIsDeleting(true);
    try {
      await deleteConnection(existingConnection.id, orgId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
      setIsDeleting(false);
    }
  };

  return (
    <motion.div
      className="connect-flow__overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="connect-flow"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="connect-flow__close" onClick={onClose}>
          <X size={18} />
        </button>

        {/* Intro Step */}
        {step === "intro" && (
          <div className="connect-flow__content">
            <h2 className="connect-flow__title">Connect {connectorInfo.name}</h2>
            <p className="connect-flow__description">
              Allow Drovi to access your {connectorInfo.name} data to power your
              memory intelligence.
            </p>

            <div className="connect-flow__scopes">
              <h3 className="connect-flow__scopes-title">
                <Shield size={16} />
                Permissions requested
              </h3>
              <ul className="connect-flow__scopes-list">
                {connectorInfo.scopes.map((scope, index) => (
                  <li key={index} className="connect-flow__scope">
                    <CheckCircle size={14} />
                    <span>{scope}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="connect-flow__privacy">
              <p>{connectorInfo.privacyNote}</p>
            </div>

            <div className="connect-flow__actions">
              <button className="btn btn--secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={handleConnect}>
                <ExternalLink size={16} />
                Continue with {connectorInfo.name}
              </button>
            </div>
          </div>
        )}

        {/* Connecting Step */}
        {step === "connecting" && (
          <div className="connect-flow__content connect-flow__content--center">
            <Loader2 size={48} className="connect-flow__spinner" />
            <h2 className="connect-flow__title">Connecting...</h2>
            <p className="connect-flow__description">
              Complete the authorization in your browser, then return here.
            </p>
          </div>
        )}

        {/* Success Step */}
        {step === "success" && (
          <div className="connect-flow__content connect-flow__content--center">
            <div className="connect-flow__success-icon">
              <CheckCircle size={48} />
            </div>
            <h2 className="connect-flow__title">Connected!</h2>
            <p className="connect-flow__description">
              Your {connectorInfo.name} account is now connected. We'll start
              syncing your data shortly.
            </p>
            <button className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {/* Error Step */}
        {step === "error" && (
          <div className="connect-flow__content connect-flow__content--center">
            <div className="connect-flow__error-icon">
              <AlertCircle size={48} />
            </div>
            <h2 className="connect-flow__title">Connection Failed</h2>
            <p className="connect-flow__description">
              {error || "Something went wrong. Please try again."}
            </p>
            <div className="connect-flow__actions">
              <button className="btn btn--secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => setStep("intro")}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Manage Step */}
        {step === "manage" && existingConnection && (
          <div className="connect-flow__content">
            <h2 className="connect-flow__title">
              Manage {connectorInfo.name} Connection
            </h2>

            <SyncStatus connection={existingConnection} />

            <div className="connect-flow__manage-actions">
              <button
                className="btn btn--secondary"
                onClick={handleSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 size={16} className="connect-flow__button-spinner" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Sync Now
              </button>
              <button
                className="btn btn--danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 size={16} className="connect-flow__button-spinner" />
                ) : (
                  <Trash2 size={16} />
                )}
                Disconnect
              </button>
            </div>

            {error && (
              <div className="connect-flow__inline-error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
