// =============================================================================
// PROVIDER EXPORTS
// =============================================================================

// Email providers
export * from "./gmail";
export * from "./google-docs";
// Document/Knowledge providers
export * from "./notion";
export * from "./outlook";
// Messaging providers
export * from "./slack";
// CRM providers
export * from "./salesforce";
export * from "./hubspot";

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
export { isNotionConfigured } from "./notion";
export { isOutlookConfigured } from "./outlook";
export { isSlackConfigured } from "./slack";
export { isSalesforceConfigured } from "./salesforce";
export { isHubSpotConfigured } from "./hubspot";
