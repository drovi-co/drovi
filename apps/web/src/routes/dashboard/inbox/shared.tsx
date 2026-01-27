// =============================================================================
// SHARED INBOX QUEUE PAGE
// =============================================================================
//
// Team shared inbox view with:
// - Conversation queue (unassigned + assigned items)
// - Team members panel with presence indicators
// - Claim/release functionality
// - SLA status indicators
//

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock,
  Inbox,
  Loader2,
  RefreshCw,
  User,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  PresenceIndicator,
  type PresenceStatus,
  QuickAssignButton,
  WhoIsViewing,
} from "@/components/collaboration";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOnlineUsers, useTrackViewing } from "@/hooks/use-presence";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/inbox/shared")({
  component: SharedInboxQueuePage,
});

// =============================================================================
// TYPES (inferred from API responses)
// =============================================================================

// Types are inferred from API - see sharedInbox router for schema

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SharedInboxQueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const organizationId = activeOrg?.id ?? "";
  const currentUserId = session?.user?.id ?? "";

  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"unassigned" | "my" | "all">(
    "unassigned"
  );

  // Track viewing shared inbox for presence
  useTrackViewing({
    organizationId,
    resourceType: "other",
    resourceId: selectedInboxId ?? "shared-inbox-default",
    enabled: Boolean(organizationId),
  });

  // Fetch shared inboxes
  const { data: inboxesData, isLoading: isLoadingInboxes } = useQuery({
    ...trpc.sharedInbox.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  // Set default inbox on load
  const inboxes = inboxesData?.inboxes ?? [];
  const activeInbox =
    inboxes.find((i) => i.id === selectedInboxId) ?? inboxes[0];
  const sharedInboxId = activeInbox?.id ?? "";

  // Fetch stats for the inbox
  const { data: statsData } = useQuery({
    ...trpc.sharedInbox.getStats.queryOptions({
      organizationId,
      sharedInboxId,
    }),
    enabled: Boolean(organizationId && sharedInboxId),
  });

  // Fetch assignments based on active tab
  const {
    data: assignmentsData,
    isLoading: isLoadingAssignments,
    refetch: refetchAssignments,
  } = useQuery({
    ...trpc.sharedInbox.getAssignments.queryOptions({
      organizationId,
      sharedInboxId,
      status:
        activeTab === "unassigned"
          ? "unassigned"
          : activeTab === "my"
            ? "assigned"
            : undefined,
      assigneeUserId: activeTab === "my" ? currentUserId : undefined,
      limit: 50,
    }),
    enabled: Boolean(organizationId && sharedInboxId),
    refetchInterval: 30_000, // Refresh every 30 seconds
  });

  // Get online users for presence
  const { data: onlineUsersData } = useOnlineUsers({
    organizationId,
    enabled: Boolean(organizationId),
  });

  // Build presence map
  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceStatus>();
    if (onlineUsersData?.users) {
      for (const user of onlineUsersData.users) {
        map.set(user.userId, (user.status as PresenceStatus) || "online");
      }
    }
    return map;
  }, [onlineUsersData?.users]);

  // Claim mutation
  const claimMutation = useMutation(
    trpc.sharedInbox.claim.mutationOptions({
      onSuccess: () => {
        toast.success("Conversation claimed");
        queryClient.invalidateQueries({ queryKey: ["sharedInbox"] });
        refetchAssignments();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to claim conversation");
      },
    })
  );

  // Release mutation
  const releaseMutation = useMutation(
    trpc.sharedInbox.release.mutationOptions({
      onSuccess: () => {
        toast.success("Conversation released");
        queryClient.invalidateQueries({ queryKey: ["sharedInbox"] });
        refetchAssignments();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to release conversation");
      },
    })
  );

  const handleClaim = (assignmentId: string) => {
    claimMutation.mutate({
      organizationId,
      sharedInboxId,
      assignmentId,
    });
  };

  const handleRelease = (assignmentId: string) => {
    releaseMutation.mutate({
      organizationId,
      sharedInboxId,
      assignmentId,
      reassign: true,
    });
  };

  const handleViewConversation = (conversationId: string) => {
    navigate({
      to: "/dashboard/inbox",
      search: { id: conversationId },
    });
  };

  const assignments = assignmentsData?.assignments ?? [];
  const members = statsData?.memberWorkloads ?? [];

  // Calculate stats
  const unassignedCount = statsData?.unassigned ?? 0;
  const myCount = assignments.filter(
    (a) => a.assigneeUserId === currentUserId
  ).length;
  const totalCount = statsData?.total ?? 0;
  const onlineMembers = members.filter((m) => presenceMap.has(m.userId));

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading organization...</p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))]">
        {/* Main queue area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="border-b bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <h1 className="flex items-center gap-2 font-semibold text-xl">
                    <Inbox className="h-5 w-5" />
                    Shared Inbox
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    Team queue for collaborative handling
                  </p>
                </div>

                {/* Inbox selector */}
                {inboxes.length > 1 && (
                  <Select
                    onValueChange={setSelectedInboxId}
                    value={selectedInboxId ?? activeInbox?.id}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select inbox" />
                    </SelectTrigger>
                    <SelectContent>
                      {inboxes.map((inbox) => (
                        <SelectItem key={inbox.id} value={inbox.id}>
                          {inbox.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Who's viewing this inbox */}
                {organizationId && (
                  <WhoIsViewing
                    compact
                    organizationId={organizationId}
                    resourceId={sharedInboxId || "shared-inbox-default"}
                    resourceType="other"
                  />
                )}
                <Button
                  disabled={isLoadingAssignments}
                  onClick={() => refetchAssignments()}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4",
                      isLoadingAssignments && "animate-spin"
                    )}
                  />
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              className="mt-4"
              onValueChange={(v) => setActiveTab(v as typeof activeTab)}
              value={activeTab}
            >
              <TabsList>
                <TabsTrigger className="gap-2" value="unassigned">
                  <Inbox className="h-4 w-4" />
                  Unassigned
                  {unassignedCount > 0 && (
                    <Badge className="text-[10px]" variant="secondary">
                      {unassignedCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger className="gap-2" value="my">
                  <User className="h-4 w-4" />
                  My Items
                  {myCount > 0 && (
                    <Badge className="text-[10px]" variant="secondary">
                      {myCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger className="gap-2" value="all">
                  <Users className="h-4 w-4" />
                  All
                  <Badge className="text-[10px]" variant="outline">
                    {totalCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoadingAssignments ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle className="mb-4 h-12 w-12 text-green-500" />
                <h3 className="font-semibold text-lg">Queue is clear</h3>
                <p className="text-muted-foreground text-sm">
                  {activeTab === "unassigned"
                    ? "No unassigned conversations"
                    : activeTab === "my"
                      ? "You have no assigned items"
                      : "No items in queue"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => (
                  <QueueItemCard
                    assignment={assignment}
                    currentUserId={currentUserId}
                    isClaimPending={claimMutation.isPending}
                    isReleasePending={releaseMutation.isPending}
                    key={assignment.id}
                    onClaim={() => handleClaim(assignment.id)}
                    onRelease={() => handleRelease(assignment.id)}
                    onView={() =>
                      assignment.conversationId &&
                      handleViewConversation(assignment.conversationId)
                    }
                    organizationId={organizationId}
                    sharedInboxId={sharedInboxId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Team sidebar */}
        <div className="w-80 border-l bg-card">
          <div className="border-b p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <Users className="h-4 w-4" />
              Team Members
            </h2>
            <p className="text-muted-foreground text-xs">
              {onlineMembers.length} online of {members.length} total
            </p>
          </div>

          <div className="overflow-y-auto p-4">
            {statsData ? (
              members.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No members in this inbox
                </div>
              ) : (
                <div className="space-y-3">
                  {members.map((member) => {
                    const presenceStatus =
                      presenceMap.get(member.userId) ?? "offline";
                    const initials =
                      member.user.name
                        ?.split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2) ?? "?";
                    const maxAssignments = member.maxAssignments ?? 10;
                    const workloadPercent =
                      maxAssignments > 0
                        ? Math.round(
                            (member.currentAssignments / maxAssignments) * 100
                          )
                        : 0;

                    return (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-lg p-2 transition-colors",
                          presenceStatus === "online" && "bg-green-500/5"
                        )}
                        key={member.userId}
                      >
                        <div className="relative">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              alt={member.user.name ?? undefined}
                              src={member.user.image ?? undefined}
                            />
                            <AvatarFallback>{initials}</AvatarFallback>
                          </Avatar>
                          <span className="absolute -right-0.5 -bottom-0.5">
                            <PresenceIndicator
                              size="sm"
                              status={presenceStatus}
                            />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-sm">
                              {member.user.name ?? "Unknown"}
                            </span>
                            {member.availability !== "available" && (
                              <Badge className="text-[10px]" variant="outline">
                                {member.availability}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">
                              {member.currentAssignments} / {maxAssignments}{" "}
                              items
                            </span>
                            {/* Workload bar */}
                            <div className="h-1.5 flex-1 rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  workloadPercent >= 90
                                    ? "bg-red-500"
                                    : workloadPercent >= 70
                                      ? "bg-amber-500"
                                      : "bg-green-500"
                                )}
                                style={{
                                  width: `${Math.min(workloadPercent, 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    className="flex animate-pulse items-center gap-3"
                    key={i}
                  >
                    <div className="h-10 w-10 rounded-full bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 rounded bg-muted" />
                      <div className="h-3 w-16 rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// QUEUE ITEM CARD
// =============================================================================

interface QueueItemCardProps {
  assignment: {
    id: string;
    conversationId: string;
    status: string;
    assigneeUserId: string | null;
    firstResponseDueAt?: string | null;
    createdAt: string;
    conversation: {
      id: string;
      title: string | null;
      snippet: string | null;
      lastMessageAt: string | null;
    } | null;
    assignee: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
    } | null;
  };
  currentUserId: string;
  organizationId: string;
  sharedInboxId: string;
  onClaim: () => void;
  onRelease: () => void;
  onView: () => void;
  isClaimPending: boolean;
  isReleasePending: boolean;
}

function QueueItemCard({
  assignment,
  currentUserId,
  organizationId,
  sharedInboxId,
  onClaim,
  onRelease,
  onView,
  isClaimPending,
  isReleasePending,
}: QueueItemCardProps) {
  const isAssignedToMe = assignment.assigneeUserId === currentUserId;
  const isAssigned = Boolean(assignment.assigneeUserId);

  // Determine SLA status
  const now = new Date();
  const dueAt = assignment.firstResponseDueAt
    ? new Date(assignment.firstResponseDueAt)
    : null;
  const slaStatus =
    dueAt && now > dueAt
      ? "breached"
      : dueAt && now.getTime() > dueAt.getTime() - 30 * 60 * 1000
        ? "warning"
        : "ok";

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50",
        slaStatus === "breached" && "border-red-500/50",
        slaStatus === "warning" && "border-amber-500/50"
      )}
    >
      {/* SLA indicator */}
      <div className="flex flex-col items-center gap-1">
        {slaStatus === "breached" ? (
          <AlertTriangle className="h-5 w-5 text-red-500" />
        ) : slaStatus === "warning" ? (
          <Clock className="h-5 w-5 text-amber-500" />
        ) : (
          <Clock className="h-5 w-5 text-muted-foreground" />
        )}
        {dueAt && (
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(dueAt, { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge className="shrink-0 text-[10px] capitalize" variant="outline">
            {assignment.status}
          </Badge>
          <span className="truncate font-medium">
            {assignment.conversation?.title ?? "Untitled"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <span>{format(new Date(assignment.createdAt), "MMM d, h:mm a")}</span>
          {isAssigned && assignment.assignee && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <UserCheck className="h-3 w-3" />
                {isAssignedToMe
                  ? "You"
                  : (assignment.assignee.name ?? "Unknown")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        {isAssigned ? (
          isAssignedToMe ? (
            <Button
              disabled={isReleasePending}
              onClick={(e) => {
                e.stopPropagation();
                onRelease();
              }}
              size="sm"
              variant="outline"
            >
              {isReleasePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Release"
              )}
            </Button>
          ) : (
            <QuickAssignButton
              assignmentId={assignment.id}
              conversationTitle={assignment.conversation?.title ?? undefined}
              currentAssigneeId={assignment.assigneeUserId}
              currentAssigneeName={assignment.assignee?.name}
              organizationId={organizationId}
              sharedInboxId={sharedInboxId}
              size="sm"
            />
          )
        ) : (
          <Button
            disabled={isClaimPending}
            onClick={(e) => {
              e.stopPropagation();
              onClaim();
            }}
            size="sm"
          >
            {isClaimPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="mr-1 h-4 w-4" />
                Claim
              </>
            )}
          </Button>
        )}

        <Button
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          size="sm"
          variant="ghost"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
