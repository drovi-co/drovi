"use client";

/**
 * ConsoleDataTable
 *
 * Datadog-style flat log table with:
 * - Color indicator strip on left for type
 * - Simple flat rows (no expand/collapse)
 * - Click to open detail panel
 * - Keyboard navigation (j/k for up/down)
 */

import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react";
import { useCallback } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ConsoleItem } from "@/hooks/use-console-query";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ConsoleDataTableProps {
  items: ConsoleItem[];
  onItemClick?: (item: ConsoleItem) => void;
  onOpenDetail?: (item: ConsoleItem) => void;
  selectedId?: string | null;
  focusedIndex?: number;
  className?: string;
}

// =============================================================================
// TYPE COLORS (left stripe)
// =============================================================================

// Vercel-style muted colors
const TYPE_COLORS: Record<string, string> = {
  commitment: "#666666", // Dark gray
  decision: "#0070f3", // Vercel blue
  task: "#171717", // Near black
  risk: "#dc2626", // Muted red
  claim: "#059669", // Muted teal
  brief: "#a3a3a3", // Light gray
};

// =============================================================================
// TABLE ROW COMPONENT
// =============================================================================

interface TableRowProps {
  item: ConsoleItem;
  isSelected: boolean;
  isFocused?: boolean;
  onClick: () => void;
}

function TableRow({
  item,
  isSelected,
  isFocused = false,
  onClick,
}: TableRowProps) {
  const typeColor = TYPE_COLORS[item.type] ?? "#6b7280";

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center border-b border-border/50 transition-colors",
        "hover:bg-accent/50",
        isSelected && "bg-primary/10",
        isFocused && !isSelected && "bg-accent/30"
      )}
      onClick={onClick}
    >
      {/* Type color stripe */}
      <div
        className="w-1 self-stretch"
        style={{ backgroundColor: typeColor }}
      />

      {/* Date column */}
      <div className="w-44 shrink-0 px-3 py-2">
        <span className="font-mono text-muted-foreground text-xs">
          {format(new Date(item.created_at), "MMM d HH:mm:ss.SSS")}
        </span>
      </div>

      {/* Type column */}
      <div className="w-28 shrink-0 px-2 py-2">
        <span
          className="inline-block rounded px-1.5 py-0.5 font-medium text-white text-xs uppercase"
          style={{ backgroundColor: typeColor }}
        >
          {item.type}
        </span>
      </div>

      {/* Contact/Owner column */}
      <div className="w-36 shrink-0 px-2 py-2">
        {(() => {
          // Find the first available contact from owner, debtor, creditor, assignee, or decision_maker
          const contact = item.owner ?? item.debtor ?? item.creditor ?? item.assignee ?? item.decision_maker;
          if (contact) {
            const displayName = contact.display_name ?? contact.email?.split("@")[0] ?? "Unknown";
            return (
              <div className="flex items-center gap-1.5">
                <Avatar className="size-5">
                  <AvatarImage src={contact.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[9px]">
                    {displayName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs">{displayName}</span>
              </div>
            );
          }
          // Fallback to source message sender
          if (item.source_sender_name || item.source_sender_email) {
            const displayName = item.source_sender_name ?? item.source_sender_email?.split("@")[0] ?? "Unknown";
            return (
              <div className="flex items-center gap-1.5">
                <Avatar className="size-5">
                  <AvatarFallback className="text-[9px]">
                    {displayName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-muted-foreground text-xs">{displayName}</span>
              </div>
            );
          }
          return <span className="text-muted-foreground text-xs">—</span>;
        })()}
      </div>

      {/* Content column (flexible) */}
      <div className="min-w-0 flex-1 px-2 py-2">
        <div className="flex items-center gap-2">
          {/* Status indicators - Vercel style */}
          {item.is_overdue && (
            <Clock className="size-3.5 shrink-0 text-[#dc2626]" />
          )}
          {item.is_at_risk && !item.is_overdue && (
            <AlertTriangle className="size-3.5 shrink-0 text-[#d97706]" />
          )}
          {item.status === "completed" && (
            <CheckCircle2 className="size-3.5 shrink-0 text-[#059669]" />
          )}

          {/* Title with description (only if different from title) */}
          <span className="truncate text-sm">
            <span className="font-medium">{item.title}</span>
            {item.description && item.description !== item.title && !item.title.includes(item.description) && !item.description.includes(item.title) && (
              <span className="ml-2 text-muted-foreground">
                {item.description.slice(0, 100)}
                {item.description.length > 100 && "..."}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Status badge */}
      <div className="w-24 shrink-0 px-2 py-2">
        <StatusBadge
          isAtRisk={item.is_at_risk}
          isOverdue={item.is_overdue}
          status={item.status}
        />
      </div>

      {/* Confidence - Vercel style */}
      <div className="w-12 shrink-0 px-2 py-2 text-right">
        {item.confidence !== null && (
          <span
            className={cn(
              "font-mono text-xs",
              item.confidence >= 0.8
                ? "text-foreground"
                : item.confidence >= 0.5
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60"
            )}
          >
            {Math.round(item.confidence * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// STATUS BADGE
// =============================================================================

function StatusBadge({
  status,
  isOverdue,
  isAtRisk,
}: {
  status: string;
  isOverdue: boolean;
  isAtRisk: boolean;
}) {
  // Vercel-style status badges
  if (isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#fecaca] bg-[#fef2f2] px-2 py-0.5 font-medium text-[#b91c1c] text-[10px] dark:border-[#7f1d1d] dark:bg-[#450a0a] dark:text-[#fca5a5]">
        OVERDUE
      </span>
    );
  }

  if (isAtRisk) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 font-medium text-[#b45309] text-[10px] dark:border-[#78350f] dark:bg-[#451a03] dark:text-[#fcd34d]">
        AT RISK
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#a7f3d0] bg-[#ecfdf5] px-2 py-0.5 font-medium text-[#047857] text-[10px] dark:border-[#064e3b] dark:bg-[#022c22] dark:text-[#6ee7b7]">
        DONE
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 font-medium text-muted-foreground text-[10px] capitalize">
      {status.replace(/_/g, " ")}
    </span>
  );
}

// =============================================================================
// MAIN TABLE COMPONENT
// =============================================================================

export function ConsoleDataTable({
  items,
  onOpenDetail,
  selectedId,
  focusedIndex = -1,
  className,
}: ConsoleDataTableProps) {
  const handleRowClick = useCallback(
    (item: ConsoleItem) => {
      onOpenDetail?.(item);
    },
    [onOpenDetail]
  );

  if (items.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <div className="text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No items found</p>
          <p className="text-muted-foreground text-sm">
            Try adjusting your filters
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border bg-background overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center border-b bg-muted/50 text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        <div className="w-1 shrink-0" /> {/* Stripe space */}
        <div className="w-44 shrink-0 px-3 py-2">↓ Date</div>
        <div className="w-28 shrink-0 px-2 py-2">Type</div>
        <div className="w-36 shrink-0 px-2 py-2">Contact</div>
        <div className="min-w-0 flex-1 px-2 py-2">Content</div>
        <div className="w-24 shrink-0 px-2 py-2">Status</div>
        <div className="w-12 shrink-0 px-2 py-2 text-right">Conf</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/30">
        {items.map((item, index) => (
          <TableRow
            isFocused={index === focusedIndex}
            isSelected={selectedId === item.id}
            item={item}
            key={item.id}
            onClick={() => handleRowClick(item)}
          />
        ))}
      </div>
    </div>
  );
}
