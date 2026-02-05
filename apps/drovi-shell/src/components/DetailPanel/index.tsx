import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ExternalLink,
  Clock,
  User,
  Calendar,
  GitCommit,
  CheckCircle2,
  FileText,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Shield,
  ArrowUpRight,
  Flag,
} from "lucide-react";
import { useUIStore, useDetailPanel } from "../../store/uiStore";
import type { UIODetail, EvidenceRef } from "../../api/schemas";

const TYPE_CONFIG: Record<
  string,
  { icon: typeof GitCommit; color: string; label: string }
> = {
  commitment: {
    icon: GitCommit,
    color: "var(--color-commitment)",
    label: "Commitment",
  },
  decision: {
    icon: CheckCircle2,
    color: "var(--color-decision)",
    label: "Decision",
  },
  task: {
    icon: FileText,
    color: "var(--color-task)",
    label: "Task",
  },
  risk: {
    icon: AlertTriangle,
    color: "var(--color-risk)",
    label: "Risk",
  },
  contact: {
    icon: User,
    color: "var(--color-contact)",
    label: "Contact",
  },
  claim: {
    icon: BookOpen,
    color: "var(--color-text-secondary)",
    label: "Claim",
  },
};

export function DetailPanel() {
  const { isOpen, uio } = useDetailPanel();
  const { closeDetailPanel, openEvidenceLens } = useUIStore();

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeDetailPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeDetailPanel]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeDetailPanel();
      }
    },
    [closeDetailPanel]
  );

  const config = uio ? TYPE_CONFIG[uio.type] || TYPE_CONFIG.claim : TYPE_CONFIG.claim;
  const Icon = config.icon;

  return (
    <AnimatePresence>
      {isOpen && uio && (
        <>
          {/* Overlay */}
          <motion.div
            className="detail-panel__overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleOverlayClick}
          />

          {/* Panel */}
          <motion.div
            className="detail-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="detail-panel__header">
              <div className="detail-panel__header-row">
                <div
                  className="detail-panel__type-badge"
                  style={{
                    backgroundColor: `${config.color}15`,
                    color: config.color,
                  }}
                >
                  <Icon size={14} />
                  <span>{config.label}</span>
                </div>
                <button
                  className="btn btn--ghost btn--icon"
                  onClick={closeDetailPanel}
                  aria-label="Close panel"
                >
                  <X size={18} />
                </button>
              </div>
              <h2 className="detail-panel__title">{uio.title}</h2>
              {uio.confidence !== undefined && (
                <ConfidenceMeter confidence={uio.confidence} />
              )}
            </div>

            {/* Body */}
            <div className="detail-panel__body">
              {/* Description */}
              {uio.description && (
                <Section title="Description">
                  <p className="detail-panel__summary">{uio.description}</p>
                </Section>
              )}

              {/* Status and Basic Info */}
              <Section title="Status">
                <div className="detail-panel__details-grid">
                  <DetailRow
                    icon={Flag}
                    label="Status"
                    value={formatStatus(uio.status)}
                  />
                  {uio.owner_id && (
                    <DetailRow icon={User} label="Owner" value={uio.owner_id} />
                  )}
                  {uio.valid_from && (
                    <DetailRow
                      icon={Calendar}
                      label="Valid From"
                      value={formatDate(uio.valid_from)}
                    />
                  )}
                  {uio.valid_to && (
                    <DetailRow
                      icon={Calendar}
                      label="Valid To"
                      value={formatDate(uio.valid_to)}
                      highlight={isOverdue(uio.valid_to)}
                    />
                  )}
                </div>
              </Section>

              {/* Reasoning if available */}
              {uio.reasoning && (
                <Section title="AI Reasoning">
                  <div className="detail-panel__reasoning">
                    <Shield size={14} />
                    <p>{uio.reasoning}</p>
                  </div>
                </Section>
              )}

              {/* Metadata Section */}
              {uio.metadata && Object.keys(uio.metadata).length > 0 && (
                <Section title="Additional Details">
                  <div className="detail-panel__metadata-grid">
                    {Object.entries(uio.metadata).map(([key, value]) => (
                      <div key={key} className="detail-panel__metadata-row">
                        <span className="detail-panel__metadata-key">{formatKey(key)}</span>
                        <span className="detail-panel__metadata-value">
                          {formatMetadataValue(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Evidence Section */}
              {uio.evidence && uio.evidence.length > 0 && (
                <Section title="Evidence">
                  <div className="evidence-section__list">
                    {uio.evidence.map((evidence) => (
                      <EvidenceItem
                        key={evidence.id}
                        evidence={evidence}
                        onView={() => openEvidenceLens(evidence.id)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Related UIOs */}
              {uio.related_uios && uio.related_uios.length > 0 && (
                <Section title="Related">
                  <div className="detail-panel__related">
                    {uio.related_uios.map((relatedId) => (
                      <button
                        key={relatedId}
                        className="detail-panel__related-item"
                        onClick={() => {
                          console.log("Navigate to:", relatedId);
                        }}
                      >
                        <BookOpen size={14} />
                        <span>{relatedId}</span>
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {/* Timestamps */}
              <Section title="Timeline">
                <div className="detail-panel__metadata">
                  <div className="detail-panel__metadata-item">
                    <Clock size={14} />
                    <span>Created {formatTimestamp(uio.created_at)}</span>
                  </div>
                  {uio.updated_at && uio.updated_at !== uio.created_at && (
                    <div className="detail-panel__metadata-item">
                      <Clock size={14} />
                      <span>Updated {formatTimestamp(uio.updated_at)}</span>
                    </div>
                  )}
                </div>
              </Section>
            </div>

            {/* Footer Actions */}
            <div className="detail-panel__footer">
              <button className="btn btn--secondary">
                <ExternalLink size={14} />
                <span>View Source</span>
              </button>
              <button className="btn btn--primary">
                <span>Take Action</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Section wrapper component
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="detail-panel__section">
      <h3 className="detail-panel__section-title">{title}</h3>
      {children}
    </div>
  );
}

// Confidence meter component
function ConfidenceMeter({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const percentage = Math.round(confidence * 100);

  return (
    <div className="confidence-meter">
      <Shield size={14} style={{ color: `var(--color-confidence-${level})` }} />
      <div className="confidence-meter__bar">
        <div
          className={`confidence-meter__fill confidence-meter__fill--${level}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="confidence-meter__label">{percentage}%</span>
    </div>
  );
}

// Evidence item component
function EvidenceItem({
  evidence,
  onView,
}: {
  evidence: EvidenceRef;
  onView: () => void;
}) {
  return (
    <button className="evidence-item" onClick={onView}>
      <div className="evidence-item__icon">
        <BookOpen size={14} />
      </div>
      <div className="evidence-item__content">
        {evidence.snippet && (
          <span className="evidence-item__snippet">{evidence.snippet}</span>
        )}
        <div className="evidence-item__meta">
          <span>{formatSourceType(evidence.source_type)}</span>
        </div>
      </div>
      <ChevronRight size={14} className="evidence-item__arrow" />
    </button>
  );
}

// Detail row component
function DetailRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof User;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`detail-panel__detail-row ${highlight ? "highlight" : ""}`}>
      <Icon size={14} />
      <span className="detail-panel__detail-label">{label}</span>
      <span className="detail-panel__detail-value">{value}</span>
    </div>
  );
}

// Utility functions
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(dateString: string): boolean {
  return new Date(dateString) < new Date();
}

function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSourceType(sourceType: string): string {
  const labels: Record<string, string> = {
    email: "Email",
    slack: "Slack",
    notion: "Notion",
    google_docs: "Google Docs",
    whatsapp: "WhatsApp",
    calendar: "Calendar",
    meeting: "Meeting",
    call: "Call",
    recording: "Recording",
    transcript: "Transcript",
    api: "API",
    manual: "Manual",
  };
  return labels[sourceType] || sourceType;
}

function formatKey(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

export default DetailPanel;
