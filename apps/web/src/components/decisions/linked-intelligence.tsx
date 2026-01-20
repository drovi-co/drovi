// =============================================================================
// LINKED INTELLIGENCE
// =============================================================================
//
// Shows the connections between decisions and commitments. When a decision is
// made, commitments often follow. This component surfaces those relationships
// to provide full context.
//

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Check,
  ChevronRight,
  Clock,
  GitBranch,
  Lightbulb,
  Link2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { ConfidenceBadge } from "@/components/evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface LinkedCommitment {
  id: string;
  title: string;
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  confidence: number;
  isUserVerified?: boolean;
}

interface LinkedDecision {
  id: string;
  title: string;
  statement: string;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
}

// =============================================================================
// LINKED COMMITMENTS (Show in Decision Detail)
// =============================================================================

interface LinkedCommitmentsProps {
  /** Source thread ID to find related commitments */
  sourceThreadId: string;
  /** Organization ID */
  organizationId: string;
  /** Decision ID (to exclude from results if needed) */
  decisionId: string;
  /** Callback when a commitment is clicked */
  onCommitmentClick: (commitmentId: string) => void;
  /** Optional class name */
  className?: string;
}

/**
 * Shows commitments that are linked to a decision through the same source thread.
 * "This decision led to these commitments..."
 */
export function LinkedCommitments({
  sourceThreadId,
  organizationId,
  decisionId,
  onCommitmentClick,
  className,
}: LinkedCommitmentsProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const trpc = useTRPC();

  // Fetch commitments from the same source thread
  const { data, isLoading } = useQuery({
    ...trpc.commitments.list.queryOptions({
      organizationId,
      limit: 10,
    }),
    select: (data) => ({
      ...data,
      // Filter to commitments from the same thread
      commitments: data.commitments.filter(
        (c) => c.sourceThreadId === sourceThreadId
      ),
    }),
    enabled: Boolean(sourceThreadId && organizationId),
  });

  const commitments = data?.commitments ?? [];

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground text-xs">
          Finding related commitments...
        </span>
      </div>
    );
  }

  if (commitments.length === 0) {
    return null;
  }

  return (
    <Collapsible
      className={className}
      onOpenChange={setIsExpanded}
      open={isExpanded}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="h-auto w-full justify-between px-3 py-2"
          size="sm"
          variant="ghost"
        >
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-blue-500" />
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Related Commitments
            </span>
            <Badge className="text-[10px]" variant="secondary">
              {commitments.length}
            </Badge>
          </div>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-1 pt-2">
          {commitments.map((commitment) => (
            <LinkedCommitmentCard
              commitment={{
                id: commitment.id,
                title: commitment.title,
                status: commitment.status,
                priority: commitment.priority,
                direction: commitment.direction,
                dueDate: commitment.dueDate
                  ? new Date(commitment.dueDate)
                  : null,
                confidence: commitment.confidence,
                isUserVerified: commitment.isUserVerified ?? false,
              }}
              key={commitment.id}
              onClick={() => onCommitmentClick(commitment.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// LINKED COMMITMENT CARD
// =============================================================================

interface LinkedCommitmentCardProps {
  commitment: LinkedCommitment;
  onClick: () => void;
}

function LinkedCommitmentCard({
  commitment,
  onClick,
}: LinkedCommitmentCardProps) {
  const isOverdue =
    commitment.dueDate &&
    new Date(commitment.dueDate) < new Date() &&
    !["completed", "cancelled"].includes(commitment.status);

  return (
    <button
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-all",
        "hover:border-blue-500/50 hover:bg-accent/50"
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              commitment.status === "completed"
                ? "bg-green-500/10"
                : isOverdue
                  ? "bg-red-500/10"
                  : "bg-blue-500/10"
            )}
          >
            {commitment.status === "completed" ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Clock
                className={cn(
                  "h-3 w-3",
                  isOverdue ? "text-red-500" : "text-blue-500"
                )}
              />
            )}
          </div>
          <span className="truncate text-sm">{commitment.title}</span>
        </div>
        <ConfidenceBadge
          confidence={commitment.confidence}
          isUserVerified={commitment.isUserVerified}
          showDetails={false}
          size="sm"
        />
      </div>

      <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5",
            commitment.direction === "owed_by_me"
              ? "bg-blue-500/10 text-blue-600"
              : "bg-purple-500/10 text-purple-600"
          )}
        >
          {commitment.direction === "owed_by_me" ? "I owe" : "Owed to me"}
        </span>
        {commitment.dueDate && (
          <span className={cn(isOverdue && "font-medium text-red-600")}>
            {isOverdue ? "Overdue: " : "Due: "}
            {format(new Date(commitment.dueDate), "MMM d")}
          </span>
        )}
        <Badge className="text-[10px]" variant="outline">
          {commitment.status.replace("_", " ")}
        </Badge>
      </div>
    </button>
  );
}

// =============================================================================
// LINKED DECISIONS (Show in Commitment Detail)
// =============================================================================

interface LinkedDecisionsProps {
  /** Source thread ID to find related decisions */
  sourceThreadId: string;
  /** Organization ID */
  organizationId: string;
  /** Commitment ID (to exclude from results if needed) */
  commitmentId: string;
  /** Callback when a decision is clicked */
  onDecisionClick: (decisionId: string) => void;
  /** Optional class name */
  className?: string;
}

/**
 * Shows decisions that are linked to a commitment through the same source thread.
 * "This commitment came from this decision..."
 */
export function LinkedDecisions({
  sourceThreadId,
  organizationId,
  commitmentId,
  onDecisionClick,
  className,
}: LinkedDecisionsProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const trpc = useTRPC();

  // Fetch decisions from the same source thread
  const { data, isLoading } = useQuery({
    ...trpc.decisions.list.queryOptions({
      organizationId,
      limit: 10,
    }),
    select: (data) => ({
      ...data,
      // Filter to decisions from the same thread
      decisions: data.decisions.filter(
        (d) => d.sourceThreadId === sourceThreadId
      ),
    }),
    enabled: Boolean(sourceThreadId && organizationId),
  });

  const decisions = data?.decisions ?? [];

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground text-xs">
          Finding related decisions...
        </span>
      </div>
    );
  }

  if (decisions.length === 0) {
    return null;
  }

  return (
    <Collapsible
      className={className}
      onOpenChange={setIsExpanded}
      open={isExpanded}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="h-auto w-full justify-between px-3 py-2"
          size="sm"
          variant="ghost"
        >
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-purple-500" />
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Related Decisions
            </span>
            <Badge className="text-[10px]" variant="secondary">
              {decisions.length}
            </Badge>
          </div>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-1 pt-2">
          {decisions.map((decision) => (
            <LinkedDecisionCard
              decision={{
                id: decision.id,
                title: decision.title,
                statement: decision.statement,
                decidedAt: new Date(decision.decidedAt),
                confidence: decision.confidence,
                isUserVerified: decision.isUserVerified ?? false,
                isSuperseded: Boolean(decision.supersededById),
              }}
              key={decision.id}
              onClick={() => onDecisionClick(decision.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// LINKED DECISION CARD
// =============================================================================

interface LinkedDecisionCardProps {
  decision: LinkedDecision;
  onClick: () => void;
}

function LinkedDecisionCard({ decision, onClick }: LinkedDecisionCardProps) {
  return (
    <button
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-all",
        "hover:border-purple-500/50 hover:bg-accent/50",
        decision.isSuperseded && "opacity-60"
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
          <span
            className={cn(
              "truncate text-sm",
              decision.isSuperseded && "line-through"
            )}
          >
            {decision.title}
          </span>
          {decision.isSuperseded && (
            <Badge className="shrink-0 text-[10px]" variant="outline">
              <GitBranch className="mr-1 h-2.5 w-2.5" />
              Superseded
            </Badge>
          )}
        </div>
        <ConfidenceBadge
          confidence={decision.confidence}
          isUserVerified={decision.isUserVerified}
          showDetails={false}
          size="sm"
        />
      </div>

      <p className="mt-2 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
        {decision.statement}
      </p>

      <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
        <Clock className="h-3 w-3" />
        <span>{format(decision.decidedAt, "MMM d, yyyy")}</span>
      </div>
    </button>
  );
}

export default LinkedCommitments;
