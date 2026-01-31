// =============================================================================
// CONSOLE QUERY PARSER
// =============================================================================
//
// Datadog-style search query parser for the Console.
// Supports entity filters, time ranges, and free text search.
//
// Examples:
//   type:commitment status:active,overdue owner:me @7d
//   -status:archived contact:"John Smith" quarterly report
//   type:decision priority:high from:2024-01-01 to:2024-01-31
//

// =============================================================================
// TYPES
// =============================================================================

export type FilterOperator = "=" | "in" | "not" | "contains";

export interface ParsedFilter {
  entity: string;
  operator: FilterOperator;
  values: string[];
  negated: boolean;
}

export interface TimeRange {
  type: "relative" | "absolute";
  value: string;
  field: "created_at" | "updated_at" | "due_date";
}

export interface ParsedQuery {
  filters: ParsedFilter[];
  freeText: string[];
  timeRange: TimeRange | null;
}

// Entity definitions with their allowed values
export interface EntityDefinition {
  name: string;
  prefix: string;
  values: string[] | "dynamic";
  multiValue: boolean;
  negatable: boolean;
  description: string;
}

// =============================================================================
// ENTITY DEFINITIONS
// =============================================================================

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
  {
    name: "type",
    prefix: "type:",
    values: ["commitment", "decision", "task", "risk", "claim", "brief"],
    multiValue: true,
    negatable: true,
    description: "Filter by intelligence type",
  },
  {
    name: "status",
    prefix: "status:",
    values: [
      "active",
      "completed",
      "archived",
      "overdue",
      "snoozed",
      "draft",
      "in_progress",
    ],
    multiValue: true,
    negatable: true,
    description: "Filter by status",
  },
  {
    name: "priority",
    prefix: "priority:",
    values: ["no_priority", "low", "medium", "high", "urgent"],
    multiValue: true,
    negatable: true,
    description: "Filter by priority level",
  },
  {
    name: "direction",
    prefix: "direction:",
    values: ["owed_by_me", "owed_to_me"],
    multiValue: true,
    negatable: true,
    description: "Filter commitments by direction",
  },
  {
    name: "contact",
    prefix: "contact:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter by associated contact",
  },
  {
    name: "owner",
    prefix: "owner:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter by owner (use 'me' for yourself)",
  },
  {
    name: "debtor",
    prefix: "debtor:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter commitments by debtor",
  },
  {
    name: "creditor",
    prefix: "creditor:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter commitments by creditor",
  },
  {
    name: "assignee",
    prefix: "assignee:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter tasks by assignee",
  },
  {
    name: "decision_maker",
    prefix: "decision_maker:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter decisions by decision maker",
  },
  {
    name: "confidence",
    prefix: "confidence:",
    values: ["high", "medium", "low"],
    multiValue: true,
    negatable: true,
    description: "Filter by AI confidence level",
  },
  {
    name: "verified",
    prefix: "verified:",
    values: ["true", "false"],
    multiValue: false,
    negatable: false,
    description: "Filter by verification status",
  },
  {
    name: "source",
    prefix: "source:",
    values: ["gmail", "slack", "outlook", "calendar"],
    multiValue: true,
    negatable: true,
    description: "Filter by source integration",
  },
  {
    name: "has_due_date",
    prefix: "has_due_date:",
    values: ["true", "false"],
    multiValue: false,
    negatable: false,
    description: "Filter items with/without due dates",
  },
  {
    name: "overdue",
    prefix: "overdue:",
    values: ["true", "false"],
    multiValue: false,
    negatable: false,
    description: "Filter overdue items",
  },
  {
    name: "at_risk",
    prefix: "at_risk:",
    values: ["true", "false"],
    multiValue: false,
    negatable: false,
    description: "Filter at-risk items",
  },
  {
    name: "company",
    prefix: "company:",
    values: "dynamic",
    multiValue: true,
    negatable: true,
    description: "Filter by associated company",
  },
];

// Time filter patterns
const TIME_PATTERNS = {
  relative: /^@(now-)?(\d+)(m|h|d|w|y)$/,
  due: /^due:@(\d+)(d|w|m)$/,
  dueOverdue: /^due:overdue$/,
  created: /^created:@(\d+)(d|w|m|y)$/,
  updated: /^updated:@(\d+)(d|w|m|y)$/,
  from: /^from:(\d{4}-\d{2}-\d{2})$/,
  to: /^to:(\d{4}-\d{2}-\d{2})$/,
};

// =============================================================================
// TOKENIZER
// =============================================================================

interface Token {
  type: "filter" | "time" | "text" | "quoted";
  raw: string;
  negated: boolean;
  entity?: string;
  values?: string[];
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let remaining = query.trim();

  while (remaining.length > 0) {
    // Skip whitespace
    const wsMatch = remaining.match(/^\s+/);
    if (wsMatch) {
      remaining = remaining.slice(wsMatch[0].length);
      continue;
    }

    // Check for quoted strings
    if (remaining.startsWith('"')) {
      const endQuote = remaining.indexOf('"', 1);
      if (endQuote !== -1) {
        tokens.push({
          type: "quoted",
          raw: remaining.slice(0, endQuote + 1),
          negated: false,
        });
        remaining = remaining.slice(endQuote + 1);
        continue;
      }
    }

    // Check for negated filter (-entity:value)
    const negatedMatch = remaining.match(/^-([a-z_]+):("[^"]+"|[^\s,]+(?:,[^\s,]+)*)/i);
    if (negatedMatch) {
      const entity = negatedMatch[1].toLowerCase();
      const valueStr = negatedMatch[2];
      const values = parseValues(valueStr);

      tokens.push({
        type: "filter",
        raw: negatedMatch[0],
        negated: true,
        entity,
        values,
      });
      remaining = remaining.slice(negatedMatch[0].length);
      continue;
    }

    // Check for entity filter (entity:value or entity:value1,value2)
    const filterMatch = remaining.match(/^([a-z_]+):("[^"]+"|[^\s,]+(?:,[^\s,]+)*)/i);
    if (filterMatch) {
      const entity = filterMatch[1].toLowerCase();
      const valueStr = filterMatch[2];
      const values = parseValues(valueStr);

      tokens.push({
        type: "filter",
        raw: filterMatch[0],
        negated: false,
        entity,
        values,
      });
      remaining = remaining.slice(filterMatch[0].length);
      continue;
    }

    // Check for time filter (@7d, @now-1h, etc.)
    const timeMatch = remaining.match(/^@(now-)?(\d+)(m|h|d|w|y)/i);
    if (timeMatch) {
      tokens.push({
        type: "time",
        raw: timeMatch[0],
        negated: false,
      });
      remaining = remaining.slice(timeMatch[0].length);
      continue;
    }

    // Regular word (free text)
    const wordMatch = remaining.match(/^[^\s]+/);
    if (wordMatch) {
      tokens.push({
        type: "text",
        raw: wordMatch[0],
        negated: false,
      });
      remaining = remaining.slice(wordMatch[0].length);
      continue;
    }

    // Safety: skip one character if nothing matched
    remaining = remaining.slice(1);
  }

  return tokens;
}

function parseValues(valueStr: string): string[] {
  // Remove surrounding quotes if present
  if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
    return [valueStr.slice(1, -1)];
  }
  // Split by comma for multi-value
  return valueStr.split(",").map((v) => v.trim());
}

// =============================================================================
// PARSER
// =============================================================================

export function parseConsoleQuery(query: string): ParsedQuery {
  const tokens = tokenize(query);
  const filters: ParsedFilter[] = [];
  const freeText: string[] = [];
  let timeRange: TimeRange | null = null;

  for (const token of tokens) {
    if (token.type === "filter" && token.entity && token.values) {
      const operator: FilterOperator = token.values.length > 1 ? "in" : "=";
      filters.push({
        entity: token.entity,
        operator,
        values: token.values,
        negated: token.negated,
      });
    } else if (token.type === "time") {
      // Parse relative time like @7d, @now-1h
      const match = token.raw.match(/^@(now-)?(\d+)(m|h|d|w|y)$/i);
      if (match) {
        const value = `${match[2]}${match[3]}`;
        timeRange = {
          type: "relative",
          value,
          field: "created_at",
        };
      }
    } else if (token.type === "text" || token.type === "quoted") {
      // Add to free text search
      const text =
        token.type === "quoted"
          ? token.raw.slice(1, -1) // Remove quotes
          : token.raw;
      if (text) {
        freeText.push(text);
      }
    }
  }

  return { filters, freeText, timeRange };
}

// =============================================================================
// QUERY BUILDER
// =============================================================================

export function buildQueryString(parsed: ParsedQuery): string {
  const parts: string[] = [];

  // Add filters
  for (const filter of parsed.filters) {
    const prefix = filter.negated ? "-" : "";
    const valueStr =
      filter.values.length === 1
        ? filter.values[0].includes(" ")
          ? `"${filter.values[0]}"`
          : filter.values[0]
        : filter.values.join(",");
    parts.push(`${prefix}${filter.entity}:${valueStr}`);
  }

  // Add free text
  for (const text of parsed.freeText) {
    if (text.includes(" ")) {
      parts.push(`"${text}"`);
    } else {
      parts.push(text);
    }
  }

  // Add time range
  if (parsed.timeRange) {
    parts.push(`@${parsed.timeRange.value}`);
  }

  return parts.join(" ");
}

// =============================================================================
// AUTOCOMPLETE HELPERS
// =============================================================================

export interface AutocompleteSuggestion {
  type: "entity" | "value" | "time" | "saved";
  label: string;
  value: string;
  description?: string;
  icon?: string;
}

export function getEntitySuggestions(partial: string): AutocompleteSuggestion[] {
  const lower = partial.toLowerCase();
  return ENTITY_DEFINITIONS.filter((e) => e.name.startsWith(lower)).map(
    (e) => ({
      type: "entity" as const,
      label: e.prefix,
      value: e.prefix,
      description: e.description,
    })
  );
}

export function getValueSuggestions(
  entity: string,
  partial: string
): AutocompleteSuggestion[] {
  const def = ENTITY_DEFINITIONS.find((e) => e.name === entity);
  if (!def || def.values === "dynamic") {
    return [];
  }

  const lower = partial.toLowerCase();
  return def.values
    .filter((v) => v.toLowerCase().includes(lower))
    .map((v) => ({
      type: "value" as const,
      label: v,
      value: v,
    }));
}

export function getTimeSuggestions(): AutocompleteSuggestion[] {
  return [
    { type: "time", label: "@15m", value: "@15m", description: "Last 15 minutes" },
    { type: "time", label: "@1h", value: "@1h", description: "Last 1 hour" },
    { type: "time", label: "@4h", value: "@4h", description: "Last 4 hours" },
    { type: "time", label: "@1d", value: "@1d", description: "Last 1 day" },
    { type: "time", label: "@7d", value: "@7d", description: "Last 7 days" },
    { type: "time", label: "@30d", value: "@30d", description: "Last 30 days" },
    { type: "time", label: "@90d", value: "@90d", description: "Last 90 days" },
    { type: "time", label: "@1y", value: "@1y", description: "Last 1 year" },
  ];
}

// =============================================================================
// CURSOR POSITION HELPERS
// =============================================================================

export interface CursorContext {
  mode: "empty" | "entity" | "value" | "time" | "freetext";
  partial: string;
  entity?: string;
  existingValues?: string[];
}

export function getCursorContext(query: string, cursorPos: number): CursorContext {
  const beforeCursor = query.slice(0, cursorPos);

  // Empty or whitespace only
  if (!beforeCursor.trim()) {
    return { mode: "empty", partial: "" };
  }

  // Check if we're typing a time filter (starts with @)
  const timeMatch = beforeCursor.match(/(^|\s)@([a-z0-9-]*)$/i);
  if (timeMatch) {
    return {
      mode: "time",
      partial: timeMatch[2],
    };
  }

  // Check if we're typing a value (after colon)
  const valueMatch = beforeCursor.match(/([a-z_]+):([^:\s]*)$/i);
  if (valueMatch) {
    const entity = valueMatch[1].toLowerCase();
    const partial = valueMatch[2];
    // Check for comma-separated values
    const parts = partial.split(",");
    const currentPart = parts[parts.length - 1];
    const existingValues = parts.slice(0, -1);

    return {
      mode: "value",
      partial: currentPart,
      entity,
      existingValues,
    };
  }

  // Check if we're typing an entity prefix
  const entityMatch = beforeCursor.match(/(^|\s)-?([a-z_]*)$/i);
  if (entityMatch) {
    const partial = entityMatch[2];
    if (partial.length > 0) {
      return { mode: "entity", partial };
    }
  }

  // Default to free text
  const lastWord = beforeCursor.match(/[^\s]+$/);
  return {
    mode: "freetext",
    partial: lastWord ? lastWord[0] : "",
  };
}

// =============================================================================
// SERIALIZATION FOR API
// =============================================================================

export interface ConsoleQueryRequest {
  filters: Array<{
    entity: string;
    operator: string;
    values: string[];
    negated: boolean;
  }>;
  free_text: string[];
  time_range: {
    type: string;
    value: string;
    field: string;
  } | null;
  group_by: string | null;
  visualization: string;
  limit: number;
  cursor: string | null;
}

export function toApiRequest(
  parsed: ParsedQuery,
  options: {
    groupBy?: string | null;
    visualization?: string;
    limit?: number;
    cursor?: string | null;
  } = {}
): ConsoleQueryRequest {
  return {
    filters: parsed.filters.map((f) => ({
      entity: f.entity,
      operator: f.operator,
      values: f.values,
      negated: f.negated,
    })),
    free_text: parsed.freeText,
    time_range: parsed.timeRange
      ? {
          type: parsed.timeRange.type,
          value: parsed.timeRange.value,
          field: parsed.timeRange.field,
        }
      : null,
    group_by: options.groupBy ?? null,
    visualization: options.visualization ?? "list",
    limit: options.limit ?? 50,
    cursor: options.cursor ?? null,
  };
}
