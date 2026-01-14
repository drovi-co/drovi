// =============================================================================
// COMMITMENT DETAIL SHEET
// =============================================================================
//
// Beautiful, insightful commitment details - showing the full story behind
// each promise: who, what, when, why, and the evidence trail.
//

import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from "date-fns";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  Pause,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentDetailData {
  id: string;
  title: string;
  description?: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "overdue" | "waiting" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  createdAt?: Date | null;
  completedAt?: Date | null;
  confidence: number;
  isUserVerified?: boolean;
  evidence?: string[];
  debtor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  creditor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  sourceThread?: {
    id: string;
    subject?: string | null;
    snippet?: string | null;
  } | null;
  snoozedUntil?: Date | null;
  metadata?: {
    originalText?: string;
    extractedAt?: string;
  } | null;
}

interface CommitmentDetailSheetProps {
  commitment: CommitmentDetailData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (commitmentId: string) => void;
  onSnooze?: (commitmentId: string, days: number) => void;
  onDismiss?: (commitmentId: string) => void;
  onVerify?: (commitmentId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onGenerateFollowUp?: (commitmentId: string) => void;
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

function getUrgencyLevel(dueDate: Date | null | undefined, status: string): "overdue" | "urgent" | "soon" | "normal" {
  if (status === "overdue" || status === "completed" || status === "cancelled") {
    return status === "overdue" ? "overdue" : "normal";
  }
  if (!dueDate) return "normal";
  if (isPast(dueDate)) return "overdue";
  if (isToday(dueDate) || isTomorrow(dueDate)) return "urgent";
  const daysUntil = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 7) return "soon";
  return "normal";
}

function getStatusConfig(status: string) {
  switch (status) {
    case "overdue":
      return { label: "Overdue", color: "text-red-600 bg-red-500/10", icon: AlertCircle };
    case "completed":
      return { label: "Completed", color: "text-green-600 bg-green-500/10", icon: CheckCircle2 };
    case "in_progress":
      return { label: "In Progress", color: "text-blue-600 bg-blue-500/10", icon: Clock };
    case "waiting":
      return { label: "Waiting", color: "text-amber-600 bg-amber-500/10", icon: Clock };
    case "snoozed":
      return { label: "Snoozed", color: "text-gray-600 bg-gray-500/10", icon: Pause };
    case "cancelled":
      return { label: "Cancelled", color: "text-gray-400 bg-gray-500/10", icon: X };
    default:
      return { label: "Pending", color: "text-purple-600 bg-purple-500/10", icon: Clock };
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CommitmentDetailSheet({
  commitment,
  open,
  onOpenChange,
  onComplete,
  onSnooze,
  onDismiss,
  onVerify,
  onThreadClick,
  onContactClick,
  onGenerateFollowUp,
}: CommitmentDetailSheetProps) {
  if (!commitment) return null;

  const urgency = getUrgencyLevel(commitment.dueDate, commitment.status);
  const statusConfig = getStatusConfig(commitment.status);
  const StatusIcon = statusConfig.icon;
  const otherPerson = commitment.direction === "owed_by_me" ? commitment.creditor : commitment.debtor;
  const isActive = !["completed", "cancelled"].includes(commitment.status);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:w-[540px] p-0 flex flex-col">
        {/* Header with gradient based on urgency */}
        <div className={cn(
          "px-6 pt-6 pb-4",
          urgency === "overdue" && "bg-gradient-to-b from-red-500/10 to-transparent",
          urgency === "urgent" && "bg-gradient-to-b from-orange-500/10 to-transparent",
          urgency === "soon" && "bg-gradient-to-b from-amber-500/10 to-transparent"
        )}>
          <SheetHeader className="space-y-4">
            {/* Direction & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-medium px-2 py-1 rounded-full",
                  commitment.direction === "owed_by_me"
                    ? "bg-blue-500/10 text-blue-600"
                    : "bg-purple-500/10 text-purple-600"
                )}>
                  {commitment.direction === "owed_by_me" ? "I owe this" : "Owed to me"}
                </span>
                {commitment.isUserVerified && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-2 py-1 rounded-full">
                    <ThumbsUp className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>
              <span className={cn(
                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                statusConfig.color
              )}>
                <StatusIcon className="h-3 w-3" />
                {statusConfig.label}
              </span>
            </div>

            {/* Title */}
            <SheetTitle className="text-xl font-semibold leading-tight pr-8">
              {commitment.title}
            </SheetTitle>

            {/* AI Confidence */}
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">AI Confidence</span>
                  <span className={cn(
                    "font-medium",
                    commitment.confidence >= 0.8 && "text-green-600",
                    commitment.confidence >= 0.5 && commitment.confidence < 0.8 && "text-amber-600",
                    commitment.confidence < 0.5 && "text-red-600"
                  )}>
                    {Math.round(commitment.confidence * 100)}%
                  </span>
                </div>
                <Progress
                  value={commitment.confidence * 100}
                  className="h-1.5"
                />
              </div>
            </div>
          </SheetHeader>
        </div>

        <Separator />

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          {/* People involved */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              People Involved
            </h4>
            <div className="space-y-2">
              {commitment.debtor && (
                <button
                  type="button"
                  onClick={() => onContactClick?.(commitment.debtor!.primaryEmail)}
                  className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-blue-500/10 text-blue-600 text-sm font-medium">
                      {getInitials(commitment.debtor.displayName, commitment.debtor.primaryEmail)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {commitment.debtor.displayName ?? commitment.debtor.primaryEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {commitment.direction === "owed_by_me" ? "You" : "Owes this commitment"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {commitment.creditor && (
                <button
                  type="button"
                  onClick={() => onContactClick?.(commitment.creditor!.primaryEmail)}
                  className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-purple-500/10 text-purple-600 text-sm font-medium">
                      {getInitials(commitment.creditor.displayName, commitment.creditor.primaryEmail)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {commitment.creditor.displayName ?? commitment.creditor.primaryEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {commitment.direction === "owed_to_me" ? "You" : "Expecting this commitment"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Timeline
            </h4>
            <div className="space-y-3">
              {commitment.dueDate && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center",
                    urgency === "overdue" && "bg-red-500/10",
                    urgency === "urgent" && "bg-orange-500/10",
                    urgency === "soon" && "bg-amber-500/10",
                    urgency === "normal" && "bg-muted"
                  )}>
                    <Calendar className={cn(
                      "h-5 w-5",
                      urgency === "overdue" && "text-red-600",
                      urgency === "urgent" && "text-orange-600",
                      urgency === "soon" && "text-amber-600",
                      urgency === "normal" && "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {isPast(commitment.dueDate) ? "Was due" : "Due"} {format(commitment.dueDate, "MMMM d, yyyy")}
                    </p>
                    <p className={cn(
                      "text-xs",
                      urgency === "overdue" && "text-red-600 font-medium",
                      urgency !== "overdue" && "text-muted-foreground"
                    )}>
                      {formatDistanceToNow(commitment.dueDate, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )}
              {commitment.snoozedUntil && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="h-10 w-10 rounded-lg bg-gray-500/10 flex items-center justify-center">
                    <Pause className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Snoozed until {format(commitment.snoozedUntil, "MMMM d")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(commitment.snoozedUntil, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )}
              {commitment.completedAt && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5">
                  <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Completed {format(commitment.completedAt, "MMMM d, yyyy")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(commitment.completedAt, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {commitment.description && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Details
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {commitment.description}
              </p>
            </div>
          )}

          {/* Evidence */}
          {(commitment.evidence?.length || commitment.metadata?.originalText) && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Evidence
              </h4>
              <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-sm italic text-muted-foreground leading-relaxed">
                  "{commitment.metadata?.originalText || commitment.evidence?.[0]}"
                </p>
                {commitment.metadata?.extractedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Extracted {formatDistanceToNow(new Date(commitment.metadata.extractedAt), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Source Thread */}
          {commitment.sourceThread && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Source
              </h4>
              <button
                type="button"
                onClick={() => onThreadClick?.(commitment.sourceThread!.id)}
                className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {commitment.sourceThread.subject ?? "Email thread"}
                  </p>
                  {commitment.sourceThread.snippet && (
                    <p className="text-xs text-muted-foreground truncate">
                      {commitment.sourceThread.snippet}
                    </p>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            </div>
          )}
        </div>

        <Separator />

        {/* Actions Footer */}
        <div className="p-4 space-y-3">
          {isActive && (
            <div className="flex gap-2">
              {onComplete && (
                <Button
                  onClick={() => onComplete(commitment.id)}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark Complete
                </Button>
              )}
              {commitment.direction === "owed_to_me" && urgency === "overdue" && onGenerateFollowUp && (
                <Button
                  variant="outline"
                  onClick={() => onGenerateFollowUp(commitment.id)}
                  className="flex-1"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send Follow-up
                </Button>
              )}
            </div>
          )}

          {isActive && onSnooze && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSnooze(commitment.id, 1)}
                className="flex-1"
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                1 day
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSnooze(commitment.id, 3)}
                className="flex-1"
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                3 days
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSnooze(commitment.id, 7)}
                className="flex-1"
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                1 week
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            {!commitment.isUserVerified && onVerify && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onVerify(commitment.id)}
                className="flex-1"
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                Verify
              </Button>
            )}
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDismiss(commitment.id)}
                className="flex-1 text-destructive hover:text-destructive"
              >
                <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
