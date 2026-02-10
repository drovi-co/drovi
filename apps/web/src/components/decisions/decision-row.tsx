"use client";

import { Copy, Eye, MoreHorizontal } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { ConfidenceBadge, EvidencePopover } from "@/components/evidence";
import { SourceIcon } from "@/components/inbox/source-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import { type TFunction, useI18n } from "@/i18n";
import { extractQuotedText, extractSourceMessage } from "@/lib/evidence-utils";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";

/**
 * Linear-style Decision Row component
 *
 * Layout - fixed widths for perfect alignment:
 * | Checkbox(28) | Priority(28) | Source(24) | Status(28) | Owner(120) | Title(flex) | Right(140px) |
 *
 * Right section (140px fixed):
 * - Default: Date | Topic | Confidence
 * - On hover: Copy | Evidence | More actions
 */

export interface DecisionRowData {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  evidence?: string[];
  extractedAt?: Date | null;
  isSuperseded?: boolean;
  supersededBy?: {
    id: string;
    title: string;
    decidedAt: Date;
  } | null;
  owners?: Array<{
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  }>;
  topics?: Array<{
    id: string;
    name: string;
  }>;
  sourceType?: SourceType;
}

interface DecisionRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  decision: DecisionRowData;
  isSelected?: boolean;
  isActive?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onClick?: () => void;
  onCopy?: () => void;
  onShowEvidence?: () => void;
  onDismiss?: () => void;
  onVerify?: () => void;
  onViewSupersession?: () => void;
}

// Fixed column widths for perfect alignment
const COL = {
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  owner: "w-[120px]", // 120px
} as const;

function getStatus(decision: DecisionRowData): Status {
  if (decision.isSuperseded || decision.supersededBy) {
    return "done";
  }
  return "in_progress"; // Active decisions
}

function getOwnerName(
  owner:
    | { displayName?: string | null; primaryEmail: string }
    | null
    | undefined,
  t: TFunction
): string {
  if (!owner) {
    return t("common.messages.unknown");
  }
  return (
    owner.displayName ||
    owner.primaryEmail.split("@")[0] ||
    t("common.messages.unknown")
  );
}

function formatDecisionDate(
  date: Date,
  options: { locale: string; t: TFunction }
): string {
  const diffDays = getLocalDayDiff(date);
  if (diffDays === 0) {
    return options.t("components.decisions.date.today");
  }
  if (diffDays === -1) {
    return options.t("components.decisions.date.yesterday");
  }
  try {
    return new Intl.DateTimeFormat(options.locale, {
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

function getLocalDayDiff(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function DecisionRow({
  decision,
  isSelected = false,
  isActive = false,
  onSelect,
  onClick,
  onCopy,
  onShowEvidence,
  onDismiss,
  onVerify,
  onViewSupersession,
  className,
  ...props
}: DecisionRowProps) {
  const { locale, t } = useI18n();
  const status = getStatus(decision);
  const firstOwner = decision.owners?.[0];
  const ownerName = getOwnerName(firstOwner, t);
  const dateDisplay = formatDecisionDate(decision.decidedAt, { locale, t });
  const firstTopic = decision.topics?.[0];

  const isSuperseded = decision.isSuperseded || !!decision.supersededBy;

  const quotedText = extractQuotedText(
    decision.evidence?.[0],
    decision.statement
  );
  const evidencePopover = onShowEvidence
    ? {
        id: decision.id,
        type: "decision" as const,
        title: decision.title,
        extractedText: decision.statement,
        quotedText,
        confidence: decision.confidence,
        isUserVerified: decision.isUserVerified,
        sourceMessage: extractSourceMessage(decision.evidence?.[0]),
        extractedAt: decision.extractedAt ?? decision.decidedAt ?? new Date(),
      }
    : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success(t("components.decisions.toasts.statementCopied"));
    onCopy?.();
  };

  return (
    <div
      className={cn(
        "group flex h-10 items-center",
        "cursor-pointer transition-colors duration-100",
        "border-border border-b",
        isSuperseded && "opacity-60",
        isSelected && "bg-accent",
        isActive &&
          "border-l-2 border-l-secondary bg-accent pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !(isSelected || isActive) && "hover:bg-muted",
        className
      )}
      data-slot="decision-row"
      onClick={onClick}
      {...props}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(
          COL.checkbox,
          "flex shrink-0 items-center justify-center"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect?.(decision.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width (always none for decisions) */}
      <div
        className={cn(
          COL.priority,
          "flex shrink-0 items-center justify-center"
        )}
      >
        <PriorityIcon priority="none" size="sm" />
      </div>

      {/* Source - fixed width */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        {decision.sourceType ? (
          <SourceIcon size="sm" sourceType={decision.sourceType} />
        ) : (
          <div className="h-4 w-4" />
        )}
      </div>

      {/* Status - fixed width */}
      <div
        className={cn(COL.status, "flex shrink-0 items-center justify-center")}
      >
        <StatusIcon size="sm" status={status} />
      </div>

      {/* Owner - fixed width */}
      <div className={cn(COL.owner, "shrink-0 px-1")}>
        <div className="flex items-center gap-1.5">
          <AssigneeIcon
            email={firstOwner?.primaryEmail}
            name={firstOwner?.displayName ?? undefined}
            size="xs"
          />
          <span className="truncate font-medium text-[13px] text-foreground">
            {ownerName}
          </span>
        </div>
      </div>

      {/* Title - flexible width */}
      <div className="min-w-0 flex-1 px-2">
        <span
          className={cn(
            "block truncate font-normal text-[13px] text-muted-foreground",
            isSuperseded && "line-through"
          )}
        >
          {decision.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Date + Topic + Confidence - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date */}
          <span className="w-14 whitespace-nowrap text-right font-normal text-[12px] text-muted-foreground">
            {dateDisplay}
          </span>

          {/* Topic badge */}
          <div className="flex w-7 items-center justify-center">
            {firstTopic ? (
              <Badge
                className="h-4 max-w-[28px] truncate px-1 py-0 text-[9px]"
                variant="secondary"
              >
                {firstTopic.name.slice(0, 3)}
              </Badge>
            ) : (
              <div className="w-4" />
            )}
          </div>

          {/* Confidence badge */}
          <div className="flex items-center justify-center">
            <ConfidenceBadge
              confidence={decision.confidence}
              isUserVerified={decision.isUserVerified}
              size="sm"
            />
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          {/* Copy button */}
          <button
            aria-label={t("components.decisions.actions.copyStatement")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            type="button"
          >
            <Copy className="size-4" />
          </button>

          {/* Evidence button */}
          {onShowEvidence && evidencePopover && (
            <EvidencePopover
              evidence={evidencePopover}
              onShowFullEvidence={onShowEvidence}
              side="left"
            >
              <button
                aria-label={t("components.decisions.actions.showEvidence")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[4px]",
                  "transition-colors duration-100",
                  "text-purple-500",
                  "hover:bg-accent hover:text-purple-400"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onShowEvidence();
                }}
                type="button"
              >
                <Eye className="size-4" />
              </button>
            </EvidencePopover>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("components.decisions.actions.moreActions")}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[4px]",
                  "transition-colors duration-100",
                  "text-muted-foreground",
                  "hover:bg-accent hover:text-foreground"
                )}
                onClick={(e) => e.stopPropagation()}
                type="button"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopy}>
                {t("components.decisions.menu.copyStatement")}
              </DropdownMenuItem>
              {onShowEvidence && (
                <DropdownMenuItem onClick={onShowEvidence}>
                  {t("components.decisions.menu.showEvidence")}
                </DropdownMenuItem>
              )}
              {onViewSupersession && (
                <DropdownMenuItem onClick={onViewSupersession}>
                  {t("components.decisions.menu.viewHistory")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!decision.isUserVerified && onVerify && (
                <DropdownMenuItem onClick={onVerify}>
                  {t("components.decisions.menu.verifyCorrect")}
                </DropdownMenuItem>
              )}
              {onDismiss && (
                <DropdownMenuItem className="text-red-400" onClick={onDismiss}>
                  {t("components.decisions.menu.dismissIncorrect")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * Decision List Header - matches row layout exactly for alignment
 */
interface DecisionListHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  onSelectAll?: (selected: boolean) => void;
  allSelected?: boolean;
  someSelected?: boolean;
}

function DecisionListHeader({
  onSelectAll,
  allSelected = false,
  someSelected = false,
  className,
  ...props
}: DecisionListHeaderProps) {
  const t = useI18n().t;
  return (
    <div
      className={cn(
        "flex h-8 items-center px-3",
        "border-border border-b bg-background",
        "font-medium text-[11px] text-muted-foreground uppercase tracking-wider",
        className
      )}
      data-slot="decision-list-header"
      {...props}
    >
      {/* Checkbox */}
      <div
        className={cn(
          COL.checkbox,
          "flex shrink-0 items-center justify-center"
        )}
      >
        <IssueCheckbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(checked) => onSelectAll?.(checked)}
          size="sm"
        />
      </div>

      {/* Priority */}
      <div className={cn(COL.priority, "shrink-0")} />

      {/* Source */}
      <div className={cn(COL.source, "shrink-0")} />

      {/* Status */}
      <div className={cn(COL.status, "shrink-0")} />

      {/* Owner */}
      <div className={cn(COL.owner, "shrink-0 px-1")}>
        {t("components.decisions.listHeader.owner")}
      </div>

      {/* Title */}
      <div className="flex-1 px-2">
        {t("components.decisions.listHeader.decision")}
      </div>

      {/* Right section */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        <div className="flex items-center gap-1.5">
          <span className="w-14 whitespace-nowrap text-right">
            {t("components.decisions.listHeader.date")}
          </span>
          <div className="w-7" />
          <div className="w-7" />
        </div>
      </div>
    </div>
  );
}

export {
  DecisionRow,
  DecisionListHeader,
  type DecisionRowProps,
  type DecisionListHeaderProps,
};
