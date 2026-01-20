// =============================================================================
// POSTHOG ANALYTICS
// =============================================================================
//
// PostHog analytics integration for tracking user behavior and product metrics.
// Privacy-conscious implementation that respects DNT and avoids PII.
//

import { env } from "@memorystack/env/web";
import posthog from "posthog-js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Strongly-typed event names for analytics.
 * Organized by category for clarity.
 */
export type AnalyticsEvent =
  // Authentication
  | "user_signed_up"
  | "user_logged_in"
  | "user_logged_out"
  // Onboarding
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "email_account_connected"
  | "email_account_disconnected"
  // Thread Intelligence
  | "thread_opened"
  | "thread_brief_viewed"
  | "thread_archived"
  | "thread_starred"
  | "thread_read"
  | "message_expanded"
  // Commitments
  | "commitment_viewed"
  | "commitment_completed"
  | "commitment_verified"
  | "commitment_dismissed"
  | "commitment_snoozed"
  // Decisions
  | "decision_viewed"
  | "decision_verified"
  | "decision_dismissed"
  // Search & Command Bar
  | "search_performed"
  | "search_result_clicked"
  | "command_bar_opened"
  | "command_bar_action"
  // AI Interactions
  | "ai_extraction_accepted"
  | "ai_extraction_corrected"
  | "ai_draft_generated"
  | "ai_draft_used"
  | "ai_suggestion_clicked"
  // Settings & Configuration
  | "preference_changed"
  | "source_connected"
  | "source_disconnected"
  // Tasks
  | "task_created"
  | "task_completed"
  | "task_deleted"
  | "task_status_changed"
  // Inbox
  | "inbox_filter_changed"
  | "inbox_bulk_action"
  // Dashboards
  | "dashboard_viewed"
  | "widget_interacted";

/**
 * Properties for analytics events.
 * Each event can have specific properties.
 */
export interface AnalyticsEventProperties {
  // Common properties
  source?: string;
  organizationId?: string;

  // Thread properties
  threadId?: string;
  messageCount?: number;

  // Search properties
  query?: string;
  resultCount?: number;
  resultPosition?: number;

  // AI properties
  confidence?: number;
  correctionType?: string;
  model?: string;

  // Commitment/Decision properties
  itemId?: string;
  itemType?: string;
  verificationResult?: "confirmed" | "dismissed" | "corrected";

  // Task properties
  taskId?: string;
  status?: string;
  priority?: string;

  // Dashboard properties
  dashboardName?: string;
  widgetName?: string;

  // Settings properties
  settingName?: string;
  oldValue?: unknown;
  newValue?: unknown;

  // Source properties
  provider?: string;

  // Onboarding properties
  stepName?: string;
  stepNumber?: number;

  // Command bar properties
  action?: string;

  // Generic properties
  [key: string]: unknown;
}

/**
 * User properties for identification.
 * Avoid PII - use IDs only.
 */
export interface UserProperties {
  id: string;
  organizationId?: string;
  plan?: string;
  accountCount?: number;
  createdAt?: string;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

let isInitialized = false;

/**
 * Initialize PostHog analytics.
 * Should be called once at app startup.
 */
export function initAnalytics(): void {
  // Skip if already initialized
  if (isInitialized) return;

  // Skip if disabled or not configured
  if (!env.VITE_ANALYTICS_ENABLED || !env.VITE_POSTHOG_KEY) {
    console.log("[Analytics] Disabled or not configured");
    return;
  }

  // Respect Do Not Track
  if (navigator.doNotTrack === "1") {
    console.log("[Analytics] Respecting Do Not Track preference");
    return;
  }

  try {
    posthog.init(env.VITE_POSTHOG_KEY, {
      api_host: env.VITE_POSTHOG_HOST,

      // Privacy settings
      persistence: "localStorage",
      autocapture: false, // We control what gets tracked
      capture_pageview: false, // We handle page views manually
      capture_pageleave: true,
      disable_session_recording: false,

      // Session recording settings
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "[data-mask]",
      },

      // Performance
      loaded: (ph) => {
        // Disable in development unless explicitly enabled
        if (import.meta.env.DEV && !env.VITE_ANALYTICS_ENABLED) {
          ph.opt_out_capturing();
        }
      },
    });

    isInitialized = true;
    console.log("[Analytics] PostHog initialized");
  } catch (error) {
    console.error("[Analytics] Failed to initialize PostHog:", error);
  }
}

// =============================================================================
// TRACKING FUNCTIONS
// =============================================================================

/**
 * Track an analytics event.
 */
export function track(
  event: AnalyticsEvent,
  properties?: AnalyticsEventProperties
): void {
  if (!isInitialized) return;

  try {
    posthog.capture(event, {
      ...properties,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Analytics] Failed to track event:", error);
  }
}

/**
 * Track a page view.
 */
export function trackPageView(path: string, properties?: Record<string, unknown>): void {
  if (!isInitialized) return;

  try {
    posthog.capture("$pageview", {
      $current_url: path,
      ...properties,
    });
  } catch (error) {
    console.error("[Analytics] Failed to track page view:", error);
  }
}

/**
 * Identify a user.
 * Call after successful authentication.
 */
export function identifyUser(properties: UserProperties): void {
  if (!isInitialized) return;

  try {
    posthog.identify(properties.id, {
      organization_id: properties.organizationId,
      plan: properties.plan,
      account_count: properties.accountCount,
      created_at: properties.createdAt,
    });
  } catch (error) {
    console.error("[Analytics] Failed to identify user:", error);
  }
}

/**
 * Reset user identity (on logout).
 */
export function resetUser(): void {
  if (!isInitialized) return;

  try {
    posthog.reset();
  } catch (error) {
    console.error("[Analytics] Failed to reset user:", error);
  }
}

/**
 * Set user properties (for super properties).
 */
export function setUserProperties(properties: Record<string, unknown>): void {
  if (!isInitialized) return;

  try {
    posthog.people.set(properties);
  } catch (error) {
    console.error("[Analytics] Failed to set user properties:", error);
  }
}

// =============================================================================
// FEATURE FLAGS
// =============================================================================

/**
 * Check if a feature flag is enabled.
 */
export function isFeatureEnabled(flagKey: string): boolean {
  if (!isInitialized) return false;

  try {
    return posthog.isFeatureEnabled(flagKey) ?? false;
  } catch (error) {
    console.error("[Analytics] Failed to check feature flag:", error);
    return false;
  }
}

/**
 * Get feature flag payload.
 */
export function getFeatureFlagPayload<T>(flagKey: string): T | null {
  if (!isInitialized) return null;

  try {
    return posthog.getFeatureFlagPayload(flagKey) as T | null;
  } catch (error) {
    console.error("[Analytics] Failed to get feature flag payload:", error);
    return null;
  }
}

/**
 * Reload feature flags.
 */
export function reloadFeatureFlags(): void {
  if (!isInitialized) return;

  try {
    posthog.reloadFeatureFlags();
  } catch (error) {
    console.error("[Analytics] Failed to reload feature flags:", error);
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if analytics is initialized and enabled.
 */
export function isAnalyticsEnabled(): boolean {
  return isInitialized;
}

/**
 * Opt out of tracking.
 */
export function optOut(): void {
  if (!isInitialized) return;
  posthog.opt_out_capturing();
}

/**
 * Opt in to tracking.
 */
export function optIn(): void {
  if (!isInitialized) return;
  posthog.opt_in_capturing();
}

/**
 * Check if user has opted out.
 */
export function hasOptedOut(): boolean {
  if (!isInitialized) return true;
  return posthog.has_opted_out_capturing();
}

/**
 * Get the distinct ID (anonymous user ID).
 */
export function getDistinctId(): string | undefined {
  if (!isInitialized) return undefined;
  return posthog.get_distinct_id();
}

// =============================================================================
// SESSION RECORDING
// =============================================================================

/**
 * Start session recording.
 */
export function startSessionRecording(): void {
  if (!isInitialized) return;
  posthog.startSessionRecording();
}

/**
 * Stop session recording.
 */
export function stopSessionRecording(): void {
  if (!isInitialized) return;
  posthog.stopSessionRecording();
}

/**
 * Check if session recording is active.
 */
export function isSessionRecordingActive(): boolean {
  if (!isInitialized) return false;
  return posthog.sessionRecordingStarted();
}

// =============================================================================
// GROUPS (ORGANIZATIONS)
// =============================================================================

/**
 * Set the organization group for the user.
 * Used for organization-level analytics.
 */
export function setOrganization(
  organizationId: string,
  properties?: Record<string, unknown>
): void {
  if (!isInitialized) return;

  try {
    posthog.group("organization", organizationId, properties);
  } catch (error) {
    console.error("[Analytics] Failed to set organization group:", error);
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export { posthog };
