// =============================================================================
// CONVERSATION LIST PANEL COMPONENT
// =============================================================================
//
// Left panel (1/3 width) displaying conversations in a list.
// Features:
// - Task-style collapsible items
// - Selection state management
// - Loading and empty states
// - Keyboard navigation (j/k)

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useRef } from "react";

import {
  ConversationListItem,
  type ConversationListItemData,
} from "@/components/smart-inbox/conversation-list-item";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SourceType } from "@/lib/source-config";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export type ConversationTab = "all" | "unread" | "starred" | "done";

export interface ConversationFilters {
  tab?: ConversationTab;
  sourceTypes?: SourceType[];
  search?: string;
}

export interface ConversationListPanelProps {
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filters?: ConversationFilters;
  className?: string;
}

// =============================================================================
// CONVERSATION LIST PANEL COMPONENT
// =============================================================================

export function ConversationListPanel({
  selectedId,
  onSelect,
  filters = {},
  className,
}: ConversationListPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Build status filter from tab
  const statusFilter = (() => {
    switch (filters.tab) {
      case "unread":
        return ["unread" as const];
      case "starred":
        return ["starred" as const];
      case "done":
        return ["done" as const];
      default:
        return undefined;
    }
  })();

  // Fetch conversations
  const { data, isLoading, isFetching } = useQuery(
    trpc.unifiedInbox.list.queryOptions({
      sourceTypes: filters.sourceTypes,
      status: statusFilter,
      search: filters.search,
      limit: 100,
      offset: 0,
    })
  );

  // Star mutation
  const starMutation = useMutation(
    trpc.unifiedInbox.star.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.list.queryKey(),
        });
      },
    })
  );

  // Mark done mutation
  const markDoneMutation = useMutation(
    trpc.unifiedInbox.markDone.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.list.queryKey(),
        });
      },
    })
  );

  // Transform API response to component format
  const items: ConversationListItemData[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    sourceType: item.sourceType as SourceType,
    sourceAccountName: item.sourceAccountName,
    title: item.title,
    snippet: item.snippet,
    brief: item.brief,
    participants: item.participants.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      avatarUrl: undefined,
    })),
    messageCount: item.messageCount,
    lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
    isRead: item.isRead,
    isStarred: item.isStarred,
    isDone: item.isDone,
    priorityTier: item.priorityTier,
    hasOpenLoops: item.hasOpenLoops,
    openLoopCount: item.openLoopCount,
    hasCommitments: item.hasCommitments,
    hasDecisions: item.hasDecisions,
  }));

  // Keyboard navigation
  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  const navigateToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < items.length) {
        const item = items[index];
        if (item) {
          onSelect(item.id);
          // Scroll into view
          const element = document.getElementById(`conversation-${item.id}`);
          element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    },
    [items, onSelect]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        navigateToIndex(selectedIndex + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateToIndex(selectedIndex - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, navigateToIndex]);

  // Handlers
  const handleToggleStar = useCallback(
    (conversationId: string) => {
      const item = items.find((i) => i.id === conversationId);
      if (item) {
        starMutation.mutate({
          conversationId,
          starred: !item.isStarred,
        });
      }
    },
    [items, starMutation]
  );

  const handleToggleDone = useCallback(
    (conversationId: string) => {
      const item = items.find((i) => i.id === conversationId);
      if (item) {
        const newDoneState = !item.isDone;
        markDoneMutation.mutate(
          {
            conversationId,
            done: newDoneState,
          },
          {
            onSuccess: () => {
              toast.success(
                newDoneState
                  ? "Conversation marked as done"
                  : "Conversation marked as not done"
              );
            },
            onError: () => {
              toast.error("Failed to update conversation status");
            },
          }
        );
      }
    },
    [items, markDoneMutation]
  );

  // Tab label for header
  const tabLabel = (() => {
    switch (filters.tab) {
      case "unread":
        return "Unread";
      case "starred":
        return "Starred";
      case "done":
        return "Done";
      default:
        return "Conversations";
    }
  })();

  return (
    <div className={cn("flex h-full flex-col border-r bg-card", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-sm">{tabLabel}</h2>
          {data?.total !== undefined && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
              {data.total}
            </Badge>
          )}
          {filters.sourceTypes && filters.sourceTypes.length > 0 && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="outline">
              {filters.sourceTypes.length} source
              {filters.sourceTypes.length > 1 ? "s" : ""}
            </Badge>
          )}
          {isFetching && !isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* List content */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <ConversationListItemSkeleton key={`skeleton-${i}`} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState tab={filters.tab} />
        ) : (
          <div>
            {items.map((item) => (
              <div id={`conversation-${item.id}`} key={item.id}>
                <ConversationListItem
                  conversation={item}
                  onClick={() => onSelect(item.id)}
                  onToggleDone={handleToggleDone}
                  onToggleStar={handleToggleStar}
                  selected={item.id === selectedId}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function ConversationListItemSkeleton() {
  return (
    <div className="border-border/50 border-b p-3">
      {/* Top row: ID / Date */}
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-4" />
        </div>
      </div>
      {/* Title */}
      <Skeleton className="mb-2 h-4 w-4/5" />
      {/* Bottom row */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ tab }: { tab?: ConversationTab }) {
  const getMessage = () => {
    switch (tab) {
      case "unread":
        return {
          title: "All caught up!",
          description: "No unread conversations",
        };
      case "starred":
        return {
          title: "No starred conversations",
          description: "Star important conversations to find them quickly",
        };
      case "done":
        return {
          title: "No completed conversations",
          description: "Mark conversations as done to see them here",
        };
      default:
        return {
          title: "No conversations yet",
          description: "Connect your accounts to see conversations here",
        };
    }
  };

  const { title, description } = getMessage();

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="mt-1 text-muted-foreground text-xs">{description}</p>
    </div>
  );
}
