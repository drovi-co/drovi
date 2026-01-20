"use client";

import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  HelpCircle,
  Link2,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentData {
  id: string;
  title: string;
  description?: string;
  debtor: {
    email: string;
    name: string;
  };
  creditor?: {
    email: string;
    name: string;
  };
  dueDate?: Date;
  status: "pending" | "completed" | "overdue" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  confidence: number;
  evidence: EvidenceLink[];
  extractedFrom: string; // messageId
  reasoning?: string;
}

export interface DecisionData {
  id: string;
  title: string;
  statement: string;
  rationale?: string;
  maker: {
    email: string;
    name: string;
  };
  date: Date;
  category?: string;
  supersedes?: string;
  confidence: number;
  evidence: EvidenceLink[];
  extractedFrom: string;
  alternatives?: Array<{
    title: string;
    description: string;
    rejectionReason?: string;
  }>;
}

export interface OpenQuestionData {
  id: string;
  question: string;
  askedBy: {
    email: string;
    name: string;
  };
  askedAt: Date;
  context?: string;
  isAnswered: boolean;
  answeredBy?: {
    email: string;
    name: string;
  };
  answeredAt?: Date;
  confidence: number;
}

export interface RiskWarningData {
  id: string;
  type: "contradiction" | "sensitive_data" | "fraud" | "policy";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  recommendation: string;
  evidence: EvidenceLink[];
}

export interface EvidenceLink {
  id: string;
  type: "message" | "thread" | "attachment";
  title: string;
  snippet: string;
  messageId?: string;
  timestamp?: Date;
}

interface IntelligencePanelProps {
  threadId: string;
  commitments: CommitmentData[];
  decisions: DecisionData[];
  openQuestions: OpenQuestionData[];
  riskWarnings?: RiskWarningData[];
  isLoading?: boolean;
  onEvidenceClick?: (evidence: EvidenceLink) => void;
  onCommitmentAction?: (
    id: string,
    action: "complete" | "dismiss" | "edit"
  ) => void;
  onFeedback?: (
    type: "commitment" | "decision",
    id: string,
    positive: boolean
  ) => void;
  className?: string;
}

// =============================================================================
// INTELLIGENCE PANEL
// =============================================================================

export function IntelligencePanel({
  threadId,
  commitments,
  decisions,
  openQuestions,
  riskWarnings = [],
  isLoading = false,
  onEvidenceClick,
  onCommitmentAction,
  onFeedback,
  className,
}: IntelligencePanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["commitments", "decisions", "questions"])
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (isLoading) {
    return <IntelligencePanelSkeleton />;
  }

  const hasContent =
    commitments.length > 0 ||
    decisions.length > 0 ||
    openQuestions.length > 0 ||
    riskWarnings.length > 0;

  if (!hasContent) {
    return (
      <div className={cn("p-4", className)}>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            No intelligence extracted yet
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            AI analysis in progress...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <h3 className="font-semibold text-sm">Thread Intelligence</h3>
        </div>

        {/* Risk warnings (always visible when present) */}
        {riskWarnings.length > 0 && (
          <div className="space-y-2">
            {riskWarnings.map((warning) => (
              <RiskWarningCard
                key={warning.id}
                onEvidenceClick={onEvidenceClick}
                warning={warning}
              />
            ))}
          </div>
        )}

        {/* Commitments */}
        {commitments.length > 0 && (
          <IntelligenceSection
            color="blue"
            count={commitments.length}
            expanded={expandedSections.has("commitments")}
            icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
            onToggle={() => toggleSection("commitments")}
            title="Commitments"
          >
            <div className="space-y-2">
              {commitments.map((commitment) => (
                <CommitmentCard
                  commitment={commitment}
                  key={commitment.id}
                  onAction={onCommitmentAction}
                  onEvidenceClick={onEvidenceClick}
                  onFeedback={onFeedback}
                />
              ))}
            </div>
          </IntelligenceSection>
        )}

        {/* Decisions */}
        {decisions.length > 0 && (
          <IntelligenceSection
            color="purple"
            count={decisions.length}
            expanded={expandedSections.has("decisions")}
            icon={<BookOpen className="h-4 w-4 text-purple-500" />}
            onToggle={() => toggleSection("decisions")}
            title="Decisions"
          >
            <div className="space-y-2">
              {decisions.map((decision) => (
                <DecisionCard
                  decision={decision}
                  key={decision.id}
                  onEvidenceClick={onEvidenceClick}
                  onFeedback={onFeedback}
                />
              ))}
            </div>
          </IntelligenceSection>
        )}

        {/* Open questions */}
        {openQuestions.length > 0 && (
          <IntelligenceSection
            color="amber"
            count={openQuestions.filter((q) => !q.isAnswered).length}
            expanded={expandedSections.has("questions")}
            icon={<HelpCircle className="h-4 w-4 text-amber-500" />}
            onToggle={() => toggleSection("questions")}
            title="Open Questions"
          >
            <div className="space-y-2">
              {openQuestions.map((question) => (
                <QuestionCard key={question.id} question={question} />
              ))}
            </div>
          </IntelligenceSection>
        )}
      </div>
    </ScrollArea>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function IntelligenceSection({
  title,
  icon,
  count,
  expanded,
  onToggle,
  color,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  color: "blue" | "purple" | "amber" | "red";
  children: React.ReactNode;
}) {
  const colors = {
    blue: "bg-blue-500/10 border-blue-500/20",
    purple: "bg-purple-500/10 border-purple-500/20",
    amber: "bg-amber-500/10 border-amber-500/20",
    red: "bg-red-500/10 border-red-500/20",
  };

  return (
    <Collapsible onOpenChange={onToggle} open={expanded}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border p-2 transition-colors",
            colors[color],
            "hover:bg-accent"
          )}
          type="button"
        >
          {icon}
          <span className="font-medium text-sm">{title}</span>
          <Badge className="ml-auto text-[10px]" variant="secondary">
            {count}
          </Badge>
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <AnimatePresence>
          <motion.div
            animate={{ opacity: 1, height: "auto" }}
            className="pt-2"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CommitmentCard({
  commitment,
  onEvidenceClick,
  onAction,
  onFeedback,
}: {
  commitment: CommitmentData;
  onEvidenceClick?: (evidence: EvidenceLink) => void;
  onAction?: (id: string, action: "complete" | "dismiss" | "edit") => void;
  onFeedback?: (
    type: "commitment" | "decision",
    id: string,
    positive: boolean
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    pending: { color: "bg-blue-500", label: "Pending" },
    completed: { color: "bg-green-500", label: "Completed" },
    overdue: { color: "bg-red-500", label: "Overdue" },
    cancelled: { color: "bg-gray-500", label: "Cancelled" },
  };

  const status = statusConfig[commitment.status];
  const isOverdue =
    commitment.dueDate &&
    commitment.dueDate < new Date() &&
    commitment.status === "pending";

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3",
        isOverdue && "border-red-500/50"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", status.color)}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{commitment.title}</p>
          {commitment.description && (
            <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
              {commitment.description}
            </p>
          )}
        </div>
        <ConfidenceIndicator confidence={commitment.confidence} />
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {commitment.debtor.name}
        </span>
        {commitment.dueDate && (
          <span
            className={cn(
              "flex items-center gap-1",
              isOverdue && "text-red-500"
            )}
          >
            <Calendar className="h-3 w-3" />
            {isOverdue ? "Overdue: " : "Due: "}
            {formatDistanceToNow(commitment.dueDate, { addSuffix: true })}
          </span>
        )}
        <PriorityBadge priority={commitment.priority} />
      </div>

      {/* Evidence */}
      {commitment.evidence.length > 0 && (
        <div className="flex items-center gap-1 pt-1">
          <Link2 className="h-3 w-3 text-muted-foreground" />
          {commitment.evidence.slice(0, 2).map((ev) => (
            <button
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted/80"
              key={ev.id}
              onClick={() => onEvidenceClick?.(ev)}
              type="button"
            >
              {ev.title}
            </button>
          ))}
          {commitment.evidence.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{commitment.evidence.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-6 w-6"
                  onClick={() =>
                    onFeedback?.("commitment", commitment.id, true)
                  }
                  size="icon"
                  variant="ghost"
                >
                  <ThumbsUp className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Correct extraction</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-6 w-6"
                  onClick={() =>
                    onFeedback?.("commitment", commitment.id, false)
                  }
                  size="icon"
                  variant="ghost"
                >
                  <ThumbsDown className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Incorrect extraction</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-1">
          {commitment.status === "pending" && (
            <Button
              className="h-6 text-xs"
              onClick={() => onAction?.(commitment.id, "complete")}
              size="sm"
              variant="ghost"
            >
              <Check className="mr-1 h-3 w-3" />
              Complete
            </Button>
          )}
          <Button
            className="h-6 w-6"
            onClick={() => onAction?.(commitment.id, "edit")}
            size="icon"
            variant="ghost"
          >
            <Edit3 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  onEvidenceClick,
  onFeedback,
}: {
  decision: DecisionData;
  onEvidenceClick?: (evidence: EvidenceLink) => void;
  onFeedback?: (
    type: "commitment" | "decision",
    id: string,
    positive: boolean
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{decision.title}</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {decision.statement}
          </p>
        </div>
        <ConfidenceIndicator confidence={decision.confidence} />
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {decision.maker.name}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDistanceToNow(decision.date, { addSuffix: true })}
        </span>
        {decision.category && (
          <Badge className="text-[10px]" variant="outline">
            {decision.category}
          </Badge>
        )}
      </div>

      {/* Rationale (expandable) */}
      {decision.rationale && (
        <Collapsible onOpenChange={setExpanded} open={expanded}>
          <CollapsibleTrigger asChild>
            <button
              className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              type="button"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              View rationale
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-1 rounded bg-muted/50 p-2 text-muted-foreground text-xs">
              {decision.rationale}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Evidence */}
      {decision.evidence.length > 0 && (
        <div className="flex items-center gap-1 pt-1">
          <Link2 className="h-3 w-3 text-muted-foreground" />
          {decision.evidence.slice(0, 2).map((ev) => (
            <button
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted/80"
              key={ev.id}
              onClick={() => onEvidenceClick?.(ev)}
              type="button"
            >
              {ev.title}
            </button>
          ))}
        </div>
      )}

      {/* Feedback */}
      <div className="flex items-center gap-1 pt-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-6 w-6"
                onClick={() => onFeedback?.("decision", decision.id, true)}
                size="icon"
                variant="ghost"
              >
                <ThumbsUp className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Correct extraction</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-6 w-6"
                onClick={() => onFeedback?.("decision", decision.id, false)}
                size="icon"
                variant="ghost"
              >
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Incorrect extraction</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function QuestionCard({ question }: { question: OpenQuestionData }) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3",
        question.isAnswered && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <HelpCircle
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            question.isAnswered ? "text-green-500" : "text-amber-500"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm">{question.question}</p>
          <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {question.askedBy.name}
            </span>
            <span>•</span>
            <span>
              {formatDistanceToNow(question.askedAt, { addSuffix: true })}
            </span>
          </div>
        </div>
        <ConfidenceIndicator confidence={question.confidence} />
      </div>

      {question.isAnswered && question.answeredBy && (
        <div className="flex items-center gap-1 text-green-600 text-xs">
          <Check className="h-3 w-3" />
          Answered by {question.answeredBy.name}
        </div>
      )}
    </div>
  );
}

function RiskWarningCard({
  warning,
  onEvidenceClick,
}: {
  warning: RiskWarningData;
  onEvidenceClick?: (evidence: EvidenceLink) => void;
}) {
  const severityConfig = {
    low: {
      color: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
      icon: AlertCircle,
    },
    medium: {
      color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
      icon: AlertTriangle,
    },
    high: {
      color: "text-orange-600 bg-orange-500/10 border-orange-500/30",
      icon: AlertTriangle,
    },
    critical: {
      color: "text-red-600 bg-red-500/10 border-red-500/30",
      icon: ShieldAlert,
    },
  };

  const severity = severityConfig[warning.severity];
  const Icon = severity.icon;

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", severity.color)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{warning.title}</p>
          <p className="mt-0.5 text-xs opacity-90">{warning.description}</p>
        </div>
        <Badge
          className={cn("shrink-0 text-[10px]", severity.color)}
          variant="outline"
        >
          {warning.severity}
        </Badge>
      </div>

      <div className="pl-6 text-xs">
        <span className="font-medium">Recommendation:</span>{" "}
        {warning.recommendation}
      </div>
    </div>
  );
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const level =
    confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const config = {
    high: { color: "bg-green-500", label: "High confidence" },
    medium: { color: "bg-amber-500", label: "Medium confidence" },
    low: { color: "bg-red-500", label: "Low confidence" },
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-0.5">
            {[0.33, 0.66, 1].map((threshold, i) => (
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  confidence >= threshold ? config[level].color : "bg-muted"
                )}
                key={threshold}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {config[level].label} ({Math.round(confidence * 100)}%)
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PriorityBadge({
  priority,
}: {
  priority: "low" | "medium" | "high" | "urgent";
}) {
  const config = {
    low: { color: "text-muted-foreground", label: "Low" },
    medium: { color: "text-blue-500", label: "Medium" },
    high: { color: "text-amber-500", label: "High" },
    urgent: { color: "text-red-500", label: "Urgent" },
  };

  if (priority === "low" || priority === "medium") return null;

  return (
    <span className={cn("font-medium text-[10px]", config[priority].color)}>
      {config[priority].label}
    </span>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function IntelligencePanelSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-32" />
      </div>
      {[1, 2, 3].map((i) => (
        <div className="space-y-2" key={i}>
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
