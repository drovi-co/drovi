// =============================================================================
// CIRCUIT BREAKER
// =============================================================================
//
// Implements the circuit breaker pattern for external API calls.
// Protects the system from cascading failures when external services are down.
//
// States:
// - CLOSED: Normal operation, requests pass through
// - OPEN: Service is failing, requests are rejected immediately
// - HALF_OPEN: Testing if service has recovered
//

import { log } from "./logger";

// =============================================================================
// TYPES
// =============================================================================

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery (half-open state) */
  resetTimeout: number;
  /** Number of successful calls in half-open state to close the circuit */
  successThreshold: number;
  /** Name for logging */
  name: string;
  /** Optional callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly state: CircuitState
  ) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

// =============================================================================
// CIRCUIT BREAKER CLASS
// =============================================================================

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly successThreshold: number;
  private readonly name: string;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeout = options.resetTimeout;
    this.successThreshold = options.successThreshold;
    this.name = options.name;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if we should transition from open to half-open
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("half-open");
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker ${this.name} is open. Service unavailable.`,
          this.name,
          this.state
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Execute with a fallback value when circuit is open
   */
  async executeWithFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        log.warn(`Circuit breaker ${this.name} returned fallback`, {
          state: this.state,
        });
        return fallback;
      }
      throw error;
    }
  }

  /**
   * Get current circuit breaker stats
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset(): void {
    this.transitionTo("closed");
    this.failures = 0;
    this.successes = 0;
  }

  /**
   * Force the circuit breaker to open state
   */
  forceOpen(): void {
    this.transitionTo("open");
  }

  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.totalSuccesses++;

    switch (this.state) {
      case "half-open":
        this.successes++;
        if (this.successes >= this.successThreshold) {
          this.transitionTo("closed");
          this.failures = 0;
          this.successes = 0;
        }
        break;
      case "closed":
        // Reset failure count on success in closed state
        this.failures = 0;
        break;
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.totalFailures++;
    this.failures++;

    switch (this.state) {
      case "half-open":
        // Any failure in half-open state opens the circuit
        this.transitionTo("open");
        this.successes = 0;
        break;
      case "closed":
        if (this.failures >= this.failureThreshold) {
          this.transitionTo("open");
        }
        break;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      log.info(`Circuit breaker ${this.name} state change: ${oldState} -> ${newState}`);
      this.onStateChange?.(oldState, newState);
    }
  }
}

// =============================================================================
// PRE-CONFIGURED CIRCUIT BREAKERS
// =============================================================================

/** Circuit breaker for Google Calendar API */
export const googleCalendarBreaker = new CircuitBreaker({
  name: "google-calendar",
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  successThreshold: 2,
});

/** Circuit breaker for Microsoft Graph API */
export const microsoftGraphBreaker = new CircuitBreaker({
  name: "microsoft-graph",
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

/** Circuit breaker for Gmail API */
export const gmailBreaker = new CircuitBreaker({
  name: "gmail",
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

/** Circuit breaker for Slack API */
export const slackBreaker = new CircuitBreaker({
  name: "slack",
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

/** Circuit breaker for WhatsApp Business API */
export const whatsappBreaker = new CircuitBreaker({
  name: "whatsapp",
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

/** Circuit breaker for Notion API */
export const notionBreaker = new CircuitBreaker({
  name: "notion",
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all circuit breaker stats for health monitoring
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  return {
    "google-calendar": googleCalendarBreaker.getStats(),
    "microsoft-graph": microsoftGraphBreaker.getStats(),
    gmail: gmailBreaker.getStats(),
    slack: slackBreaker.getStats(),
    whatsapp: whatsappBreaker.getStats(),
    notion: notionBreaker.getStats(),
  };
}

/**
 * Reset all circuit breakers (useful for testing)
 */
export function resetAllCircuitBreakers(): void {
  googleCalendarBreaker.reset();
  microsoftGraphBreaker.reset();
  gmailBreaker.reset();
  slackBreaker.reset();
  whatsappBreaker.reset();
  notionBreaker.reset();
}

/**
 * Create a circuit breaker for a custom service
 */
export function createCircuitBreaker(
  name: string,
  options?: Partial<Omit<CircuitBreakerOptions, "name">>
): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: options?.failureThreshold ?? 5,
    resetTimeout: options?.resetTimeout ?? 30000,
    successThreshold: options?.successThreshold ?? 2,
    onStateChange: options?.onStateChange,
  });
}
