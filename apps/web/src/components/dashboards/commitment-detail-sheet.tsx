// =============================================================================
// COMMITMENT DETAIL SHEET
// =============================================================================
//
// Beautiful, insightful commitment details - showing the full story behind
// each promise: who, what, when, why, and the evidence trail.
//

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
  X,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/i18n";
import { formatRelativeTime } from "@/lib/intl-time";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentDetailData {
  id: string;
  title: string;
  description?: string | null;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "overdue"
    | "waiting"
    | "snoozed";
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

function getLocalDayDiff(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyLevel(
  dueDate: Date | null | undefined,
  status: string
): "overdue" | "urgent" | "soon" | "normal" {
  if (
    status === "overdue" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status === "overdue" ? "overdue" : "normal";
  }
  if (!dueDate) {
    return "normal";
  }
  const diffDays = getLocalDayDiff(dueDate);
  if (diffDays < 0) {
    return "overdue";
  }
  if (diffDays === 0 || diffDays === 1) {
    return "urgent";
  }
  if (diffDays <= 7) {
    return "soon";
  }
  return "normal";
}

function getStatusConfig(status: string) {
  switch (status) {
    case "overdue":
      return {
        labelKey: "components.commitmentDetailSheet.status.overdue",
        color: "text-red-600 bg-red-500/10",
        icon: AlertCircle,
      };
    case "completed":
      return {
        labelKey: "components.commitmentDetailSheet.status.completed",
        color: "text-green-600 bg-green-500/10",
        icon: CheckCircle2,
      };
    case "in_progress":
      return {
        labelKey: "components.commitmentDetailSheet.status.inProgress",
        color: "text-blue-600 bg-blue-500/10",
        icon: Clock,
      };
    case "waiting":
      return {
        labelKey: "components.commitmentDetailSheet.status.waiting",
        color: "text-amber-600 bg-amber-500/10",
        icon: Clock,
      };
    case "snoozed":
      return {
        labelKey: "components.commitmentDetailSheet.status.snoozed",
        color: "text-gray-600 bg-gray-500/10",
        icon: Pause,
      };
    case "cancelled":
      return {
        labelKey: "components.commitmentDetailSheet.status.cancelled",
        color: "text-gray-400 bg-gray-500/10",
        icon: X,
      };
    default:
      return {
        labelKey: "components.commitmentDetailSheet.status.pending",
        color: "text-purple-600 bg-purple-500/10",
        icon: Clock,
      };
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
  const { locale, t } = useI18n();
  if (!commitment) {
    return null;
  }

  const urgency = getUrgencyLevel(commitment.dueDate, commitment.status);
  const statusConfig = getStatusConfig(commitment.status);
  const StatusIcon = statusConfig.icon;
  const otherPerson =
    commitment.direction === "owed_by_me"
      ? commitment.creditor
      : commitment.debtor;
  const isActive = !["completed", "cancelled"].includes(commitment.status);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="flex w-[480px] flex-col p-0 sm:w-[540px]">
        {/* Header with gradient based on urgency */}
        <div
          className={cn(
            "px-6 pt-6 pb-4",
            urgency === "overdue" &&
              "bg-gradient-to-b from-red-500/10 to-transparent",
            urgency === "urgent" &&
              "bg-gradient-to-b from-orange-500/10 to-transparent",
            urgency === "soon" &&
              "bg-gradient-to-b from-amber-500/10 to-transparent"
          )}
        >
          <SheetHeader className="space-y-4">
            {/* Direction & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-1 font-medium text-xs",
                    commitment.direction === "owed_by_me"
                      ? "bg-blue-500/10 text-blue-600"
                      : "bg-purple-500/10 text-purple-600"
                  )}
                >
                  {commitment.direction === "owed_by_me"
                    ? t("components.commitmentDetailSheet.direction.owedByMe")
                    : t("components.commitmentDetailSheet.direction.owedToMe")}
                </span>
                {commitment.isUserVerified && (
                  <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 text-green-600 text-xs">
                    <ThumbsUp className="h-3 w-3" />
                    {t("components.commitmentDetailSheet.verified")}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-1 font-medium text-xs",
                  statusConfig.color
                )}
              >
                <StatusIcon className="h-3 w-3" />
                {t(statusConfig.labelKey)}
              </span>
            </div>

            {/* Title */}
            <SheetTitle className="pr-8 font-semibold text-xl leading-tight">
              {commitment.title}
            </SheetTitle>

            {/* AI Confidence */}
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {t("components.commitmentDetailSheet.aiConfidence")}
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      commitment.confidence >= 0.8 && "text-green-600",
                      commitment.confidence >= 0.5 &&
                        commitment.confidence < 0.8 &&
                        "text-amber-600",
                      commitment.confidence < 0.5 && "text-red-600"
                    )}
                  >
                    {Math.round(commitment.confidence * 100)}%
                  </span>
                </div>
                <Progress
                  className="h-1.5"
                  value={commitment.confidence * 100}
                />
              </div>
            </div>
          </SheetHeader>
        </div>

        <Separator />

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-auto px-6 py-4">
          {/* People involved */}
          <div className="space-y-3">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {t("components.commitmentDetailSheet.sections.peopleInvolved")}
            </h4>
            <div className="space-y-2">
              {commitment.debtor && (
                <button
                  className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                  onClick={() =>
                    onContactClick?.(commitment.debtor!.primaryEmail)
                  }
                  type="button"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-blue-500/10 font-medium text-blue-600 text-sm">
                      {getInitials(
                        commitment.debtor.displayName,
                        commitment.debtor.primaryEmail
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">
                      {commitment.debtor.displayName ??
                        commitment.debtor.primaryEmail}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {commitment.direction === "owed_by_me"
                        ? t("components.commitmentDetailSheet.people.you")
                        : t("components.commitmentDetailSheet.people.owesThis")}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {commitment.creditor && (
                <button
                  className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                  onClick={() =>
                    onContactClick?.(commitment.creditor!.primaryEmail)
                  }
                  type="button"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-purple-500/10 font-medium text-purple-600 text-sm">
                      {getInitials(
                        commitment.creditor.displayName,
                        commitment.creditor.primaryEmail
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">
                      {commitment.creditor.displayName ??
                        commitment.creditor.primaryEmail}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {commitment.direction === "owed_to_me"
                        ? t("components.commitmentDetailSheet.people.you")
                        : t(
                            "components.commitmentDetailSheet.people.expectingThis"
                          )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-3">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {t("components.commitmentDetailSheet.sections.timeline")}
            </h4>
            <div className="space-y-3">
              {commitment.dueDate && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      urgency === "overdue" && "bg-red-500/10",
                      urgency === "urgent" && "bg-orange-500/10",
                      urgency === "soon" && "bg-amber-500/10",
                      urgency === "normal" && "bg-muted"
                    )}
                  >
                    <Calendar
                      className={cn(
                        "h-5 w-5",
                        urgency === "overdue" && "text-red-600",
                        urgency === "urgent" && "text-orange-600",
                        urgency === "soon" && "text-amber-600",
                        urgency === "normal" && "text-muted-foreground"
                      )}
                    />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {getLocalDayDiff(commitment.dueDate) < 0
                        ? t("components.commitmentDetailSheet.timeline.wasDue")
                        : t(
                            "components.commitmentDetailSheet.timeline.due"
                          )}{" "}
                      {new Intl.DateTimeFormat(locale, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }).format(commitment.dueDate)}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        urgency === "overdue" && "font-medium text-red-600",
                        urgency !== "overdue" && "text-muted-foreground"
                      )}
                    >
                      {formatRelativeTime(commitment.dueDate, locale)}
                    </p>
                  </div>
                </div>
              )}
              {commitment.snoozedUntil && (
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-500/10">
                    <Pause className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {t(
                        "components.commitmentDetailSheet.timeline.snoozedUntil",
                        {
                          date: new Intl.DateTimeFormat(locale, {
                            month: "long",
                            day: "numeric",
                          }).format(commitment.snoozedUntil),
                        }
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatRelativeTime(commitment.snoozedUntil, locale)}
                    </p>
                  </div>
                </div>
              )}
              {commitment.completedAt && (
                <div className="flex items-center gap-3 rounded-lg bg-green-500/5 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {t(
                        "components.commitmentDetailSheet.timeline.completed",
                        {
                          date: new Intl.DateTimeFormat(locale, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          }).format(commitment.completedAt),
                        }
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatRelativeTime(commitment.completedAt, locale)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {commitment.description && (
            <div className="space-y-3">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                {t("components.commitmentDetailSheet.sections.details")}
              </h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {commitment.description}
              </p>
            </div>
          )}

          {/* Evidence */}
          {(commitment.evidence?.length ||
            commitment.metadata?.originalText) && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <FileText className="h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.sections.evidence")}
              </h4>
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
                <p className="text-muted-foreground text-sm italic leading-relaxed">
                  "
                  {commitment.metadata?.originalText ||
                    commitment.evidence?.[0]}
                  "
                </p>
                {commitment.metadata?.extractedAt && (
                  <p className="mt-2 text-muted-foreground text-xs">
                    {t("components.commitmentDetailSheet.evidence.extracted", {
                      time: formatRelativeTime(
                        new Date(commitment.metadata.extractedAt),
                        locale
                      ),
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Source Thread */}
          {commitment.sourceThread && (
            <div className="space-y-3">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                {t("components.commitmentDetailSheet.sections.source")}
              </h4>
              <button
                className="group flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                onClick={() => onThreadClick?.(commitment.sourceThread!.id)}
                type="button"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {commitment.sourceThread.subject ??
                      t(
                        "components.commitmentDetailSheet.sourceThread.emailThreadFallback"
                      )}
                  </p>
                  {commitment.sourceThread.snippet && (
                    <p className="truncate text-muted-foreground text-xs">
                      {commitment.sourceThread.snippet}
                    </p>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
            </div>
          )}
        </div>

        <Separator />

        {/* Actions Footer */}
        <div className="space-y-3 p-4">
          {isActive && (
            <div className="flex gap-2">
              {onComplete && (
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  onClick={() => onComplete(commitment.id)}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {t("components.commitmentDetailSheet.actions.markComplete")}
                </Button>
              )}
              {commitment.direction === "owed_to_me" &&
                urgency === "overdue" &&
                onGenerateFollowUp && (
                  <Button
                    className="flex-1"
                    onClick={() => onGenerateFollowUp(commitment.id)}
                    variant="outline"
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    {t("components.commitmentDetailSheet.actions.sendFollowUp")}
                  </Button>
                )}
            </div>
          )}

          {isActive && onSnooze && (
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => onSnooze(commitment.id, 1)}
                size="sm"
                variant="ghost"
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.actions.snooze1d")}
              </Button>
              <Button
                className="flex-1"
                onClick={() => onSnooze(commitment.id, 3)}
                size="sm"
                variant="ghost"
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.actions.snooze3d")}
              </Button>
              <Button
                className="flex-1"
                onClick={() => onSnooze(commitment.id, 7)}
                size="sm"
                variant="ghost"
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.actions.snooze1w")}
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            {!commitment.isUserVerified && onVerify && (
              <Button
                className="flex-1"
                onClick={() => onVerify(commitment.id)}
                size="sm"
                variant="outline"
              >
                <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.actions.verify")}
              </Button>
            )}
            {onDismiss && (
              <Button
                className="flex-1 text-destructive hover:text-destructive"
                onClick={() => onDismiss(commitment.id)}
                size="sm"
                variant="ghost"
              >
                <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                {t("components.commitmentDetailSheet.actions.dismiss")}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
