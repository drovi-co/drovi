// =============================================================================
// COMMITMENTS COMMAND CENTER
// =============================================================================
//
// A revolutionary inbox view that replaces the thread list with an actionable
// intelligence view focused on commitments. Shows:
// - Overdue & At Risk commitments
// - Commitments "I Owe" (owed_by_me)
// - Commitments "Owed To Me" (owed_to_me)
//

import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow, isToday, isTomorrow, isPast } from "date-fns";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Eye,
  MessageSquare,
  MoreHorizontal,
  TimerOff,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useCommitmentUIOs } from "@/hooks/use-uio";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";

// =============================================================================
// TYPES
// =============================================================================

interface Commitment {
  id: string;
  title: string;
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  dueDate: string | null;
  confidence: number;
  isOverdue?: boolean;
  daysOverdue?: number;
  creditor?: {
    id: string;
    displayName: string | null;
    primaryEmail: string | null;
    avatarUrl?: string | null;
  } | null;
  debtor?: {
    id: string;
    displayName: string | null;
    primaryEmail: string | null;
    avatarUrl?: string | null;
  } | null;
  sourceConversationId?: string | null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CommitmentsCommandCenter() {
  const navigate = useNavigate();
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // Fetch commitments I owe using UIO hook
  const { data: owedByMeData, isLoading: isLoadingOwedByMe } = useCommitmentUIOs({
    organizationId,
    direction: "owed_by_me",
    limit: 50,
    enabled: Boolean(organizationId),
  });

  // Fetch commitments owed to me using UIO hook
  const { data: owedToMeData, isLoading: isLoadingOwedToMe } = useCommitmentUIOs({
    organizationId,
    direction: "owed_to_me",
    limit: 50,
    enabled: Boolean(organizationId),
  });

  // Helper to check if commitment is overdue
  const isCommitmentOverdue = (dueDate: Date | null | undefined): boolean => {
    if (!dueDate) return false;
    return isPast(dueDate) && !isToday(dueDate);
  };

  // Transform UIO data
  const owedByMe: Commitment[] = (owedByMeData?.items ?? []).map((c) => {
    const details = c.commitmentDetails;
    const dueDateParsed = c.dueDate ? new Date(c.dueDate) : null;
    return {
      id: c.id,
      title: c.userCorrectedTitle ?? c.canonicalTitle ?? "",
      status: details?.status ?? "pending",
      priority: details?.priority ?? "medium",
      direction: "owed_by_me" as const,
      dueDate: c.dueDate ?? null,
      confidence: c.overallConfidence ?? 0.8,
      isOverdue: isCommitmentOverdue(dueDateParsed),
      creditor: c.owner ? {
        id: c.owner.id,
        displayName: c.owner.displayName,
        primaryEmail: c.owner.primaryEmail,
        avatarUrl: c.owner.avatarUrl,
      } : undefined,
      sourceConversationId: c.sources?.[0]?.conversationId ?? null,
    };
  });

  const owedToMe: Commitment[] = (owedToMeData?.items ?? []).map((c) => {
    const details = c.commitmentDetails;
    const dueDateParsed = c.dueDate ? new Date(c.dueDate) : null;
    return {
      id: c.id,
      title: c.userCorrectedTitle ?? c.canonicalTitle ?? "",
      status: details?.status ?? "pending",
      priority: details?.priority ?? "medium",
      direction: "owed_to_me" as const,
      dueDate: c.dueDate ?? null,
      confidence: c.overallConfidence ?? 0.8,
      isOverdue: isCommitmentOverdue(dueDateParsed),
      debtor: c.owner ? {
        id: c.owner.id,
        displayName: c.owner.displayName,
        primaryEmail: c.owner.primaryEmail,
        avatarUrl: c.owner.avatarUrl,
      } : undefined,
      sourceConversationId: c.sources?.[0]?.conversationId ?? null,
    };
  });

  // Filter for urgent/at-risk
  const urgentCommitments = [
    ...owedByMe.filter((c) => c.isOverdue || c.priority === "urgent"),
    ...owedToMe.filter((c) => c.isOverdue || c.priority === "urgent"),
  ].sort((a, b) => {
    // Sort by overdue first, then by due date
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    return 0;
  });

  // Stats
  const totalOwedByMe = owedByMe.length;
  const totalOwedToMe = owedToMe.length;
  const overdueCount = [...owedByMe, ...owedToMe].filter((c) => c.isOverdue).length;
  const completedThisWeek = [...owedByMe, ...owedToMe].filter(
    (c) => c.status === "completed"
  ).length;

  // Handlers
  const handleCommitmentClick = useCallback(
    (commitment: Commitment) => {
      if (commitment.sourceConversationId) {
        navigate({
          to: "/dashboard/email/thread/$threadId",
          params: { threadId: commitment.sourceConversationId },
        });
      } else {
        toast.info("View commitment details", {
          description: commitment.title,
        });
      }
    },
    [navigate]
  );

  const handleMarkComplete = useCallback((id: string) => {
    toast.success("Marked as complete");
    // TODO: Call mutation to mark commitment as complete
  }, []);

  const handleSnooze = useCallback((id: string) => {
    toast.info("Snoozed for 1 day");
    // TODO: Call mutation to snooze commitment
  }, []);

  const isLoading = isLoadingOwedByMe || isLoadingOwedToMe;

  if (isLoading) {
    return <CommitmentsCommandCenterSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Stats Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Commitments Command Center</h2>
            <p className="text-sm text-muted-foreground">
              Track what you owe and what's owed to you
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{totalOwedByMe}</div>
              <div className="text-xs text-muted-foreground">I Owe</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{totalOwedToMe}</div>
              <div className="text-xs text-muted-foreground">Owed to Me</div>
            </div>
            {overdueCount > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{overdueCount}</div>
                <div className="text-xs text-muted-foreground">Overdue</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-3 gap-4 p-6">
          {/* Column 1: Needs Attention */}
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
                Needs Attention
              </CardTitle>
              <CardDescription className="text-red-600/80">
                Overdue or at-risk commitments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {urgentCommitments.length === 0 ? (
                <div className="py-8 text-center">
                  <Check className="mx-auto h-8 w-8 text-green-500" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    All caught up! No urgent items.
                  </p>
                </div>
              ) : (
                urgentCommitments.map((commitment) => (
                  <CommitmentCard
                    key={commitment.id}
                    commitment={commitment}
                    onClick={() => handleCommitmentClick(commitment)}
                    onMarkComplete={() => handleMarkComplete(commitment.id)}
                    onSnooze={() => handleSnooze(commitment.id)}
                    variant="urgent"
                  />
                ))
              )}
            </CardContent>
          </Card>

          {/* Column 2: I Owe */}
          <Card className="border-blue-200 bg-blue-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-blue-700">
                <ArrowUpRight className="h-5 w-5" />
                I Owe
              </CardTitle>
              <CardDescription className="text-blue-600/80">
                Commitments you've made to others
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {owedByMe.filter((c) => !c.isOverdue).length === 0 ? (
                <div className="py-8 text-center">
                  <Check className="mx-auto h-8 w-8 text-green-500" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No pending commitments!
                  </p>
                </div>
              ) : (
                owedByMe
                  .filter((c) => !c.isOverdue)
                  .slice(0, 10)
                  .map((commitment) => (
                    <CommitmentCard
                      key={commitment.id}
                      commitment={commitment}
                      onClick={() => handleCommitmentClick(commitment)}
                      onMarkComplete={() => handleMarkComplete(commitment.id)}
                      onSnooze={() => handleSnooze(commitment.id)}
                    />
                  ))
              )}
              {owedByMe.filter((c) => !c.isOverdue).length > 10 && (
                <Button variant="ghost" className="w-full text-blue-600">
                  View all {owedByMe.filter((c) => !c.isOverdue).length} commitments
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Column 3: Owed to Me */}
          <Card className="border-green-200 bg-green-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-green-700">
                <ArrowDownLeft className="h-5 w-5" />
                Owed to Me
              </CardTitle>
              <CardDescription className="text-green-600/80">
                Commitments others have made to you
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {owedToMe.filter((c) => !c.isOverdue).length === 0 ? (
                <div className="py-8 text-center">
                  <Check className="mx-auto h-8 w-8 text-green-500" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No pending commitments!
                  </p>
                </div>
              ) : (
                owedToMe
                  .filter((c) => !c.isOverdue)
                  .slice(0, 10)
                  .map((commitment) => (
                    <CommitmentCard
                      key={commitment.id}
                      commitment={commitment}
                      onClick={() => handleCommitmentClick(commitment)}
                      onMarkComplete={() => handleMarkComplete(commitment.id)}
                      onSnooze={() => handleSnooze(commitment.id)}
                    />
                  ))
              )}
              {owedToMe.filter((c) => !c.isOverdue).length > 10 && (
                <Button variant="ghost" className="w-full text-green-600">
                  View all {owedToMe.filter((c) => !c.isOverdue).length} commitments
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// COMMITMENT CARD
// =============================================================================

interface CommitmentCardProps {
  commitment: Commitment;
  onClick: () => void;
  onMarkComplete: () => void;
  onSnooze: () => void;
  variant?: "default" | "urgent";
}

function CommitmentCard({
  commitment,
  onClick,
  onMarkComplete,
  onSnooze,
  variant = "default",
}: CommitmentCardProps) {
  const person =
    commitment.direction === "owed_by_me" ? commitment.creditor : commitment.debtor;
  const personInitials = person?.displayName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "?";

  // Format due date
  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isPast(date)) {
      return `${formatDistanceToNow(date)} overdue`;
    }
    return `Due ${formatDistanceToNow(date, { addSuffix: true })}`;
  };

  const dueDateLabel = formatDueDate(commitment.dueDate);

  return (
    <div
      className={`
        group flex items-start gap-3 rounded-lg border bg-background p-3 shadow-sm transition-all
        hover:shadow-md cursor-pointer
        ${variant === "urgent" ? "border-red-200" : "border-border"}
        ${commitment.isOverdue ? "animate-pulse border-red-300" : ""}
      `}
      onClick={onClick}
    >
      {/* Person avatar */}
      <Avatar className="h-8 w-8">
        <AvatarImage src={person?.avatarUrl ?? undefined} />
        <AvatarFallback className="text-xs">{personInitials}</AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{commitment.title}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {person?.displayName && (
            <span className="text-xs text-muted-foreground">
              {commitment.direction === "owed_by_me" ? "To" : "From"}{" "}
              {person.displayName}
            </span>
          )}
          {dueDateLabel && (
            <Badge
              variant={commitment.isOverdue ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              <Calendar className="mr-1 h-3 w-3" />
              {dueDateLabel}
            </Badge>
          )}
        </div>
        {/* Confidence indicator */}
        {commitment.confidence < 0.7 && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={commitment.confidence * 100} className="h-1 flex-1" />
            <span className="text-[10px] text-orange-600">
              {Math.round(commitment.confidence * 100)}% confident
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onMarkComplete();
            }}
          >
            <Check className="mr-2 h-4 w-4" />
            Mark Complete
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onSnooze();
            }}
          >
            <TimerOff className="mr-2 h-4 w-4" />
            Snooze
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Source
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              // TODO: Open message composer
            }}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Follow Up
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function CommitmentsCommandCenterSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Stats Header Skeleton */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-1 h-4 w-64" />
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <Skeleton className="mx-auto h-8 w-12" />
              <Skeleton className="mt-1 h-3 w-10" />
            </div>
            <div className="text-center">
              <Skeleton className="mx-auto h-8 w-12" />
              <Skeleton className="mt-1 h-3 w-16" />
            </div>
          </div>
        </div>
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-3 gap-4 p-6">
        {[1, 2, 3].map((col) => (
          <Card key={col}>
            <CardHeader className="pb-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="mt-2 h-3 w-24" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
