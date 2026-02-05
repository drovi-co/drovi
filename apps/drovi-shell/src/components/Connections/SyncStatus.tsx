import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Clock,
  Database,
} from "lucide-react";
import type { Connection } from "../../api/schemas";
import { useSyncStatus } from "../../store/connectionStore";
import { formatDistanceToNow, parseISO } from "date-fns";

interface SyncStatusProps {
  connection: Connection;
}

const STATUS_CONFIG: Record<
  string,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  active: {
    icon: CheckCircle,
    color: "var(--color-success)",
    label: "Connected",
  },
  pending: {
    icon: Clock,
    color: "var(--color-warning)",
    label: "Pending",
  },
  syncing: {
    icon: Loader2,
    color: "var(--color-accent)",
    label: "Syncing...",
  },
  error: {
    icon: AlertCircle,
    color: "var(--color-error)",
    label: "Error",
  },
  disconnected: {
    icon: AlertCircle,
    color: "var(--color-text-muted)",
    label: "Disconnected",
  },
};

export function SyncStatus({ connection }: SyncStatusProps) {
  const syncStatus = useSyncStatus(connection.id);
  const status = STATUS_CONFIG[connection.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;

  const lastSynced = connection.last_sync_at
    ? formatDistanceToNow(parseISO(connection.last_sync_at), { addSuffix: true })
    : "Never";

  const isSyncing = syncStatus?.is_syncing || connection.status === "syncing";
  const job = syncStatus?.job;

  return (
    <div className="sync-status">
      <div className="sync-status__header">
        <span
          className="sync-status__indicator"
          style={{ backgroundColor: isSyncing ? "var(--color-accent)" : status.color }}
        />
        <span
          className="sync-status__label"
          style={{ color: isSyncing ? "var(--color-accent)" : status.color }}
        >
          <StatusIcon
            size={14}
            className={isSyncing ? "sync-status__spinner" : ""}
          />
          {isSyncing ? "Syncing..." : status.label}
        </span>
      </div>

      <div className="sync-status__info">
        <div className="sync-status__info-row">
          <Clock size={14} />
          <span>Last synced: {lastSynced}</span>
        </div>

        {job && job.records_processed !== undefined && (
          <div className="sync-status__info-row">
            <Database size={14} />
            <span>{job.records_processed.toLocaleString()} records processed</span>
          </div>
        )}
      </div>

      {job && job.status === "running" && (
        <div className="sync-status__progress">
          <div className="sync-status__progress-label">
            Syncing in progress...
          </div>
          <div className="sync-status__progress-bar">
            <div
              className="sync-status__progress-fill sync-status__progress-fill--indeterminate"
            />
          </div>
        </div>
      )}

      {job?.error_message && (
        <div className="sync-status__error">
          <AlertCircle size={14} />
          <span>{job.error_message}</span>
        </div>
      )}
    </div>
  );
}
