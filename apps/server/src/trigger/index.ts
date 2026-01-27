// =============================================================================
// TRIGGER.DEV TASK EXPORTS
// =============================================================================
//
// All intelligence extraction is handled by the Python backend (drovi-intelligence).
// These TypeScript tasks handle:
// - Data synchronization (email, calendar, slack, etc.)
// - OAuth token refresh
// - Task management
// - Integration with Python intelligence backend
//

// Audit and cleanup
export * from "./audit-log.js";
// Multi-source sync tasks
export * from "./calendar-sync.js";
export * from "./cleanup.js";
// Contact intelligence (proactive monitoring)
export * from "./contact-intelligence.js";
export * from "./credits.js";
// CRM sync (Salesforce, HubSpot, Pipedrive)
export * from "./crm-sync.js";
// Daily digest generation
export * from "./daily-digest.js";
// Data export
export * from "./data-export.js";
// Email infrastructure
export * from "./email-backfill.js";
export * from "./email-sync.js";
export * from "./google-docs-sync.js";
// Graph and intelligence (bridge to Python backend)
export * from "./graph-backfill.js";
export * from "./intelligence-extraction.js";
export * from "./notion-sync.js";
// Email sending
export * from "./send-email.js";
export * from "./slack-sync.js";
// Task and UIO management
export * from "./task-sync.js";
export * from "./token-refresh.js";
export * from "./unified-object-processing.js";

// User context refresh (RAM layer from Supermemory research)
export * from "./user-context-refresh.js";
export * from "./whatsapp-sync.js";
