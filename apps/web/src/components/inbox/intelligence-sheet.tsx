"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CircleDot,
  HelpCircle,
  Lightbulb,
  User2,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EvidenceChain,
  type EvidenceSource,
} from "@/components/unified-object/evidence-chain";
import {
  type SourceBreadcrumb,
  SourceBreadcrumbs,
} from "@/components/unified-object/source-breadcrumbs";
import {
  Timeline,
  type TimelineEvent,
} from "@/components/unified-object/timeline";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

/**
 * Intelligence Sheet - displays detailed thread intelligence
 *
 * Shows:
 * - Commitments (promises made)
 * - Decisions (decisions recorded)
 * - Open questions (unanswered questions)
 * - Risk warnings (if any)
 */

interface IntelligenceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string | null;
  title?: string;
}

// Confidence indicator colors
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8)
    return "bg-green-500/20 text-green-400 border-green-500/30";
  if (confidence >= 0.6)
    return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (confidence >= 0.4)
    return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  return (
    <Badge
      className={cn("px-1.5 py-0 text-[10px]", getConfidenceColor(confidence))}
      variant="outline"
    >
      {percentage}%
    </Badge>
  );
}

// Section header component
function SectionHeader({
  icon: Icon,
  title,
  count,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  color: string;
}) {
  if (count === 0) return null;

  return (
    <div className="mb-3 flex items-center gap-2">
      <div
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded",
          color
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <h3 className="font-medium text-foreground text-sm">{title}</h3>
      <Badge className="px-1.5 py-0 text-[10px]" variant="secondary">
        {count}
      </Badge>
    </div>
  );
}

// Commitment from API
interface CommitmentData {
  id: string;
  title: string;
  description?: string;
  debtor: { email: string; name: string };
  dueDate?: string;
  status: string;
  priority: string;
  confidence: number;
  evidence: unknown[];
  extractedFrom: string;
  reasoning?: string;
  // UIO fields
  unifiedObjectId?: string;
  sourceBreadcrumbs?: SourceBreadcrumb[];
  timeline?: TimelineEvent[];
  evidenceSources?: EvidenceSource[];
}

// Commitment card
function CommitmentCard({ commitment }: { commitment: CommitmentData }) {
  const [showTimeline, setShowTimeline] = React.useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-secondary/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-medium text-[13px] text-foreground leading-tight">
          {commitment.title}
        </p>
        <ConfidenceBadge confidence={commitment.confidence} />
      </div>

      {/* Source breadcrumbs - shows which sources this commitment came from */}
      {commitment.sourceBreadcrumbs &&
        commitment.sourceBreadcrumbs.length > 0 && (
          <div className="mb-2">
            <SourceBreadcrumbs
              sources={commitment.sourceBreadcrumbs}
              variant="compact"
            />
          </div>
        )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <User2 className="size-3" />
          {commitment.debtor.name || commitment.debtor.email}
        </span>
        {commitment.dueDate && (
          <span className="flex items-center gap-1">
            <Calendar className="size-3" />
            {commitment.dueDate}
          </span>
        )}
      </div>

      {commitment.reasoning && (
        <div className="mt-2 border-border border-t pt-2">
          <p className="text-[11px] text-muted-foreground italic">
            "{commitment.reasoning}"
          </p>
        </div>
      )}

      {/* Timeline - expandable history */}
      {commitment.timeline && commitment.timeline.length > 0 && (
        <div className="mt-2 border-border border-t pt-2">
          <button
            className="flex items-center gap-1 text-secondary text-[11px] hover:underline"
            onClick={() => setShowTimeline(!showTimeline)}
            type="button"
          >
            {showTimeline ? "Hide" : "Show"} history (
            {commitment.timeline.length} events)
          </button>
          {showTimeline && (
            <div className="mt-2">
              <Timeline events={commitment.timeline} />
            </div>
          )}
        </div>
      )}

      {/* Evidence chain - expandable */}
      {commitment.evidenceSources && commitment.evidenceSources.length > 0 && (
        <div className="mt-2">
          <EvidenceChain
            collapsible
            defaultOpen={false}
            sources={commitment.evidenceSources}
          />
        </div>
      )}
    </div>
  );
}

// Decision from API
interface DecisionData {
  id: string;
  title: string;
  statement: string;
  rationale?: string;
  maker: { email: string; name: string };
  date: Date | string;
  confidence: number;
  evidence: unknown[];
  extractedFrom: string;
  // UIO fields
  unifiedObjectId?: string;
  sourceBreadcrumbs?: SourceBreadcrumb[];
  timeline?: TimelineEvent[];
  evidenceSources?: EvidenceSource[];
}

// Decision card
function DecisionCard({ decision }: { decision: DecisionData }) {
  const [showTimeline, setShowTimeline] = React.useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-purple-500/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-medium text-[13px] text-foreground leading-tight">
          {decision.statement}
        </p>
        <ConfidenceBadge confidence={decision.confidence} />
      </div>

      {/* Source breadcrumbs - shows which sources this decision came from */}
      {decision.sourceBreadcrumbs && decision.sourceBreadcrumbs.length > 0 && (
        <div className="mb-2">
          <SourceBreadcrumbs
            sources={decision.sourceBreadcrumbs}
            variant="compact"
          />
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <User2 className="size-3" />
          {decision.maker.name || decision.maker.email}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="size-3" />
          {formatDistanceToNow(new Date(decision.date), { addSuffix: true })}
        </span>
      </div>

      {decision.rationale && (
        <div className="mt-2 border-border border-t pt-2">
          <p className="text-[11px] text-muted-foreground italic">
            "{decision.rationale}"
          </p>
        </div>
      )}

      {/* Timeline - expandable history */}
      {decision.timeline && decision.timeline.length > 0 && (
        <div className="mt-2 border-border border-t pt-2">
          <button
            className="flex items-center gap-1 text-purple-500 text-[11px] hover:underline"
            onClick={() => setShowTimeline(!showTimeline)}
            type="button"
          >
            {showTimeline ? "Hide" : "Show"} history ({decision.timeline.length}{" "}
            events)
          </button>
          {showTimeline && (
            <div className="mt-2">
              <Timeline events={decision.timeline} />
            </div>
          )}
        </div>
      )}

      {/* Evidence chain - expandable */}
      {decision.evidenceSources && decision.evidenceSources.length > 0 && (
        <div className="mt-2">
          <EvidenceChain
            collapsible
            defaultOpen={false}
            sources={decision.evidenceSources}
          />
        </div>
      )}
    </div>
  );
}

// Question from API
interface QuestionData {
  id: string;
  question: string;
  askedBy: { email: string; name: string };
  askedAt: Date | string;
  isAnswered: boolean;
  confidence: number;
}

// Open question card
function QuestionCard({ question }: { question: QuestionData }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-amber-500/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-medium text-[13px] text-foreground leading-tight">
          {question.question}
        </p>
        <ConfidenceBadge confidence={question.confidence} />
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <User2 className="size-3" />
          {question.askedBy.name || question.askedBy.email}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="size-3" />
          {formatDistanceToNow(new Date(question.askedAt), { addSuffix: true })}
        </span>
        {question.isAnswered && (
          <Badge
            className="border-green-500/30 bg-green-500/20 px-1.5 py-0 text-[10px] text-green-400"
            variant="outline"
          >
            Answered
          </Badge>
        )}
      </div>
    </div>
  );
}

// Loading skeleton
function IntelligenceSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

// Empty state
function EmptyIntelligence() {
  return (
    <div className="flex h-64 flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-card">
        <Lightbulb className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mb-1 font-medium text-foreground text-sm">
        No Intelligence Found
      </h3>
      <p className="max-w-[280px] text-[13px] text-muted-foreground">
        This thread hasn't been processed yet, or no commitments, decisions, or
        questions were detected.
      </p>
    </div>
  );
}

export function IntelligenceSheet({
  open,
  onOpenChange,
  threadId,
  title,
}: IntelligenceSheetProps) {
  // Fetch intelligence data when the sheet opens
  const { data, isLoading, error } = useQuery({
    ...trpc.threads.getIntelligence.queryOptions({
      threadId: threadId ?? "",
    }),
    enabled: open && !!threadId,
  });

  const commitments = (data?.commitments ?? []) as CommitmentData[];
  const decisions = (data?.decisions ?? []) as DecisionData[];
  const openQuestions = (data?.openQuestions ?? []) as QuestionData[];
  const riskWarnings = (data?.riskWarnings ?? []) as unknown[];

  const hasAnyIntelligence =
    commitments.length > 0 ||
    decisions.length > 0 ||
    openQuestions.length > 0 ||
    riskWarnings.length > 0;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-[440px] max-w-[90vw] p-0" side="right">
        <SheetHeader className="border-border border-b px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <Lightbulb className="size-4 text-secondary" />
            Thread Intelligence
          </SheetTitle>
          {title && (
            <SheetDescription className="line-clamp-2">
              {title}
            </SheetDescription>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)]">
          {isLoading ? (
            <IntelligenceSkeleton />
          ) : hasAnyIntelligence ? (
            <div className="space-y-6 p-4">
              {/* Commitments Section */}
              {commitments.length > 0 && (
                <section>
                  <SectionHeader
                    color="bg-secondary/20 text-secondary"
                    count={commitments.length}
                    icon={CheckCircle2}
                    title="Commitments"
                  />
                  <div className="space-y-2">
                    {commitments.map((commitment) => (
                      <CommitmentCard
                        commitment={commitment}
                        key={commitment.id}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Decisions Section */}
              {decisions.length > 0 && (
                <section>
                  <SectionHeader
                    color="bg-purple-500/20 text-purple-500"
                    count={decisions.length}
                    icon={CircleDot}
                    title="Decisions"
                  />
                  <div className="space-y-2">
                    {decisions.map((decision) => (
                      <DecisionCard decision={decision} key={decision.id} />
                    ))}
                  </div>
                </section>
              )}

              {/* Open Questions Section */}
              {openQuestions.length > 0 && (
                <section>
                  <SectionHeader
                    color="bg-amber-500/20 text-amber-500"
                    count={openQuestions.length}
                    icon={HelpCircle}
                    title="Open Questions"
                  />
                  <div className="space-y-2">
                    {openQuestions.map((question) => (
                      <QuestionCard key={question.id} question={question} />
                    ))}
                  </div>
                </section>
              )}

              {/* Risk Warnings Section */}
              {riskWarnings.length > 0 && (
                <section>
                  <SectionHeader
                    color="bg-red-500/20 text-red-400"
                    count={riskWarnings.length}
                    icon={AlertTriangle}
                    title="Risk Warnings"
                  />
                  <div className="space-y-2">
                    {riskWarnings.map((warning, index) => (
                      <div
                        className="rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                        key={index}
                      >
                        <p className="text-[13px] text-red-300">
                          {String(warning)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <EmptyIntelligence />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
