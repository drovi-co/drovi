"use client";

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
import { cn } from "@/lib/utils";
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
import {
  ThreadBrief,
  ThreadBriefSkeleton,
  type ThreadBriefData,
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
  const allSelected = selectedThreads.size === threads.length && threads.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        {/* Primary tabs */}
        <div className="flex items-center gap-2 px-4 py-2">
          <Tabs
            value={filter}
            onValueChange={(v) => onFilterChange(v as InboxFilter)}
          >
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-3 gap-1.5">
                <Inbox className="h-3.5 w-3.5" />
                Inbox
                {filterCounts.all > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                    {filterCounts.all}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="unread" className="text-xs px-3 gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Unread
                {filterCounts.unread > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                    {filterCounts.unread}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="starred" className="text-xs px-3 gap-1.5">
                <Star className="h-3.5 w-3.5" />
                Starred
              </TabsTrigger>
              <TabsTrigger value="snoozed" className="text-xs px-3 gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Snoozed
              </TabsTrigger>
              <TabsTrigger value="sent" className="text-xs px-3 gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Sent
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex-1" />

          {/* Refresh */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Secondary toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
          {/* Select all */}
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleSelectAll}
            className="mr-2"
          />

          {/* Batch actions (visible when items selected) */}
          <AnimatePresence>
            {hasSelection ? (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-1"
              >
                <Badge variant="secondary" className="mr-2">
                  {selectedThreads.size} selected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleBatchAction("archive")}
                  className="h-7 text-xs"
                >
                  <Archive className="h-3.5 w-3.5 mr-1" />
                  Archive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleBatchAction("mark_read")}
                  className="h-7 text-xs"
                >
                  <MailOpen className="h-3.5 w-3.5 mr-1" />
                  Mark read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleBatchAction("star")}
                  className="h-7 text-xs"
                >
                  <Star className="h-3.5 w-3.5 mr-1" />
                  Star
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      More
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleBatchAction("snooze")}>
                      <Clock className="h-4 w-4 mr-2" />
                      Snooze
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBatchAction("label")}>
                      <Tag className="h-4 w-4 mr-2" />
                      Add label
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleBatchAction("delete")}
                      className="text-red-500"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedThreads(new Set())}
                  className="h-7 w-7 ml-2"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-2"
              >
                {/* Intelligence filter */}
                <Select
                  value={intelligenceFilter}
                  onValueChange={(v) =>
                    onIntelligenceFilterChange(v as IntelligenceFilter)
                  }
                >
                  <SelectTrigger className="h-7 w-[160px] text-xs">
                    <Filter className="h-3.5 w-3.5 mr-1.5" />
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
                  value={sort}
                  onValueChange={(v) => onSortChange(v as InboxSort)}
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
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")
                  }
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
      <div ref={parentRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
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
                  className="px-3 py-2 overflow-hidden"
                >
                  <ThreadBrief
                    thread={thread}
                    isSelected={selectedThreads.has(thread.id)}
                    onSelect={handleSelectThread}
                    onClick={onThreadClick}
                    onAction={onThreadAction}
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
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  );
}
