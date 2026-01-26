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
  Heart,
  Loader2,
  Mail,
  MessageSquare,
  Slack,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { useState } from "react";
import {
  useCustomerContext,
  useCustomerTimeline,
  useRelationshipHealth,
} from "@/hooks/use-intelligence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
    if (s >= 0.8) return "text-green-500";
    if (s >= 0.6) return "text-amber-500";
    if (s >= 0.4) return "text-orange-500";
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
    event_type: string;
    title: string;
    timestamp: string;
    source_type: string;
  };
}

function TimelineEvent({ event }: TimelineEventProps) {
  const Icon = SOURCE_ICONS[event.source_type] ?? SOURCE_ICONS.default;
  const timeAgo = formatDistanceToNow(new Date(event.timestamp), {
    addSuffix: true,
  });

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

  const initials = context.contact_name
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
            <h3 className="font-semibold text-lg">{context.contact_name}</h3>
            <p className="text-muted-foreground text-sm">
              {context.contact_email}
            </p>
            {/* Source presence */}
            <div className="mt-1 flex gap-1">
              {context.source_presence.map((source) => {
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
                score={health?.health_score ?? context.relationship_health}
              />
            )}
            <div className="text-right">
              <p className="font-medium text-lg">{context.interaction_count}</p>
              <p className="text-muted-foreground text-xs">Interactions</p>
              {context.last_interaction && (
                <p className="mt-1 text-muted-foreground text-xs">
                  Last:{" "}
                  {formatDistanceToNow(new Date(context.last_interaction), {
                    addSuffix: true,
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Health components */}
          {health?.components && (
            <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1">
                  <Target className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    {Math.round(health.components.fulfillment_rate * 100)}%
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">Fulfillment</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1">
                  {health.components.interaction_trend >= 1 ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <span className="font-medium text-sm">
                    {Math.round(health.components.interaction_trend * 100)}%
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">Trend</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1">
                  <Heart className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    {Math.round(health.components.response_quality * 100)}%
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">Quality</p>
              </div>
            </div>
          )}

          {/* Risk indicators */}
          {health?.risk_indicators && health.risk_indicators.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {health.risk_indicators.map((risk) => (
                <Badge
                  className="text-xs"
                  key={risk}
                  variant="destructive"
                >
                  {risk}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>

        {/* Relationship Summary */}
        {context.relationship_summary && (
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-sm italic">&ldquo;{context.relationship_summary}&rdquo;</p>
          </div>
        )}

        {/* Topics */}
        {context.top_topics.length > 0 && (
          <div>
            <h4 className="mb-2 font-medium text-sm">Discussion Topics</h4>
            <div className="flex flex-wrap gap-1">
              {context.top_topics.map((topic) => (
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
            <Button
              className="w-full justify-between"
              variant="ghost"
            >
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-500" />
                <span>Open Commitments</span>
                <Badge variant="secondary">
                  {context.open_commitments.length}
                </Badge>
              </div>
              {showCommitments ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {context.open_commitments.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">
                No open commitments
              </p>
            ) : (
              <div className="space-y-2 py-2">
                {context.open_commitments.map((commitment) => (
                  <div
                    className="flex items-center justify-between rounded-lg border p-3"
                    key={commitment.id}
                  >
                    <div className="flex-1">
                      <p className="text-sm">{commitment.title}</p>
                      {commitment.due_date && (
                        <p className="text-muted-foreground text-xs">
                          Due{" "}
                          {format(new Date(commitment.due_date), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <Badge
                      className={cn(
                        "text-xs",
                        commitment.status === "overdue" &&
                          "bg-red-500/10 text-red-600 border-red-500/30"
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
            <Button
              className="w-full justify-between"
              variant="ghost"
            >
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-purple-500" />
                <span>Related Decisions</span>
                <Badge variant="secondary">
                  {context.related_decisions.length}
                </Badge>
              </div>
              {showDecisions ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {context.related_decisions.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">
                No related decisions
              </p>
            ) : (
              <div className="space-y-2 py-2">
                {context.related_decisions.map((decision) => (
                  <div
                    className="rounded-lg border p-3"
                    key={decision.id}
                  >
                    <p className="text-sm">{decision.title}</p>
                    <p className="text-muted-foreground text-xs">
                      Decided{" "}
                      {format(new Date(decision.decided_at), "MMM d, yyyy")}
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
            <Button
              className="w-full justify-between"
              variant="ghost"
            >
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
        {context.related_contacts.length > 0 && (
          <div>
            <h4 className="mb-2 font-medium text-sm">Related Contacts</h4>
            <div className="space-y-2">
              {context.related_contacts.slice(0, 5).map((contact) => (
                <div
                  className="flex items-center gap-3 rounded-lg border p-2"
                  key={contact.id}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{contact.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {contact.relationship_type}
                    </p>
                  </div>
                </div>
              ))}
              {context.related_contacts.length > 5 && (
                <Button className="w-full" size="sm" variant="ghost">
                  <Users className="mr-2 h-4 w-4" />
                  View all {context.related_contacts.length} contacts
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
