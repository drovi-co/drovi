// =============================================================================
// SOURCE ADAPTERS
// =============================================================================
//
// Adapters for converting source-specific data to generic ConversationInput
// format. Each source type has its own adapter.
//

export * from "./calendar";
export * from "./email";
export * from "./google-docs";
export * from "./notion";
export * from "./slack";
export * from "./whatsapp";

// Future adapters:
// export * from "./meeting-transcript";

import type { SourceAdapter, SourceType } from "../types/content";
import { calendarAdapter } from "./calendar";
import { emailAdapter } from "./email";
import { googleDocsAdapter } from "./google-docs";
import { notionAdapter } from "./notion";
import { slackAdapter } from "./slack";
import { whatsappAdapter } from "./whatsapp";

/**
 * Registry of all available source adapters.
 */
export const sourceAdapters: Partial<
  Record<SourceType, SourceAdapter<unknown, unknown>>
> = {
  email: emailAdapter as SourceAdapter<unknown, unknown>,
  calendar: calendarAdapter as SourceAdapter<unknown, unknown>,
  slack: slackAdapter as SourceAdapter<unknown, unknown>,
  whatsapp: whatsappAdapter as SourceAdapter<unknown, unknown>,
  notion: notionAdapter as SourceAdapter<unknown, unknown>,
  google_docs: googleDocsAdapter as SourceAdapter<unknown, unknown>,
};

/**
 * Get adapter for a specific source type.
 */
export function getAdapter(
  sourceType: SourceType
): SourceAdapter<unknown, unknown> | undefined {
  return sourceAdapters[sourceType];
}

/**
 * Check if an adapter is available for a source type.
 */
export function hasAdapter(sourceType: SourceType): boolean {
  return sourceType in sourceAdapters;
}
