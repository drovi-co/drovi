import { FileText, User, Calendar, Flag } from "lucide-react";
import { ResultCard } from "./ResultCard";
import type { Task } from "../../api/schemas";
import { format, parseISO, formatDistanceToNow, isPast } from "date-fns";

interface TaskResultProps {
  task: Task;
  onClick?: () => void;
  onOpenEvidence?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "var(--color-risk)",
  high: "var(--color-warning)",
  medium: "var(--color-text-secondary)",
  low: "var(--color-text-muted)",
};

export function TaskResult({ task, onClick, onOpenEvidence }: TaskResultProps) {
  const dueDate = task.due_date ? parseISO(task.due_date) : null;
  const isOverdue = dueDate && isPast(dueDate);
  const priorityColor = task.priority
    ? PRIORITY_COLORS[task.priority]
    : "var(--color-text-muted)";

  return (
    <ResultCard
      type="task"
      icon={<FileText size={16} />}
      title={task.title}
      subtitle={task.description}
      confidence={task.confidence}
      onClick={onClick}
      onOpenEvidence={onOpenEvidence}
    >
      <div className="task-details">
        <div className="task-details__row">
          {task.priority && (
            <span
              className={`task-priority task-priority--${task.priority}`}
              style={{ color: priorityColor }}
            >
              <Flag size={12} />
              <span>{task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>
            </span>
          )}

          {task.assignee_id && (
            <span className="task-assignee">
              <User size={12} />
              <span>{task.assignee_id}</span>
            </span>
          )}
        </div>

        {dueDate && (
          <div className="task-details__row">
            <span className={`task-due ${isOverdue ? "task-due--overdue" : ""}`}>
              <Calendar size={12} />
              <span>Due {format(dueDate, "MMM d, yyyy")}</span>
              {isOverdue ? (
                <span className="task-due__badge task-due__badge--overdue">
                  Overdue
                </span>
              ) : (
                <span className="task-due__badge">
                  {formatDistanceToNow(dueDate, { addSuffix: true })}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="task-details__row task-details__row--status">
          <span className={`task-status task-status--${task.status}`}>
            {task.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </ResultCard>
  );
}
