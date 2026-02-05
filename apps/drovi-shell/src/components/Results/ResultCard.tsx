import { motion } from "framer-motion";
import { ExternalLink, MoreVertical } from "lucide-react";
import type { ReactNode } from "react";

interface ResultCardProps {
  type: "commitment" | "decision" | "task" | "risk" | "contact";
  icon: ReactNode;
  title: string;
  subtitle?: string;
  confidence: number;
  children?: ReactNode;
  onClick?: () => void;
  onOpenEvidence?: () => void;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  commitment: {
    bg: "var(--color-commitment-bg)",
    text: "var(--color-commitment)",
    border: "var(--color-commitment)",
  },
  decision: {
    bg: "var(--color-decision-bg)",
    text: "var(--color-decision)",
    border: "var(--color-decision)",
  },
  task: {
    bg: "var(--color-task-bg)",
    text: "var(--color-task)",
    border: "var(--color-task)",
  },
  risk: {
    bg: "var(--color-risk-bg)",
    text: "var(--color-risk)",
    border: "var(--color-risk)",
  },
  contact: {
    bg: "var(--color-contact-bg)",
    text: "var(--color-contact)",
    border: "var(--color-contact)",
  },
};

export function ResultCard({
  type,
  icon,
  title,
  subtitle,
  confidence,
  children,
  onClick,
  onOpenEvidence,
}: ResultCardProps) {
  const colors = TYPE_COLORS[type];
  const confidenceLevel =
    confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";

  return (
    <motion.div
      className="result-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div className="result-card__header">
        <div
          className="result-card__icon"
          style={{ backgroundColor: colors.bg, color: colors.text }}
        >
          {icon}
        </div>
        <div className="result-card__title-section">
          <h3 className="result-card__title">{title}</h3>
          {subtitle && <p className="result-card__subtitle">{subtitle}</p>}
        </div>
        <div className="result-card__actions">
          <div
            className={`result-card__confidence result-card__confidence--${confidenceLevel}`}
          >
            {Math.round(confidence * 100)}%
          </div>
          {onOpenEvidence && (
            <button
              className="result-card__evidence-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenEvidence();
              }}
              aria-label="View evidence"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button className="result-card__menu-btn" aria-label="More options">
            <MoreVertical size={14} />
          </button>
        </div>
      </div>
      {children && <div className="result-card__body">{children}</div>}
    </motion.div>
  );
}
