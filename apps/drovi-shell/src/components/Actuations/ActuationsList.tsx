import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { actuationEndpoints } from "../../api/endpoints";
import type { Actuation, ActuationStatus } from "../../api/schemas";
import { useUIStore } from "../../store/uiStore";
import { ActuationDetail } from "./ActuationDetail";

interface ActuationsListProps {
  organizationId: string | null;
}

const STATUS_GROUPS: { label: string; statuses: ActuationStatus[] }[] = [
  {
    label: "Pending Approval",
    statuses: ["pending_approval"],
  },
  {
    label: "In Progress",
    statuses: ["draft", "approved", "executing"],
  },
  {
    label: "Completed",
    statuses: ["completed", "failed", "rolled_back", "cancelled"],
  },
];

const STATUS_LABELS: Record<ActuationStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  executing: "Executing",
  completed: "Completed",
  failed: "Failed",
  rolled_back: "Rolled Back",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<ActuationStatus, string> = {
  draft: "var(--color-text-muted)",
  pending_approval: "var(--color-warning)",
  approved: "var(--color-accent)",
  executing: "var(--color-info)",
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  rolled_back: "var(--color-warning)",
  cancelled: "var(--color-text-muted)",
};

const ACTION_TYPE_ICONS: Record<string, string> = {
  send_email: "✉️",
  send_slack: "💬",
  create_task: "✓",
  update_crm: "📊",
  send_reminder: "⏰",
  calendar_invite: "📅",
  webhook: "🔗",
};

const TIER_LABELS: Record<string, string> = {
  tier_0: "Auto",
  tier_1: "Low",
  tier_2: "Medium",
  tier_3: "High",
};

export function ActuationsList({ organizationId }: ActuationsListProps) {
  const [actuations, setActuations] = useState<Actuation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedActuation, setSelectedActuation] = useState<Actuation | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActuationStatus | null>(null);
  const { openEvidenceLens } = useUIStore();

  const loadActuations = useCallback(async () => {
    if (!organizationId) {
      setActuations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await actuationEndpoints.list(
        organizationId,
        statusFilter ?? undefined,
        100
      );
      setActuations(response.actuations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load actuations");
    } finally {
      setLoading(false);
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    loadActuations();
  }, [loadActuations]);

  const handleApprove = async (actuation: Actuation) => {
    if (!organizationId) return;
    try {
      await actuationEndpoints.approve(actuation.id, organizationId);
      loadActuations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleExecute = async (actuation: Actuation, dryRun = false) => {
    if (!organizationId) return;
    try {
      await actuationEndpoints.execute(actuation.id, organizationId, dryRun);
      loadActuations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute");
    }
  };

  const handleCancel = async (actuation: Actuation) => {
    if (!organizationId) return;
    try {
      await actuationEndpoints.cancel(actuation.id, organizationId);
      loadActuations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    }
  };

  const groupedActuations = STATUS_GROUPS.map((group) => ({
    ...group,
    actuations: actuations.filter((a) => group.statuses.includes(a.status)),
  })).filter((group) => group.actuations.length > 0);

  if (!organizationId) {
    return (
      <div className="actuations-list actuations-list--empty">
        <div className="actuations-list__empty-state">
          <span className="actuations-list__empty-icon">⚡</span>
          <h3>No Organization Selected</h3>
          <p>Select an organization to view actuations.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="actuations-list actuations-list--loading">
        <div className="actuations-list__spinner" />
        <span>Loading actuations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="actuations-list actuations-list--error">
        <span className="actuations-list__error-icon">⚠️</span>
        <p>{error}</p>
        <button className="btn btn--secondary" onClick={loadActuations}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="actuations-list">
      <div className="actuations-list__header">
        <h2>Actuations</h2>
        <div className="actuations-list__filters">
          <select
            value={statusFilter ?? ""}
            onChange={(e) =>
              setStatusFilter(e.target.value ? (e.target.value as ActuationStatus) : null)
            }
            className="actuations-list__filter-select"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn btn--icon" onClick={loadActuations} title="Refresh">
            ↻
          </button>
        </div>
      </div>

      {actuations.length === 0 ? (
        <div className="actuations-list__empty-state">
          <span className="actuations-list__empty-icon">⚡</span>
          <h3>No Actuations</h3>
          <p>
            {statusFilter
              ? `No actuations with status "${STATUS_LABELS[statusFilter]}"`
              : "No actuations have been created yet."}
          </p>
        </div>
      ) : (
        <div className="actuations-list__groups">
          <AnimatePresence mode="popLayout">
            {groupedActuations.map((group) => (
              <motion.div
                key={group.label}
                className="actuations-list__group"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <h3 className="actuations-list__group-label">
                  {group.label}
                  <span className="actuations-list__group-count">
                    {group.actuations.length}
                  </span>
                </h3>
                <div className="actuations-list__cards">
                  {group.actuations.map((actuation) => (
                    <ActuationCard
                      key={actuation.id}
                      actuation={actuation}
                      onSelect={() => setSelectedActuation(actuation)}
                      onApprove={() => handleApprove(actuation)}
                      onExecute={(dryRun) => handleExecute(actuation, dryRun)}
                      onCancel={() => handleCancel(actuation)}
                      onViewEvidence={(evidenceId) =>
                        openEvidenceLens(evidenceId)
                      }
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedActuation && (
          <ActuationDetail
            actuation={selectedActuation}
            organizationId={organizationId}
            onClose={() => setSelectedActuation(null)}
            onRefresh={loadActuations}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface ActuationCardProps {
  actuation: Actuation;
  onSelect: () => void;
  onApprove: () => void;
  onExecute: (dryRun: boolean) => void;
  onCancel: () => void;
  onViewEvidence: (id: string) => void;
}

function ActuationCard({
  actuation,
  onSelect,
  onApprove,
  onExecute,
  onCancel,
  onViewEvidence,
}: ActuationCardProps) {
  const isPendingApproval = actuation.status === "pending_approval";
  const isApproved = actuation.status === "approved";
  const isDraft = actuation.status === "draft";
  const isExecuting = actuation.status === "executing";
  const canCancel = ["draft", "pending_approval", "approved"].includes(actuation.status);

  return (
    <motion.div
      className="actuation-card"
      onClick={onSelect}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.15 }}
    >
      <div className="actuation-card__header">
        <span className="actuation-card__icon">
          {ACTION_TYPE_ICONS[actuation.action_type] ?? "⚡"}
        </span>
        <div className="actuation-card__title-row">
          <h4 className="actuation-card__title">{actuation.title}</h4>
          <span
            className="actuation-card__status"
            style={{ backgroundColor: STATUS_COLORS[actuation.status] }}
          >
            {STATUS_LABELS[actuation.status]}
          </span>
        </div>
      </div>

      {actuation.description && (
        <p className="actuation-card__description">{actuation.description}</p>
      )}

      {actuation.preview && (
        <div className="actuation-card__preview">
          <p className="actuation-card__preview-summary">{actuation.preview.summary}</p>
          {actuation.preview.recipients && actuation.preview.recipients.length > 0 && (
            <div className="actuation-card__recipients">
              <span className="actuation-card__recipients-label">To:</span>
              {actuation.preview.recipients.slice(0, 3).map((r, i) => (
                <span key={i} className="actuation-card__recipient">
                  {r}
                </span>
              ))}
              {actuation.preview.recipients.length > 3 && (
                <span className="actuation-card__recipient-more">
                  +{actuation.preview.recipients.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="actuation-card__meta">
        <span className="actuation-card__type">{actuation.action_type.replace(/_/g, " ")}</span>
        <span className="actuation-card__tier" data-tier={actuation.tier}>
          {TIER_LABELS[actuation.tier]}
        </span>
        {actuation.requires_approval && (
          <span className="actuation-card__approval-badge">Requires Approval</span>
        )}
      </div>

      {actuation.evidence_ids && actuation.evidence_ids.length > 0 && (
        <div className="actuation-card__evidence">
          <span className="actuation-card__evidence-label">Evidence:</span>
          {actuation.evidence_ids.slice(0, 2).map((id) => (
            <button
              key={id}
              className="actuation-card__evidence-link"
              onClick={(e) => {
                e.stopPropagation();
                onViewEvidence(id);
              }}
            >
              {id.slice(0, 8)}...
            </button>
          ))}
        </div>
      )}

      <div className="actuation-card__actions" onClick={(e) => e.stopPropagation()}>
        {isPendingApproval && (
          <button className="btn btn--success btn--sm" onClick={onApprove}>
            Approve
          </button>
        )}
        {isApproved && (
          <>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => onExecute(true)}
            >
              Dry Run
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => onExecute(false)}>
              Execute
            </button>
          </>
        )}
        {isDraft && (
          <button className="btn btn--primary btn--sm" onClick={() => onExecute(false)}>
            Submit
          </button>
        )}
        {isExecuting && (
          <span className="actuation-card__executing">
            <span className="actuation-card__executing-dot" />
            Executing...
          </span>
        )}
        {canCancel && (
          <button className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </motion.div>
  );
}
