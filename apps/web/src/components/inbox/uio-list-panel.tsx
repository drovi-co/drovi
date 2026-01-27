// =============================================================================
// UIO LIST PANEL COMPONENT
// =============================================================================
//
// Left panel (1/3 width) displaying UIOs in a scrollable list.
// Features:
// - Filter row with type/status filters
// - Virtualized list for performance
// - Selection state management
// - Loading and empty states

"use client";

import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  GitBranch,
  Inbox,
  Lightbulb,
  Loader2,
  MessageSquare,
  Target,
  Zap,
} from "lucide-react";
import { useRef } from "react";

import {
  UIOListItem,
  type UIOListItemData,
  type UIOType,
} from "@/components/inbox/uio-list-item";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export interface UIOFilters {
  types?: UIOType[];
  status?: "active" | "archived";
  search?: string;
}

export interface UIOListPanelProps {
  organizationId: string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Filters controlled by header tabs */
  filters?: UIOFilters;
  className?: string;
}

// =============================================================================
// TYPE FILTER CONFIG (used by header tabs)
// =============================================================================

export const TYPE_OPTIONS: {
  value: UIOType;
  label: string;
  icon: typeof Target;
}[] = [
  { value: "commitment", label: "Commitments", icon: Target },
  { value: "decision", label: "Decisions", icon: GitBranch },
  { value: "task", label: "Tasks", icon: CheckCircle2 },
  { value: "topic", label: "Topics", icon: MessageSquare },
  { value: "claim", label: "Claims", icon: Lightbulb },
  { value: "risk", label: "Risks", icon: AlertTriangle },
  { value: "brief", label: "Briefs", icon: Zap },
  { value: "project", label: "Projects", icon: FileText },
];

// =============================================================================
// UIO LIST PANEL COMPONENT
// =============================================================================

export function UIOListPanel({
  organizationId,
  selectedId,
  onSelect,
  filters = {},
  className,
}: UIOListPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch UIOs with filters from header
  const { data, isLoading, isFetching } = useQuery({
    ...trpc.uio.list.queryOptions({
      organizationId,
      types: filters.types,
      status: filters.status,
      search: filters.search,
      limit: 100,
      offset: 0,
    }),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });

  // Note: Type-specific details (commitmentDetails, etc.) are not included in list response
  // They would need to be fetched separately or added to the API with: clause
  const items = (data?.items ?? []).map(
    (item): UIOListItemData => ({
      id: item.id,
      type: item.type,
      status: item.status,
      canonicalTitle: item.canonicalTitle,
      userCorrectedTitle: item.userCorrectedTitle,
      canonicalDescription: item.canonicalDescription,
      overallConfidence: item.overallConfidence,
      isUserVerified: item.isUserVerified ?? undefined,
      owner: item.owner,
      createdAt: new Date(item.createdAt),
      dueDate: item.dueDate ? new Date(item.dueDate) : null,
      lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null,
    })
  );

  // Virtualizer for performance
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100, // Estimated row height
    overscan: 5,
  });

  // Active filter count (for display purposes)
  const activeFilterCount =
    (filters.types?.length ?? 0) + (filters.status ? 1 : 0);

  return (
    <div className={cn("flex h-full flex-col border-r", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-sm">Intelligence</h2>
          {data?.total !== undefined && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
              {data.total}
            </Badge>
          )}
          {activeFilterCount > 0 && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="outline">
              {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
            </Badge>
          )}
          {isFetching && !isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* List content */}
      <div className="flex-1 overflow-hidden" ref={scrollRef}>
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <UIOListItemSkeleton key={`skeleton-${i}`} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState hasFilters={activeFilterCount > 0} />
        ) : (
          <div
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) {
                return null;
              }

              return (
                <div
                  className="absolute top-0 left-0 w-full"
                  key={item.id}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <UIOListItem
                    onClick={() => onSelect(item.id)}
                    selected={item.id === selectedId}
                    uio={item}
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
// SKELETON
// =============================================================================

function UIOListItemSkeleton() {
  return (
    <div className="border-border/50 border-b p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-3 w-3/4" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm">
        {hasFilters ? "No matching items" : "No intelligence yet"}
      </h3>
      <p className="mt-1 text-muted-foreground text-xs">
        {hasFilters
          ? "Try adjusting your filters"
          : "AI-extracted commitments, decisions, and more will appear here"}
      </p>
    </div>
  );
}
