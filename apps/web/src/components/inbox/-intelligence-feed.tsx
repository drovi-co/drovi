// =============================================================================
// INTELLIGENCE FEED COMPONENT
// =============================================================================
//
// Real-time feed showing AI discoveries as they happen, with feedback loop
// for users to indicate if intelligence was helpful or not.
//
// Features:
// - Real-time event streaming via WebSocket
// - Animated entry for new intelligence
// - Feedback buttons (helpful / not useful)
// - Confidence indicators
// - Evidence links to source conversations
//

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type ConnectionState,
  type IntelligenceEvent,
  useIntelligenceStream,
} from "@/hooks/use-intelligence-stream";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface IntelligenceFeedProps {
  organizationId: string;
  className?: string;
  maxHeight?: string;
  showConnectionStatus?: boolean;
}

type FeedbackStatus = "none" | "helpful" | "not_useful" | "pending";

interface FeedbackState {
  [eventId: string]: FeedbackStatus;
}

// =============================================================================
// EVENT TYPE MAPPINGS
// =============================================================================

const eventTypeConfig: Record<
  string,
  {
    icon: React.ReactNode;
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
    color: string;
  }
> = {
  UIO_CREATED: {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    label: "New Intelligence",
    variant: "default",
    color: "text-primary",
  },
  UIO_UPDATED: {
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    label: "Updated",
    variant: "secondary",
    color: "text-muted-foreground",
  },
  COMMITMENT_EXTRACTED: {
    icon: <Target className="h-3.5 w-3.5" />,
    label: "Commitment",
    variant: "default",
    color: "text-blue-500",
  },
  DECISION_EXTRACTED: {
    icon: <GitBranch className="h-3.5 w-3.5" />,
    label: "Decision",
    variant: "default",
    color: "text-purple-500",
  },
  RISK_DETECTED: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: "Risk",
    variant: "destructive",
    color: "text-red-500",
  },
  TASK_CREATED: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "Task Created",
    variant: "secondary",
    color: "text-green-500",
  },
  ANALYSIS_STARTED: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    label: "Analyzing",
    variant: "outline",
    color: "text-muted-foreground",
  },
  ANALYSIS_COMPLETE: {
    icon: <Zap className="h-3.5 w-3.5" />,
    label: "Analysis Done",
    variant: "secondary",
    color: "text-green-500",
  },
  ANALYSIS_PROGRESS: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    label: "Processing",
    variant: "outline",
    color: "text-muted-foreground",
  },
};

const defaultEventConfig = {
  icon: <MessageSquare className="h-3.5 w-3.5" />,
  label: "Event",
  variant: "outline" as const,
  color: "text-muted-foreground",
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getEventConfig(type: string) {
  return eventTypeConfig[type] || defaultEventConfig;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-500";
  if (confidence >= 0.6) return "bg-yellow-500";
  if (confidence >= 0.4) return "bg-orange-500";
  return "bg-red-500";
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

function extractIntelligenceData(event: IntelligenceEvent): {
  title: string | null;
  summary: string | null;
  confidence: number | null;
  sourceConversationId: string | null;
  targetType: "commitment" | "decision" | "claim" | null;
  targetId: string | null;
} {
  const payload = event.payload as Record<string, unknown>;

  return {
    title: (payload.title as string) || null,
    summary:
      (payload.summary as string) || (payload.statement as string) || null,
    confidence: (payload.confidence as number) ?? null,
    sourceConversationId:
      (payload.sourceConversationId as string) ||
      (payload.conversationId as string) ||
      (payload.threadId as string) ||
      null,
    targetType:
      (payload.targetType as "commitment" | "decision" | "claim") || null,
    targetId: (payload.targetId as string) || (payload.uioId as string) || null,
  };
}

// =============================================================================
// CONNECTION STATUS BADGE
// =============================================================================

function ConnectionStatusBadge({ state }: { state: ConnectionState }) {
  const statusConfig: Record<
    ConnectionState,
    { label: string; className: string }
  > = {
    connected: { label: "Live", className: "bg-green-500" },
    connecting: {
      label: "Connecting",
      className: "bg-yellow-500 animate-pulse",
    },
    disconnected: { label: "Offline", className: "bg-muted" },
    error: { label: "Error", className: "bg-red-500" },
  };

  const config = statusConfig[state];

  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-2 w-2 rounded-full", config.className)} />
      <span className="text-muted-foreground text-xs">{config.label}</span>
    </div>
  );
}

// =============================================================================
// CONFIDENCE BAR
// =============================================================================

function ConfidenceBar({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <Progress
              className="h-1.5 w-16"
              indicatorClassName={getConfidenceColor(confidence)}
              value={percentage}
            />
            <span className="text-muted-foreground text-xs">{percentage}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="text-xs" side="top">
          AI confidence: {percentage}%
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// INTELLIGENCE CARD
// =============================================================================

interface IntelligenceCardProps {
  event: IntelligenceEvent;
  organizationId: string;
  feedbackStatus: FeedbackStatus;
  onFeedback: (helpful: boolean) => void;
}

function IntelligenceCard({
  event,
  organizationId,
  feedbackStatus,
  onFeedback,
}: IntelligenceCardProps) {
  const config = getEventConfig(event.type);
  const data = extractIntelligenceData(event);

  // Skip rendering analysis progress events (too noisy)
  if (event.type === "ANALYSIS_PROGRESS") {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1, x: 0, height: "auto" }}
      className="group"
      exit={{ opacity: 0, x: 20, height: 0 }}
      initial={{ opacity: 0, x: -20, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge className="gap-1" variant={config.variant}>
              <span className={config.color}>{config.icon}</span>
              {config.label}
            </Badge>
            {data.confidence !== null && (
              <ConfidenceBar confidence={data.confidence} />
            )}
          </div>
          <span className="whitespace-nowrap text-muted-foreground text-xs">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>

        {/* Content */}
        <div className="mt-2">
          {data.title && (
            <p className="line-clamp-2 font-medium text-sm">{data.title}</p>
          )}
          {data.summary && !data.title && (
            <p className="line-clamp-2 text-muted-foreground text-sm">
              {data.summary}
            </p>
          )}
          {!(data.title || data.summary) && (
            <p className="text-muted-foreground text-sm">
              {event.type.replace(/_/g, " ").toLowerCase()}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          {/* Evidence link */}
          {data.sourceConversationId && (
            <Link
              className="flex items-center gap-1 text-blue-500 text-xs transition-colors hover:text-blue-600"
              params={{ threadId: data.sourceConversationId }}
              to="/dashboard/email/thread/$threadId"
            >
              View source
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
          {!data.sourceConversationId && <div />}

          {/* Feedback buttons */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {feedbackStatus === "pending" ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : feedbackStatus === "helpful" ? (
              <Badge className="gap-1 text-green-600" variant="secondary">
                <ThumbsUp className="h-3 w-3" />
                Helpful
              </Badge>
            ) : feedbackStatus === "not_useful" ? (
              <Badge
                className="gap-1 text-muted-foreground"
                variant="secondary"
              >
                <ThumbsDown className="h-3 w-3" />
                Dismissed
              </Badge>
            ) : (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="h-7 px-2 text-muted-foreground hover:text-green-600"
                        onClick={() => onFeedback(true)}
                        size="sm"
                        variant="ghost"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs" side="top">
                      This was helpful
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="h-7 px-2 text-muted-foreground hover:text-red-600"
                        onClick={() => onFeedback(false)}
                        size="sm"
                        variant="ghost"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs" side="top">
                      Not useful
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
      </div>
      <h4 className="font-medium text-sm">No intelligence yet</h4>
      <p className="mt-1 max-w-[200px] text-muted-foreground text-xs">
        AI discoveries will appear here in real-time as your emails are
        analyzed.
      </p>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function IntelligenceFeed({
  organizationId,
  className,
  maxHeight = "400px",
  showConnectionStatus = true,
}: IntelligenceFeedProps) {
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({});
  const queryClient = useQueryClient();

  // Connect to intelligence stream
  const { events, connectionState, clearEvents } = useIntelligenceStream({
    topics: ["uio.*", "analysis.*", "task.*"],
    maxEvents: 50,
    enableCacheInvalidation: true,
  });

  // Feedback mutations
  const verifyMutation = useMutation(
    trpc.feedback.verify.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["feedback"] });
      },
    })
  );

  const dismissMutation = useMutation(
    trpc.feedback.dismiss.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["feedback"] });
      },
    })
  );

  // Handle feedback
  const handleFeedback = useCallback(
    (event: IntelligenceEvent, helpful: boolean) => {
      const data = extractIntelligenceData(event);

      // We need a target type and id to submit feedback
      if (!(data.targetType && data.targetId)) {
        // Just update local state for events without proper targets
        setFeedbackState((prev) => ({
          ...prev,
          [event.id]: helpful ? "helpful" : "not_useful",
        }));
        return;
      }

      // Set pending state
      setFeedbackState((prev) => ({
        ...prev,
        [event.id]: "pending",
      }));

      if (helpful) {
        verifyMutation.mutate(
          {
            organizationId,
            targetId: data.targetId,
            targetType: data.targetType,
          },
          {
            onSuccess: () => {
              setFeedbackState((prev) => ({
                ...prev,
                [event.id]: "helpful",
              }));
            },
            onError: () => {
              setFeedbackState((prev) => ({
                ...prev,
                [event.id]: "none",
              }));
            },
          }
        );
      } else {
        dismissMutation.mutate(
          {
            organizationId,
            targetId: data.targetId,
            targetType: data.targetType,
            reason: "User marked as not useful from intelligence feed",
          },
          {
            onSuccess: () => {
              setFeedbackState((prev) => ({
                ...prev,
                [event.id]: "not_useful",
              }));
            },
            onError: () => {
              setFeedbackState((prev) => ({
                ...prev,
                [event.id]: "none",
              }));
            },
          }
        );
      }
    },
    [organizationId, verifyMutation, dismissMutation]
  );

  // Filter out progress events for display count
  const displayEvents = events.filter((e) => e.type !== "ANALYSIS_PROGRESS");

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Intelligence Feed</span>
          {displayEvents.length > 0 && (
            <Badge className="text-xs" variant="secondary">
              {displayEvents.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showConnectionStatus && (
            <ConnectionStatusBadge state={connectionState} />
          )}
          {displayEvents.length > 0 && (
            <Button
              className="h-7 px-2 text-xs"
              onClick={clearEvents}
              size="sm"
              variant="ghost"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Event List */}
      <ScrollArea className="flex-1" style={{ maxHeight }}>
        <div className="space-y-2 p-2">
          {displayEvents.length === 0 ? (
            <EmptyState />
          ) : (
            <AnimatePresence mode="popLayout">
              {displayEvents.map((event) => (
                <IntelligenceCard
                  event={event}
                  feedbackStatus={feedbackState[event.id] || "none"}
                  key={event.id}
                  onFeedback={(helpful) => handleFeedback(event, helpful)}
                  organizationId={organizationId}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// DRAWER VARIANT
// =============================================================================

interface IntelligenceFeedDrawerProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IntelligenceFeedDrawer({
  organizationId,
  open,
  onOpenChange,
}: IntelligenceFeedDrawerProps) {
  // Using a slide-over panel instead of a drawer for now
  // Can be converted to use Sheet from shadcn/ui if needed

  if (!open) return null;

  return (
    <motion.div
      animate={{ x: 0 }}
      className="fixed inset-y-0 right-0 z-50 w-80 border-l bg-background shadow-lg"
      exit={{ x: "100%" }}
      initial={{ x: "100%" }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b p-3">
          <h3 className="font-semibold">Intelligence Feed</h3>
          <Button onClick={() => onOpenChange(false)} size="sm" variant="ghost">
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
        <IntelligenceFeed
          maxHeight="calc(100vh - 60px)"
          organizationId={organizationId}
          showConnectionStatus={true}
        />
      </div>
    </motion.div>
  );
}

export default IntelligenceFeed;
