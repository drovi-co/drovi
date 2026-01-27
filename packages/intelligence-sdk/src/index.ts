// =============================================================================
// DROVI INTELLIGENCE SDK
// =============================================================================
//
// TypeScript SDK for the Drovi Intelligence Platform.
//
// @example
// ```typescript
// import { IntelligenceClient } from '@memorystack/intelligence-sdk';
//
// const client = new IntelligenceClient({ apiKey: 'your-api-key' });
//
// // Analyze content
// const result = await client.analyze({
//   content: 'I will send the report by Friday',
//   sourceType: 'email',
// });
//
// console.log('Extracted UIOs:', result.results.uios);
//
// // List commitments
// const commitments = await client.listUIOs({ type: 'commitment' });
//
// // Subscribe to real-time events
// const stream = client.subscribe({
//   onEvent: (event) => console.log('New event:', event),
// });
// stream.connect();
// ```
//

// =============================================================================
// CLIENT
// =============================================================================

export {
  AuthenticationError,
  createClient,
  IntelligenceClient,
  IntelligenceError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "./client";

// =============================================================================
// STREAMING
// =============================================================================

export type { AnalysisStreamOptions } from "./stream";
export { createAnalysisStream, EventStream } from "./stream";

// =============================================================================
// TYPES
// =============================================================================

export type {
  AnalysisResult,
  AnalyzeInput,
  // Analysis types
  AnalyzeOptions,
  ErrorResponse,
  EventStreamOptions,
  // Graph types
  GraphQueryInput,
  GraphQueryResult,
  // Configuration
  IntelligenceClientConfig,
  // Event types
  IntelligenceEvent,
  // Stats types
  IntelligenceStats,
  ItemResponse,
  // Common
  PaginatedResponse,
  RelatedTask,
  SourceRole,
  SourceType,
  StreamEvent,
  StreamEventType,
  TimelineEventType,
  UIODetail,
  UIOFilters,
  UIOListItem,
  UIOOwner,
  UIOSource,
  UIOStatus,
  UIOTimelineEvent,
  // UIO types
  UIOType,
  Webhook,
  // Webhook types
  WebhookInput,
} from "./types";
