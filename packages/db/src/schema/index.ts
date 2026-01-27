// Existing exports
export * from "./audit";
export * from "./auth";
// Contact identity linking (cross-source resolution)
export * from "./contact-identity";
// Contact relationships (social graph)
export * from "./contact-relationship";
// Contact source links (CRM sync, etc.)
export * from "./contact-source-link";
// Contact alerts (proactive monitoring)
export * from "./contact-alert";
// Contact intelligence snapshots (historical trend data)
export * from "./contact-intelligence-snapshot";
export * from "./credits";
// Derivation rules and calibration (knowledge evolution)
export * from "./derivation-rules";
// Google Docs integration
export * from "./google-docs";
// Intelligence entities (contacts, claims, commitments, decisions)
export * from "./intelligence";
// Notion integration
export * from "./notion";
// Organization management
export * from "./organization";
// Processing queues
export * from "./processing";
// Slack integration
export * from "./slack";
// Multi-source unified schema (sourceAccount, conversation, message)
export * from "./sources";
// Task management
export * from "./tasks";
// Unified Intelligence Objects (UIOs)
export * from "./unified-intelligence";
// Vector embeddings
export * from "./vectors";
// Waitlist
export * from "./waitlist";
// WhatsApp integration
export * from "./whatsapp";

// =============================================================================
// MULTIPLAYER & ENTERPRISE SCHEMAS
// =============================================================================

// Organization settings (privacy, SSO, SCIM, feature flags)
export * from "./organization-settings";
// Shared inbox (round-robin assignment, SLA tracking)
export * from "./shared-inbox";
// Intelligence sharing (auto-share, teammate linking)
export * from "./intelligence-sharing";
// Custom roles (granular permissions)
export * from "./custom-roles";
// Presence (real-time user status, "who's viewing")
export * from "./presence";
// Collaboration (mentions, comments, activity feed, delegation)
export * from "./collaboration";
// Push notifications (Web Push subscriptions)
export * from "./push-notifications";
