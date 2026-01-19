// =============================================================================
// UNIFIED INBOX PAGE - Multi-Source Smart Inbox
// =============================================================================

"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  FileText,
  Hash,
  Inbox,
  Mail,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandBar, useCommandBar } from "@/components/email/command-bar";
import { SchedulePanel } from "@/components/email/schedule-panel";
import { InboxRow, InboxListHeader, type InboxItem } from "@/components/inbox/inbox-row";

import { trpc, queryClient } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { type SourceType } from "@/lib/source-config";
import { startOfDay, endOfDay, addDays } from "date-fns";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/inbox/")({
  component: UnifiedInboxPage,
});

// =============================================================================
// TYPES
// =============================================================================

type SourceFilter = "all" | "email" | "slack" | "calendar" | "whatsapp" | "notion" | "google_docs";
type StatusFilter = "inbox" | "unread" | "starred";

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
  metadata?: Record<string, unknown>;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function UnifiedInboxPage() {
  const navigate = useNavigate();
  const { open: commandBarOpen, setOpen: setCommandBarOpen, openCompose } = useCommandBar();
  const listRef = useRef<HTMLDivElement>(null);
  const { data: activeOrg } = useActiveOrganization();

  // State
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("inbox");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSchedule, setShowSchedule] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Date range for schedule panel
  const today = startOfDay(new Date());
  const weekFromNow = endOfDay(addDays(today, 7));

  // Build filter for API
  const getStatusArray = (): ("read" | "unread" | "starred" | "archived")[] | undefined => {
    if (statusFilter === "unread") return ["unread"];
    if (statusFilter === "starred") return ["starred"];
    return undefined; // inbox = all non-archived
  };

  const getSourceTypesArray = () => {
    if (sourceFilter === "all") return undefined;
    return [sourceFilter];
  };

  // Fetch unified inbox items
  // Use placeholderData to keep showing previous data while fetching new filter results
  const {
    data: inboxData,
    isLoading: isLoadingInbox,
    isFetching: isFetchingInbox,
    refetch: refetchInbox,
  } = useQuery({
    ...trpc.unifiedInbox.list.queryOptions({
      sourceTypes: getSourceTypesArray(),
      status: getStatusArray(),
      limit: 100,
      offset: 0,
    }),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    placeholderData: (previousData) => previousData, // Keep showing old data while fetching
  });

  // Fetch stats - long cache, rarely changes
  const { data: statsData } = useQuery({
    ...trpc.unifiedInbox.getStats.queryOptions(),
    staleTime: 60000,
    gcTime: 10 * 60 * 1000, // Keep stats in cache for 10 minutes
  });

  // Fetch calendar events for schedule panel
  const { data: calendarData } = useQuery({
    ...trpc.emailAccounts.getCalendarEvents.queryOptions({
      timeMin: today.toISOString(),
      timeMax: weekFromNow.toISOString(),
      maxResults: 50,
    }),
    staleTime: 60000,
    enabled: showSchedule,
  });

  // Fetch commitments for schedule panel
  const { data: commitmentsData } = useQuery({
    ...trpc.commitments.getByDirection.queryOptions({
      organizationId: activeOrg?.id ?? "",
      direction: "owed_by_me",
      limit: 20,
    }),
    staleTime: 60000,
    enabled: Boolean(activeOrg?.id) && showSchedule,
  });

  // Get current query key for optimistic updates
  const currentQueryKey = trpc.unifiedInbox.list.queryOptions({
    sourceTypes: getSourceTypesArray(),
    status: getStatusArray(),
    limit: 100,
    offset: 0,
  }).queryKey;

  // Mutations with optimistic updates for instant feedback
  const markReadMutation = useMutation({
    ...trpc.unifiedInbox.markRead.mutationOptions(),
    onMutate: async ({ conversationId, read }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      // Snapshot previous value
      const previousData = queryClient.getQueryData(currentQueryKey);
      // Optimistically update
      queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item: UnifiedFeedItem) =>
            item.id === conversationId ? { ...item, isRead: read } : item
          ),
        };
      });
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previousData) {
        queryClient.setQueryData(currentQueryKey, context.previousData);
      }
    },
    onSettled: () => {
      // Sync with server in background (don't await)
      queryClient.invalidateQueries({ queryKey: ["unifiedInbox", "getStats"] });
    },
  });

  const starMutation = useMutation({
    ...trpc.unifiedInbox.star.mutationOptions(),
    onMutate: async ({ conversationId, starred }) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const previousData = queryClient.getQueryData(currentQueryKey);
      queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((item: UnifiedFeedItem) =>
            item.id === conversationId ? { ...item, isStarred: starred } : item
          ),
        };
      });
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(currentQueryKey, context.previousData);
      }
    },
  });

  const archiveMutation = useMutation({
    ...trpc.unifiedInbox.archive.mutationOptions(),
    onMutate: async ({ conversationId }) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const previousData = queryClient.getQueryData(currentQueryKey);
      // Optimistically remove from list
      queryClient.setQueryData(currentQueryKey, (old: typeof inboxData) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((item: UnifiedFeedItem) => item.id !== conversationId),
          total: old.total - 1,
        };
      });
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(currentQueryKey, context.previousData);
      }
      toast.error("Failed to archive");
    },
    onSuccess: () => {
      toast.success("Archived");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["unifiedInbox", "getStats"] });
    },
  });

  // Transform data
  const items: UnifiedFeedItem[] = (inboxData?.items ?? []).map((item) => ({
    ...item,
    lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
  }));

  // Transform schedule data
  const scheduleEvents = (calendarData?.events ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    type: "meeting" as const,
    attendees: event.attendees,
    location: event.location,
    isVideoCall: event.isVideoCall,
  }));

  const scheduleCommitments = (commitmentsData?.commitments ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    dueDate: c.dueDate ? new Date(c.dueDate) : new Date(),
    status: c.status as "pending" | "in_progress" | "completed",
    priority: (c.priority ?? "medium") as "high" | "medium" | "low",
  }));

  // Virtualizer
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

  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(items.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [items]);

  // Handlers
  const handleItemClick = useCallback(
    (item: UnifiedFeedItem) => {
      // Mark as read
      markReadMutation.mutate({ conversationId: item.id, read: true });

      // Navigate based on source type
      switch (item.sourceType) {
        case "email":
          navigate({ to: "/dashboard/email/thread/$threadId", params: { threadId: item.id } });
          break;

        case "slack": {
          // Try to construct Slack URL from metadata
          const metadata = item.metadata as { channelId?: string; teamDomain?: string } | undefined;
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
              description: "If Slack doesn't open, you may need to install the desktop app.",
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
          const waMetadata = item.metadata as { phoneNumber?: string; waId?: string } | undefined;
          if (waMetadata?.phoneNumber || waMetadata?.waId) {
            const phone = waMetadata.phoneNumber || waMetadata.waId;
            window.open(`https://wa.me/${phone?.replace(/[^0-9]/g, "")}`, "_blank");
          } else {
            toast.info("WhatsApp conversation", {
              description: `${item.title} • ${item.messageCount} messages`,
            });
          }
          break;
        }

        case "notion": {
          // Open Notion page
          const notionMetadata = item.metadata as { url?: string; pageId?: string } | undefined;
          if (notionMetadata?.url) {
            window.open(notionMetadata.url, "_blank");
          } else if (notionMetadata?.pageId) {
            window.open(`https://notion.so/${notionMetadata.pageId.replace(/-/g, "")}`, "_blank");
          } else {
            toast.info("Notion page", {
              description: item.title,
            });
          }
          break;
        }

        case "google_docs": {
          // Open Google Doc
          const docsMetadata = item.metadata as { url?: string; documentId?: string } | undefined;
          if (docsMetadata?.url) {
            window.open(docsMetadata.url, "_blank");
          } else if (docsMetadata?.documentId) {
            window.open(`https://docs.google.com/document/d/${docsMetadata.documentId}`, "_blank");
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

      // Toggle schedule panel
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSchedule((s) => !s);
        return;
      }

      // Navigation
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
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
        const sourceFilters: SourceFilter[] = ["all", "email", "slack", "calendar", "whatsapp", "notion", "google_docs"];
        if (e.key >= "1" && e.key <= "7") {
          const filterIndex = parseInt(e.key, 10) - 1;
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
            handleItemClick(item);
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
  const emailStats = statsData?.bySource?.email;
  const slackStats = statsData?.bySource?.slack;
  const calendarStats = statsData?.bySource?.calendar;
  const whatsappStats = statsData?.bySource?.whatsapp;
  const notionStats = statsData?.bySource?.notion;
  const googleDocsStats = statsData?.bySource?.google_docs;

  return (
    <div data-no-shell-padding className="h-full">
      <CommandBar open={commandBarOpen} onOpenChange={setCommandBarOpen} />

      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Source filter tabs */}
            <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
              <TabsList className="h-8 bg-transparent gap-1">
                <TabsTrigger
                  value="all"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Inbox className="h-4 w-4" />
                  All
                  {inboxData?.total !== undefined && inboxData.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      {inboxData.total}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="email"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Mail className="h-4 w-4" style={{ color: sourceFilter === "email" ? "#EA4335" : undefined }} />
                  Email
                  {emailStats && emailStats.unread > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                      {emailStats.unread}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="slack"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Hash className="h-4 w-4" style={{ color: sourceFilter === "slack" ? "#4A154B" : undefined }} />
                  Slack
                  {slackStats && slackStats.unread > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                      {slackStats.unread}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="calendar"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Calendar className="h-4 w-4" style={{ color: sourceFilter === "calendar" ? "#4285F4" : undefined }} />
                  Calendar
                  {calendarStats && calendarStats.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      {calendarStats.total}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="whatsapp"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <MessageCircle className="h-4 w-4" style={{ color: sourceFilter === "whatsapp" ? "#25D366" : undefined }} />
                  WhatsApp
                  {whatsappStats && whatsappStats.unread > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                      {whatsappStats.unread}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="notion"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <FileText className="h-4 w-4" style={{ color: sourceFilter === "notion" ? "#000000" : undefined }} />
                  Notion
                  {notionStats && notionStats.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      {notionStats.total}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="google_docs"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <FileText className="h-4 w-4" style={{ color: sourceFilter === "google_docs" ? "#4285F4" : undefined }} />
                  Docs
                  {googleDocsStats && googleDocsStats.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      {googleDocsStats.total}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Status filter + actions */}
            <div className="flex items-center gap-2">
              {/* Status pills */}
              <div className="flex items-center gap-1 mr-2">
                <Button
                  variant={statusFilter === "inbox" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setStatusFilter("inbox")}
                >
                  All
                </Button>
                <Button
                  variant={statusFilter === "unread" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setStatusFilter("unread")}
                >
                  Unread
                  {totalUnread > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1 py-0 ml-1">
                      {totalUnread}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant={statusFilter === "starred" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setStatusFilter("starred")}
                >
                  <Star className="h-3 w-3 mr-1" />
                  Starred
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-muted-foreground"
                onClick={() => setCommandBarOpen(true)}
              >
                <Search className="h-4 w-4 mr-2" />
                Search
                <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => refetchInbox()}
                      disabled={isFetchingInbox}
                    >
                      <RefreshCw className={cn("h-4 w-4", isFetchingInbox && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFetchingInbox ? "Refreshing..." : "Refresh"}</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showSchedule ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setShowSchedule((s) => !s)}
                    >
                      {showSchedule ? (
                        <PanelRightClose className="h-4 w-4" />
                      ) : (
                        <PanelRightOpen className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {showSchedule ? "Hide schedule" : "Show schedule"} (⌘\)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button variant="default" size="sm" className="h-8 gap-2" onClick={() => openCompose()}>
                <Plus className="h-4 w-4" />
                Compose
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Item list */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* List Header */}
            {items.length > 0 && (
              <InboxListHeader
                onSelectAll={handleSelectAll}
                allSelected={selectedIds.size === items.length && items.length > 0}
                someSelected={selectedIds.size > 0 && selectedIds.size < items.length}
              />
            )}

            {/* Scrollable list */}
            <div ref={listRef} className="flex-1 overflow-auto">
              {isLoadingInbox ? (
                <div>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <InboxRowSkeleton key={`skeleton-${i}`} />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState sourceFilter={sourceFilter} statusFilter={statusFilter} />
              ) : (
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
                    };
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
                          item={inboxItem}
                          isSelected={selectedIds.has(item.id)}
                          isActive={virtualRow.index === selectedIndex}
                          onSelect={handleSelectItem}
                          onClick={() => handleItemClick(item)}
                          onStar={(starred) => handleStar(item.id, starred)}
                          onArchive={() => handleArchive(item.id)}
                          onPriorityClick={(e) => {
                            // TODO: Open priority dropdown at e.currentTarget
                            toast.info("Priority dropdown coming soon");
                          }}
                          onStatusClick={(e) => {
                            // TODO: Open status dropdown at e.currentTarget
                            toast.info("Status dropdown coming soon");
                          }}
                          onAssigneeClick={(e) => {
                            // TODO: Open assignee dropdown at e.currentTarget
                            toast.info("Assignee dropdown coming soon");
                          }}
                          onDotsClick={(e) => {
                            // TODO: Open intelligence panel at e.currentTarget
                            toast.info("Intelligence details coming soon");
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Schedule panel */}
          <div
            className={cn(
              "border-l transition-all duration-300 ease-in-out overflow-hidden",
              showSchedule ? "w-80" : "w-0"
            )}
          >
            {showSchedule && (
              <SchedulePanel
                events={scheduleEvents}
                commitments={scheduleCommitments}
                onEventClick={(id) => {
                  console.log("Event clicked:", id);
                }}
                onCommitmentClick={(id) => {
                  navigate({ to: "/dashboard/commitments" });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// SKELETON
// =============================================================================

function InboxRowSkeleton() {
  return (
    <div className="flex items-center h-10 px-3 border-b border-[#191A23]">
      {/* Checkbox */}
      <div className="w-7 flex items-center justify-center shrink-0">
        <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
      </div>
      {/* Priority */}
      <div className="w-7 flex items-center justify-center shrink-0">
        <Skeleton className="h-4 w-4" />
      </div>
      {/* Source */}
      <div className="w-6 flex items-center justify-center shrink-0">
        <Skeleton className="h-4 w-4" />
      </div>
      {/* Status */}
      <div className="w-7 flex items-center justify-center shrink-0">
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
      <div className="flex-shrink-0 ml-auto" />
      {/* Right side */}
      <div className="flex items-center shrink-0">
        <div className="w-14 px-2">
          <Skeleton className="h-4 w-10 ml-auto" />
        </div>
        <div className="w-7 flex items-center justify-center">
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
  statusFilter,
}: {
  sourceFilter: SourceFilter;
  statusFilter: StatusFilter;
}) {
  const getConfig = () => {
    if (statusFilter === "unread") {
      return {
        icon: CheckCircle2,
        title: "All caught up!",
        description: "You have no unread messages",
      };
    }
    if (statusFilter === "starred") {
      return {
        icon: Star,
        title: "No starred items",
        description: "Star important conversations to find them quickly",
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
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <EmptyIcon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      <Button
        variant="outline"
        className="mt-4"
        onClick={() => window.location.href = "/dashboard/sources"}
      >
        <Plus className="h-4 w-4 mr-2" />
        Connect Sources
      </Button>
    </div>
  );
}
