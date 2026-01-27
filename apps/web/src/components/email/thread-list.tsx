"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  Filter,
  Inbox,
  Mail,
  MailOpen,
  RefreshCw,
  Send,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ThreadBrief,
  type ThreadBriefData,
  ThreadBriefSkeleton,
} from "./thread-brief";

// =============================================================================
// TYPES
// =============================================================================

export type InboxFilter =
  | "all"
  | "unread"
  | "starred"
  | "snoozed"
  | "sent"
  | "drafts"
  | "archived"
  | "trash";

export type InboxSort = "date" | "priority" | "sender" | "subject";

export type IntelligenceFilter =
  | "all"
  | "has_commitments"
  | "has_decisions"
  | "needs_response"
  | "has_risk";

interface ThreadListProps {
  threads: ThreadBriefData[];
  isLoading?: boolean;
  filter: InboxFilter;
  sort: InboxSort;
  sortDirection: "asc" | "desc";
  intelligenceFilter: IntelligenceFilter;
  onFilterChange: (filter: InboxFilter) => void;
  onSortChange: (sort: InboxSort) => void;
  onSortDirectionChange: (direction: "asc" | "desc") => void;
  onIntelligenceFilterChange: (filter: IntelligenceFilter) => void;
  onThreadClick: (threadId: string) => void;
  onThreadAction: (threadId: string, action: string) => void;
  onBatchAction: (threadIds: string[], action: string) => void;
  onRefresh: () => void;
  unreadCount?: number;
  totalCount?: number;
}

// =============================================================================
// THREAD LIST COMPONENT
// =============================================================================

export function ThreadList({
  threads,
  isLoading = false,
  filter,
  sort,
  sortDirection,
  intelligenceFilter,
  onFilterChange,
  onSortChange,
  onSortDirectionChange,
  onIntelligenceFilterChange,
  onThreadClick,
  onThreadAction,
  onBatchAction,
  onRefresh,
  unreadCount = 0,
  totalCount = 0,
}: ThreadListProps) {
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(
    new Set()
  );
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtualizer for performance with large lists
  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140, // Estimated row height with padding (brief + badges)
    overscan: 5,
  });

  // Selection handlers
  const handleSelectThread = useCallback((id: string, selected: boolean) => {
    setSelectedThreads((prev) => {
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
    (checked: boolean) => {
      if (checked) {
        setSelectedThreads(new Set(threads.map((t) => t.id)));
      } else {
        setSelectedThreads(new Set());
      }
    },
    [threads]
  );

  const handleBatchAction = useCallback(
    (action: string) => {
      onBatchAction(Array.from(selectedThreads), action);
      setSelectedThreads(new Set());
    },
    [selectedThreads, onBatchAction]
  );

  // Filter counts
  const filterCounts = useMemo(() => {
    return {
      all: totalCount,
      unread: unreadCount,
      starred: threads.filter((t) => t.isStarred).length,
      snoozed: threads.filter((t) => t.isSnoozed).length,
    };
  }, [threads, totalCount, unreadCount]);

  const hasSelection = selectedThreads.size > 0;
  const allSelected =
    selectedThreads.size === threads.length && threads.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        {/* Primary tabs */}
        <div className="flex items-center gap-2 px-4 py-2">
          <Tabs
            onValueChange={(v) => onFilterChange(v as InboxFilter)}
            value={filter}
          >
            <TabsList className="h-8">
              <TabsTrigger className="gap-1.5 px-3 text-xs" value="all">
                <Inbox className="h-3.5 w-3.5" />
                Inbox
                {filterCounts.all > 0 && (
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {filterCounts.all}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 px-3 text-xs" value="unread">
                <Mail className="h-3.5 w-3.5" />
                Unread
                {filterCounts.unread > 0 && (
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="destructive"
                  >
                    {filterCounts.unread}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 px-3 text-xs" value="starred">
                <Star className="h-3.5 w-3.5" />
                Starred
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 px-3 text-xs" value="snoozed">
                <Clock className="h-3.5 w-3.5" />
                Snoozed
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 px-3 text-xs" value="sent">
                <Send className="h-3.5 w-3.5" />
                Sent
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex-1" />

          {/* Refresh */}
          <Button
            className="h-8 w-8"
            onClick={onRefresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Secondary toolbar */}
        <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
          {/* Select all */}
          <Checkbox
            checked={allSelected}
            className="mr-2"
            onCheckedChange={handleSelectAll}
          />

          {/* Batch actions (visible when items selected) */}
          <AnimatePresence>
            {hasSelection ? (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-1"
                exit={{ opacity: 0, x: -10 }}
                initial={{ opacity: 0, x: -10 }}
              >
                <Badge className="mr-2" variant="secondary">
                  {selectedThreads.size} selected
                </Badge>
                <Button
                  className="h-7 text-xs"
                  onClick={() => handleBatchAction("archive")}
                  size="sm"
                  variant="ghost"
                >
                  <Archive className="mr-1 h-3.5 w-3.5" />
                  Archive
                </Button>
                <Button
                  className="h-7 text-xs"
                  onClick={() => handleBatchAction("mark_read")}
                  size="sm"
                  variant="ghost"
                >
                  <MailOpen className="mr-1 h-3.5 w-3.5" />
                  Mark read
                </Button>
                <Button
                  className="h-7 text-xs"
                  onClick={() => handleBatchAction("star")}
                  size="sm"
                  variant="ghost"
                >
                  <Star className="mr-1 h-3.5 w-3.5" />
                  Star
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="h-7 text-xs" size="sm" variant="ghost">
                      More
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => handleBatchAction("snooze")}
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      Snooze
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleBatchAction("label")}
                    >
                      <Tag className="mr-2 h-4 w-4" />
                      Add label
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={() => handleBatchAction("delete")}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  className="ml-2 h-7 w-7"
                  onClick={() => setSelectedThreads(new Set())}
                  size="icon"
                  variant="ghost"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </motion.div>
            ) : (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2"
                exit={{ opacity: 0, x: 10 }}
                initial={{ opacity: 0, x: 10 }}
              >
                {/* Intelligence filter */}
                <Select
                  onValueChange={(v) =>
                    onIntelligenceFilterChange(v as IntelligenceFilter)
                  }
                  value={intelligenceFilter}
                >
                  <SelectTrigger className="h-7 w-[160px] text-xs">
                    <Filter className="mr-1.5 h-3.5 w-3.5" />
                    <SelectValue placeholder="Filter by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All threads</SelectItem>
                    <SelectItem value="has_commitments">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                        Has commitments
                      </div>
                    </SelectItem>
                    <SelectItem value="has_decisions">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-purple-500" />
                        Has decisions
                      </div>
                    </SelectItem>
                    <SelectItem value="needs_response">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                        Needs response
                      </div>
                    </SelectItem>
                    <SelectItem value="has_risk">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                        Has risk warning
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Sort */}
                <Select
                  onValueChange={(v) => onSortChange(v as InboxSort)}
                  value={sort}
                >
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue placeholder="Sort by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="sender">Sender</SelectItem>
                    <SelectItem value="subject">Subject</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  className="h-7 w-7"
                  onClick={() =>
                    onSortDirectionChange(
                      sortDirection === "asc" ? "desc" : "asc"
                    )
                  }
                  size="icon"
                  variant="ghost"
                >
                  {sortDirection === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Thread list with virtualization */}
      <div className="flex-1 overflow-auto" ref={parentRef}>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <ThreadBriefSkeleton key={`skeleton-${i}`} />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const thread = threads[virtualRow.index];
              if (!thread) {
                return null;
              }
              return (
                <div
                  className="overflow-hidden px-3 py-2"
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
                  <ThreadBrief
                    isSelected={selectedThreads.has(thread.id)}
                    onAction={onThreadAction}
                    onClick={onThreadClick}
                    onSelect={handleSelectThread}
                    thread={thread}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ filter }: { filter: InboxFilter }) {
  const config = {
    all: {
      icon: Inbox,
      title: "Your inbox is empty",
      description: "New emails will appear here",
    },
    unread: {
      icon: Mail,
      title: "All caught up!",
      description: "You have no unread emails",
    },
    starred: {
      icon: Star,
      title: "No starred emails",
      description: "Star important emails to find them quickly",
    },
    snoozed: {
      icon: Clock,
      title: "No snoozed emails",
      description: "Snooze emails to deal with them later",
    },
    sent: {
      icon: Send,
      title: "No sent emails",
      description: "Emails you send will appear here",
    },
    drafts: {
      icon: Mail,
      title: "No drafts",
      description: "Your draft emails will appear here",
    },
    archived: {
      icon: Archive,
      title: "No archived emails",
      description: "Archive emails to clean up your inbox",
    },
    trash: {
      icon: Trash2,
      title: "Trash is empty",
      description: "Deleted emails will appear here",
    },
  };

  const { icon: Icon, title, description } = config[filter];

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg">{title}</h3>
      <p className="mt-1 text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
