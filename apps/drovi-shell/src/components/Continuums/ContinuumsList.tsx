import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Activity,
  Calendar,
  Zap,
} from "lucide-react";
import { continuumEndpoints } from "../../api/endpoints/continuums";
import { useOrgId } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import type { Continuum, ContinuumStatus } from "../../api/schemas";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ContinuumDetail } from "./ContinuumDetail";

const STATUS_CONFIG: Record<
  ContinuumStatus,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  DRAFT: { icon: Clock, color: "var(--color-text-muted)", label: "Draft" },
  ACTIVE: { icon: CheckCircle, color: "var(--color-success)", label: "Active" },
  PAUSED: { icon: Pause, color: "var(--color-warning)", label: "Paused" },
  FAILED: { icon: XCircle, color: "var(--color-error)", label: "Failed" },
  COMPLETED: { icon: CheckCircle, color: "var(--color-success)", label: "Completed" },
};

const SCHEDULE_ICONS: Record<string, typeof Clock> = {
  interval: RefreshCw,
  cron: Calendar,
  on_demand: Zap,
};

export function ContinuumsList() {
  const orgId = useOrgId();
  const { addNotification } = useUIStore();

  const [continuums, setContinuums] = useState<Continuum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContinuum, setSelectedContinuum] = useState<Continuum | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const loadContinuums = useCallback(async () => {
    if (!orgId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await continuumEndpoints.list(orgId);
      setContinuums(response.continuums);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load continuums");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadContinuums();
  }, [loadContinuums]);

  const handleRun = async (continuum: Continuum, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!orgId) return;

    setRunningIds((prev) => new Set([...prev, continuum.id]));

    try {
      await continuumEndpoints.run(continuum.id, orgId);
      addNotification({
        type: "success",
        title: "Continuum Started",
        message: `${continuum.name} is now running`,
      });
      await loadContinuums();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Run Failed",
        message: err instanceof Error ? err.message : "Failed to run continuum",
      });
    } finally {
      setRunningIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(continuum.id);
        return newSet;
      });
    }
  };

  const handlePause = async (continuum: Continuum, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!orgId) return;

    try {
      await continuumEndpoints.pause(continuum.id, orgId);
      addNotification({
        type: "info",
        title: "Continuum Paused",
        message: `${continuum.name} has been paused`,
      });
      await loadContinuums();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Pause Failed",
        message: err instanceof Error ? err.message : "Failed to pause continuum",
      });
    }
  };

  const handleActivate = async (continuum: Continuum, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!orgId) return;

    try {
      await continuumEndpoints.activate(continuum.id, orgId);
      addNotification({
        type: "success",
        title: "Continuum Activated",
        message: `${continuum.name} is now active`,
      });
      await loadContinuums();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Activation Failed",
        message: err instanceof Error ? err.message : "Failed to activate continuum",
      });
    }
  };

  // Group continuums by status
  const activeContinuums = continuums.filter((c) => c.status === "ACTIVE");
  const pausedContinuums = continuums.filter((c) => c.status === "PAUSED");
  const otherContinuums = continuums.filter(
    (c) => c.status !== "ACTIVE" && c.status !== "PAUSED"
  );

  if (loading) {
    return (
      <div className="continuums-list continuums-list--loading">
        <Loader2 size={32} className="spinning" />
        <span>Loading continuums...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="continuums-list continuums-list--error">
        <AlertCircle size={32} />
        <h3>Failed to load continuums</h3>
        <p>{error}</p>
        <button className="btn btn--primary" onClick={loadContinuums}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="continuums-list">
      <div className="continuums-list__header">
        <div className="continuums-list__title-section">
          <h1 className="continuums-list__title">Continuums</h1>
          <p className="continuums-list__subtitle">
            Automated workflows that monitor your organization
          </p>
        </div>
        <button
          className="btn btn--secondary btn--icon"
          onClick={loadContinuums}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spinning" : ""} />
        </button>
      </div>

      {continuums.length === 0 ? (
        <div className="continuums-list__empty">
          <Activity size={48} style={{ opacity: 0.3 }} />
          <h3>No continuums found</h3>
          <p>Continuums are automated workflows that run on a schedule.</p>
        </div>
      ) : (
        <div className="continuums-list__content">
          {activeContinuums.length > 0 && (
            <ContinuumSection
              title="Active"
              count={activeContinuums.length}
              icon={<CheckCircle size={16} className="section-icon--active" />}
              continuums={activeContinuums}
              runningIds={runningIds}
              onSelect={setSelectedContinuum}
              onRun={handleRun}
              onPause={handlePause}
              onActivate={handleActivate}
            />
          )}

          {pausedContinuums.length > 0 && (
            <ContinuumSection
              title="Paused"
              count={pausedContinuums.length}
              icon={<Pause size={16} className="section-icon--paused" />}
              continuums={pausedContinuums}
              runningIds={runningIds}
              onSelect={setSelectedContinuum}
              onRun={handleRun}
              onPause={handlePause}
              onActivate={handleActivate}
            />
          )}

          {otherContinuums.length > 0 && (
            <ContinuumSection
              title="Other"
              count={otherContinuums.length}
              continuums={otherContinuums}
              runningIds={runningIds}
              onSelect={setSelectedContinuum}
              onRun={handleRun}
              onPause={handlePause}
              onActivate={handleActivate}
            />
          )}
        </div>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedContinuum && (
          <ContinuumDetail
            continuum={selectedContinuum}
            onClose={() => setSelectedContinuum(null)}
            onRefresh={loadContinuums}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface ContinuumSectionProps {
  title: string;
  count: number;
  icon?: React.ReactNode;
  continuums: Continuum[];
  runningIds: Set<string>;
  onSelect: (continuum: Continuum) => void;
  onRun: (continuum: Continuum, e: React.MouseEvent) => void;
  onPause: (continuum: Continuum, e: React.MouseEvent) => void;
  onActivate: (continuum: Continuum, e: React.MouseEvent) => void;
}

function ContinuumSection({
  title,
  count,
  icon,
  continuums,
  runningIds,
  onSelect,
  onRun,
  onPause,
  onActivate,
}: ContinuumSectionProps) {
  return (
    <section className="continuums-list__section">
      <div className="continuums-list__section-header">
        {icon}
        <h2 className="continuums-list__section-title">{title}</h2>
        <span className="continuums-list__section-count">{count}</span>
      </div>
      <div className="continuums-list__grid">
        <AnimatePresence mode="popLayout">
          {continuums.map((continuum) => (
            <ContinuumCard
              key={continuum.id}
              continuum={continuum}
              isRunning={runningIds.has(continuum.id)}
              onSelect={() => onSelect(continuum)}
              onRun={(e) => onRun(continuum, e)}
              onPause={(e) => onPause(continuum, e)}
              onActivate={(e) => onActivate(continuum, e)}
            />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

interface ContinuumCardProps {
  continuum: Continuum;
  isRunning: boolean;
  onSelect: () => void;
  onRun: (e: React.MouseEvent) => void;
  onPause: (e: React.MouseEvent) => void;
  onActivate: (e: React.MouseEvent) => void;
}

function ContinuumCard({
  continuum,
  isRunning,
  onSelect,
  onRun,
  onPause,
  onActivate,
}: ContinuumCardProps) {
  const statusConfig = STATUS_CONFIG[continuum.status];
  const StatusIcon = statusConfig.icon;
  const ScheduleIcon = SCHEDULE_ICONS[continuum.schedule_type || "on_demand"];

  const lastRun = continuum.last_run_at
    ? formatDistanceToNow(parseISO(continuum.last_run_at), { addSuffix: true })
    : "Never";

  const nextRun = continuum.next_run_at
    ? formatDistanceToNow(parseISO(continuum.next_run_at), { addSuffix: true })
    : null;

  return (
    <motion.div
      className="continuum-card"
      onClick={onSelect}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="continuum-card__header">
        <div
          className="continuum-card__status"
          style={{ color: statusConfig.color }}
        >
          <StatusIcon size={14} />
          <span>{statusConfig.label}</span>
        </div>
        <div className="continuum-card__schedule">
          <ScheduleIcon size={12} />
          <span>{continuum.schedule_type || "on_demand"}</span>
        </div>
      </div>

      <h3 className="continuum-card__name">{continuum.name}</h3>
      {continuum.description && (
        <p className="continuum-card__description">{continuum.description}</p>
      )}

      <div className="continuum-card__meta">
        <span className="continuum-card__last-run">
          <Clock size={12} />
          Last run: {lastRun}
        </span>
        {nextRun && continuum.status === "ACTIVE" && (
          <span className="continuum-card__next-run">
            Next: {nextRun}
          </span>
        )}
      </div>

      <div className="continuum-card__actions">
        {continuum.status === "ACTIVE" ? (
          <>
            <button
              className="btn btn--ghost btn--sm"
              onClick={onPause}
              title="Pause"
            >
              <Pause size={14} />
            </button>
            <button
              className="btn btn--primary btn--sm"
              onClick={onRun}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 size={14} className="spinning" />
              ) : (
                <Play size={14} />
              )}
              Run Now
            </button>
          </>
        ) : continuum.status === "PAUSED" ? (
          <>
            <button
              className="btn btn--secondary btn--sm"
              onClick={onActivate}
            >
              <Play size={14} />
              Activate
            </button>
          </>
        ) : (
          <button
            className="btn btn--secondary btn--sm"
            onClick={onRun}
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader2 size={14} className="spinning" />
            ) : (
              <Play size={14} />
            )}
            Run
          </button>
        )}
        <ChevronRight size={16} className="continuum-card__arrow" />
      </div>
    </motion.div>
  );
}

export default ContinuumsList;
