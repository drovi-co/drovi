"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  Inbox,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
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

import { ThreadRow, ThreadRowSkeleton } from "@/components/email/thread-row";
import { SchedulePanel } from "@/components/email/schedule-panel";
import { CommandBar, useCommandBar } from "@/components/email/command-bar";

import { trpc, queryClient } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { startOfDay, endOfDay, addDays } from "date-fns";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/email/")({
  component: EmailInboxPage,
});

// =============================================================================
// TYPES
// =============================================================================

type InboxTab = "inbox" | "unread" | "starred" | "sent";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function EmailInboxPage() {
  const navigate = useNavigate();
  const { open: commandBarOpen, setOpen: setCommandBarOpen, openCompose } = useCommandBar();
  const listRef = useRef<HTMLDivElement>(null);
  const { data: activeOrg } = useActiveOrganization();

  // State - restore selected index from session storage if available
  const [activeTab, setActiveTab] = useState<InboxTab>("inbox");
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("inbox-selected-index");
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("inbox-selected-thread-id");
    }
    return null;
  });
  const [showSchedule, setShowSchedule] = useState(true);

  // Date range for calendar events (today + 7 days)
  const today = startOfDay(new Date());
  const weekFromNow = endOfDay(addDays(today, 7));

  // Fetch threads
  const {
    data: threadsData,
    isLoading: isLoadingThreads,
    refetch: refetchThreads,
  } = useQuery({
    ...trpc.threads.listInbox.queryOptions({
      filter: activeTab === "inbox" ? "all" : activeTab,
      sort: "date",
      sortDirection: "desc",
      intelligenceFilter: "all",
    }),
    staleTime: 30000,
  });

  // Fetch unread count
  const { data: unreadData } = useQuery({
    ...trpc.threads.getUnreadCount.queryOptions({}),
    staleTime: 60000,
  });

  // Fetch calendar events (from connected Gmail accounts)
  const { data: calendarData } = useQuery({
    ...trpc.emailAccounts.getCalendarEvents.queryOptions({
      timeMin: today.toISOString(),
      timeMax: weekFromNow.toISOString(),
      maxResults: 50,
    }),
    staleTime: 60000,
    enabled: showSchedule,
  });

  // Fetch commitments (when organization is available)
  const { data: commitmentsData } = useQuery({
    ...trpc.commitments.getByDirection.queryOptions({
      organizationId: activeOrg?.id ?? "",
      direction: "owed_by_me",
      limit: 20,
    }),
    staleTime: 60000,
    enabled: Boolean(activeOrg?.id) && showSchedule,
  });

  // Mutations
  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      toast.success("Archived");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const starMutation = useMutation({
    ...trpc.threads.star.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const markReadMutation = useMutation({
    ...trpc.threads.markRead.mutationOptions(),
    onSuccess: () => {
      // Invalidate all thread-related queries to update UI
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const deleteMutation = useMutation({
    ...trpc.threads.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  // Transform thread data
  const threads = (threadsData?.threads ?? []).map((t) => ({
    id: t.id,
    subject: t.subject ?? "No subject",
    brief: t.brief ?? t.snippet ?? "",
    lastMessageDate: new Date(t.lastMessageDate),
    messageCount: t.messageCount ?? 1,
    isUnread: t.isUnread ?? false,
    isStarred: t.isStarred ?? false,
    participants: t.participants ?? [],
    priority: (t.priority ?? "medium") as "urgent" | "high" | "medium" | "low",
    commitmentCount: t.commitmentCount ?? 0,
    decisionCount: t.decisionCount ?? 0,
    openQuestionCount: t.openQuestionCount ?? 0,
  }));

  // Transform calendar events for SchedulePanel
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

  // Transform commitments for SchedulePanel
  const scheduleCommitments = (commitmentsData?.commitments ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    dueDate: c.dueDate ? new Date(c.dueDate) : new Date(),
    status: c.status as "pending" | "in_progress" | "completed",
    priority: (c.priority ?? "medium") as "high" | "medium" | "low",
  }));

  // Virtualizer for thread list
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  // Handlers
  const handleThreadClick = useCallback(
    (threadId: string) => {
      navigate({ to: "/dashboard/email/thread/$threadId", params: { threadId } });
      markReadMutation.mutate({ threadId, read: true });
    },
    [navigate, markReadMutation]
  );

  const handleStar = useCallback(
    (threadId: string, starred: boolean) => {
      starMutation.mutate({ threadId, starred });
    },
    [starMutation]
  );

  const handleArchive = useCallback(
    (threadId: string) => {
      archiveMutation.mutate({ threadId });
    },
    [archiveMutation]
  );

  const handleDelete = useCallback(
    (threadId: string) => {
      deleteMutation.mutate({ threadId });
    },
    [deleteMutation]
  );

  // Restore selection position when threads load (only once)
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (threads.length > 0 && selectedThreadId && !hasRestoredRef.current) {
      const index = threads.findIndex((t) => t.id === selectedThreadId);
      if (index >= 0) {
        setSelectedIndex(index);
        // Scroll after a brief delay to ensure virtualizer is ready
        setTimeout(() => {
          virtualizer.scrollToIndex(index, { align: "center" });
        }, 50);
      }
      hasRestoredRef.current = true;
    }
  }, [threads, selectedThreadId, virtualizer]);

  // Scroll selected item into view - use layout effect for instant scrolling
  useEffect(() => {
    if (threads.length > 0 && selectedIndex >= 0) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
      });
    }
  }, [selectedIndex, threads.length, virtualizer]);

  // Save selection state when it changes
  useEffect(() => {
    const thread = threads[selectedIndex];
    if (thread) {
      sessionStorage.setItem("inbox-selected-index", String(selectedIndex));
      sessionStorage.setItem("inbox-selected-thread-id", thread.id);
    }
  }, [selectedIndex, threads]);

  // Tab order for keyboard navigation
  const tabs: InboxTab[] = ["inbox", "unread", "starred", "sent"];

  // Keyboard navigation - use refs for instant response
  const selectedIndexRef = useRef(selectedIndex);
  const threadsRef = useRef(threads);
  selectedIndexRef.current = selectedIndex;
  threadsRef.current = threads;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input or dialog
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

      // Tab navigation between inbox tabs
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setActiveTab((current) => {
          const currentIndex = tabs.indexOf(current);
          if (e.shiftKey) {
            // Shift+Tab goes backward
            return tabs[(currentIndex - 1 + tabs.length) % tabs.length] as InboxTab;
          }
          // Tab goes forward
          return tabs[(currentIndex + 1) % tabs.length] as InboxTab;
        });
        setSelectedIndex(0); // Reset selection when changing tabs
        return;
      }

      // Navigation (only when not using modifier keys)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        // Fast j/k navigation using refs for instant response
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          const maxIndex = threadsRef.current.length - 1;
          const newIndex = Math.min(selectedIndexRef.current + 1, maxIndex);
          if (newIndex !== selectedIndexRef.current) {
            setSelectedIndex(newIndex);
          }
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          const newIndex = Math.max(selectedIndexRef.current - 1, 0);
          if (newIndex !== selectedIndexRef.current) {
            setSelectedIndex(newIndex);
          }
          return;
        }

        // Number keys for quick tab switching (1-4)
        if (e.key >= "1" && e.key <= "4") {
          const tabIndex = parseInt(e.key, 10) - 1;
          if (tabs[tabIndex]) {
            e.preventDefault();
            setActiveTab(tabs[tabIndex] as InboxTab);
            setSelectedIndex(0);
          }
          return;
        }

        // Actions on selected thread
        const thread = threadsRef.current[selectedIndexRef.current];
        if (thread) {
          if (e.key === "Enter" || e.key === "o") {
            e.preventDefault();
            handleThreadClick(thread.id);
          } else if (e.key === "e") {
            e.preventDefault();
            handleArchive(thread.id);
          } else if (e.key === "s") {
            e.preventDefault();
            handleStar(thread.id, !thread.isStarred);
          } else if (e.key === "#") {
            e.preventDefault();
            handleDelete(thread.id);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandBarOpen, handleThreadClick, handleArchive, handleStar, handleDelete, setActiveTab]);

  const unreadCount = unreadData?.count ?? 0;

  return (
    <div data-no-shell-padding className="h-full">
      <CommandBar open={commandBarOpen} onOpenChange={setCommandBarOpen} />

      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as InboxTab)}>
              <TabsList className="h-8 bg-transparent gap-1">
                <TabsTrigger
                  value="inbox"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Inbox className="h-4 w-4" />
                  Inbox
                  {threadsData?.total !== undefined && threadsData.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                      {threadsData.total}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="unread"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Mail className="h-4 w-4" />
                  Unread
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                      {unreadCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="starred"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Star className="h-4 w-4" />
                  Starred
                </TabsTrigger>
                <TabsTrigger
                  value="sent"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <Send className="h-4 w-4" />
                  Sent
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
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
                      onClick={() => refetchThreads()}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
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
          {/* Thread list */}
          <div ref={listRef} className="flex-1 overflow-auto">
            {isLoadingThreads ? (
              <div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <ThreadRowSkeleton key={`skeleton-${i}`} />
                ))}
              </div>
            ) : threads.length === 0 ? (
              <EmptyState tab={activeTab} />
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const thread = threads[virtualRow.index];
                  if (!thread) return null;
                  return (
                    <div
                      key={thread.id}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ThreadRow
                        thread={thread}
                        isSelected={virtualRow.index === selectedIndex}
                        onClick={handleThreadClick}
                        onStar={handleStar}
                        onArchive={handleArchive}
                        onDelete={handleDelete}
                      />
                    </div>
                  );
                })}
              </div>
            )}
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
                  // Calendar events could link to the calendar view or open details
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
// EMPTY STATE
// =============================================================================

function EmptyState({ tab }: { tab: InboxTab }) {
  const config = {
    inbox: {
      icon: Inbox,
      title: "Your inbox is empty",
      description: "New emails will appear here",
    },
    unread: {
      icon: CheckCircle2,
      title: "All caught up!",
      description: "You have no unread emails",
    },
    starred: {
      icon: Star,
      title: "No starred emails",
      description: "Star important emails to find them quickly",
    },
    sent: {
      icon: Send,
      title: "No sent emails",
      description: "Emails you send will appear here",
    },
  };

  const { icon: Icon, title, description } = config[tab];

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  );
}
