// =============================================================================
// PROVIDER EXPORTS
// =============================================================================

// Email providers
export * from "./gmail";
export * from "./google-docs";
export * from "./hubspot";
// Document/Knowledge providers
export * from "./notion";
export * from "./outlook";
// CRM providers
export * from "./salesforce";
// Messaging providers
export * from "./slack";

// Re-export common types
export type EmailProvider = "gmail" | "outlook";
export type MessagingProvider = "slack";
export type DocumentProvider = "notion" | "google_docs";
export type CRMProvider = "salesforce" | "hubspot" | "pipedrive";
export type SourceProvider =
  | EmailProvider
  | MessagingProvider
  | DocumentProvider
  | CRMProvider;

/**
 * Check if providers are configured
 */
export { isGmailConfigured } from "./gmail";
export { isGoogleDocsConfigured } from "./google-docs";
export { isHubSpotConfigured } from "./hubspot";
export { isNotionConfigured } from "./notion";
export { isOutlookConfigured } from "./outlook";
export { isSalesforceConfigured } from "./salesforce";
export { isSlackConfigured } from "./slack";
