import { AlertTriangle, Shield, Lightbulb } from "lucide-react";
import { ResultCard } from "./ResultCard";
import type { Risk } from "../../api/schemas";

interface RiskResultProps {
  risk: Risk;
  onClick?: () => void;
  onOpenEvidence?: () => void;
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: "rgba(239, 68, 68, 0.2)", text: "var(--color-risk)" },
  high: { bg: "rgba(249, 115, 22, 0.2)", text: "#f97316" },
  medium: { bg: "rgba(251, 191, 36, 0.2)", text: "var(--color-warning)" },
  low: { bg: "rgba(107, 114, 128, 0.2)", text: "var(--color-text-muted)" },
};

const MITIGATION_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  mitigating: "Mitigating",
  mitigated: "Mitigated",
  accepted: "Accepted",
};

export function RiskResult({ risk, onClick, onOpenEvidence }: RiskResultProps) {
  const severityColors = risk.severity
    ? SEVERITY_COLORS[risk.severity]
    : SEVERITY_COLORS.medium;

  return (
    <ResultCard
      type="risk"
      icon={<AlertTriangle size={16} />}
      title={risk.title}
      subtitle={risk.description}
      confidence={risk.confidence}
      onClick={onClick}
      onOpenEvidence={onOpenEvidence}
    >
      <div className="risk-details">
        {risk.severity && (
          <div className="risk-details__row">
            <span
              className="risk-severity"
              style={{
                backgroundColor: severityColors.bg,
                color: severityColors.text,
              }}
            >
              <AlertTriangle size={12} />
              <span>{risk.severity.charAt(0).toUpperCase() + risk.severity.slice(1)} Severity</span>
            </span>
          </div>
        )}

        {/* Severity Bar */}
        <div className="risk-severity-bar">
          <div className="risk-severity-bar__track">
            <div
              className="risk-severity-bar__fill"
              style={{
                width: `${
                  risk.severity === "critical"
                    ? 100
                    : risk.severity === "high"
                    ? 75
                    : risk.severity === "medium"
                    ? 50
                    : 25
                }%`,
                backgroundColor: severityColors.text,
              }}
            />
          </div>
        </div>

        {risk.suggested_action && (
          <div className="risk-details__suggestion">
            <Lightbulb size={12} />
            <span>{risk.suggested_action}</span>
          </div>
        )}

        {risk.mitigation_status && (
          <div className="risk-details__row risk-details__row--status">
            <span
              className={`risk-mitigation risk-mitigation--${risk.mitigation_status}`}
            >
              <Shield size={12} />
              <span>{MITIGATION_STATUS_LABELS[risk.mitigation_status]}</span>
            </span>
          </div>
        )}
      </div>
    </ResultCard>
  );
}
