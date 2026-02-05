import { useState } from "react";
import { motion } from "framer-motion";
import { actuationEndpoints } from "../../api/endpoints";
import type { Actuation, ActuationStatus } from "../../api/schemas";
import { formatDistanceToNow, format } from "date-fns";

interface ActuationDetailProps {
  actuation: Actuation;
  organizationId: string;
  onClose: () => void;
  onRefresh: () => void;
}

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

const TIER_DESCRIPTIONS: Record<string, string> = {
  tier_0: "Auto-execute without approval",
  tier_1: "Low risk - optional review",
  tier_2: "Medium risk - approval recommended",
  tier_3: "High risk - approval required",
};

export function ActuationDetail({
  actuation,
  organizationId,
  onClose,
  onRefresh,
}: ActuationDetailProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "payload" | "audit">("overview");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showRollbackForm, setShowRollbackForm] = useState(false);

  const handleApprove = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await actuationEndpoints.approve(actuation.id, organizationId, approvalNotes || undefined);
      onRefresh();
      setShowApprovalForm(false);
      setApprovalNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async (dryRun: boolean) => {
    setIsProcessing(true);
    setError(null);
    try {
      await actuationEndpoints.execute(actuation.id, organizationId, dryRun);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await actuationEndpoints.cancel(actuation.id, organizationId, cancelReason || undefined);
      onRefresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRollback = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await actuationEndpoints.rollback(actuation.id, organizationId, rollbackReason || undefined);
      onRefresh();
      setShowRollbackForm(false);
      setRollbackReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rollback");
    } finally {
      setIsProcessing(false);
    }
  };

  const isPendingApproval = actuation.status === "pending_approval";
  const isApproved = actuation.status === "approved";
  const isExecuting = actuation.status === "executing";
  const isCompleted = actuation.status === "completed";
  const isFailed = actuation.status === "failed";
  const canCancel = ["draft", "pending_approval", "approved"].includes(actuation.status);
  const canRollback = Boolean(actuation.rollback_available) && isCompleted;

  return (
    <motion.div
      className="actuation-detail-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="actuation-detail"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 50 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="actuation-detail__header">
          <div className="actuation-detail__title-row">
            <h2>{actuation.title}</h2>
            <span
              className="actuation-detail__status"
              style={{ backgroundColor: STATUS_COLORS[actuation.status] }}
            >
              {STATUS_LABELS[actuation.status]}
            </span>
          </div>
          <button className="actuation-detail__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="actuation-detail__tabs">
          {(["overview", "payload", "audit"] as const).map((tab) => (
            <button
              key={tab}
              className={`actuation-detail__tab ${activeTab === tab ? "actuation-detail__tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="actuation-detail__content">
          {error && (
            <div className="actuation-detail__error">
              <span>⚠️</span> {error}
            </div>
          )}

          {activeTab === "overview" && (
            <OverviewTab
              actuation={actuation}
              isProcessing={isProcessing}
              isPendingApproval={isPendingApproval}
              isApproved={isApproved}
              isExecuting={isExecuting}
              isFailed={isFailed}
              canCancel={canCancel}
              canRollback={canRollback}
              showApprovalForm={showApprovalForm}
              showCancelForm={showCancelForm}
              showRollbackForm={showRollbackForm}
              approvalNotes={approvalNotes}
              cancelReason={cancelReason}
              rollbackReason={rollbackReason}
              setShowApprovalForm={setShowApprovalForm}
              setShowCancelForm={setShowCancelForm}
              setShowRollbackForm={setShowRollbackForm}
              setApprovalNotes={setApprovalNotes}
              setCancelReason={setCancelReason}
              setRollbackReason={setRollbackReason}
              onApprove={handleApprove}
              onExecute={handleExecute}
              onCancel={handleCancel}
              onRollback={handleRollback}
            />
          )}

          {activeTab === "payload" && <PayloadTab actuation={actuation} />}

          {activeTab === "audit" && <AuditTab actuation={actuation} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

interface OverviewTabProps {
  actuation: Actuation;
  isProcessing: boolean;
  isPendingApproval: boolean;
  isApproved: boolean;
  isExecuting: boolean;
  isFailed: boolean;
  canCancel: boolean;
  canRollback: boolean;
  showApprovalForm: boolean;
  showCancelForm: boolean;
  showRollbackForm: boolean;
  approvalNotes: string;
  cancelReason: string;
  rollbackReason: string;
  setShowApprovalForm: (show: boolean) => void;
  setShowCancelForm: (show: boolean) => void;
  setShowRollbackForm: (show: boolean) => void;
  setApprovalNotes: (notes: string) => void;
  setCancelReason: (reason: string) => void;
  setRollbackReason: (reason: string) => void;
  onApprove: () => void;
  onExecute: (dryRun: boolean) => void;
  onCancel: () => void;
  onRollback: () => void;
}

function OverviewTab({
  actuation,
  isProcessing,
  isPendingApproval,
  isApproved,
  isExecuting,
  isFailed,
  canCancel,
  canRollback,
  showApprovalForm,
  showCancelForm,
  showRollbackForm,
  approvalNotes,
  cancelReason,
  rollbackReason,
  setShowApprovalForm,
  setShowCancelForm,
  setShowRollbackForm,
  setApprovalNotes,
  setCancelReason,
  setRollbackReason,
  onApprove,
  onExecute,
  onCancel,
  onRollback,
}: OverviewTabProps) {
  return (
    <div className="actuation-detail__overview">
      {/* Preview Section */}
      {actuation.preview && (
        <div className="actuation-detail__section">
          <h3>Preview</h3>
          <div className="actuation-detail__preview">
            <p className="actuation-detail__preview-summary">{actuation.preview.summary}</p>
            {actuation.preview.details && (
              <p className="actuation-detail__preview-details">{actuation.preview.details}</p>
            )}
            {actuation.preview.recipients && actuation.preview.recipients.length > 0 && (
              <div className="actuation-detail__preview-recipients">
                <strong>Recipients:</strong>
                <ul>
                  {actuation.preview.recipients.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="actuation-detail__section">
        <h3>Details</h3>
        <div className="actuation-detail__info-grid">
          <div className="actuation-detail__info-item">
            <span className="actuation-detail__info-label">Action Type</span>
            <span className="actuation-detail__info-value">
              {actuation.action_type.replace(/_/g, " ")}
            </span>
          </div>
          <div className="actuation-detail__info-item">
            <span className="actuation-detail__info-label">Tier</span>
            <span className="actuation-detail__info-value" data-tier={actuation.tier}>
              {actuation.tier.replace("_", " ").toUpperCase()}
              <span className="actuation-detail__tier-desc">
                {TIER_DESCRIPTIONS[actuation.tier]}
              </span>
            </span>
          </div>
          <div className="actuation-detail__info-item">
            <span className="actuation-detail__info-label">Created</span>
            <span className="actuation-detail__info-value">
              {formatDistanceToNow(new Date(actuation.created_at), { addSuffix: true })}
            </span>
          </div>
          {actuation.approved_at && (
            <div className="actuation-detail__info-item">
              <span className="actuation-detail__info-label">Approved</span>
              <span className="actuation-detail__info-value">
                {format(new Date(actuation.approved_at), "PPp")}
                {actuation.approved_by && <span> by {actuation.approved_by}</span>}
              </span>
            </div>
          )}
          {actuation.executed_at && (
            <div className="actuation-detail__info-item">
              <span className="actuation-detail__info-label">Executed</span>
              <span className="actuation-detail__info-value">
                {format(new Date(actuation.executed_at), "PPp")}
              </span>
            </div>
          )}
          {actuation.completed_at && (
            <div className="actuation-detail__info-item">
              <span className="actuation-detail__info-label">Completed</span>
              <span className="actuation-detail__info-value">
                {format(new Date(actuation.completed_at), "PPp")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {isFailed && actuation.error_message && (
        <div className="actuation-detail__section actuation-detail__section--error">
          <h3>Error</h3>
          <pre className="actuation-detail__error-message">{actuation.error_message}</pre>
        </div>
      )}

      {/* Executing Status */}
      {isExecuting && (
        <div className="actuation-detail__section actuation-detail__section--executing">
          <h3>Execution in Progress</h3>
          <div className="actuation-detail__executing-status">
            <div className="actuation-detail__executing-spinner" />
            <span>This actuation is currently being executed...</span>
          </div>
        </div>
      )}

      {/* Approval Form */}
      {isPendingApproval && (
        <div className="actuation-detail__section">
          <h3>Approval Required</h3>
          {showApprovalForm ? (
            <div className="actuation-detail__form">
              <textarea
                placeholder="Add approval notes (optional)..."
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="actuation-detail__textarea"
              />
              <div className="actuation-detail__form-actions">
                <button
                  className="btn btn--ghost"
                  onClick={() => setShowApprovalForm(false)}
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  className="btn btn--success"
                  onClick={onApprove}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Approving..." : "Confirm Approval"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn--success"
              onClick={() => setShowApprovalForm(true)}
            >
              Approve Actuation
            </button>
          )}
        </div>
      )}

      {/* Execute Actions */}
      {isApproved && (
        <div className="actuation-detail__section">
          <h3>Ready to Execute</h3>
          <div className="actuation-detail__execute-actions">
            <button
              className="btn btn--secondary"
              onClick={() => onExecute(true)}
              disabled={isProcessing}
            >
              {isProcessing ? "Running..." : "Dry Run"}
            </button>
            <button
              className="btn btn--primary"
              onClick={() => onExecute(false)}
              disabled={isProcessing}
            >
              {isProcessing ? "Executing..." : "Execute"}
            </button>
          </div>
        </div>
      )}

      {/* Rollback Form */}
      {canRollback && (
        <div className="actuation-detail__section">
          <h3>Rollback Available</h3>
          {showRollbackForm ? (
            <div className="actuation-detail__form">
              <textarea
                placeholder="Reason for rollback..."
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                className="actuation-detail__textarea"
              />
              <div className="actuation-detail__form-actions">
                <button
                  className="btn btn--ghost"
                  onClick={() => setShowRollbackForm(false)}
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  className="btn btn--warning"
                  onClick={onRollback}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Rolling back..." : "Confirm Rollback"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn--warning"
              onClick={() => setShowRollbackForm(true)}
            >
              Rollback Actuation
            </button>
          )}
        </div>
      )}

      {/* Cancel Form */}
      {canCancel && (
        <div className="actuation-detail__section actuation-detail__section--danger">
          <h3>Cancel Actuation</h3>
          {showCancelForm ? (
            <div className="actuation-detail__form">
              <textarea
                placeholder="Reason for cancellation..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="actuation-detail__textarea"
              />
              <div className="actuation-detail__form-actions">
                <button
                  className="btn btn--ghost"
                  onClick={() => setShowCancelForm(false)}
                  disabled={isProcessing}
                >
                  Keep
                </button>
                <button
                  className="btn btn--danger"
                  onClick={onCancel}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Cancelling..." : "Confirm Cancel"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn--ghost btn--danger-text"
              onClick={() => setShowCancelForm(true)}
            >
              Cancel Actuation
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface PayloadTabProps {
  actuation: Actuation;
}

function PayloadTab({ actuation }: PayloadTabProps) {
  return (
    <div className="actuation-detail__payload">
      <div className="actuation-detail__section">
        <h3>Payload Data</h3>
        <pre className="actuation-detail__code">
          {JSON.stringify(actuation.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

interface AuditTabProps {
  actuation: Actuation;
}

function AuditTab({ actuation }: AuditTabProps) {
  const events: { label: string; time: string | undefined; detail?: string }[] = [
    { label: "Created", time: actuation.created_at, detail: actuation.created_by },
    { label: "Approved", time: actuation.approved_at, detail: actuation.approved_by },
    { label: "Executed", time: actuation.executed_at },
    { label: "Completed", time: actuation.completed_at },
  ].filter((e) => e.time);

  return (
    <div className="actuation-detail__audit">
      <div className="actuation-detail__section">
        <h3>Audit Trail</h3>
        <div className="actuation-detail__timeline">
          {events.map((event, i) => (
            <div key={i} className="actuation-detail__timeline-item">
              <div className="actuation-detail__timeline-marker" />
              <div className="actuation-detail__timeline-content">
                <span className="actuation-detail__timeline-label">{event.label}</span>
                <span className="actuation-detail__timeline-time">
                  {format(new Date(event.time!), "PPp")}
                </span>
                {event.detail && (
                  <span className="actuation-detail__timeline-detail">by {event.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {actuation.uio_id && (
        <div className="actuation-detail__section">
          <h3>Related UIO</h3>
          <p className="actuation-detail__uio-link">{actuation.uio_id}</p>
        </div>
      )}

      {actuation.evidence_ids && actuation.evidence_ids.length > 0 && (
        <div className="actuation-detail__section">
          <h3>Evidence</h3>
          <ul className="actuation-detail__evidence-list">
            {actuation.evidence_ids.map((id) => (
              <li key={id} className="actuation-detail__evidence-item">
                {id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
