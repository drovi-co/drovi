import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  X,
  Play,
  Pause,
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  History,
  Eye,
  RotateCcw,
  Activity,
  Bell,
  Settings,
} from "lucide-react";
import { continuumEndpoints } from "../../api/endpoints/continuums";
import { useOrgId } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import type { Continuum, ContinuumRun, ContinuumPreviewResponse } from "../../api/schemas";
import { formatDistanceToNow, parseISO, format } from "date-fns";

interface ContinuumDetailProps {
  continuum: Continuum;
  onClose: () => void;
  onRefresh: () => void;
}

type TabId = "overview" | "history" | "preview" | "settings";

const RUN_STATUS_CONFIG: Record<
  string,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  PENDING: { icon: Clock, color: "var(--color-warning)", label: "Pending" },
  RUNNING: { icon: Loader2, color: "var(--color-accent)", label: "Running" },
  SUCCESS: { icon: CheckCircle, color: "var(--color-success)", label: "Success" },
  FAILURE: { icon: XCircle, color: "var(--color-error)", label: "Failed" },
};

export function ContinuumDetail({ continuum, onClose, onRefresh }: ContinuumDetailProps) {
  const orgId = useOrgId();
  const { addNotification } = useUIStore();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [runs, setRuns] = useState<ContinuumRun[]>([]);
  const [preview, setPreview] = useState<ContinuumPreviewResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Load run history
  const loadRuns = useCallback(async () => {
    if (!orgId) return;
    setLoadingRuns(true);
    try {
      const history = await continuumEndpoints.getRunHistory(continuum.id, orgId);
      setRuns(history);
    } catch (err) {
      console.error("Failed to load run history:", err);
    } finally {
      setLoadingRuns(false);
    }
  }, [orgId, continuum.id]);

  // Load preview
  const loadPreview = useCallback(async () => {
    if (!orgId) return;
    setLoadingPreview(true);
    try {
      const result = await continuumEndpoints.preview(continuum.id, orgId, 30);
      setPreview(result);
    } catch (err) {
      console.error("Failed to load preview:", err);
    } finally {
      setLoadingPreview(false);
    }
  }, [orgId, continuum.id]);

  useEffect(() => {
    if (activeTab === "history") {
      loadRuns();
    } else if (activeTab === "preview") {
      loadPreview();
    }
  }, [activeTab, loadRuns, loadPreview]);

  const handleRun = async () => {
    if (!orgId) return;
    setIsRunning(true);
    try {
      await continuumEndpoints.run(continuum.id, orgId);
      addNotification({
        type: "success",
        title: "Continuum Started",
        message: `${continuum.name} is now running`,
      });
      onRefresh();
      loadRuns();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Run Failed",
        message: err instanceof Error ? err.message : "Failed to run",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handlePause = async () => {
    if (!orgId) return;
    try {
      await continuumEndpoints.pause(continuum.id, orgId);
      addNotification({
        type: "info",
        title: "Continuum Paused",
        message: `${continuum.name} has been paused`,
      });
      onRefresh();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Pause Failed",
        message: err instanceof Error ? err.message : "Failed to pause",
      });
    }
  };

  const handleActivate = async () => {
    if (!orgId) return;
    try {
      await continuumEndpoints.activate(continuum.id, orgId);
      addNotification({
        type: "success",
        title: "Continuum Activated",
        message: `${continuum.name} is now active`,
      });
      onRefresh();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Activation Failed",
        message: err instanceof Error ? err.message : "Failed to activate",
      });
    }
  };

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <motion.div
        className="continuum-detail__overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="continuum-detail"
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 100 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="continuum-detail__header">
          <div className="continuum-detail__header-content">
            <h2 className="continuum-detail__title">{continuum.name}</h2>
            {continuum.description && (
              <p className="continuum-detail__description">{continuum.description}</p>
            )}
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Actions */}
        <div className="continuum-detail__actions">
          {continuum.status === "ACTIVE" ? (
            <>
              <button className="btn btn--ghost" onClick={handlePause}>
                <Pause size={16} />
                Pause
              </button>
              <button
                className="btn btn--primary"
                onClick={handleRun}
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 size={16} className="spinning" />
                ) : (
                  <Play size={16} />
                )}
                Run Now
              </button>
            </>
          ) : continuum.status === "PAUSED" ? (
            <>
              <button className="btn btn--secondary" onClick={handleActivate}>
                <Play size={16} />
                Activate
              </button>
              <button
                className="btn btn--ghost"
                onClick={handleRun}
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 size={16} className="spinning" />
                ) : (
                  <Play size={16} />
                )}
                Run Once
              </button>
            </>
          ) : (
            <button
              className="btn btn--secondary"
              onClick={handleRun}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 size={16} className="spinning" />
              ) : (
                <Play size={16} />
              )}
              Run
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="continuum-detail__tabs">
          {[
            { id: "overview" as const, label: "Overview", icon: Activity },
            { id: "history" as const, label: "Run History", icon: History },
            { id: "preview" as const, label: "Preview", icon: Eye },
            { id: "settings" as const, label: "Settings", icon: Settings },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`continuum-detail__tab ${activeTab === id ? "continuum-detail__tab--active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="continuum-detail__content">
          {activeTab === "overview" && (
            <OverviewTab continuum={continuum} />
          )}
          {activeTab === "history" && (
            <HistoryTab runs={runs} loading={loadingRuns} onRefresh={loadRuns} />
          )}
          {activeTab === "preview" && (
            <PreviewTab preview={preview} loading={loadingPreview} onRefresh={loadPreview} />
          )}
          {activeTab === "settings" && (
            <SettingsTab continuum={continuum} />
          )}
        </div>
      </motion.div>
    </>
  );
}

function OverviewTab({ continuum }: { continuum: Continuum }) {
  return (
    <div className="continuum-overview">
      <div className="continuum-overview__grid">
        <div className="continuum-overview__stat">
          <span className="continuum-overview__stat-label">Status</span>
          <span
            className="continuum-overview__stat-value"
            style={{
              color:
                continuum.status === "ACTIVE"
                  ? "var(--color-success)"
                  : continuum.status === "PAUSED"
                  ? "var(--color-warning)"
                  : "var(--color-text-secondary)",
            }}
          >
            {continuum.status}
          </span>
        </div>
        <div className="continuum-overview__stat">
          <span className="continuum-overview__stat-label">Version</span>
          <span className="continuum-overview__stat-value">
            v{continuum.current_version}
          </span>
        </div>
        <div className="continuum-overview__stat">
          <span className="continuum-overview__stat-label">Schedule</span>
          <span className="continuum-overview__stat-value">
            {continuum.schedule_type === "interval"
              ? `Every ${continuum.schedule_interval_minutes} min`
              : continuum.schedule_type === "cron"
              ? continuum.schedule_cron
              : "On demand"}
          </span>
        </div>
        <div className="continuum-overview__stat">
          <span className="continuum-overview__stat-label">Last Run</span>
          <span className="continuum-overview__stat-value">
            {continuum.last_run_at
              ? formatDistanceToNow(parseISO(continuum.last_run_at), { addSuffix: true })
              : "Never"}
          </span>
        </div>
      </div>

      {continuum.escalation_policy && (
        <div className="continuum-overview__section">
          <h3>
            <Bell size={16} />
            Escalation Policy
          </h3>
          <div className="continuum-overview__policy">
            {continuum.escalation_policy.on_failure && (
              <span className="policy-badge">Escalate on failure</span>
            )}
            {continuum.escalation_policy.max_retries && (
              <span className="policy-badge">
                Max {continuum.escalation_policy.max_retries} retries
              </span>
            )}
            {continuum.escalation_policy.require_manual_override && (
              <span className="policy-badge policy-badge--warning">
                Manual override required
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab({
  runs,
  loading,
  onRefresh,
}: {
  runs: ContinuumRun[];
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="continuum-history continuum-history--loading">
        <Loader2 size={24} className="spinning" />
        <span>Loading run history...</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="continuum-history continuum-history--empty">
        <History size={32} style={{ opacity: 0.3 }} />
        <p>No runs yet</p>
        <button className="btn btn--secondary btn--sm" onClick={onRefresh}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="continuum-history">
      <div className="continuum-history__header">
        <span>{runs.length} runs</span>
        <button className="btn btn--ghost btn--sm" onClick={onRefresh}>
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="continuum-history__list">
        {runs.map((run) => {
          const config = RUN_STATUS_CONFIG[run.status] || RUN_STATUS_CONFIG.PENDING;
          const StatusIcon = config.icon;
          return (
            <div key={run.id} className="run-item">
              <div
                className="run-item__status"
                style={{ color: config.color }}
              >
                <StatusIcon
                  size={14}
                  className={run.status === "RUNNING" ? "spinning" : ""}
                />
                {config.label}
              </div>
              <div className="run-item__info">
                <span className="run-item__version">v{run.version}</span>
                {run.started_at && (
                  <span className="run-item__time">
                    {format(parseISO(run.started_at), "MMM d, HH:mm")}
                  </span>
                )}
              </div>
              {run.error_message && (
                <div className="run-item__error">
                  <AlertCircle size={12} />
                  {run.error_message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewTab({
  preview,
  loading,
  onRefresh,
}: {
  preview: ContinuumPreviewResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="continuum-preview continuum-preview--loading">
        <Loader2 size={24} className="spinning" />
        <span>Generating preview...</span>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="continuum-preview continuum-preview--empty">
        <Eye size={32} style={{ opacity: 0.3 }} />
        <p>No preview available</p>
        <button className="btn btn--secondary btn--sm" onClick={onRefresh}>
          <RefreshCw size={14} />
          Generate Preview
        </button>
      </div>
    );
  }

  return (
    <div className="continuum-preview">
      <div className="continuum-preview__header">
        <h3>30-Day Risk Forecast</h3>
        <button className="btn btn--ghost btn--sm" onClick={onRefresh}>
          <RefreshCw size={14} />
        </button>
      </div>

      {preview.risk_snapshots && preview.risk_snapshots.length > 0 && (
        <div className="continuum-preview__snapshots">
          {preview.risk_snapshots.map((snapshot, index) => (
            <div key={index} className="snapshot-card">
              <div className="snapshot-card__header">
                <span>Day {index + 1}</span>
                <span
                  className={`snapshot-card__outlook snapshot-card__outlook--${snapshot.risk_outlook}`}
                >
                  {snapshot.risk_outlook} risk
                </span>
              </div>
              <div className="snapshot-card__stats">
                <div>
                  <span className="snapshot-card__value">
                    {snapshot.open_commitments}
                  </span>
                  <span className="snapshot-card__label">Open</span>
                </div>
                <div>
                  <span
                    className="snapshot-card__value"
                    style={{ color: snapshot.overdue_commitments > 0 ? "var(--color-error)" : undefined }}
                  >
                    {snapshot.overdue_commitments}
                  </span>
                  <span className="snapshot-card__label">Overdue</span>
                </div>
                <div>
                  <span className="snapshot-card__value">
                    {Math.round(snapshot.risk_score * 100)}%
                  </span>
                  <span className="snapshot-card__label">Risk Score</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview.recommendations && preview.recommendations.length > 0 && (
        <div className="continuum-preview__recommendations">
          <h4>Recommendations</h4>
          <ul>
            {preview.recommendations.map((rec, index) => (
              <li key={index}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ continuum }: { continuum: Continuum }) {
  return (
    <div className="continuum-settings">
      <div className="continuum-settings__section">
        <h3>General</h3>
        <div className="continuum-settings__item">
          <span className="continuum-settings__label">ID</span>
          <code className="continuum-settings__value">{continuum.id}</code>
        </div>
        <div className="continuum-settings__item">
          <span className="continuum-settings__label">Created</span>
          <span className="continuum-settings__value">
            {format(parseISO(continuum.created_at), "MMM d, yyyy HH:mm")}
          </span>
        </div>
        {continuum.created_by && (
          <div className="continuum-settings__item">
            <span className="continuum-settings__label">Created By</span>
            <span className="continuum-settings__value">{continuum.created_by}</span>
          </div>
        )}
      </div>

      <div className="continuum-settings__section">
        <h3>Danger Zone</h3>
        <p className="continuum-settings__warning">
          These actions are irreversible. Proceed with caution.
        </p>
        <button className="btn btn--danger btn--sm" disabled>
          <RotateCcw size={14} />
          Rollback to Previous Version
        </button>
      </div>
    </div>
  );
}

export default ContinuumDetail;
