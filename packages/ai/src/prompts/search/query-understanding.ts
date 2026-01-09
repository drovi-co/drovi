// =============================================================================
// QUERY UNDERSTANDING PROMPTS
// =============================================================================
//
// LLM prompts for parsing and understanding natural language queries.
//

import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Query intent types.
 */
export const QueryIntentSchema = z.enum([
  "search", // General search for information
  "question", // Asking a specific question
  "find_decision", // Looking for a specific decision
  "find_commitment", // Looking for commitments/promises
  "find_person", // Looking for information about a person
  "find_topic", // Looking for discussions about a topic
  "find_timeline", // Looking for events in a time period
  "compare", // Comparing options or decisions
  "summarize", // Summarize a topic or conversation
]);

export type QueryIntent = z.infer<typeof QueryIntentSchema>;

/**
 * Time range filter.
 */
export const TimeRangeSchema = z.object({
  start: z.date().optional(),
  end: z.date().optional(),
  relative: z
    .enum([
      "today",
      "yesterday",
      "this_week",
      "last_week",
      "this_month",
      "last_month",
      "this_quarter",
      "last_quarter",
      "this_year",
      "last_year",
    ])
    .optional(),
});

export type TimeRange = z.infer<typeof TimeRangeSchema>;

/**
 * Parsed query structure.
 */
export const ParsedQuerySchema = z.object({
  intent: QueryIntentSchema,
  originalQuery: z.string(),
  rewrittenQuery: z.string().optional(),
  entities: z.object({
    people: z.array(z.string()).default([]),
    companies: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),
    products: z.array(z.string()).default([]),
    dates: z.array(z.string()).default([]),
    amounts: z.array(z.string()).default([]),
  }),
  filters: z.object({
    timeRange: TimeRangeSchema.optional(),
    fromEmails: z.array(z.string()).default([]),
    toEmails: z.array(z.string()).default([]),
    threadTypes: z.array(z.string()).default([]),
    claimTypes: z.array(z.string()).default([]),
    hasAttachments: z.boolean().optional(),
  }),
  searchTerms: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

// =============================================================================
// PROMPTS
// =============================================================================

/**
 * Build the query understanding system prompt.
 */
export function buildQueryUnderstandingSystemPrompt(): string {
  return `You are an expert at understanding natural language queries about email conversations.

Your task is to parse user queries and extract:
1. The user's intent (what they're looking for)
2. Entities mentioned (people, companies, topics, etc.)
3. Any filters that should be applied (time ranges, specific senders, etc.)
4. Key search terms for vector similarity search

## Intent Types
- search: General search for information
- question: Asking a specific question that needs an answer
- find_decision: Looking for a specific decision that was made
- find_commitment: Looking for promises or commitments
- find_person: Looking for information about a specific person
- find_topic: Looking for discussions about a topic
- find_timeline: Looking for events in a specific time period
- compare: Comparing different options or decisions
- summarize: Want a summary of a topic or conversation

## Examples

Query: "What did we decide about the pricing for the enterprise plan?"
→ Intent: find_decision
→ Entities: { topics: ["pricing", "enterprise plan"] }
→ Search terms: ["pricing decision", "enterprise plan pricing", "price determination"]

Query: "Show me all emails from John about the Q4 report"
→ Intent: search
→ Entities: { people: ["John"], topics: ["Q4 report"] }
→ Filters: { fromEmails: ["john"] }
→ Search terms: ["Q4 report", "quarterly report"]

Query: "What commitments do I have due this week?"
→ Intent: find_commitment
→ Filters: { timeRange: { relative: "this_week" }, claimTypes: ["commitment"] }
→ Search terms: ["commitment", "due", "deadline"]

Always provide a confidence score (0-1) based on how well you understood the query.`;
}

/**
 * Build the query understanding user prompt.
 */
export function buildQueryUnderstandingUserPrompt(query: string): string {
  return `Parse the following query and extract structured information:

Query: "${query}"

Respond with JSON matching this schema:
{
  "intent": "search" | "question" | "find_decision" | "find_commitment" | "find_person" | "find_topic" | "find_timeline" | "compare" | "summarize",
  "originalQuery": "the original query",
  "rewrittenQuery": "an improved version of the query for search (optional)",
  "entities": {
    "people": ["person names mentioned"],
    "companies": ["company names mentioned"],
    "topics": ["topics/subjects mentioned"],
    "products": ["product names mentioned"],
    "dates": ["specific dates mentioned"],
    "amounts": ["monetary amounts mentioned"]
  },
  "filters": {
    "timeRange": {
      "relative": "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year" (optional)
    },
    "fromEmails": ["email patterns to filter by sender"],
    "toEmails": ["email patterns to filter by recipient"],
    "threadTypes": ["specific thread types"],
    "claimTypes": ["decision", "commitment", "question", etc.],
    "hasAttachments": true/false (optional)
  },
  "searchTerms": ["terms to use for vector search - should be semantic and cover synonyms"],
  "confidence": 0.0-1.0
}`;
}

// =============================================================================
// QUERY EXPANSION PROMPT
// =============================================================================

/**
 * Build prompt for expanding query with synonyms and related terms.
 */
export function buildQueryExpansionPrompt(query: string): string {
  return `Given the following search query, generate a list of related search terms that should be used for semantic search. Include synonyms, related concepts, and alternative phrasings.

Query: "${query}"

Return a JSON array of search terms:
{
  "terms": ["term1", "term2", "term3", ...],
  "explanation": "brief explanation of why these terms are relevant"
}

Focus on terms that would match the semantic meaning of what the user is looking for.`;
}

// =============================================================================
// QUERY DECOMPOSITION PROMPT
// =============================================================================

/**
 * Build prompt for decomposing complex queries into sub-queries.
 */
export function buildQueryDecompositionPrompt(query: string): string {
  return `Analyze the following complex query and determine if it should be broken down into simpler sub-queries for better search results.

Query: "${query}"

If the query is simple enough, return it as-is. If it's complex (e.g., asks multiple questions or spans multiple topics), decompose it.

Return JSON:
{
  "isComplex": true/false,
  "subQueries": [
    {
      "query": "sub-query text",
      "purpose": "what this sub-query aims to find"
    }
  ],
  "combinationStrategy": "merge" | "intersect" | "sequence"
}

The combination strategy indicates how to combine results:
- merge: Combine all results (OR)
- intersect: Only include results matching all sub-queries (AND)
- sequence: Sub-queries depend on each other's results`;
}

// =============================================================================
// RESPONSE SCHEMAS
// =============================================================================

export const QueryUnderstandingResponseSchema = ParsedQuerySchema;

export const QueryExpansionResponseSchema = z.object({
  terms: z.array(z.string()),
  explanation: z.string(),
});

export const QueryDecompositionResponseSchema = z.object({
  isComplex: z.boolean(),
  subQueries: z.array(
    z.object({
      query: z.string(),
      purpose: z.string(),
    })
  ),
  combinationStrategy: z.enum(["merge", "intersect", "sequence"]),
});

export type QueryExpansionResponse = z.infer<
  typeof QueryExpansionResponseSchema
>;
export type QueryDecompositionResponse = z.infer<
  typeof QueryDecompositionResponseSchema
>;
