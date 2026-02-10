// =============================================================================
// CUSTOMER CONTEXT PANEL
// =============================================================================
//
// Rich intelligence context for contacts using MCP-style aggregation.
// Shows relationship summary, timeline, commitments, decisions, and health.
//

import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Mail,
  MessageSquare,
  Slack,
  Target,
  User,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCustomerContext,
  useCustomerTimeline,
  useRelationshipHealth,
} from "@/hooks/use-intelligence";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface CustomerContextPanelProps {
  organizationId: string;
  contactId: string;
}

// =============================================================================
// SOURCE ICONS
// =============================================================================

const SOURCE_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  slack: Slack,
  calendar: Calendar,
  default: MessageSquare,
};

// =============================================================================
// HEALTH GAUGE COMPONENT
// =============================================================================

interface HealthGaugeProps {
  score: number;
  label: string;
}

function HealthGauge({ score, label }: HealthGaugeProps) {
  const percentage = Math.round(score * 100);
  const getColor = (s: number) => {
    if (s >= 0.8) {
      return "text-green-500";
    }
    if (s >= 0.6) {
      return "text-amber-500";
    }
    if (s >= 0.4) {
      return "text-orange-500";
    }
    return "text-red-500";
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
          <circle
            className="stroke-muted"
            cx="18"
            cy="18"
            fill="none"
            r="15.915"
            strokeWidth="3"
          />
          <circle
            className={cn("transition-all duration-500", getColor(score))}
            cx="18"
            cy="18"
            fill="none"
            r="15.915"
            stroke="currentColor"
            strokeDasharray={`${percentage}, 100`}
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("font-bold text-lg", getColor(score))}>
            {percentage}
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">
          {score >= 0.8
            ? "Healthy"
            : score >= 0.6
              ? "Moderate"
              : score >= 0.4
                ? "At Risk"
                : "Critical"}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// TIMELINE EVENT COMPONENT
// =============================================================================

interface TimelineEventProps {
  event: {
    id: string;
    eventType: string;
    title: string;
    timestamp: string | null;
    sourceType: string | null;
  };
}

function TimelineEvent({ event }: TimelineEventProps) {
  const Icon =
    SOURCE_ICONS[event.sourceType ?? "default"] ?? SOURCE_ICONS.default;
  const timeAgo = event.timestamp
    ? formatDistanceToNow(new Date(event.timestamp), {
        addSuffix: true,
      })
    : "—";

  return (
    <div className="flex gap-3 py-2">
      <div className="mt-0.5 rounded-full bg-muted p-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <p className="text-sm">{event.title}</p>
        <p className="text-muted-foreground text-xs">{timeAgo}</p>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CustomerContextPanel({
  organizationId,
  contactId,
}: CustomerContextPanelProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showCommitments, setShowCommitments] = useState(true);
  const [showDecisions, setShowDecisions] = useState(false);

  const {
    data: context,
    isLoading: contextLoading,
    error: contextError,
  } = useCustomerContext({ organizationId, contactId });

  const { data: timeline, isLoading: timelineLoading } = useCustomerTimeline({
    organizationId,
    contactId,
    limit: 20,
    enabled: showTimeline,
  });

  const { data: health, isLoading: healthLoading } = useRelationshipHealth({
    organizationId,
    contactId,
  });

  if (contextLoading) {
    return (
      <div className="space-y-6 py-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (contextError || !context) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">Failed to load customer context</p>
      </div>
    );
  }

  const contactName = context.name ?? context.email ?? "Contact";
  const contactEmail = context.email ?? "—";
  const sourcePresence = context.sourceTypes ?? [];
  const openCommitments = context.openCommitments ?? [];
  const relatedDecisions = context.relatedDecisions ?? [];
  const relatedContacts = context.topContacts ?? [];
  const topTopics = context.topTopics ?? [];

  const initials = contactName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <SheetHeader>
        <SheetTitle>Customer Context</SheetTitle>
        <SheetDescription>
          Complete intelligence about this relationship
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 py-6">
        {/* Contact Header */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary/10 font-bold text-lg text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-semibold text-lg">{contactName}</h3>
            <p className="text-muted-foreground text-sm">{contactEmail}</p>
            {/* Source presence */}
            <div className="mt-1 flex gap-1">
              {sourcePresence.map((source) => {
                const Icon = SOURCE_ICONS[source] ?? SOURCE_ICONS.default;
                return (
                  <Badge
                    className="gap-1 px-1.5 py-0.5"
                    key={source}
                    variant="secondary"
                  >
                    <Icon className="h-3 w-3" />
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>

        {/* Relationship Health */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border bg-card p-4"
          initial={{ opacity: 0, y: 10 }}
        >
          <div className="flex items-center justify-between">
            {healthLoading ? (
              <Skeleton className="h-16 w-32" />
            ) : (
              <HealthGauge
                label="Relationship Health"
                score={health?.healthScore ?? context.relationshipHealth}
              />
            )}
            <div className="text-right">
              <p className="font-medium text-lg">{context.interactionCount}</p>
              <p className="text-muted-foreground text-xs">Interactions</p>
              {context.lastInteraction && (
                <p className="mt-1 text-muted-foreground text-xs">
                  Last:{" "}
                  {formatDistanceToNow(new Date(context.lastInteraction), {
                    addSuffix: true,
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Health factors */}
          {health?.factors && Object.keys(health.factors).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {Object.entries(health.factors).map(([key, value]) => (
                <Badge className="text-xs" key={key} variant="secondary">
                  {key.replace(/_/g, " ")}: {String(value)}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>

        {/* Relationship Summary */}
        {context.relationshipSummary && (
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-sm italic">
              &ldquo;{context.relationshipSummary}&rdquo;
            </p>
          </div>
        )}

        {/* Topics */}
        {topTopics.length > 0 && (
          <div>
            <h4 className="mb-2 font-medium text-sm">Discussion Topics</h4>
            <div className="flex flex-wrap gap-1">
              {topTopics.map((topic) => (
                <Badge key={topic} variant="secondary">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Commitments */}
        <Collapsible onOpenChange={setShowCommitments} open={showCommitments}>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" variant="ghost">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-500" />
                <span>Open Commitments</span>
                <Badge variant="secondary">{openCommitments.length}</Badge>
              </div>
              {showCommitments ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {openCommitments.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">
                No open commitments
              </p>
            ) : (
              <div className="space-y-2 py-2">
                {openCommitments.map((commitment) => (
                  <div
                    className="flex items-center justify-between rounded-lg border p-3"
                    key={commitment.id}
                  >
                    <div className="flex-1">
                      <p className="text-sm">{commitment.title}</p>
                      {commitment.dueDate && (
                        <p className="text-muted-foreground text-xs">
                          Due{" "}
                          {format(new Date(commitment.dueDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <Badge
                      className={cn(
                        "text-xs",
                        commitment.status === "overdue" &&
                          "border-red-500/30 bg-red-500/10 text-red-600"
                      )}
                      variant="outline"
                    >
                      {commitment.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Decisions */}
        <Collapsible onOpenChange={setShowDecisions} open={showDecisions}>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" variant="ghost">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-purple-500" />
                <span>Related Decisions</span>
                <Badge variant="secondary">{relatedDecisions.length}</Badge>
              </div>
              {showDecisions ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {relatedDecisions.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">
                No related decisions
              </p>
            ) : (
              <div className="space-y-2 py-2">
                {relatedDecisions.map((decision) => (
                  <div className="rounded-lg border p-3" key={decision.id}>
                    <p className="text-sm">{decision.title}</p>
                    <p className="text-muted-foreground text-xs">
                      Decided{" "}
                      {decision.decidedAt
                        ? format(new Date(decision.decidedAt), "MMM d, yyyy")
                        : "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Timeline */}
        <Collapsible onOpenChange={setShowTimeline} open={showTimeline}>
          <CollapsibleTrigger asChild>
            <Button className="w-full justify-between" variant="ghost">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span>Interaction Timeline</span>
              </div>
              {showTimeline ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-[300px] overflow-y-auto py-2">
              {timelineLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : timeline?.events?.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground text-sm">
                  No timeline events
                </p>
              ) : (
                <div className="space-y-1 divide-y">
                  {timeline?.events?.map((event) => (
                    <TimelineEvent event={event} key={event.id} />
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Related Contacts */}
        {relatedContacts.length > 0 && (
          <div>
            <h4 className="mb-2 font-medium text-sm">Related Contacts</h4>
            <div className="space-y-2">
              {relatedContacts.slice(0, 5).map((contact) => (
                <div
                  className="flex items-center gap-3 rounded-lg border p-2"
                  key={contact.id}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">
                      {contact.name ?? contact.email ?? "Contact"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {contact.company ?? contact.title ?? "Related contact"}
                    </p>
                  </div>
                </div>
              ))}
              {relatedContacts.length > 5 && (
                <Button className="w-full" size="sm" variant="ghost">
                  <Users className="mr-2 h-4 w-4" />
                  View all {relatedContacts.length} contacts
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default CustomerContextPanel;
