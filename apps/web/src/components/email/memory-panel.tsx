"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Link2,
  MessageSquare,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

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

  if (!hasContext && !hasRelated && !hasTimeline) {
    return (
      <div className={cn("p-4", className)}>
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
            <Brain className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No related context yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Historical connections will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header with tabs - hidden when showTimelineOnly */}
      {!showTimelineOnly && (
        <div className={cn("border-b", compact ? "p-1.5" : "p-2")}>
          <div className="flex items-center gap-1">
            <Button
              variant={activeTab === "context" ? "secondary" : "ghost"}
              size="sm"
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("context")}
            >
              <Brain className="h-3.5 w-3.5 mr-1" />
              Context
            </Button>
            <Button
              variant={activeTab === "related" ? "secondary" : "ghost"}
              size="sm"
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("related")}
            >
              <Link2 className="h-3.5 w-3.5 mr-1" />
              Related
              {relatedThreads.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {relatedThreads.length}
                </Badge>
              )}
            </Button>
            <Button
              variant={activeTab === "timeline" ? "secondary" : "ghost"}
              size="sm"
              className={cn("text-xs", compact && "h-7 px-2")}
              onClick={() => setActiveTab("timeline")}
            >
              <History className="h-3.5 w-3.5 mr-1" />
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
              key="context"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className={cn("space-y-4", compact ? "p-3" : "p-4")}
            >
              {/* Contact contexts */}
              {contactContexts.length > 0 && (
                <Section title="People in this thread" icon={<Users className="h-4 w-4" />}>
                  <div className="space-y-2">
                    {contactContexts.map((contact) => (
                      <ContactCard
                        key={contact.email}
                        contact={contact}
                        onClick={() => onContactClick?.(contact.email)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Related decisions */}
              {relatedDecisions.length > 0 && (
                <Section
                  title="Relevant decisions"
                  icon={<BookOpen className="h-4 w-4 text-purple-500" />}
                >
                  <div className="space-y-2">
                    {relatedDecisions.map((decision) => (
                      <DecisionCard
                        key={decision.id}
                        decision={decision}
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
                  title="Related commitments"
                  icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
                >
                  <div className="space-y-2">
                    {relatedCommitments.map((commitment) => (
                      <CommitmentCard
                        key={commitment.id}
                        commitment={commitment}
                        onClick={() =>
                          onCommitmentClick?.(commitment.id, commitment.threadId)
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
              key="related"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className={cn("space-y-4", compact ? "p-3" : "p-4")}
            >
              {relatedThreads.length > 0 ? (
                <div className="space-y-2">
                  {relatedThreads.map((thread) => (
                    <RelatedThreadCard
                      key={thread.id}
                      thread={thread}
                      onClick={() => onThreadClick?.(thread.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    No related threads found
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "timeline" && (
            <motion.div
              key="timeline"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className={compact ? "p-3" : "p-4"}
            >
              {timeline.length > 0 ? (
                <Timeline events={timeline} onEventClick={(threadId) => threadId && onThreadClick?.(threadId)} />
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
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
        <h4 className="text-sm font-medium">{title}</h4>
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
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 w-full p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
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
          <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-amber-500 flex items-center justify-center">
            <TrendingUp className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{contact.name}</span>
          <span
            className={cn(
              "text-[10px]",
              sentimentColors[contact.relationship.sentiment]
            )}
          >
            {contact.relationship.sentiment}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{contact.relationship.interactionCount} interactions</span>
          <span>•</span>
          <span>~{contact.relationship.responseTime} response</span>
        </div>

        {contact.recentTopics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {contact.recentTopics.slice(0, 3).map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="text-[10px] px-1.5"
              >
                {topic}
              </Badge>
            ))}
          </div>
        )}

        {contact.pendingCommitments > 0 && (
          <p className="text-xs text-amber-500 mt-1">
            {contact.pendingCommitments} pending commitment
            {contact.pendingCommitments !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
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
      type="button"
      onClick={onClick}
      className="flex items-start gap-2 w-full p-2 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
    >
      <BookOpen className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{decision.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {decision.statement}
        </p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
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
      type="button"
      onClick={onClick}
      className="flex items-start gap-2 w-full p-2 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
    >
      <div
        className={cn(
          "h-2 w-2 rounded-full mt-1.5 shrink-0",
          statusColors[commitment.status]
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{commitment.title}</p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
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
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 w-full p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
    >
      <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{thread.subject}</p>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
          {thread.brief}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(thread.date, { addSuffix: true })}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">
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
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {events.map((event, index) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onEventClick?.(event.threadId)}
            className="flex items-start gap-3 w-full text-left hover:bg-accent/50 rounded p-1 -ml-1 transition-colors"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-background border shrink-0">
              {getEventIcon(event.type)}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm truncate">{event.title}</p>
              {event.snippet && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {event.snippet}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">
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
        "text-[10px] px-1.5 py-0.5 rounded shrink-0",
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
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-24" />
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}
