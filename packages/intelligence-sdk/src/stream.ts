// =============================================================================
// EVENT STREAM
// =============================================================================
//
// SSE (Server-Sent Events) stream client for real-time intelligence events.
//

import type { EventStreamOptions, IntelligenceEvent } from "./types";

// =============================================================================
// EVENT STREAM CLASS
// =============================================================================

/**
 * Event stream for receiving real-time intelligence events via SSE.
 */
export class EventStream {
  private readonly url: string;
  private readonly options: Required<
    Pick<EventStreamOptions, "topics" | "autoReconnect" | "reconnectDelay">
  > &
    EventStreamOptions;
  private eventSource: EventSource | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private shouldReconnect = true;

  constructor(url: string, options: EventStreamOptions = {}) {
    this.url = url;
    this.options = {
      topics: ["uio.*", "task.*"],
      autoReconnect: true,
      reconnectDelay: 3000,
      ...options,
    };
  }

  /**
   * Connect to the event stream.
   */
  connect(): void {
    if (this.eventSource) {
      return;
    }

    this.shouldReconnect = true;

    // Build URL with topics
    const urlWithTopics = new URL(this.url);
    urlWithTopics.searchParams.set("topics", this.options.topics.join(","));

    // Note: EventSource doesn't support custom headers in browsers.
    // The API key should be included in the URL or handled via cookies.
    // withCredentials can be set via EventSourceInit if the runtime supports it.
    this.eventSource = new EventSource(urlWithTopics.toString());

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.clearReconnectTimeout();
      this.options.onConnect?.();
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(event.type, data);
      } catch {
        // Ignore parse errors
      }
    };

    // Handle named events
    this.eventSource.addEventListener("connected", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        this.handleEvent("connected", data);
      } catch {
        // Ignore parse errors
      }
    });

    this.eventSource.addEventListener("event", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        this.handleEvent("event", data);
      } catch {
        // Ignore parse errors
      }
    });

    this.eventSource.addEventListener("heartbeat", () => {
      // Heartbeat received - connection is alive
    });

    this.eventSource.onerror = (error) => {
      this.isConnected = false;
      this.options.onError?.(
        new Error(error instanceof Event ? "EventSource error" : String(error))
      );
      this.eventSource?.close();
      this.eventSource = null;
      this.options.onDisconnect?.();

      // Attempt reconnect
      if (this.options.autoReconnect && this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * Disconnect from the event stream.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimeout();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.isConnected) {
      this.isConnected = false;
      this.options.onDisconnect?.();
    }
  }

  /**
   * Check if currently connected.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Update topics (will reconnect).
   */
  setTopics(topics: string[]): void {
    this.options.topics = topics;
    if (this.eventSource) {
      this.disconnect();
      this.connect();
    }
  }

  /**
   * Handle incoming events.
   */
  private handleEvent(type: string, data: unknown): void {
    if (type === "event" && this.options.onEvent) {
      // The event contains an IntelligenceEvent in the payload
      const eventData = data as { event?: IntelligenceEvent };
      if (eventData.event) {
        this.options.onEvent(eventData.event);
      }
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimeout();
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.options.reconnectDelay);
  }

  /**
   * Clear any pending reconnect timeout.
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

// =============================================================================
// ANALYSIS STREAM
// =============================================================================

/**
 * Options for the analysis stream.
 */
export interface AnalysisStreamOptions {
  /** Called when a node starts processing */
  onNodeStart?: (node: string) => void;
  /** Called when a node completes */
  onNodeComplete?: (node: string) => void;
  /** Called with progress updates */
  onProgress?: (progress: number) => void;
  /** Called on errors */
  onError?: (error: Error) => void;
}

/**
 * Async generator that yields analysis stream events.
 */
export async function* createAnalysisStream(
  response: Response,
  options: AnalysisStreamOptions = {}
): AsyncGenerator<{
  type: string;
  analysisId?: string;
  node?: string;
  results?: unknown;
  error?: string;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          // Event type line - next line will be data
          continue;
        }

        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            const eventType = data.type ?? "unknown";

            // Call appropriate callbacks
            if (
              eventType === "node_start" &&
              options.onNodeStart &&
              data.node
            ) {
              options.onNodeStart(data.node);
            } else if (
              eventType === "node_complete" &&
              options.onNodeComplete &&
              data.node
            ) {
              options.onNodeComplete(data.node);
            } else if (eventType === "error" && options.onError) {
              options.onError(new Error(data.error ?? "Unknown error"));
            }

            yield data;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
