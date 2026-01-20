// =============================================================================
// UPDATE DETECTION AGENT MODULE
// =============================================================================
//
// Detects when messages reference or update existing UIOs.
//
// Usage:
//
//   import { createUpdateDetectionAgent } from "@memorystack/ai/agents";
//
//   const agent = createUpdateDetectionAgent(db);
//   const result = await agent.detectUpdates({
//     organizationId: "org_123",
//     message: {
//       id: "msg_456",
//       content: "I'll have the deck ready by Friday",
//       senderEmail: "alice@example.com",
//       timestamp: new Date(),
//       sourceType: "slack",
//     },
//   });
//
//   if (result.hasUpdates) {
//     await agent.applyUpdates(context, result.references);
//   }
//

// Main agent
export { createUpdateDetectionAgent, UpdateDetectionAgent } from "./agent";

// Types
export type {
  DetectedReference,
  ExtractedUpdateInfo,
  LLMUpdateDetectionResponse,
  MessageInput,
  TrackedUIO,
  UpdateDetectionContext,
  UpdateDetectionResult,
  UpdateType,
} from "./types";

// Schemas
export {
  DetectedReferenceSchema,
  ExtractedUpdateInfoSchema,
  LLMUpdateDetectionResponseSchema,
  UpdateTypeSchema,
} from "./types";
