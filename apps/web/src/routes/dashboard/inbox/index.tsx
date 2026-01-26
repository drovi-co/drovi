// =============================================================================
// UNIFIED INBOX PAGE - Multi-Source Smart Inbox with 3-Column Layout
// =============================================================================

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Calendar,
  CheckCircle2,
  FileText,
  Hash,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCommandBar } from "@/components/email/command-bar";
import {
  type InboxItem,
  InboxListHeader,
  InboxRow,
} from "@/components/inbox/inbox-row";
import { EmailPreviewPane } from "@/components/inbox/email-preview-pane";
import { IntelligenceSheet } from "@/components/inbox/intelligence-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveOrganization } from "@/lib/auth-client";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/inbox/")({
  component: UnifiedInboxPage,
});

// =============================================================================
// TYPES
// =============================================================================

type SourceFilter =
  | "all"
  | "email"
  | "slack"
  | "calendar"
  | "whatsapp"
  | "notion"
  | "google_docs";
type StatusFilter = "all" | "focused" | "others";
type ViewTab = "all" | "focused" | "others";

interface UnifiedFeedItem {
  id: string;
  sourceType: SourceType;
  sourceAccountId: string;
  sourceAccountName?: string;
  externalId: string;
  conversationType: string | null;
  title: string;
  snippet: string;
  brief?: string | null;
  participants: Array<{ id: string; name?: string; email?: string }>;
  messageCount: number;
  lastMessageAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  priorityTier: string | null;
  urgencyScore: number | null;
  importanceScore: number | null;
  hasOpenLoops: boolean | null;
  openLoopCount: number | null;
  suggestedAction: string | null;
  hasCommitments: boolean;
  hasDecisions: boolean;
  // Linked task data - enables task dropdowns when present
  task?: {
    id: string;
    status:
      | "backlog"
      | "todo"
      | "in_progress"
      | "in_review"
      | "done"
      | "cancelled";
    priority: "no_priority" | "low" | "medium" | "high" | "urgent";
    assignee: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
    } | null;
  };
  metadata?: Record<string, unknown>;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function UnifiedInboxPage() {
  const navigate = useNavigate();
  const {
    open: commandBarOpen,
    setOpen: setCommandBarOpen,
    openCompose,
  } = useCommandBar();
  const listRef = useRef<HTMLDivElement>(null);
  const { data: activeOrg } = useActiveOrganization();

  // State
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [viewTab, setViewTab] = useState<ViewTab>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Intelligence sheet state
  const [intelligenceSheetOpen, setIntelligenceSheetOpen] = useState(false);
  const [intelligenceThreadId, setIntelligenceThreadId] = useState<
    string | null
  >(null);
  const [intelligenceThreadTitle, setIntelligenceThreadTitle] = useState<
    string | undefined
  >(undefined);

  // Build filter for API based on view tab
  const getStatusArray = ():
    | ("read" | "unread" | "starred" | "archived")[]
    | undefined => {
    // For now, focused = unread + high priority (handled in filtering)
    // Others = read + low priority
    // All = no filter
    return undefined;
  };

  const getSourceTypesArray = () => {
    if (sourceFilter === "all") return undefined;
    return [sourceFilter];
  };

  // Pagination state
  const PAGE_SIZE = 50;
  const [currentLimit, setCurrentLimit] = useState(PAGE_SIZE);

  // Fetch unified inbox items with pagination
  const {
    data: inboxData,
    isLoading: isLoadingInbox,
    isFetching: isFetchingInbox,
    refetch: refetchInbox,
  } = useQuery({
    ...trpc.unifiedInbox.list.queryOptions({
      sourceTypes: getSourceTypesArray(),
      status: getStatusArray(),
      limit: currentLimit,
      offset: 0,
    }),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    placeholderData: (previousData) => previousData, // Keep showing old data while fetching
  });

  // Pagination helpers
  const hasNextPage = inboxData?.hasMore ?? false;
  const totalCount = inboxData?.total ?? 0;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingInbox) {
      setCurrentLimit((prev) => prev + PAGE_SIZE);
    }
  }, [hasNextPage, isFetchingInbox]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentLimit(PAGE_SIZE);
  }, [sourceFilter, viewTab]);

  // Fetch stats - long cache, rarely changes
  const { data: statsData } = useQuery({
    ...trpc.unifiedInbox.getStats.queryOptions(),
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000, // Keep stats in cache for 10 minutes
  });

  // Get current query key for optimistic updates
  const currentQueryKey = [
    "unifiedInbox",
    "list",
    { sourceTypes: getSourceTypesArray(), status: getStatusArray() },
  ];

  // Mutations with optimistic updates for instant feedback
  const markReadMutation = useMutation(
    trpc.unifiedInbox.markRead.mutationOptions({
      onMutate: async ({ conversationId, read }) => {
        // Cancel outgoing refetches
        await queryClient.cancelQueries({ queryKey: currentQueryKey });
        // Optimistically update
        queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === conversationId ? { ...item, isRead: read } : item
            ),
          };
        });
        return undefined;
      },
      onSettled: () => {
        // Sync with server in background (don't await)
        queryClient.invalidateQueries({
          queryKey: ["unifiedInbox", "getStats"],
        });
      },
    })
  );

  const starMutation = useMutation(
    trpc.unifiedInbox.star.mutationOptions({
      onMutate: async ({ conversationId, starred }) => {
        await queryClient.cancelQueries({ queryKey: currentQueryKey });
        queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === conversationId
                ? { ...item, isStarred: starred }
                : item
            ),
          };
        });
        return undefined;
      },
    })
  );

  const archiveMutation = useMutation(
    trpc.unifiedInbox.archive.mutationOptions({
      onMutate: async ({ conversationId }) => {
        await queryClient.cancelQueries({ queryKey: currentQueryKey });
        // Optimistically remove from list
        queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== conversationId),
            total: old.total - 1,
          };
        });
        return undefined;
      },
      onSuccess: () => {
        toast.success("Archived");
      },
      onError: () => {
        toast.error("Failed to archive");
      },
      onSettled: () => {
        queryClient.invalidateQueries({
          queryKey: ["unifiedInbox", "getStats"],
        });
      },
    })
  );

  // Transform data
  const allItems: UnifiedFeedItem[] = (inboxData?.items ?? []).map((item) => ({
    ...item,
    lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
  }));

  // Filter items based on viewTab (Focused/Others)
  // Focused: High priority, unread, has open loops, or has commitments
  // Others: Everything else (low priority, newsletters, automated)
  const items = allItems.filter((item) => {
    if (viewTab === "all") return true;

    const isFocused =
      item.priorityTier === "urgent" ||
      item.priorityTier === "high" ||
      !item.isRead ||
      item.hasOpenLoops ||
      item.hasCommitments ||
      (item.urgencyScore ?? 0) > 60 ||
      (item.importanceScore ?? 0) > 60;

    if (viewTab === "focused") return isFocused;
    if (viewTab === "others") return !isFocused;

    return true;
  });

  // Calculate focused/others counts for tabs
  const focusedCount = allItems.filter(
    (item) =>
      item.priorityTier === "urgent" ||
      item.priorityTier === "high" ||
      !item.isRead ||
      item.hasOpenLoops ||
      item.hasCommitments ||
      (item.urgencyScore ?? 0) > 60 ||
      (item.importanceScore ?? 0) > 60
  ).length;
  const othersCount = allItems.length - focusedCount;

  // Virtualizer for performant rendering
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40, // Linear-style row height
    overscan: 10,
  });

  // Selection handlers
  const handleSelectItem = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedIds(new Set(items.map((item) => item.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [items]
  );

  // Handlers
  const handleItemClick = useCallback(
    (item: UnifiedFeedItem) => {
      // Mark as read
      markReadMutation.mutate({ conversationId: item.id, read: true });

      // For email, select in preview pane; for other sources, handle externally
      switch (item.sourceType) {
        case "email":
          // Select in preview pane instead of navigating
          setSelectedThreadId(item.id);
          setSelectedIndex(items.findIndex((i) => i.id === item.id));
          break;

        case "slack": {
          // Try to construct Slack URL from metadata
          const metadata = item.metadata as
            | { channelId?: string; teamDomain?: string }
            | undefined;
          if (metadata?.channelId && metadata?.teamDomain) {
            // Open Slack in new tab
            window.open(
              `https://${metadata.teamDomain}.slack.com/archives/${metadata.channelId}`,
              "_blank"
            );
          } else if (metadata?.channelId) {
            // Try Slack deep link (works if Slack app is installed)
            window.open(`slack://channel?id=${metadata.channelId}`, "_self");
            toast.info("Opening in Slack app...", {
              description:
                "If Slack doesn't open, you may need to install the desktop app.",
            });
          } else {
            toast.info("Slack conversation", {
              description: `Channel: ${item.title}`,
            });
          }
          break;
        }

        case "calendar":
          // Navigate to calendar view - could add date param for scroll-to behavior
          navigate({ to: "/dashboard/calendar" });
          toast.info("Viewing calendar", {
            description: item.title,
          });
          break;

        case "whatsapp": {
          // WhatsApp conversations - open in WhatsApp Web if possible
          const waMetadata = item.metadata as
            | { phoneNumber?: string; waId?: string }
            | undefined;
          if (waMetadata?.phoneNumber || waMetadata?.waId) {
            const phone = waMetadata.phoneNumber || waMetadata.waId;
            window.open(
              `https://wa.me/${phone?.replace(/[^0-9]/g, "")}`,
              "_blank"
            );
          } else {
            toast.info("WhatsApp conversation", {
              description: `${item.title} • ${item.messageCount} messages`,
            });
          }
          break;
        }

        case "notion": {
          // Open Notion page
          const notionMetadata = item.metadata as
            | { url?: string; pageId?: string }
            | undefined;
          if (notionMetadata?.url) {
            window.open(notionMetadata.url, "_blank");
          } else if (notionMetadata?.pageId) {
            window.open(
              `https://notion.so/${notionMetadata.pageId.replace(/-/g, "")}`,
              "_blank"
            );
          } else {
            toast.info("Notion page", {
              description: item.title,
            });
          }
          break;
        }

        case "google_docs": {
          // Open Google Doc
          const docsMetadata = item.metadata as
            | { url?: string; documentId?: string }
            | undefined;
          if (docsMetadata?.url) {
            window.open(docsMetadata.url, "_blank");
          } else if (docsMetadata?.documentId) {
            window.open(
              `https://docs.google.com/document/d/${docsMetadata.documentId}`,
              "_blank"
            );
          } else {
            toast.info("Google Doc", {
              description: item.title,
            });
          }
          break;
        }

        default:
          toast.info(`Opening ${item.sourceType} conversation`);
      }
    },
    [navigate, markReadMutation]
  );

  const handleStar = useCallback(
    (id: string, starred: boolean) => {
      starMutation.mutate({ conversationId: id, starred });
    },
    [starMutation]
  );

  const handleArchive = useCallback(
    (id: string) => {
      archiveMutation.mutate({ conversationId: id });
    },
    [archiveMutation]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (items.length > 0 && selectedIndex >= 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
      });
    }
  }, [selectedIndex, items.length, virtualizer]);

  // Keyboard navigation
  const selectedIndexRef = useRef(selectedIndex);
  const itemsRef = useRef(items);
  selectedIndexRef.current = selectedIndex;
  itemsRef.current = items;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.closest("[role='dialog']")
      ) {
        return;
      }

      // Command bar
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandBarOpen(true);
        return;
      }

      // Escape to close preview pane
      if (e.key === "Escape" && selectedThreadId) {
        e.preventDefault();
        setSelectedThreadId(null);
        return;
      }

      // Navigation
      if (!(e.metaKey || e.ctrlKey || e.altKey)) {
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          const maxIndex = itemsRef.current.length - 1;
          setSelectedIndex((i) => Math.min(i + 1, maxIndex));
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }

        // Source filter shortcuts (1-7)
        const sourceFilters: SourceFilter[] = [
          "all",
          "email",
          "slack",
          "calendar",
          "whatsapp",
          "notion",
          "google_docs",
        ];
        if (e.key >= "1" && e.key <= "7") {
          const filterIndex = Number.parseInt(e.key, 10) - 1;
          if (sourceFilters[filterIndex]) {
            e.preventDefault();
            setSourceFilter(sourceFilters[filterIndex]);
            setSelectedIndex(0);
          }
          return;
        }

        // Actions on selected item
        const item = itemsRef.current[selectedIndexRef.current];
        if (item) {
          if (e.key === "Enter" || e.key === "o") {
            e.preventDefault();
            // Select in preview pane for email, otherwise handle externally
            if (item.sourceType === "email") {
              setSelectedThreadId(item.id);
            } else {
              handleItemClick(item);
            }
          } else if (e.key === "e") {
            e.preventDefault();
            handleArchive(item.id);
          } else if (e.key === "s") {
            e.preventDefault();
            handleStar(item.id, !item.isStarred);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandBarOpen, handleItemClick, handleArchive, handleStar]);

  // Stats
  const totalUnread = statsData?.unread ?? 0;
  const bySource = (statsData?.bySource ?? {}) as Record<string, { total: number; unread: number }>;
  const emailStats = bySource.email;
  const slackStats = bySource.slack;
  const calendarStats = bySource.calendar;
  const whatsappStats = bySource.whatsapp;
  const notionStats = bySource.notion;
  const googleDocsStats = bySource.google_docs;

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Compact Header */}
        <div className="shrink-0 border-b bg-background">
          <div className="flex items-center justify-between px-3 py-1.5">
            {/* Left: View tabs (All/Focused/Others) */}
            <Tabs
              onValueChange={(v) => setViewTab(v as ViewTab)}
              value={viewTab}
            >
              <TabsList className="h-7 gap-0.5 bg-muted/50 p-0.5">
                <TabsTrigger
                  className="h-6 gap-1.5 px-2.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  value="all"
                >
                  All
                  <Badge className="h-4 px-1 text-[10px]" variant="secondary">
                    {allItems.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="h-6 gap-1.5 px-2.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  value="focused"
                >
                  <Sparkles className="h-3 w-3" />
                  Focused
                  {focusedCount > 0 && (
                    <Badge className="h-4 px-1 text-[10px]" variant="destructive">
                      {focusedCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="h-6 gap-1.5 px-2.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  value="others"
                >
                  Others
                  {othersCount > 0 && (
                    <Badge className="h-4 px-1 text-[10px]" variant="secondary">
                      {othersCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Center: Source filters */}
            <div className="flex items-center gap-1">
              <Tabs
                onValueChange={(v) => setSourceFilter(v as SourceFilter)}
                value={sourceFilter}
              >
                <TabsList className="h-7 gap-0.5 bg-transparent p-0">
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="all"
                  >
                    <Inbox className="h-3.5 w-3.5" />
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="email"
                  >
                    <Mail className="h-3.5 w-3.5" style={{ color: sourceFilter === "email" ? "#EA4335" : undefined }} />
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="slack"
                  >
                    <Hash className="h-3.5 w-3.5" style={{ color: sourceFilter === "slack" ? "#4A154B" : undefined }} />
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="calendar"
                  >
                    <Calendar className="h-3.5 w-3.5" style={{ color: sourceFilter === "calendar" ? "#4285F4" : undefined }} />
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="whatsapp"
                  >
                    <MessageCircle className="h-3.5 w-3.5" style={{ color: sourceFilter === "whatsapp" ? "#25D366" : undefined }} />
                  </TabsTrigger>
                  <TabsTrigger
                    className="h-6 px-2 text-xs data-[state=active]:bg-muted"
                    value="notion"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-7 w-7"
                      disabled={isFetchingInbox}
                      onClick={() => refetchInbox()}
                      size="icon"
                      variant="ghost"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", isFetchingInbox && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                className="h-7 gap-1.5 text-xs"
                onClick={() => openCompose()}
                size="sm"
              >
                <Plus className="h-3.5 w-3.5" />
                Compose
              </Button>
            </div>
          </div>
        </div>

        {/* 3-Column Layout */}
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            {/* Email List Panel */}
            <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
              <div className="flex h-full flex-col overflow-hidden border-r">
                {/* List Header */}
                {items.length > 0 && (
                  <InboxListHeader
                    allSelected={selectedIds.size === items.length && items.length > 0}
                    onSelectAll={handleSelectAll}
                    someSelected={selectedIds.size > 0 && selectedIds.size < items.length}
                  />
                )}

                {/* Scrollable list */}
                <div className="flex-1 overflow-auto" ref={listRef}>
                  {isLoadingInbox ? (
                    <div>
                      {Array.from({ length: 10 }).map((_, i) => (
                        <InboxRowSkeleton key={`skeleton-${i}`} />
                      ))}
                    </div>
                  ) : items.length === 0 ? (
                    <EmptyState sourceFilter={sourceFilter} viewTab={viewTab} />
                  ) : (
                    <>
                      <div
                        style={{
                          height: `${virtualizer.getTotalSize()}px`,
                          width: "100%",
                          position: "relative",
                        }}
                      >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                          const item = items[virtualRow.index];
                          if (!item) return null;

                          const inboxItem: InboxItem = {
                            ...item,
                            hasCommitments: item.hasCommitments,
                            hasDecisions: item.hasDecisions,
                            task: item.task
                              ? {
                                  id: item.task.id,
                                  status: item.task.status,
                                  priority: item.task.priority,
                                  assignee: item.task.assignee,
                                }
                              : undefined,
                          };

                          const isSelected = item.id === selectedThreadId;

                          return (
                            <div
                              key={item.id}
                              style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <InboxRow
                                isActive={virtualRow.index === selectedIndex || isSelected}
                                isSelected={selectedIds.has(item.id)}
                                item={inboxItem}
                                onArchive={() => handleArchive(item.id)}
                                onAssigneeClick={() => toast.info("Create a task to assign")}
                                onClick={() => handleItemClick(item)}
                                onDotsClick={() => {
                                  setIntelligenceThreadId(item.id);
                                  setIntelligenceThreadTitle(item.title);
                                  setIntelligenceSheetOpen(true);
                                }}
                                onPriorityClick={() => toast.info("Create a task to set priority")}
                                onSelect={handleSelectItem}
                                onStar={(starred) => handleStar(item.id, starred)}
                                onStatusClick={() => toast.info("Create a task to set status")}
                                organizationId={activeOrg?.id}
                              />
                            </div>
                          );
                        })}
                      </div>

                      {/* Load More Button */}
                      {hasNextPage && (
                        <div className="flex items-center justify-center border-t py-3">
                          <Button
                            className="gap-2"
                            disabled={isFetchingInbox}
                            onClick={loadMore}
                            size="sm"
                            variant="outline"
                          >
                            {isFetchingInbox ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              <>Load More ({items.length}/{totalCount})</>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Preview Pane Panel */}
            <ResizablePanel defaultSize={65}>
              <EmailPreviewPane
                className="h-full"
                onClose={() => setSelectedThreadId(null)}
                onExpand={(threadId) => {
                  navigate({
                    to: "/dashboard/email/thread/$threadId",
                    params: { threadId },
                  });
                }}
                threadId={selectedThreadId}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      {/* Intelligence Sheet */}
      <IntelligenceSheet
        onOpenChange={setIntelligenceSheetOpen}
        open={intelligenceSheetOpen}
        threadId={intelligenceThreadId}
        title={intelligenceThreadTitle}
      />
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function InboxRowSkeleton() {
  return (
    <div className="flex h-10 items-center border-border border-b px-3">
      {/* Checkbox */}
      <div className="flex w-7 shrink-0 items-center justify-center">
        <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
      </div>
      {/* Priority */}
      <div className="flex w-7 shrink-0 items-center justify-center">
        <Skeleton className="h-4 w-4" />
      </div>
      {/* Source */}
      <div className="flex w-6 shrink-0 items-center justify-center">
        <Skeleton className="h-4 w-4" />
      </div>
      {/* Status */}
      <div className="flex w-7 shrink-0 items-center justify-center">
        <Skeleton className="h-4 w-4 rounded-full" />
      </div>
      {/* Sender */}
      <div className="w-[120px] shrink-0 px-1">
        <Skeleton className="h-4 w-20" />
      </div>
      {/* Brief */}
      <div className="flex-1 px-2">
        <Skeleton className="h-4 w-full max-w-[400px]" />
      </div>
      {/* Spacer */}
      <div className="ml-auto flex-shrink-0" />
      {/* Right side */}
      <div className="flex shrink-0 items-center">
        <div className="w-14 px-2">
          <Skeleton className="ml-auto h-4 w-10" />
        </div>
        <div className="flex w-7 items-center justify-center">
          <Skeleton className="h-3.5 w-3.5 rounded-full" />
        </div>
        <div className="w-10" />
        <div className="w-[58px]" />
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({
  sourceFilter,
  viewTab,
}: {
  sourceFilter: SourceFilter;
  viewTab: ViewTab;
}) {
  const getConfig = () => {
    // View tab specific messages
    if (viewTab === "focused") {
      return {
        icon: CheckCircle2,
        title: "All caught up!",
        description: "No high-priority items need your attention",
      };
    }
    if (viewTab === "others") {
      return {
        icon: Inbox,
        title: "Nothing in Others",
        description: "Low-priority items will appear here",
      };
    }

    // By source
    if (sourceFilter === "email") {
      return {
        icon: Mail,
        title: "No emails",
        description: "Connect an email account to see your messages",
      };
    }
    if (sourceFilter === "slack") {
      return {
        icon: Hash,
        title: "No Slack messages",
        description: "Connect Slack to see your channels and DMs",
      };
    }
    if (sourceFilter === "calendar") {
      return {
        icon: Calendar,
        title: "No calendar events",
        description: "Your upcoming events will appear here",
      };
    }
    if (sourceFilter === "whatsapp") {
      return {
        icon: MessageCircle,
        title: "No WhatsApp messages",
        description: "Connect WhatsApp Business to see your chats",
      };
    }
    if (sourceFilter === "notion") {
      return {
        icon: FileText,
        title: "No Notion pages",
        description: "Connect Notion to see your workspace content",
      };
    }
    if (sourceFilter === "google_docs") {
      return {
        icon: FileText,
        title: "No Google Docs",
        description: "Connect Google Docs to see your documents",
      };
    }

    return {
      icon: Inbox,
      title: "Your inbox is empty",
      description: "Connect sources to see your conversations here",
    };
  };

  const { icon: EmptyIcon, title, description } = getConfig();

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <EmptyIcon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg">{title}</h3>
      <p className="mt-1 text-muted-foreground text-sm">{description}</p>
      <Button
        className="mt-4"
        onClick={() => (window.location.href = "/dashboard/sources")}
        variant="outline"
      >
        <Plus className="mr-2 h-4 w-4" />
        Connect Sources
      </Button>
    </div>
  );
}
