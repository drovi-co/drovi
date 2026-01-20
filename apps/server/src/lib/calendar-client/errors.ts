// =============================================================================
// CALENDAR CLIENT ERRORS
// =============================================================================

import type { CalendarProvider } from "./types";

/**
 * Base error class for calendar client errors
 */
export class CalendarClientError extends Error {
  readonly provider: CalendarProvider;
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    provider: CalendarProvider,
    code: string,
    statusCode: number,
    retryable = false
  ) {
    super(message);
    this.name = "CalendarClientError";
    this.provider = provider;
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/**
 * Authentication/authorization error
 * Thrown when access token is invalid or refresh fails
 */
export class CalendarAuthError extends CalendarClientError {
  constructor(message: string, provider: CalendarProvider) {
    super(message, provider, "AUTH_ERROR", 401, false);
    this.name = "CalendarAuthError";
  }
}

/**
 * Resource not found error
 * Thrown when calendar or event doesn't exist
 */
export class CalendarNotFoundError extends CalendarClientError {
  readonly resourceType: "calendar" | "event";

  constructor(
    provider: CalendarProvider,
    resourceType: "calendar" | "event",
    resourceId?: string
  ) {
    const message = resourceId
      ? `${resourceType} not found: ${resourceId}`
      : `${resourceType} not found`;
    super(message, provider, "NOT_FOUND", 404, false);
    this.name = "CalendarNotFoundError";
    this.resourceType = resourceType;
  }
}

/**
 * Rate limit exceeded error
 * Thrown when API quota is exceeded
 */
export class CalendarQuotaError extends CalendarClientError {
  readonly retryAfterMs?: number;

  constructor(provider: CalendarProvider, retryAfterMs?: number) {
    super("Calendar API quota exceeded", provider, "QUOTA_EXCEEDED", 429, true);
    this.name = "CalendarQuotaError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Permission denied error
 * Thrown when user lacks permission for the requested operation
 */
export class CalendarPermissionError extends CalendarClientError {
  readonly action: "read" | "write" | "delete";

  constructor(
    provider: CalendarProvider,
    action: "read" | "write" | "delete",
    resourceType: "calendar" | "event"
  ) {
    super(
      `Permission denied to ${action} ${resourceType}`,
      provider,
      "PERMISSION_DENIED",
      403,
      false
    );
    this.name = "CalendarPermissionError";
    this.action = action;
  }
}

/**
 * Conflict error
 * Thrown when there's a conflict (e.g., concurrent modification)
 */
export class CalendarConflictError extends CalendarClientError {
  constructor(provider: CalendarProvider, message: string) {
    super(message, provider, "CONFLICT", 409, true);
    this.name = "CalendarConflictError";
  }
}

/**
 * Validation error
 * Thrown when input data is invalid
 */
export class CalendarValidationError extends CalendarClientError {
  readonly field?: string;

  constructor(provider: CalendarProvider, message: string, field?: string) {
    super(message, provider, "VALIDATION_ERROR", 400, false);
    this.name = "CalendarValidationError";
    this.field = field;
  }
}

/**
 * Provider-specific error (catch-all)
 * Thrown for unexpected provider errors
 */
export class CalendarProviderError extends CalendarClientError {
  readonly originalError?: unknown;

  constructor(
    message: string,
    provider: CalendarProvider,
    statusCode: number,
    originalError?: unknown
  ) {
    super(message, provider, "PROVIDER_ERROR", statusCode, statusCode >= 500);
    this.name = "CalendarProviderError";
    this.originalError = originalError;
  }
}

/**
 * Network error
 * Thrown when network request fails
 */
export class CalendarNetworkError extends CalendarClientError {
  readonly originalError?: unknown;

  constructor(provider: CalendarProvider, originalError?: unknown) {
    super("Network request failed", provider, "NETWORK_ERROR", 0, true);
    this.name = "CalendarNetworkError";
    this.originalError = originalError;
  }
}

// =============================================================================
// ERROR NORMALIZATION HELPER
// =============================================================================

/**
 * Normalize API errors to CalendarClientError subclasses
 */
export function normalizeCalendarError(
  error: unknown,
  provider: CalendarProvider
): CalendarClientError {
  // Already a CalendarClientError
  if (error instanceof CalendarClientError) {
    return error;
  }

  // Fetch/network errors
  if (
    error instanceof TypeError &&
    (error.message.includes("fetch") || error.message.includes("network"))
  ) {
    return new CalendarNetworkError(provider, error);
  }

  // HTTP response with status
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message =
      (error as { message?: string }).message || "Calendar API error";

    switch (status) {
      case 401:
        return new CalendarAuthError(message, provider);
      case 403:
        return new CalendarPermissionError(provider, "read", "calendar");
      case 404:
        return new CalendarNotFoundError(provider, "event");
      case 409:
        return new CalendarConflictError(provider, message);
      case 429:
        return new CalendarQuotaError(provider);
      default:
        return new CalendarProviderError(message, provider, status, error);
    }
  }

  // Generic error
  const message = error instanceof Error ? error.message : String(error);
  return new CalendarProviderError(message, provider, 500, error);
}
