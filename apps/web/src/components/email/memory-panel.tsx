"use client";

import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronRight,
  History,
  Link2,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface RelatedThread {
  id: string;
  subject: string;
  brief: string;
  date: Date;
  relevanceScore: number;
  relevanceReason: string;
  participants: Array<{
    email: string;
    name: string;
  }>;
}

export interface RelatedDecision {
  id: string;
  title: string;
  statement: string;
  date: Date;
  maker: {
    email: string;
    name: string;
  };
  relevanceScore: number;
  threadId: string;
}

export interface RelatedCommitment {
  id: string;
  title: string;
  status: "pending" | "completed" | "overdue";
  dueDate?: Date;
  debtor: {
    email: string;
    name: string;
  };
  relevanceScore: number;
  threadId: string;
}

export interface ContactContext {
  email: string;
  name: string;
  avatarUrl?: string;
  relationship: {
    strength: number;
    interactionCount: number;
    lastInteraction: Date;
    sentiment: "positive" | "neutral" | "negative";
    responseTime: string;
  };
  recentTopics: string[];
  pendingCommitments: number;
  isVip?: boolean;
}

export interface TimelineEvent {
  id: string;
  type: "thread" | "commitment" | "decision" | "meeting";
  title: string;
  date: Date;
  threadId?: string;
  snippet?: string;
}

interface MemoryPanelProps {
  relatedThreads: RelatedThread[];
  relatedDecisions: RelatedDecision[];
  relatedCommitments: RelatedCommitment[];
  contactContexts: ContactContext[];
  timeline?: TimelineEvent[];
  isLoading?: boolean;
  onThreadClick?: (threadId: string) => void;
  onDecisionClick?: (decisionId: string, threadId: string) => void;
  onCommitmentClick?: (commitmentId: string, threadId: string) => void;
  onContactClick?: (email: string) => void;
  className?: string;
  /** Compact display mode for side panels */
  compact?: boolean;
  /** Only show the timeline view (hide tabs) */
  showTimelineOnly?: boolean;
}

// =============================================================================
// MEMORY PANEL
// =============================================================================

export function MemoryPanel({
  relatedThreads,
  relatedDecisions,
  relatedCommitments,
  contactContexts,
  timeline = [],
  isLoading = false,
  onThreadClick,
  onDecisionClick,
  onCommitmentClick,
  onContactClick,
  className,
  compact = false,
  showTimelineOnly = false,
}: MemoryPanelProps) {
  const [activeTab, setActiveTab] = useState<
    "context" | "related" | "timeline"
  >(showTimelineOnly ? "timeline" : "context");

  if (isLoading) {
    return <MemoryPanelSkeleton />;
  }

  const hasContext =
    contactContexts.length > 0 ||
    relatedDecisions.length > 0 ||
    relatedCommitments.length > 0;

  const hasRelated = relatedThreads.length > 0;
  const hasTimeline = timeline.length > 0;

  if (!(hasContext || hasRelated || hasTimeline)) {
    return (
      <div className={cn("p-4", className)}>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Brain className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            No related context yet
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Historical connections will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header with tabs - hidden when showTimelineOnly */}
      {!showTimelineOnly && (
        <div className={cn("border-b", compact ? "p-1.5" : "p-2")}>
          <div className="flex items-center gap-1">
            <Button
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("context")}
              size="sm"
              variant={activeTab === "context" ? "secondary" : "ghost"}
            >
              <Brain className="mr-1 h-3.5 w-3.5" />
              Context
            </Button>
            <Button
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("related")}
              size="sm"
              variant={activeTab === "related" ? "secondary" : "ghost"}
            >
              <Link2 className="mr-1 h-3.5 w-3.5" />
              Related
              {relatedThreads.length > 0 && (
                <Badge className="ml-1 text-[10px]" variant="secondary">
                  {relatedThreads.length}
                </Badge>
              )}
            </Button>
            <Button
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("timeline")}
              size="sm"
              variant={activeTab === "timeline" ? "secondary" : "ghost"}
            >
              <History className="mr-1 h-3.5 w-3.5" />
              Timeline
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {activeTab === "context" && (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className={cn("space-y-4", compact ? "p-3" : "p-4")}
              exit={{ opacity: 0, x: 10 }}
              initial={{ opacity: 0, x: -10 }}
              key="context"
            >
              {/* Contact contexts */}
              {contactContexts.length > 0 && (
                <Section
                  icon={<Users className="h-4 w-4" />}
                  title="People in this thread"
                >
                  <div className="space-y-2">
                    {contactContexts.map((contact) => (
                      <ContactCard
                        contact={contact}
                        key={contact.email}
                        onClick={() => onContactClick?.(contact.email)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Related decisions */}
              {relatedDecisions.length > 0 && (
                <Section
                  icon={<BookOpen className="h-4 w-4 text-purple-500" />}
                  title="Relevant decisions"
                >
                  <div className="space-y-2">
                    {relatedDecisions.map((decision) => (
                      <DecisionCard
                        decision={decision}
                        key={decision.id}
                        onClick={() =>
                          onDecisionClick?.(decision.id, decision.threadId)
                        }
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Related commitments */}
              {relatedCommitments.length > 0 && (
                <Section
                  icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
                  title="Related commitments"
                >
                  <div className="space-y-2">
                    {relatedCommitments.map((commitment) => (
                      <CommitmentCard
                        commitment={commitment}
                        key={commitment.id}
                        onClick={() =>
                          onCommitmentClick?.(
                            commitment.id,
                            commitment.threadId
                          )
                        }
                      />
                    ))}
                  </div>
                </Section>
              )}
            </motion.div>
          )}

          {activeTab === "related" && (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className={cn("space-y-4", compact ? "p-3" : "p-4")}
              exit={{ opacity: 0, x: 10 }}
              initial={{ opacity: 0, x: -10 }}
              key="related"
            >
              {relatedThreads.length > 0 ? (
                <div className="space-y-2">
                  {relatedThreads.map((thread) => (
                    <RelatedThreadCard
                      key={thread.id}
                      onClick={() => onThreadClick?.(thread.id)}
                      thread={thread}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    No related threads found
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "timeline" && (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className={compact ? "p-3" : "p-4"}
              exit={{ opacity: 0, x: 10 }}
              initial={{ opacity: 0, x: -10 }}
              key="timeline"
            >
              {timeline.length > 0 ? (
                <Timeline
                  events={timeline}
                  onEventClick={(threadId) =>
                    threadId && onThreadClick?.(threadId)
                  }
                />
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    No timeline events
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="font-medium text-sm">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function ContactCard({
  contact,
  onClick,
}: {
  contact: ContactContext;
  onClick?: () => void;
}) {
  const sentimentColors = {
    positive: "text-green-500",
    neutral: "text-muted-foreground",
    negative: "text-red-500",
  };

  return (
    <button
      className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
      onClick={onClick}
      type="button"
    >
      <div className="relative">
        <Avatar className="h-10 w-10">
          <AvatarImage src={contact.avatarUrl} />
          <AvatarFallback className="text-xs">
            {contact.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {contact.isVip && (
          <div className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500">
            <TrendingUp className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{contact.name}</span>
          <span
            className={cn(
              "text-[10px]",
              sentimentColors[contact.relationship.sentiment]
            )}
          >
            {contact.relationship.sentiment}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
          <span>{contact.relationship.interactionCount} interactions</span>
          <span>•</span>
          <span>~{contact.relationship.responseTime} response</span>
        </div>

        {contact.recentTopics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {contact.recentTopics.slice(0, 3).map((topic) => (
              <Badge
                className="px-1.5 text-[10px]"
                key={topic}
                variant="secondary"
              >
                {topic}
              </Badge>
            ))}
          </div>
        )}

        {contact.pendingCommitments > 0 && (
          <p className="mt-1 text-amber-500 text-xs">
            {contact.pendingCommitments} pending commitment
            {contact.pendingCommitments !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function DecisionCard({
  decision,
  onClick,
}: {
  decision: RelatedDecision;
  onClick?: () => void;
}) {
  return (
    <button
      className="flex w-full items-start gap-2 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent"
      onClick={onClick}
      type="button"
    >
      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{decision.title}</p>
        <p className="line-clamp-1 text-muted-foreground text-xs">
          {decision.statement}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{decision.maker.name}</span>
          <span>•</span>
          <span>{formatDistanceToNow(decision.date, { addSuffix: true })}</span>
        </div>
      </div>
      <RelevanceBadge score={decision.relevanceScore} />
    </button>
  );
}

function CommitmentCard({
  commitment,
  onClick,
}: {
  commitment: RelatedCommitment;
  onClick?: () => void;
}) {
  const statusColors = {
    pending: "bg-blue-500",
    completed: "bg-green-500",
    overdue: "bg-red-500",
  };

  return (
    <button
      className="flex w-full items-start gap-2 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent"
      onClick={onClick}
      type="button"
    >
      <div
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          statusColors[commitment.status]
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{commitment.title}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{commitment.debtor.name}</span>
          {commitment.dueDate && (
            <>
              <span>•</span>
              <span
                className={cn(
                  commitment.status === "overdue" && "text-red-500"
                )}
              >
                {commitment.status === "overdue" ? "Overdue" : "Due"}{" "}
                {formatDistanceToNow(commitment.dueDate, { addSuffix: true })}
              </span>
            </>
          )}
        </div>
      </div>
      <RelevanceBadge score={commitment.relevanceScore} />
    </button>
  );
}

function RelatedThreadCard({
  thread,
  onClick,
}: {
  thread: RelatedThread;
  onClick?: () => void;
}) {
  return (
    <button
      className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
      onClick={onClick}
      type="button"
    >
      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{thread.subject}</p>
        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
          {thread.brief}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(thread.date, { addSuffix: true })}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {thread.relevanceReason}
          </span>
        </div>
      </div>
      <RelevanceBadge score={thread.relevanceScore} />
    </button>
  );
}

function Timeline({
  events,
  onEventClick,
}: {
  events: TimelineEvent[];
  onEventClick?: (threadId?: string) => void;
}) {
  const getEventIcon = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "thread":
        return <MessageSquare className="h-3.5 w-3.5" />;
      case "commitment":
        return <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />;
      case "decision":
        return <BookOpen className="h-3.5 w-3.5 text-purple-500" />;
      case "meeting":
        return <Calendar className="h-3.5 w-3.5 text-green-500" />;
    }
  };

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute top-2 bottom-2 left-[11px] w-px bg-border" />

      <div className="space-y-3">
        {events.map((event, _index) => (
          <button
            className="-ml-1 flex w-full items-start gap-3 rounded p-1 text-left transition-colors hover:bg-accent/50"
            key={event.id}
            onClick={() => onEventClick?.(event.threadId)}
            type="button"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background">
              {getEventIcon(event.type)}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-sm">{event.title}</p>
              {event.snippet && (
                <p className="line-clamp-1 text-muted-foreground text-xs">
                  {event.snippet}
                </p>
              )}
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {formatDistanceToNow(event.date, { addSuffix: true })}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RelevanceBadge({ score }: { score: number }) {
  const level = score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
  const colors = {
    high: "bg-green-500/10 text-green-600",
    medium: "bg-amber-500/10 text-amber-600",
    low: "bg-muted text-muted-foreground",
  };

  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
        colors[level]
      )}
    >
      {Math.round(score * 100)}%
    </span>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function MemoryPanelSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-24" />
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton className="h-20 w-full rounded-lg" key={i} />
      ))}
    </div>
  );
}
