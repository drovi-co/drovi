"use client";

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ContactFilters {
  healthScoreMin?: number;
  healthScoreMax?: number;
  lastInteractionDays?: number;
  sources?: string[];
  tags?: string[];
  company?: string;
  isVip?: boolean;
  isAtRisk?: boolean;
  hasEmail?: boolean;
}

interface ContactFilterPanelProps {
  filters: ContactFilters;
  onFiltersChange: (filters: ContactFilters) => void;
  availableTags?: string[];
  availableSources?: string[];
  className?: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ContactFilterPanel({
  filters,
  onFiltersChange,
  availableTags = [],
  availableSources = ["email", "slack", "calendar", "whatsapp"],
  className,
}: ContactFilterPanelProps) {
  const updateFilter = <K extends keyof ContactFilters>(
    key: K,
    value: ContactFilters[K]
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== null && v !== false && (!Array.isArray(v) || v.length > 0)
  ).length;

  return (
    <div className={cn("flex h-full w-[240px] flex-col border-r bg-muted/30", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Filters</h3>
          {activeFilterCount > 0 && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
              {activeFilterCount}
            </Badge>
          )}
        </div>
        {activeFilterCount > 0 && (
          <Button
            className="h-6 px-2 text-xs"
            onClick={clearFilters}
            size="sm"
            variant="ghost"
          >
            Clear all
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex-1 space-y-6 overflow-auto p-4">
        {/* Health Score Range */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Health Score</Label>
          <Select
            onValueChange={(v) => {
              if (v === "any") {
                updateFilter("healthScoreMin", undefined);
                updateFilter("healthScoreMax", undefined);
              } else if (v === "high") {
                updateFilter("healthScoreMin", 70);
                updateFilter("healthScoreMax", undefined);
              } else if (v === "medium") {
                updateFilter("healthScoreMin", 40);
                updateFilter("healthScoreMax", 69);
              } else if (v === "low") {
                updateFilter("healthScoreMin", 0);
                updateFilter("healthScoreMax", 39);
              }
            }}
            value={
              filters.healthScoreMin === undefined
                ? "any"
                : filters.healthScoreMin >= 70
                  ? "high"
                  : filters.healthScoreMin >= 40
                    ? "medium"
                    : "low"
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Any score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any score</SelectItem>
              <SelectItem value="high">High (70-100)</SelectItem>
              <SelectItem value="medium">Medium (40-69)</SelectItem>
              <SelectItem value="low">Low (0-39)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Last Interaction */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Last Interaction</Label>
          <Select
            onValueChange={(v) =>
              updateFilter("lastInteractionDays", v === "any" ? undefined : Number(v))
            }
            value={filters.lastInteractionDays?.toString() ?? "any"}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Any time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any time</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Status Filters */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Status</Label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={filters.isVip ?? false}
                id="filter-vip"
                onCheckedChange={(checked) =>
                  updateFilter("isVip", checked === true ? true : undefined)
                }
              />
              <Label className="text-xs font-normal" htmlFor="filter-vip">
                VIP Only
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={filters.isAtRisk ?? false}
                id="filter-at-risk"
                onCheckedChange={(checked) =>
                  updateFilter("isAtRisk", checked === true ? true : undefined)
                }
              />
              <Label className="text-xs font-normal" htmlFor="filter-at-risk">
                At Risk Only
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={filters.hasEmail ?? false}
                id="filter-has-email"
                onCheckedChange={(checked) =>
                  updateFilter("hasEmail", checked === true ? true : undefined)
                }
              />
              <Label className="text-xs font-normal" htmlFor="filter-has-email">
                Has Email Address
              </Label>
            </div>
          </div>
        </div>

        <Separator />

        {/* Sources */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Sources</Label>
          <div className="space-y-2">
            {availableSources.map((source) => (
              <div className="flex items-center space-x-2" key={source}>
                <Checkbox
                  checked={filters.sources?.includes(source) ?? false}
                  id={`filter-source-${source}`}
                  onCheckedChange={(checked) => {
                    const currentSources = filters.sources ?? [];
                    if (checked) {
                      updateFilter("sources", [...currentSources, source]);
                    } else {
                      const newSources = currentSources.filter((s) => s !== source);
                      updateFilter("sources", newSources.length > 0 ? newSources : undefined);
                    }
                  }}
                />
                <Label
                  className="text-xs font-normal capitalize"
                  htmlFor={`filter-source-${source}`}
                >
                  {source.replace("_", " ")}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Company Filter */}
        <div className="space-y-3">
          <Label className="text-xs font-medium">Company</Label>
          <Input
            className="h-8 text-xs"
            onChange={(e) =>
              updateFilter("company", e.target.value || undefined)
            }
            placeholder="Filter by company..."
            value={filters.company ?? ""}
          />
        </div>

        {/* Tags */}
        {availableTags.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <Label className="text-xs font-medium">Tags</Label>
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => {
                  const isSelected = filters.tags?.includes(tag) ?? false;
                  return (
                    <button
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted"
                      )}
                      key={tag}
                      onClick={() => {
                        const currentTags = filters.tags ?? [];
                        if (isSelected) {
                          const newTags = currentTags.filter((t) => t !== tag);
                          updateFilter("tags", newTags.length > 0 ? newTags : undefined);
                        } else {
                          updateFilter("tags", [...currentTags, tag]);
                        }
                      }}
                      type="button"
                    >
                      {tag}
                      {isSelected && <X className="ml-1 h-2.5 w-2.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
