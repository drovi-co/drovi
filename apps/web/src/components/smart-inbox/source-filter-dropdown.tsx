// =============================================================================
// SOURCE FILTER DROPDOWN COMPONENT
// =============================================================================
//
// Multi-select dropdown for filtering conversations by source type.
// Features:
// - Shows all connected source types
// - Multi-select with checkboxes
// - Badge showing selected count
// - Source icons with brand colors

"use client";

import { Check, ChevronDown, Filter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getAvailableSources,
  getSourceColor,
  getSourceIcon,
  getSourceLabel,
  type SourceType,
} from "@/lib/source-config";

// =============================================================================
// TYPES
// =============================================================================

export interface SourceFilterDropdownProps {
  selectedSources: SourceType[];
  onSourcesChange: (sources: SourceType[]) => void;
  /** Optional: only show sources that are connected (by account) */
  connectedSources?: SourceType[];
  className?: string;
}

// =============================================================================
// SOURCE FILTER DROPDOWN COMPONENT
// =============================================================================

export function SourceFilterDropdown({
  selectedSources,
  onSourcesChange,
  connectedSources,
  className,
}: SourceFilterDropdownProps) {
  // Get available sources (either all available or just connected ones)
  const availableSources = connectedSources ?? getAvailableSources();

  // Toggle a source in the selection
  const toggleSource = (source: SourceType) => {
    if (selectedSources.includes(source)) {
      onSourcesChange(selectedSources.filter((s) => s !== source));
    } else {
      onSourcesChange([...selectedSources, source]);
    }
  };

  // Clear all selections
  const clearAll = () => {
    onSourcesChange([]);
  };

  // Select all sources
  const selectAll = () => {
    onSourcesChange([...availableSources]);
  };

  const hasSelection = selectedSources.length > 0;
  const allSelected = selectedSources.length === availableSources.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-7 gap-1.5 text-[13px] font-normal",
            hasSelection && "bg-accent",
            className
          )}
          size="sm"
          variant="ghost"
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Sources</span>
          {hasSelection && (
            <Badge className="ml-1 h-4 min-w-4 px-1 text-[9px]" variant="secondary">
              {selectedSources.length}
            </Badge>
          )}
          <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Filter by source</span>
          {hasSelection ? (
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={clearAll}
              type="button"
            >
              Clear all
            </button>
          ) : (
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={selectAll}
              type="button"
            >
              Select all
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableSources.map((source) => {
          const SourceIcon = getSourceIcon(source);
          const sourceColor = getSourceColor(source);
          const sourceLabel = getSourceLabel(source);
          const isSelected = selectedSources.includes(source);

          return (
            <DropdownMenuCheckboxItem
              checked={isSelected}
              className="gap-2"
              key={source}
              onCheckedChange={() => toggleSource(source)}
            >
              <div
                className="flex h-5 w-5 items-center justify-center rounded"
                style={{ backgroundColor: `${sourceColor}20` }}
              >
                <SourceIcon
                  className="h-3 w-3"
                  style={{ color: sourceColor }}
                />
              </div>
              <span className="flex-1">{sourceLabel}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
