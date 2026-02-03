// =============================================================================
// DECISION TIMELINE
// =============================================================================
//
// Chronological view of all decisions. This is organizational memory made
// visible - see how decisions evolved over time, which topics were active,
// who was involved. Essential for understanding institutional history.
//

import {
  format,
  isThisMonth,
  isThisWeek,
  isThisYear,
  isToday,
  isYesterday,
} from "date-fns";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Filter,
  GitBranch,
  Lightbulb,
  Loader2,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ConfidenceBadge, EvidencePopover } from "@/components/evidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDecisionUIOs } from "@/hooks/use-uio";
import { extractQuotedText, extractSourceMessage } from "@/lib/evidence-utils";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface TimelineDecision {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
  supersededByUioId?: string | null;
  evidence?: string[];
  extractedAt?: Date | null;
  isMajor?: boolean;
  owners?: Array<{
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  }>;
  sourceThread?: {
    id: string;
    subject?: string | null;
  } | null;
  topics?: Array<{
    id: string;
    name: string;
  }>;
}

export interface DecisionTimelineProps {
  organizationId: string;
  /** Callback when a decision is clicked */
  onDecisionClick: (decisionId: string) => void;
  /** Callback to view source thread */
  onThreadClick?: (threadId: string) => void;
  /** Callback to show evidence */
  onShowEvidence?: (decisionId: string) => void;
  /** Filter by topic */
  topicId?: string;
  /** Whether to include superseded decisions */
  includeSuperseded?: boolean;
  /** Optional className */
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatTimelineDate(date: Date): string {
  if (isToday(date)) {
    return "Today";
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  if (isThisWeek(date)) {
    return format(date, "EEEE");
  }
  if (isThisMonth(date)) {
    return format(date, "MMMM d");
  }
  if (isThisYear(date)) {
    return format(date, "MMMM d");
  }
  return format(date, "MMMM d, yyyy");
}

function groupDecisionsByMonth(
  decisions: TimelineDecision[]
): Map<string, TimelineDecision[]> {
  const groups = new Map<string, TimelineDecision[]>();

  for (const decision of decisions) {
    const monthKey = format(new Date(decision.decidedAt), "yyyy-MM");
    const existing = groups.get(monthKey) ?? [];
    existing.push(decision);
    groups.set(monthKey, existing);
  }

  return groups;
}

function isMajorDecision(decision: TimelineDecision): boolean {
  return Boolean(
    decision.isUserVerified ||
      decision.isSuperseded ||
      decision.supersededByUioId ||
      decision.confidence >= 0.9
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

export function DecisionTimeline({
  organizationId,
  onDecisionClick,
  onThreadClick,
  onShowEvidence,
  topicId,
  includeSuperseded = false,
  className,
}: DecisionTimelineProps) {
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    new Set([format(new Date(), "yyyy-MM")])
  );
  const [filterTopic, setFilterTopic] = useState<string | undefined>(topicId);
  const [viewMode, setViewMode] = useState<"all" | "major">("all");

  // Fetch decisions using UIO hook
  const { data, isLoading } = useDecisionUIOs({
    organizationId,
    limit: 100,
  });

  // Transform decisions from UIO format
  const allDecisions = useMemo(() => {
    if (!data?.items) {
      return [];
    }
    return data.items
      .filter((d) => {
        // Filter superseded if not including them
        if (!includeSuperseded && d.decisionDetails?.supersededByUioId) {
          return false;
        }
        // Filter by topic if set
        // Note: topics may need to be tracked differently in UIO
        return true;
      })
      .map((d) => ({
        id: d.id,
        title: d.userCorrectedTitle ?? d.canonicalTitle ?? "",
        statement: d.canonicalDescription ?? "",
        rationale: d.decisionDetails?.rationale ?? null,
        decidedAt: new Date(d.firstSeenAt ?? d.createdAt),
        confidence: d.overallConfidence ?? 0.8,
        isUserVerified: d.isUserVerified ?? d.userCorrectedTitle != null,
        isSuperseded: Boolean(d.decisionDetails?.supersededByUioId),
        supersededByUioId: d.decisionDetails?.supersededByUioId ?? null,
        evidence: d.decisionDetails?.extractionContext
          ? [JSON.stringify(d.decisionDetails.extractionContext)]
          : undefined,
        extractedAt: new Date(d.createdAt),
        owners: d.owner
          ? [
              {
                id: d.owner.id,
                displayName: d.owner.displayName ?? null,
                primaryEmail: d.owner.primaryEmail ?? "",
              },
            ]
          : [],
        sourceThread: d.sources?.[0]?.conversationId
          ? {
              id: d.sources[0].conversationId,
              subject: null,
            }
          : null,
        topics: [],
        isMajor: false,
      }));
  }, [data, includeSuperseded]);

  const decisionsWithFlags = useMemo(
    () =>
      allDecisions.map((decision) => ({
        ...decision,
        isMajor: isMajorDecision(decision),
      })),
    [allDecisions]
  );

  const filteredDecisions = useMemo(() => {
    if (viewMode === "major") {
      return decisionsWithFlags.filter((d) => d.isMajor);
    }
    return decisionsWithFlags;
  }, [decisionsWithFlags, viewMode]);

  const groupedDecisions = useMemo(
    () => groupDecisionsByMonth(filteredDecisions as TimelineDecision[]),
    [filteredDecisions]
  );

  const monthKeys = useMemo(
    () =>
      Array.from(groupedDecisions.keys()).sort((a, b) => b.localeCompare(a)),
    [groupedDecisions]
  );

  const toggleMonth = useCallback((monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  }, []);

  // Get available topics for filter
  const allTopics = useMemo(() => {
    const topicMap = new Map<string, { id: string; name: string }>();
    for (const d of decisionsWithFlags) {
      for (const topic of (d as TimelineDecision).topics ?? []) {
        topicMap.set(topic.id, topic);
      }
    }
    return Array.from(topicMap.values());
  }, [decisionsWithFlags]);

  const yearStats = useMemo(() => {
    const stats = new Map<string, { total: number; major: number }>();
    for (const decision of decisionsWithFlags) {
      const year = format(decision.decidedAt, "yyyy");
      const current = stats.get(year) ?? { total: 0, major: 0 };
      current.total += 1;
      if (decision.isMajor) {
        current.major += 1;
      }
      stats.set(year, current);
    }
    return stats;
  }, [decisionsWithFlags]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-purple-500" />
          <h2 className="font-semibold text-lg">Decision Timeline</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border bg-muted/50 p-1">
            <Button
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setViewMode("all")}
              variant={viewMode === "all" ? "secondary" : "ghost"}
            >
              All
            </Button>
            <Button
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setViewMode("major")}
              variant={viewMode === "major" ? "secondary" : "ghost"}
            >
              Major changes
            </Button>
          </div>

          {/* Topic filter */}
          <Select
            onValueChange={(v) => setFilterTopic(v === "all" ? undefined : v)}
            value={filterTopic ?? "all"}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <Filter className="mr-2 h-3 w-3" />
              <SelectValue placeholder="All topics" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All topics</SelectItem>
              {allTopics.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : monthKeys.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Lightbulb className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No decisions recorded yet.</p>
          <p className="mt-1 text-xs">
            Decisions will appear here as they're extracted from your emails.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-2 pr-4">
            {monthKeys.map((monthKey, index) => {
              const decisions = groupedDecisions.get(monthKey) ?? [];
              const isExpanded = expandedMonths.has(monthKey);
              const monthDate = new Date(`${monthKey}-01`);
              const year = format(monthDate, "yyyy");
              const previousYear =
                index > 0
                  ? format(new Date(`${monthKeys[index - 1]}-01`), "yyyy")
                  : null;
              const showYearHeader = year !== previousYear;
              const stats = yearStats.get(year);

              return (
                <div key={monthKey}>
                  {showYearHeader && (
                    <div className="rounded-lg border bg-muted/40 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-base">{year}</p>
                          <p className="text-muted-foreground text-xs">
                            {stats?.total ?? 0} decisions •{" "}
                            {stats?.major ?? 0} major changes
                          </p>
                        </div>
                        <Badge className="text-[10px]" variant="secondary">
                          Timeline span
                        </Badge>
                      </div>
                    </div>
                  )}
                  <Collapsible
                    onOpenChange={() => toggleMonth(monthKey)}
                    open={isExpanded}
                  >
                    {/* Month Header */}
                    <CollapsibleTrigger asChild>
                      <Button
                        className="h-auto w-full justify-between rounded-lg px-4 py-3 hover:bg-accent"
                        variant="ghost"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                            <Calendar className="h-4 w-4 text-purple-500" />
                          </div>
                          <div className="text-left">
                            <p className="font-medium">
                              {format(monthDate, "MMMM yyyy")}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {decisions.length} decision
                              {decisions.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>

                    {/* Month Content */}
                    <CollapsibleContent>
                      <div className="relative pt-2 pb-4 pl-8">
                        {/* Vertical timeline line */}
                        <div className="absolute top-0 bottom-0 left-[1.125rem] w-0.5 bg-border" />

                        {decisions.map((decision, index) => (
                          <TimelineDecisionCard
                            decision={decision}
                            isLast={index === decisions.length - 1}
                            key={decision.id}
                            onClick={() => onDecisionClick(decision.id)}
                            onShowEvidence={onShowEvidence}
                            onThreadClick={onThreadClick}
                          />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// =============================================================================
// TIMELINE DECISION CARD
// =============================================================================

interface TimelineDecisionCardProps {
  decision: TimelineDecision;
  isLast: boolean;
  onClick: () => void;
  onThreadClick?: (threadId: string) => void;
  onShowEvidence?: (decisionId: string) => void;
}

function TimelineDecisionCard({
  decision,
  isLast,
  onClick,
  onThreadClick,
  onShowEvidence,
}: TimelineDecisionCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const quotedText = extractQuotedText(
    decision.evidence?.[0],
    decision.statement
  );
  const evidencePopover = onShowEvidence
    ? {
        id: decision.id,
        type: "decision" as const,
        title: decision.title,
        extractedText: decision.statement,
        quotedText,
        confidence: decision.confidence,
        isUserVerified: decision.isUserVerified,
        sourceMessage: extractSourceMessage(decision.evidence?.[0]),
        extractedAt: decision.extractedAt ?? decision.decidedAt ?? new Date(),
      }
    : null;

  return (
    <div
      className={cn("relative", !isLast && "pb-4")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Timeline node */}
      <div
        className={cn(
          "absolute top-3 left-[-1.125rem] z-10 h-3 w-3 rounded-full border-2",
          decision.supersededByUioId
            ? "border-muted-foreground/30 bg-background"
            : "border-purple-500 bg-purple-500"
        )}
      />

      {/* Card */}
      <button
        className={cn(
          "ml-4 w-full rounded-lg border p-4 text-left transition-all",
          "hover:border-purple-500/50 hover:bg-accent/50",
          decision.supersededByUioId && "opacity-60"
        )}
        onClick={onClick}
        type="button"
      >
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-muted-foreground text-xs">
                {formatTimelineDate(decision.decidedAt)}
              </span>
              {decision.isUserVerified && (
                <ThumbsUp className="h-3 w-3 shrink-0 text-green-500" />
              )}
              {decision.supersededByUioId && (
                <Badge className="shrink-0 text-[10px]" variant="outline">
                  <GitBranch className="mr-1 h-2.5 w-2.5" />
                  Superseded
                </Badge>
              )}
              {decision.isMajor && (
                <Badge className="shrink-0 text-[10px]" variant="secondary">
                  Major change
                </Badge>
              )}
            </div>
            <ConfidenceBadge
              confidence={decision.confidence}
              isUserVerified={decision.isUserVerified}
              size="sm"
            />
          </div>

          {/* Title */}
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
            <h4
              className={cn(
                "font-medium text-sm",
                decision.supersededByUioId && "line-through"
              )}
            >
              {decision.title}
            </h4>
          </div>

          {/* Statement */}
          <p className="line-clamp-2 text-muted-foreground text-sm leading-relaxed">
            {decision.statement}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Owners */}
              {decision.owners && decision.owners.length > 0 && (
                <div className="flex items-center -space-x-1">
                  {decision.owners.slice(0, 3).map((owner) => (
                    <Avatar
                      className="h-5 w-5 border border-background"
                      key={owner.id}
                    >
                      <AvatarFallback className="bg-muted text-[8px]">
                        {getInitials(owner.displayName, owner.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              )}

              {/* Topics */}
              {decision.topics && decision.topics.length > 0 && (
                <div className="flex items-center gap-1">
                  {decision.topics.slice(0, 2).map((topic) => (
                    <Badge
                      className="text-[10px]"
                      key={topic.id}
                      variant="secondary"
                    >
                      {topic.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Actions (on hover) */}
            {isHovered && (
              <div className="flex items-center gap-1">
                {onShowEvidence && evidencePopover && (
                  <EvidencePopover
                    evidence={evidencePopover}
                    onShowFullEvidence={() => onShowEvidence(decision.id)}
                    side="left"
                  >
                    <Button
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowEvidence(decision.id);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Eye className="h-3 w-3 text-purple-500" />
                    </Button>
                  </EvidencePopover>
                )}
                {decision.sourceThread && onThreadClick && (
                  <Button
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onThreadClick(decision.sourceThread!.id);
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

export default DecisionTimeline;
