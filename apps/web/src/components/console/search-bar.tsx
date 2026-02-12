"use client";

/**
 * ConsoleSearchBar
 *
 * Datadog-style search bar with entity autocomplete, filter chips,
 * and keyboard navigation. The primary interface for querying UIOs.
 */

import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Calendar,
  Clock,
  Filter,
  Hash,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEntitySuggestions } from "@/hooks/use-console-query";
import {
  type AutocompleteSuggestion,
  type CursorContext,
  ENTITY_DEFINITIONS,
  getCursorContext,
  getEntitySuggestions,
  getTimeSuggestions,
  getValueSuggestions,
  type ParsedFilter,
  type ParsedQuery,
  type TimeRange,
} from "@/lib/console-parser";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ConsoleSearchBarProps {
  organizationId: string;
  value: string;
  filters: ParsedFilter[];
  timeRange: TimeRange | null;
  onChange: (value: string) => void;
  onSearch: (parsed: ParsedQuery) => void;
  onFilterComplete: (filter: ParsedFilter) => void;
  onTimeComplete: (timeRange: TimeRange) => void;
  onFilterRemove: (index: number) => void;
  onTimeRemove: () => void;
  className?: string;
  placeholder?: string;
}

export interface ConsoleSearchBarRef {
  focus: () => void;
  clear: () => void;
}

// =============================================================================
// FILTER CHIP COMPONENT
// =============================================================================

interface FilterChipProps {
  entity: string;
  values: string[];
  negated: boolean;
  onRemove: () => void;
}

function FilterChip({ entity, values, negated, onRemove }: FilterChipProps) {
  const displayValue =
    values.length === 1 ? values[0] : `${values.length} values`;

  // Color coding by entity type
  const getVariant = () => {
    if (negated) {
      return "destructive";
    }
    switch (entity) {
      case "type":
        return "default";
      case "status":
        return "info";
      case "priority":
        return "warning";
      case "contact":
      case "owner":
      case "assignee":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Badge
      className="group cursor-pointer gap-1 pr-1 hover:pr-0.5"
      onClick={onRemove}
      variant={getVariant()}
    >
      {negated && <span className="text-destructive">-</span>}
      <span className="text-muted-foreground">{entity}:</span>
      <span>{displayValue}</span>
      <X className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
    </Badge>
  );
}

// =============================================================================
// TIME CHIP COMPONENT
// =============================================================================

interface TimeChipProps {
  value: string;
  onRemove: () => void;
}

function TimeChip({ value, onRemove }: TimeChipProps) {
  return (
    <Badge
      className="group cursor-pointer gap-1 pr-1 hover:pr-0.5"
      onClick={onRemove}
      variant="secondary"
    >
      <Clock className="size-3" />
      <span>@{value}</span>
      <X className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
    </Badge>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const ConsoleSearchBar = forwardRef<
  ConsoleSearchBarRef,
  ConsoleSearchBarProps
>(function ConsoleSearchBar(
  {
    organizationId,
    value,
    filters,
    timeRange,
    onChange,
    onSearch,
    onFilterComplete,
    onTimeComplete,
    onFilterRemove,
    onTimeRemove,
    className,
    placeholder = "Search... type:commitment status:active @7d",
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [cursorContext, setCursorContext] = useState<CursorContext>({
    mode: "empty",
    partial: "",
  });
  // Track the current entity being built (for multi-step selection)
  const [pendingEntity, setPendingEntity] = useState<string | null>(null);

  // Check if we need dynamic values
  const needsDynamicValues = Boolean(
    cursorContext.mode === "value" &&
      cursorContext.entity &&
      ENTITY_DEFINITIONS.find((e) => e.name === cursorContext.entity)
        ?.values === "dynamic"
  );

  // Fetch dynamic entity values from API
  const { data: dynamicValues } = useEntitySuggestions(
    organizationId,
    cursorContext.entity ?? "",
    cursorContext.partial,
    10
  );

  // Get suggestions based on cursor context
  const suggestions = useMemo(() => {
    const results: AutocompleteSuggestion[] = [];

    if (cursorContext.mode === "empty") {
      // Show all entity prefixes and time suggestions
      results.push(
        ...ENTITY_DEFINITIONS.slice(0, 6).map((e) => ({
          type: "entity" as const,
          label: e.prefix,
          value: e.prefix,
          description: e.description,
        }))
      );
      results.push(...getTimeSuggestions().slice(0, 4));
    } else if (cursorContext.mode === "entity") {
      // Filter entities by partial
      results.push(...getEntitySuggestions(cursorContext.partial));
    } else if (cursorContext.mode === "value" && cursorContext.entity) {
      // Get values for this entity
      results.push(
        ...getValueSuggestions(cursorContext.entity, cursorContext.partial)
      );
    } else if (cursorContext.mode === "time") {
      // Show time suggestions, filter by partial if provided
      const timeSuggestions = getTimeSuggestions();
      if (cursorContext.partial) {
        const partial = cursorContext.partial.toLowerCase();
        results.push(
          ...timeSuggestions.filter(
            (s) =>
              s.value.toLowerCase().includes(partial) ||
              s.label.toLowerCase().includes(partial) ||
              s.description?.toLowerCase().includes(partial)
          )
        );
      } else {
        results.push(...timeSuggestions);
      }
    }

    return results;
  }, [cursorContext]);

  // Merge static and dynamic suggestions
  const allSuggestions = useMemo(() => {
    const results = [...suggestions];
    if (dynamicValues && Array.isArray(dynamicValues)) {
      for (const v of dynamicValues) {
        results.push({
          type: "value" as const,
          label: v.label ?? v.value,
          value: v.value,
          description: v.description,
        });
      }
    }
    return results;
  }, [suggestions, dynamicValues]);

  // Handle input change
  const handleInputChange = useCallback(
    (newValue: string) => {
      onChange(newValue);

      // If we have a pending entity, update context for value suggestions
      if (pendingEntity) {
        // Get the last part after comma for filtering
        const parts = newValue.split(",");
        const currentPart = parts[parts.length - 1].trim();
        setCursorContext({
          mode: "value",
          entity: pendingEntity,
          partial: currentPart,
          existingValues: parts
            .slice(0, -1)
            .map((p) => p.trim())
            .filter(Boolean),
        });
      } else {
        // Update cursor context normally
        const pos = inputRef.current?.selectionStart ?? newValue.length;
        setCursorContext(getCursorContext(newValue, pos));
      }
      setOpen(true);
    },
    [onChange, pendingEntity]
  );

  // Handle suggestion selection
  const handleSelect = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      if (suggestion.type === "entity") {
        // Store the entity and show value suggestions
        const entityName = suggestion.value.replace(":", "");
        setPendingEntity(entityName);
        onChange(""); // Clear input
        setCursorContext({
          mode: "value",
          entity: entityName,
          partial: "",
        });
        setOpen(true);
      } else if (suggestion.type === "value") {
        // Complete the filter or add to existing values
        const entity = pendingEntity || cursorContext.entity;
        if (entity) {
          // Check if we have existing comma-separated values
          const existingParts = value
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v.length > 0);

          // If user typed partial values, combine with selection
          // Remove the last partial (which is being replaced by selection)
          const finalValues =
            existingParts.length > 0 && cursorContext.partial
              ? [...existingParts.slice(0, -1), suggestion.value]
              : existingParts.length > 0
                ? [...existingParts, suggestion.value]
                : [suggestion.value];

          // Remove duplicates
          const uniqueValues = [...new Set(finalValues)];

          onFilterComplete({
            entity,
            operator: uniqueValues.length > 1 ? "in" : "=",
            values: uniqueValues,
            negated: false,
          });
          setPendingEntity(null);
          onChange(""); // Clear input
          setCursorContext({
            mode: "empty",
            partial: "",
          });
          setOpen(true);
        }
      } else if (suggestion.type === "time") {
        // Complete time filter
        const timeValue = suggestion.value.replace("@", "");
        onTimeComplete({
          type: "relative",
          value: timeValue,
          field: "created_at",
        });
        onChange(""); // Clear input
        setCursorContext({
          mode: "empty",
          partial: "",
        });
        setOpen(false);
      }

      // Keep focus on input
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    },
    [
      pendingEntity,
      cursorContext,
      value,
      onChange,
      onFilterComplete,
      onTimeComplete,
    ]
  );

  // Handle search submission
  const handleSubmit = useCallback(() => {
    setOpen(false);
    // Build parsed query from current state
    const parsed: ParsedQuery = {
      filters,
      freeText: value.trim() ? [value.trim()] : [],
      timeRange,
    };
    onSearch(parsed);
  }, [filters, timeRange, value, onSearch]);

  // Track selected suggestion index for keyboard navigation
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(allSuggestions.length > 0 ? 0 : -1);
  }, [allSuggestions.length]);

  // Complete filter with typed value(s)
  const completeFilterWithTypedValue = useCallback(() => {
    const entity = pendingEntity || cursorContext.entity;
    if (!(entity && value.trim())) return false;

    // Parse comma-separated values
    const values = value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (values.length === 0) return false;

    onFilterComplete({
      entity,
      operator: values.length > 1 ? "in" : "=",
      values,
      negated: false,
    });
    setPendingEntity(null);
    onChange("");
    setCursorContext({
      mode: "empty",
      partial: "",
    });
    setOpen(true);

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return true;
  }, [pendingEntity, cursorContext.entity, value, onChange, onFilterComplete]);

  // Add value to pending multi-select (for comma-separated values)
  const addValueToPending = useCallback(
    (val: string) => {
      const entity = pendingEntity || cursorContext.entity;
      if (!(entity && val.trim())) return;

      // Parse existing values from input, excluding the last partial (which is being replaced)
      const parts = value.split(",").map((v) => v.trim());
      // Remove the last part (the partial being typed) and any empty strings
      const existingComplete = parts.slice(0, -1).filter((v) => v.length > 0);

      // Add the new value (avoid duplicates)
      const newValues = [...new Set([...existingComplete, val.trim()])];
      const newInputValue = `${newValues.join(",")},`;
      onChange(newInputValue);

      // Keep cursor context for more values
      setCursorContext({
        mode: "value",
        entity,
        partial: "",
        existingValues: newValues,
      });

      // Keep dropdown open and reset selection for next value
      setOpen(true);
      setSelectedIndex(0);

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    },
    [pendingEntity, cursorContext.entity, value, onChange]
  );

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();

        // If dropdown is open and we have a selected suggestion, use it
        if (open && allSuggestions.length > 0 && selectedIndex >= 0) {
          handleSelect(allSuggestions[selectedIndex]);
          return;
        }

        // If we have a pending entity and typed text, complete the filter with typed value
        if (pendingEntity && value.trim()) {
          completeFilterWithTypedValue();
          return;
        }

        // Otherwise submit the search
        handleSubmit();
      } else if (e.key === "," && pendingEntity) {
        // Comma adds current value and allows typing more
        e.preventDefault();

        // If there's a selected suggestion, use that value
        if (open && allSuggestions.length > 0 && selectedIndex >= 0) {
          const suggestion = allSuggestions[selectedIndex];
          if (suggestion.type === "value") {
            addValueToPending(suggestion.value);
            return;
          }
        }

        // Otherwise use the typed partial as the value
        const partial = value.split(",").pop()?.trim();
        if (partial) {
          addValueToPending(partial);
        }
      } else if (e.key === "Escape") {
        // If pending entity, cancel it
        if (pendingEntity) {
          setPendingEntity(null);
          setCursorContext({ mode: "empty", partial: "" });
        }
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (open && allSuggestions.length > 0) {
          setSelectedIndex((prev) =>
            prev < allSuggestions.length - 1 ? prev + 1 : 0
          );
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (open && allSuggestions.length > 0) {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : allSuggestions.length - 1
          );
        }
      } else if (e.key === "Tab" && open && allSuggestions.length > 0) {
        // Tab to autocomplete the selected suggestion
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(allSuggestions[selectedIndex]);
        }
      } else if (e.key === "Backspace" && value === "") {
        // Handle backspace when input is empty
        if (pendingEntity) {
          // Cancel pending entity first
          e.preventDefault();
          setPendingEntity(null);
          setCursorContext({ mode: "empty", partial: "" });
        } else if (timeRange) {
          // Remove time range if it's the last thing
          e.preventDefault();
          onTimeRemove();
        } else if (filters.length > 0) {
          // Remove the last filter chip
          e.preventDefault();
          onFilterRemove(filters.length - 1);
        }
      }
    },
    [
      handleSubmit,
      handleSelect,
      open,
      allSuggestions,
      selectedIndex,
      pendingEntity,
      value,
      completeFilterWithTypedValue,
      addValueToPending,
      filters,
      timeRange,
      onTimeRemove,
      onFilterRemove,
    ]
  );

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => onChange(""),
  }));

  // Update cursor context on click
  useEffect(() => {
    const handleClick = () => {
      const pos = inputRef.current?.selectionStart ?? value.length;
      setCursorContext(getCursorContext(value, pos));
    };

    const input = inputRef.current;
    input?.addEventListener("click", handleClick);
    return () => input?.removeEventListener("click", handleClick);
  }, [value]);

  // Icon for suggestion type
  const getSuggestionIcon = (type: AutocompleteSuggestion["type"]) => {
    switch (type) {
      case "entity":
        return <Filter className="size-4 text-muted-foreground" />;
      case "value":
        return <Hash className="size-4 text-muted-foreground" />;
      case "time":
        return <Calendar className="size-4 text-muted-foreground" />;
      case "saved":
        return <Star className="size-4 text-[#d97706] dark:text-[#fbbf24]" />;
      default:
        return <Sparkles className="size-4 text-muted-foreground" />;
    }
  };

  return (
    <div className={cn("relative", className)}>
      {/* Main search container */}
      <div
        className={cn(
          "flex min-h-[44px] w-full items-center gap-2 rounded-lg",
          "border border-border bg-background px-3",
          "transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
          "shadow-sm"
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />

        {/* Filter chips */}
        {(filters.length > 0 || timeRange || pendingEntity) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.map((filter, index) => (
              <FilterChip
                entity={filter.entity}
                key={`${filter.entity}-${index}`}
                negated={filter.negated}
                onRemove={() => onFilterRemove(index)}
                values={filter.values}
              />
            ))}
            {timeRange && (
              <TimeChip onRemove={onTimeRemove} value={timeRange.value} />
            )}
            {pendingEntity && !value && (
              <Badge className="gap-1" variant="outline">
                <span className="text-muted-foreground">{pendingEntity}:</span>
              </Badge>
            )}
          </div>
        )}

        {/* Input field */}
        <input
          className={cn(
            "flex-1 bg-transparent py-2",
            "text-[13px] text-foreground placeholder:text-muted-foreground",
            "outline-none"
          )}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            pendingEntity
              ? `Type or select ${pendingEntity} value (comma for multiple)...`
              : filters.length === 0
                ? placeholder
                : "Add more filters..."
          }
          ref={inputRef}
          type="text"
          value={value}
        />

        {/* Clear button */}
        {value && (
          <Button
            className="size-6 shrink-0"
            onClick={() => onChange("")}
            size="icon"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Autocomplete dropdown */}
      {open && allSuggestions.length > 0 && (
        <div
          className={cn(
            "absolute top-full z-50 mt-1 w-full",
            "rounded-lg border border-border bg-popover",
            "shadow-dropdown"
          )}
        >
          <div className="max-h-[300px] overflow-y-auto p-1">
            {/* Suggested Filters heading */}
            {cursorContext.mode === "empty" && (
              <div className="px-2 py-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                Suggested Filters
              </div>
            )}

            {allSuggestions.map((suggestion, index) => (
              <div
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5",
                  "text-[13px] text-foreground",
                  "transition-colors duration-75",
                  "hover:bg-accent hover:text-accent-foreground",
                  index === selectedIndex && "bg-accent text-accent-foreground"
                )}
                key={`${suggestion.type}-${suggestion.value}-${index}`}
                onClick={() => handleSelect(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {getSuggestionIcon(suggestion.type)}
                <span className="font-medium">{suggestion.label}</span>
                {suggestion.description && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {suggestion.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop to close dropdown */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
});

// =============================================================================
// SAVED SEARCHES (for future use)
// =============================================================================

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

export function useSavedSearches(_organizationId: string) {
  // TODO: Implement saved searches persistence
  return {
    savedSearches: [] as SavedSearch[],
    saveSearch: (_name: string, _query: string) => undefined,
    deleteSearch: (_id: string) => undefined,
  };
}
