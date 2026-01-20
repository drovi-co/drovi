import { z } from "zod";

// =============================================================================
// WEB SEARCH TOOL
// =============================================================================

export const webSearchSchema = z.object({
  query: z.string().describe("The search query"),
  numResults: z
    .number()
    .optional()
    .default(5)
    .describe("Number of results to return"),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;

export async function executeWebSearch(input: WebSearchInput) {
  const { query, numResults } = input;
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  if (!tavilyApiKey) {
    return {
      results: [],
      error:
        "Web search not configured. Set TAVILY_API_KEY to enable web search.",
    };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      max_results: numResults,
      search_depth: "basic",
    }),
  });

  if (!response.ok) {
    return {
      results: [],
      error: `Search failed: ${response.statusText}`,
    };
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return {
    results: data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })),
  };
}

export const webSearchTool = {
  description: "Search the web for information",
  parameters: webSearchSchema,
  execute: executeWebSearch,
};

// =============================================================================
// CALCULATOR TOOL
// =============================================================================

export const calculatorSchema = z.object({
  expression: z.string().describe("Mathematical expression to evaluate"),
});

export type CalculatorInput = z.infer<typeof calculatorSchema>;

export function executeCalculator(input: CalculatorInput) {
  const { expression } = input;
  try {
    // Simple and safe math expression evaluation
    // In production, use a proper math parser like mathjs
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
    const result = Function(`'use strict'; return (${sanitized})`)();
    return { result: Number(result) };
  } catch {
    return { error: "Invalid mathematical expression" };
  }
}

export const calculatorTool = {
  description: "Perform mathematical calculations",
  parameters: calculatorSchema,
  execute: executeCalculator,
};

// =============================================================================
// DATE/TIME TOOL
// =============================================================================

export const dateTimeSchema = z.object({
  timezone: z
    .string()
    .optional()
    .describe("Timezone (e.g., 'America/New_York')"),
  format: z.enum(["iso", "human"]).optional().default("human"),
});

export type DateTimeInput = z.infer<typeof dateTimeSchema>;

export function executeDateTime(input: DateTimeInput) {
  const { timezone, format } = input;
  const now = new Date();

  if (format === "iso") {
    return { datetime: now.toISOString() };
  }

  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: timezone ?? "UTC",
  };

  return {
    datetime: now.toLocaleString("en-US", options),
    timezone: timezone ?? "UTC",
  };
}

export const dateTimeTool = {
  description: "Get the current date and time",
  parameters: dateTimeSchema,
  execute: executeDateTime,
};

// =============================================================================
// JSON FORMATTER TOOL
// =============================================================================

export const jsonFormatterSchema = z.object({
  json: z.string().describe("JSON string to format"),
  action: z.enum(["format", "validate", "minify"]).default("format"),
});

export type JsonFormatterInput = z.infer<typeof jsonFormatterSchema>;

export function executeJsonFormatter(input: JsonFormatterInput) {
  const { json, action } = input;
  try {
    const parsed = JSON.parse(json);

    switch (action) {
      case "format":
        return { result: JSON.stringify(parsed, null, 2) };
      case "minify":
        return { result: JSON.stringify(parsed) };
      case "validate":
        return { valid: true, message: "Valid JSON" };
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

export const jsonFormatterTool = {
  description: "Format or validate JSON data",
  parameters: jsonFormatterSchema,
  execute: executeJsonFormatter,
};

// =============================================================================
// TEXT SUMMARIZATION SCHEMA
// =============================================================================

export const summarizeSchema = z.object({
  text: z.string().describe("Text to summarize"),
  maxLength: z
    .number()
    .optional()
    .describe("Maximum length of summary in words"),
  style: z
    .enum(["brief", "detailed", "bullet-points"])
    .optional()
    .default("brief"),
});

export type SummarizeInput = z.infer<typeof summarizeSchema>;

// =============================================================================
// TOOL COLLECTION
// =============================================================================

export const defaultTools = {
  webSearch: webSearchTool,
  calculator: calculatorTool,
  dateTime: dateTimeTool,
  jsonFormatter: jsonFormatterTool,
};

export type DefaultTools = typeof defaultTools;
