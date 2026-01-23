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
  IntelligenceClient,
  createClient,
  IntelligenceError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
} from "./client";

// =============================================================================
// STREAMING
// =============================================================================

export { EventStream, createAnalysisStream } from "./stream";
export type { AnalysisStreamOptions } from "./stream";

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Configuration
  IntelligenceClientConfig,
  // Common
  PaginatedResponse,
  ItemResponse,
  ErrorResponse,
  // UIO types
  UIOType,
  UIOStatus,
  SourceRole,
  SourceType,
  TimelineEventType,
  UIOSource,
  UIOTimelineEvent,
  UIOOwner,
  RelatedTask,
  UIOListItem,
  UIODetail,
  UIOFilters,
  // Analysis types
  AnalyzeOptions,
  AnalyzeInput,
  AnalysisResult,
  StreamEventType,
  StreamEvent,
  // Graph types
  GraphQueryInput,
  GraphQueryResult,
  // Webhook types
  WebhookInput,
  Webhook,
  // Event types
  IntelligenceEvent,
  EventStreamOptions,
  // Stats types
  IntelligenceStats,
} from "./types";
