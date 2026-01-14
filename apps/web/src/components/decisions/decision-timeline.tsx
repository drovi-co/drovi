// =============================================================================
// DECISION TIMELINE
// =============================================================================
//
// Chronological view of all decisions. This is organizational memory made
// visible - see how decisions evolved over time, which topics were active,
// who was involved. Essential for understanding institutional history.
//

import { useQuery } from "@tanstack/react-query";
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
  Eye,
  ExternalLink,
  Filter,
  GitBranch,
  Lightbulb,
  Loader2,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ConfidenceBadge } from "@/components/evidence";
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
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

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
  supersededById?: string | null;
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
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisWeek(date)) return format(date, "EEEE");
  if (isThisMonth(date)) return format(date, "MMMM d");
  if (isThisYear(date)) return format(date, "MMMM d");
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

  const trpc = useTRPC();

  // Fetch decisions
  const {
    data,
    isLoading,
  } = useQuery(
    trpc.decisions.list.queryOptions({
      organizationId,
      limit: 100,
      includeSuperseded,
      topicId: filterTopic,
    })
  );

  // Transform decisions
  const allDecisions = useMemo(() => {
    if (!data?.decisions) return [];
    return data.decisions.map((d) => ({
      ...d,
      decidedAt: new Date(d.decidedAt),
    }));
  }, [data]);

  const groupedDecisions = useMemo(
    () => groupDecisionsByMonth(allDecisions as TimelineDecision[]),
    [allDecisions]
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
    for (const d of allDecisions) {
      for (const topic of (d as TimelineDecision).topics ?? []) {
        topicMap.set(topic.id, topic);
      }
    }
    return Array.from(topicMap.values());
  }, [allDecisions]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold">Decision Timeline</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Topic filter */}
          <Select value={filterTopic ?? "all"} onValueChange={(v) => setFilterTopic(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-[180px] h-8">
              <Filter className="h-3 w-3 mr-2" />
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
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No decisions recorded yet.</p>
          <p className="text-xs mt-1">
            Decisions will appear here as they're extracted from your emails.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-2 pr-4">
            {monthKeys.map((monthKey) => {
              const decisions = groupedDecisions.get(monthKey) ?? [];
              const isExpanded = expandedMonths.has(monthKey);
              const monthDate = new Date(monthKey + "-01");

              return (
                <Collapsible
                  key={monthKey}
                  open={isExpanded}
                  onOpenChange={() => toggleMonth(monthKey)}
                >
                  {/* Month Header */}
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between h-auto py-3 px-4 rounded-lg hover:bg-accent"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                          <Calendar className="h-4 w-4 text-purple-500" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium">
                            {format(monthDate, "MMMM yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground">
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
                    <div className="relative pl-8 pt-2 pb-4">
                      {/* Vertical timeline line */}
                      <div className="absolute left-[1.125rem] top-0 bottom-0 w-0.5 bg-border" />

                      {decisions.map((decision, index) => (
                        <TimelineDecisionCard
                          key={decision.id}
                          decision={decision}
                          isLast={index === decisions.length - 1}
                          onClick={() => onDecisionClick(decision.id)}
                          onThreadClick={onThreadClick}
                          onShowEvidence={onShowEvidence}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
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

  return (
    <div
      className={cn("relative", !isLast && "pb-4")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Timeline node */}
      <div
        className={cn(
          "absolute left-[-1.125rem] top-3 h-3 w-3 rounded-full border-2 z-10",
          decision.supersededById
            ? "bg-background border-muted-foreground/30"
            : "bg-purple-500 border-purple-500"
        )}
      />

      {/* Card */}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left p-4 rounded-lg border transition-all ml-4",
          "hover:border-purple-500/50 hover:bg-accent/50",
          decision.supersededById && "opacity-60"
        )}
      >
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTimelineDate(decision.decidedAt)}
              </span>
              {decision.isUserVerified && (
                <ThumbsUp className="h-3 w-3 text-green-500 shrink-0" />
              )}
              {decision.supersededById && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  <GitBranch className="h-2.5 w-2.5 mr-1" />
                  Superseded
                </Badge>
              )}
            </div>
            <ConfidenceBadge
              confidence={decision.confidence}
              isUserVerified={decision.isUserVerified}
              size="sm"
              showDetails={false}
            />
          </div>

          {/* Title */}
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            <h4
              className={cn(
                "text-sm font-medium",
                decision.supersededById && "line-through"
              )}
            >
              {decision.title}
            </h4>
          </div>

          {/* Statement */}
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {decision.statement}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Owners */}
              {decision.owners && decision.owners.length > 0 && (
                <div className="flex items-center -space-x-1">
                  {decision.owners.slice(0, 3).map((owner) => (
                    <Avatar key={owner.id} className="h-5 w-5 border border-background">
                      <AvatarFallback className="text-[8px] bg-muted">
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
                      key={topic.id}
                      variant="secondary"
                      className="text-[10px]"
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
                {onShowEvidence && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowEvidence(decision.id);
                    }}
                  >
                    <Eye className="h-3 w-3 text-purple-500" />
                  </Button>
                )}
                {decision.sourceThread && onThreadClick && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onThreadClick(decision.sourceThread!.id);
                    }}
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
