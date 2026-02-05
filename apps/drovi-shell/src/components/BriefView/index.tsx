import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  GitCommit,
  Loader2,
  RefreshCw,
  Shield,
  TrendingUp,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { useOrgId } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import { intelligenceEndpoints } from "../../api/endpoints/intelligence";
import type { BriefResponse } from "../../api/schemas";

type AttentionItemType = BriefResponse["attention_items"][number]["type"];

const ATTENTION_CONFIG: Record<
  AttentionItemType,
  { icon: typeof AlertTriangle; color: string; label: string }
> = {
  overdue_commitment: {
    icon: XCircle,
    color: "var(--color-risk)",
    label: "Overdue",
  },
  upcoming_commitment: {
    icon: Clock,
    color: "var(--color-contact)",
    label: "Upcoming",
  },
  contradiction: {
    icon: AlertTriangle,
    color: "var(--color-warning)",
    label: "Contradiction",
  },
  high_risk: {
    icon: Shield,
    color: "var(--color-risk)",
    label: "High Risk",
  },
  pending_decision: {
    icon: CheckCircle2,
    color: "var(--color-decision)",
    label: "Pending",
  },
};

export function BriefView() {
  const orgId = useOrgId();
  const { openEvidenceLens } = useUIStore();
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"today" | "last_7_days">("today");

  const fetchBrief = async () => {
    if (!orgId) {
      setError("Organization ID required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await intelligenceEndpoints.getBrief(orgId, period);
      setBrief(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch brief");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrief();
  }, [orgId, period]);

  if (!orgId) {
    return (
      <div className="brief-view brief-view--empty">
        <Shield size={48} style={{ opacity: 0.3 }} />
        <h3>Organization Required</h3>
        <p>Set an organization ID to view your brief</p>
      </div>
    );
  }

  return (
    <div className="brief-view">
      {/* Header */}
      <div className="brief-view__header">
        <div className="brief-view__header-left">
          <h2>Daily Brief</h2>
          <p className="brief-view__subtitle">
            {period === "today" ? "Today's" : "Last 7 days"} intelligence summary
          </p>
        </div>
        <div className="brief-view__header-actions">
          <div className="brief-view__period-toggle">
            <button
              className={`brief-view__period-btn ${period === "today" ? "active" : ""}`}
              onClick={() => setPeriod("today")}
            >
              Today
            </button>
            <button
              className={`brief-view__period-btn ${period === "last_7_days" ? "active" : ""}`}
              onClick={() => setPeriod("last_7_days")}
            >
              7 Days
            </button>
          </div>
          <button
            className="btn btn--ghost btn--icon"
            onClick={fetchBrief}
            disabled={loading}
            aria-label="Refresh brief"
          >
            <RefreshCw size={16} className={loading ? "spinning" : ""} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && !brief && (
        <div className="brief-view__loading">
          <Loader2 size={24} className="spinning" />
          <span>Loading your brief...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="brief-view__error">
          <AlertTriangle size={20} />
          <span>{error}</span>
          <button className="btn btn--secondary btn--sm" onClick={fetchBrief}>
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      {brief && !loading && (
        <motion.div
          className="brief-view__content"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Summary Cards */}
          <div className="brief-view__summary">
            <SummaryCard
              icon={GitCommit}
              label="Commitments"
              value={brief.summary.total_commitments}
              color="var(--color-commitment)"
              overdue={brief.summary.overdue_count}
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Decisions"
              value={brief.summary.total_decisions}
              color="var(--color-decision)"
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Risks"
              value={brief.summary.total_risks}
              color="var(--color-risk)"
            />
          </div>

          {/* Attention Items */}
          <div className="brief-view__attention">
            <div className="brief-view__section-header">
              <h3>Needs Attention</h3>
              <span className="brief-view__badge">{brief.attention_items.length}</span>
            </div>

            {brief.attention_items.length === 0 ? (
              <div className="brief-view__empty-attention">
                <TrendingUp size={32} style={{ opacity: 0.3 }} />
                <p>All clear! No items need immediate attention.</p>
              </div>
            ) : (
              <div className="brief-view__attention-list">
                {brief.attention_items.map((item) => (
                  <AttentionItem
                    key={item.id}
                    item={item}
                    onViewEvidence={(evidenceId) => openEvidenceLens(evidenceId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="brief-view__footer">
            <span className="brief-view__timestamp">
              Generated {formatTimestamp(brief.generated_at)}
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Summary Card Component
function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  overdue,
}: {
  icon: typeof GitCommit;
  label: string;
  value: number;
  color: string;
  overdue?: number;
}) {
  return (
    <div className="summary-card">
      <div className="summary-card__icon" style={{ backgroundColor: `${color}15`, color }}>
        <Icon size={20} />
      </div>
      <div className="summary-card__content">
        <span className="summary-card__value">{value}</span>
        <span className="summary-card__label">{label}</span>
      </div>
      {overdue !== undefined && overdue > 0 && (
        <div className="summary-card__overdue">
          <span>{overdue} overdue</span>
        </div>
      )}
    </div>
  );
}

// Attention Item Component
function AttentionItem({
  item,
  onViewEvidence,
}: {
  item: BriefResponse["attention_items"][number];
  onViewEvidence: (evidenceId: string) => void;
}) {
  const config = ATTENTION_CONFIG[item.type];
  const Icon = config.icon;

  return (
    <motion.div
      className="attention-item"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div
        className="attention-item__icon"
        style={{ backgroundColor: `${config.color}15`, color: config.color }}
      >
        <Icon size={16} />
      </div>
      <div className="attention-item__content">
        <div className="attention-item__header">
          <span className="attention-item__type">{config.label}</span>
          {item.confidence !== undefined && (
            <ConfidenceBadge confidence={item.confidence} />
          )}
        </div>
        <h4 className="attention-item__title">{item.title}</h4>
        <div className="attention-item__meta">
          {item.owner && <span>Owner: {item.owner}</span>}
          {item.counterparty && <span>With: {item.counterparty}</span>}
          {item.days_overdue !== undefined && item.days_overdue > 0 && (
            <span className="attention-item__overdue">
              {item.days_overdue} day{item.days_overdue !== 1 ? "s" : ""} overdue
            </span>
          )}
          {item.days_until_due !== undefined && item.days_until_due >= 0 && (
            <span className="attention-item__upcoming">
              Due in {item.days_until_due} day{item.days_until_due !== 1 ? "s" : ""}
            </span>
          )}
          {item.severity && (
            <span className={`attention-item__severity severity--${item.severity}`}>
              {item.severity}
            </span>
          )}
        </div>
      </div>
      {item.evidence_ids && item.evidence_ids.length > 0 && (
        <button
          className="attention-item__evidence-btn"
          onClick={() => onViewEvidence(item.evidence_ids![0])}
          aria-label="View evidence"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </motion.div>
  );
}

// Confidence Badge
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const percentage = Math.round(confidence * 100);
  return (
    <span className={`confidence-badge confidence-badge--${level}`}>
      {percentage}%
    </span>
  );
}

// Utility functions
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default BriefView;
