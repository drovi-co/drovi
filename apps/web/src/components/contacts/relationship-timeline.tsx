// =============================================================================
// RELATIONSHIP TIMELINE COMPONENT
// =============================================================================
//
// Chronological view of all interactions with a contact across all sources.
// Shows emails, meetings, decisions, commitments, and other touchpoints.
//

import { useQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { motion } from "framer-motion";
import {
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Mail,
  MessageSquare,
  Phone,
  Slack,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

type InteractionType =
  | "email"
  | "meeting"
  | "call"
  | "slack"
  | "whatsapp"
  | "commitment"
  | "decision"
  | "document";

interface TimelineItem {
  id: string;
  type: InteractionType;
  title: string;
  summary?: string;
  timestamp: Date;
  direction?: "inbound" | "outbound";
  source?: string;
  sourceId?: string;
  metadata?: {
    participants?: string[];
    duration?: number;
    attachments?: number;
    status?: string;
  };
}

interface RelationshipTimelineProps {
  contactId: string;
  organizationId: string;
  maxItems?: number;
  onItemClick?: (item: TimelineItem) => void;
  className?: string;
}

// =============================================================================
// ICON MAPPING
// =============================================================================

const typeIcons: Record<InteractionType, React.ElementType> = {
  email: Mail,
  meeting: Calendar,
  call: Phone,
  slack: Slack,
  whatsapp: MessageSquare,
  commitment: Target,
  decision: GitBranch,
  document: FileText,
};

const typeColors: Record<InteractionType, string> = {
  email: "bg-blue-500",
  meeting: "bg-green-500",
  call: "bg-amber-500",
  slack: "bg-purple-500",
  whatsapp: "bg-emerald-500",
  commitment: "bg-orange-500",
  decision: "bg-indigo-500",
  document: "bg-gray-500",
};

const typeBgColors: Record<InteractionType, string> = {
  email: "bg-blue-500/10",
  meeting: "bg-green-500/10",
  call: "bg-amber-500/10",
  slack: "bg-purple-500/10",
  whatsapp: "bg-emerald-500/10",
  commitment: "bg-orange-500/10",
  decision: "bg-indigo-500/10",
  document: "bg-gray-500/10",
};

// =============================================================================
// DATE GROUP HEADER
// =============================================================================

function DateGroupHeader({ date }: { date: Date }) {
  let label: string;

  if (isToday(date)) {
    label = "Today";
  } else if (isYesterday(date)) {
    label = "Yesterday";
  } else {
    label = format(date, "EEEE, MMMM d, yyyy");
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="font-medium text-muted-foreground text-xs">
          {label}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function YearGroupHeader({
  year,
  total,
  major,
}: {
  year: string;
  total: number;
  major: number;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 rounded-lg border bg-muted/40 px-4 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">{year}</p>
          <p className="text-muted-foreground text-xs">
            {total} interactions • {major} major changes
          </p>
        </div>
        <Badge className="text-[10px]" variant="secondary">
          Long-term memory
        </Badge>
      </div>
    </div>
  );
}

// =============================================================================
// TIMELINE ITEM COMPONENT
// =============================================================================

interface TimelineItemComponentProps {
  item: TimelineItem;
  onClick?: () => void;
  isLast: boolean;
}

function TimelineItemComponent({
  item,
  onClick,
  isLast,
}: TimelineItemComponentProps) {
  const Icon = typeIcons[item.type] ?? Mail;
  const color = typeColors[item.type] ?? "bg-gray-500";
  const bgColor = typeBgColors[item.type] ?? "bg-gray-500/10";

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className="group relative flex gap-4"
      initial={{ opacity: 0, x: -10 }}
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            bgColor
          )}
        >
          <Icon className={cn("h-4 w-4", color.replace("bg-", "text-"))} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "mb-6 flex-1 cursor-pointer rounded-lg border bg-card p-4 transition-colors",
          onClick && "hover:bg-accent/50"
        )}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-sm">{item.title}</p>
              {item.direction && (
                <Badge
                  className={cn(
                    "text-[10px]",
                    item.direction === "inbound"
                      ? "border-green-500/30 text-green-600"
                      : "border-blue-500/30 text-blue-600"
                  )}
                  variant="outline"
                >
                  {item.direction === "inbound" ? "Received" : "Sent"}
                </Badge>
              )}
              {item.metadata?.status && (
                <Badge className="text-[10px]" variant="secondary">
                  {item.metadata.status}
                </Badge>
              )}
            </div>
            {item.summary && (
              <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
                {item.summary}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(item.timestamp), "h:mm a")}
              </span>
              {item.source && <span className="capitalize">{item.source}</span>}
              {item.metadata?.participants &&
                item.metadata.participants.length > 0 && (
                  <span className="flex items-center gap-1">
                    +{item.metadata.participants.length} others
                  </span>
                )}
              {item.metadata?.duration && (
                <span>{item.metadata.duration} min</span>
              )}
            </div>
          </div>
          {onClick && (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function RelationshipTimeline({
  contactId,
  organizationId,
  maxItems = 50,
  onItemClick,
  className,
}: RelationshipTimelineProps) {
  const trpc = useTRPC();
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "major">("all");

  // Fetch threads/conversations with this contact
  const { data: threadsData, isLoading: loadingThreads } = useQuery(
    trpc.threads.list.queryOptions({
      organizationId,
      limit: maxItems,
    })
  );

  // Fetch commitments involving this contact
  const { data: commitmentsData, isLoading: loadingCommitments } = useQuery(
    trpc.uio.listCommitments.queryOptions({
      organizationId,
      // Would filter by contact
      limit: maxItems,
    })
  );

  // Fetch decisions involving this contact
  const { data: decisionsData, isLoading: loadingDecisions } = useQuery(
    trpc.uio.listDecisions.queryOptions({
      organizationId,
      // Would filter by contact
      limit: maxItems,
    })
  );

  const isLoading = loadingThreads || loadingCommitments || loadingDecisions;

  // Combine and sort timeline items
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // Add threads as email interactions
    if (threadsData?.threads) {
      for (const thread of threadsData.threads) {
        items.push({
          id: thread.id,
          type: "email",
          title: thread.title ?? thread.snippet ?? "No Subject",
          summary: thread.snippet ?? undefined,
          timestamp: new Date(
            thread.lastMessageAt ?? thread.firstMessageAt ?? Date.now()
          ),
          direction: "inbound", // Would determine from thread data
          source: "email",
          sourceId: thread.id,
          metadata: {
            participants: [], // Would extract from thread
          },
        });
      }
    }

    // Add commitments
    if (commitmentsData?.items) {
      for (const item of commitmentsData.items) {
        if (item.type === "commitment" && item.commitmentDetails) {
          items.push({
            id: item.id,
            type: "commitment",
            title: item.canonicalTitle,
            summary: item.canonicalDescription ?? undefined,
            timestamp: new Date(item.createdAt),
            source: "commitment",
            sourceId: item.id,
            metadata: {
              status: item.commitmentDetails.status,
            },
          });
        }
      }
    }

    // Add decisions
    if (decisionsData?.items) {
      for (const item of decisionsData.items) {
        if (item.type === "decision" && item.decisionDetails) {
          items.push({
            id: item.id,
            type: "decision",
            title: item.canonicalTitle,
            summary: item.canonicalDescription ?? undefined,
            timestamp: new Date(item.createdAt),
            source: "decision",
            sourceId: item.id,
            metadata: {
              status: item.decisionDetails.status ?? item.status,
            },
          });
        }
      }
    }

    // Sort by timestamp descending
    items.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const isMajor = (item: TimelineItem) =>
      ["decision", "commitment", "document"].includes(item.type);

    if (viewMode === "major") {
      const byYear = new Map<string, TimelineItem[]>();
      for (const item of items) {
        const year = format(new Date(item.timestamp), "yyyy");
        const list = byYear.get(year) ?? [];
        list.push(item);
        byYear.set(year, list);
      }

      const majorItems: TimelineItem[] = [];
      for (const [year, yearItems] of byYear) {
        const sorted = [...yearItems].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const newest = sorted[0];
        const oldest = sorted[sorted.length - 1];
        const major = sorted.filter(isMajor);

        const unique = new Map<string, TimelineItem>();
        [newest, oldest, ...major].forEach((item) => {
          if (item) {
            unique.set(item.id, item);
          }
        });
        majorItems.push(...unique.values());
      }

      majorItems.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return showAll ? majorItems : majorItems.slice(0, 10);
    }

    return showAll ? items : items.slice(0, 10);
  }, [threadsData, commitmentsData, decisionsData, showAll, viewMode]);

  // Group items by date
  const groupedItems = useMemo(() => {
    const groups: Map<string, TimelineItem[]> = new Map();

    for (const item of timelineItems) {
      const dateKey = format(new Date(item.timestamp), "yyyy-MM-dd");
      const existing = groups.get(dateKey) ?? [];
      existing.push(item);
      groups.set(dateKey, existing);
    }

    return groups;
  }, [timelineItems]);

  const yearStats = useMemo(() => {
    const stats = new Map<string, { total: number; major: number }>();
    const isMajor = (item: TimelineItem) =>
      ["decision", "commitment", "document"].includes(item.type);
    for (const item of timelineItems) {
      const year = format(new Date(item.timestamp), "yyyy");
      const current = stats.get(year) ?? { total: 0, major: 0 };
      current.total += 1;
      if (isMajor(item)) {
        current.major += 1;
      }
      stats.set(year, current);
    }
    return stats;
  }, [timelineItems]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[...new Array(5)].map((_, i) => (
            <div className="flex gap-4" key={i}>
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (timelineItems.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
          <Calendar className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">No Interactions Yet</p>
            <p className="text-muted-foreground text-sm">
              Communication history with this contact will appear here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-500" />
          Relationship Timeline
        </CardTitle>
        <CardDescription>
          {timelineItems.length} interactions across all channels
        </CardDescription>
        <div className="mt-2 flex items-center gap-2">
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {Array.from(groupedItems.entries()).map(
            ([dateKey, items], groupIndex) => (
              <div key={dateKey}>
                {(() => {
                  const year = format(new Date(dateKey), "yyyy");
                  const previousYear =
                    groupIndex > 0
                      ? format(
                          new Date(Array.from(groupedItems.keys())[groupIndex - 1]),
                          "yyyy"
                        )
                      : null;
                  if (year !== previousYear) {
                    const stats = yearStats.get(year);
                    return (
                      <YearGroupHeader
                        year={year}
                        total={stats?.total ?? 0}
                        major={stats?.major ?? 0}
                      />
                    );
                  }
                  return null;
                })()}
                <DateGroupHeader date={new Date(dateKey)} />
                {items.map((item, itemIndex) => {
                  const isLastInGroup = itemIndex === items.length - 1;
                  const isLastOverall =
                    groupIndex === groupedItems.size - 1 && isLastInGroup;

                  return (
                    <TimelineItemComponent
                      isLast={isLastOverall}
                      item={item}
                      key={item.id}
                      onClick={
                        onItemClick ? () => onItemClick(item) : undefined
                      }
                    />
                  );
                })}
              </div>
            )
          )}
        </div>

        {!showAll && timelineItems.length >= 10 && (
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setShowAll(true)} variant="outline">
              Show All Interactions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RelationshipTimeline;
