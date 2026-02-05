import { CheckCircle2, User, Calendar, ListTree } from "lucide-react";
import { ResultCard } from "./ResultCard";
import type { Decision } from "../../api/schemas";
import { format, parseISO } from "date-fns";

interface DecisionResultProps {
  decision: Decision;
  onClick?: () => void;
  onOpenEvidence?: () => void;
}

export function DecisionResult({
  decision,
  onClick,
  onOpenEvidence,
}: DecisionResultProps) {
  const decidedAt = decision.decided_at ? parseISO(decision.decided_at) : null;

  return (
    <ResultCard
      type="decision"
      icon={<CheckCircle2 size={16} />}
      title={decision.title}
      subtitle={decision.description}
      confidence={decision.confidence}
      onClick={onClick}
      onOpenEvidence={onOpenEvidence}
    >
      <div className="decision-details">
        {decision.decision_maker_id && (
          <div className="decision-details__row">
            <span className="decision-maker">
              <User size={12} />
              <span>Decision by {decision.decision_maker_id}</span>
            </span>
          </div>
        )}

        {decidedAt && (
          <div className="decision-details__row">
            <span className="decision-date">
              <Calendar size={12} />
              <span>Decided on {format(decidedAt, "MMM d, yyyy")}</span>
            </span>
          </div>
        )}

        {decision.alternatives && decision.alternatives.length > 0 && (
          <div className="decision-details__alternatives">
            <span className="decision-alternatives__label">
              <ListTree size={12} />
              <span>Alternatives considered:</span>
            </span>
            <ul className="decision-alternatives__list">
              {decision.alternatives.map((alt, index) => (
                <li key={index} className="decision-alternatives__item">
                  {alt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {decision.supersedes_id && (
          <div className="decision-details__row">
            <span className="decision-supersedes">
              <span>Supersedes previous decision</span>
            </span>
          </div>
        )}

        <div className="decision-details__row decision-details__row--status">
          <span className={`decision-status decision-status--${decision.status}`}>
            {decision.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </ResultCard>
  );
}
