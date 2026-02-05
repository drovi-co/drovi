import { GitCommit, Calendar, ArrowRight, ArrowLeft, Clock } from "lucide-react";
import { ResultCard } from "./ResultCard";
import type { Commitment } from "../../api/schemas";
import { formatDistanceToNow, format, isPast, parseISO } from "date-fns";

interface CommitmentResultProps {
  commitment: Commitment;
  onClick?: () => void;
  onOpenEvidence?: () => void;
}

export function CommitmentResult({
  commitment,
  onClick,
  onOpenEvidence,
}: CommitmentResultProps) {
  const directionIcon =
    commitment.direction === "owed_by_me" ? (
      <ArrowRight size={12} />
    ) : (
      <ArrowLeft size={12} />
    );

  const directionLabel =
    commitment.direction === "owed_by_me" ? "You committed" : "Committed to you";

  const dueDate = commitment.due_date ? parseISO(commitment.due_date) : null;
  const isOverdue = dueDate && isPast(dueDate);

  return (
    <ResultCard
      type="commitment"
      icon={<GitCommit size={16} />}
      title={commitment.title}
      subtitle={commitment.description}
      confidence={commitment.confidence}
      onClick={onClick}
      onOpenEvidence={onOpenEvidence}
    >
      <div className="commitment-details">
        <div className="commitment-details__row">
          <span
            className={`commitment-direction commitment-direction--${commitment.direction}`}
          >
            {directionIcon}
            <span>{directionLabel}</span>
          </span>
        </div>

        {dueDate && (
          <div className="commitment-details__row">
            <span className={`commitment-due ${isOverdue ? "commitment-due--overdue" : ""}`}>
              <Calendar size={12} />
              <span>Due {format(dueDate, "MMM d, yyyy")}</span>
              {isOverdue ? (
                <span className="commitment-due__badge commitment-due__badge--overdue">
                  Overdue
                </span>
              ) : (
                <span className="commitment-due__badge">
                  {formatDistanceToNow(dueDate, { addSuffix: true })}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="commitment-details__row commitment-details__row--status">
          <span
            className={`commitment-status commitment-status--${commitment.status}`}
          >
            <Clock size={12} />
            <span>{commitment.status.replace(/_/g, " ")}</span>
          </span>
        </div>
      </div>
    </ResultCard>
  );
}
