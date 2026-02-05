import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  backoffMs: number;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: "http://localhost:8000",
  timeout: 30000,
  retries: 3,
  backoffMs: 1000,
};

// In-flight request cache for deduplication
const inflightRequests = new Map<string, Promise<unknown>>();

function getRequestKey(path: string, options?: RequestOptions): string {
  return `${options?.method ?? "GET"}:${path}:${JSON.stringify(options?.body ?? {})}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiClient {
  private config: ApiClientConfig;
  private sessionToken: string | null = null;
  private isTauri: boolean;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  }

  setSession(token: string): void {
    this.sessionToken = token;
  }

  clearSession(): void {
    this.sessionToken = null;
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.config.baseUrl = url;
  }

  private async executeRequest<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const method = options.method ?? "GET";
    const fullPath = path.startsWith("/") ? path : `/${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.sessionToken) {
      headers["Authorization"] = `Bearer ${this.sessionToken}`;
    }

    if (this.isTauri) {
      // Use Tauri's invoke for HTTP requests
      // Note: core_request returns serde_json::Value which Tauri auto-serializes
      try {
        const result = await invoke<T>("core_request", {
          method,
          path: fullPath,
          body: options.body ?? null,
          headers,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ApiError("TAURI_ERROR", message, 0, undefined, true);
      }
    }

    // Fallback to fetch for browser/dev
    const url = `${this.config.baseUrl}${fullPath}`;
    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new ApiError(
        errorBody.error?.code ?? "HTTP_ERROR",
        errorBody.error?.message ?? response.statusText,
        response.status,
        errorBody.error?.details,
        response.status >= 500 || response.status === 429
      );
    }

    return response.json() as Promise<T>;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const key = getRequestKey(path, options);

    // Deduplicate concurrent identical requests
    if (options.method === "GET" || !options.method) {
      const inflight = inflightRequests.get(key);
      if (inflight) {
        return inflight as Promise<T>;
      }
    }

    const executeWithRetry = async (): Promise<T> => {
      let lastError: ApiError | null = null;

      for (let attempt = 0; attempt < this.config.retries; attempt++) {
        try {
          return await this.executeRequest<T>(path, options);
        } catch (error) {
          if (error instanceof ApiError) {
            lastError = error;
            if (!error.retryable) {
              throw error;
            }
            await sleep(this.config.backoffMs * Math.pow(2, attempt));
          } else {
            throw error;
          }
        }
      }

      throw lastError ?? new ApiError("UNKNOWN", "Request failed", 0);
    };

    const promise = executeWithRetry().finally(() => {
      inflightRequests.delete(key);
    });

    if (options.method === "GET" || !options.method) {
      inflightRequests.set(key, promise);
    }

    return promise;
  }

  async requestWithSchema<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    options: RequestOptions = {}
  ): Promise<z.infer<T>> {
    const data = await this.request<unknown>(path, options);
    return schema.parse(data);
  }

  // SSE streaming support
  async *stream(
    path: string,
    options: RequestOptions = {}
  ): AsyncGenerator<{ event: string; data: unknown }> {
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...options.headers,
    };

    if (this.sessionToken) {
      headers["Authorization"] = `Bearer ${this.sessionToken}`;
    }

    const response = await fetch(url, {
      method: options.method ?? "POST",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });

    if (!response.ok) {
      throw new ApiError("STREAM_ERROR", response.statusText, response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ApiError("STREAM_ERROR", "No response body", 0);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          if (!event.trim()) continue;
          const lines = event.split("\n");
          const eventType = lines.find((l) => l.startsWith("event:"))?.slice(7)?.trim();
          const dataLine = lines.find((l) => l.startsWith("data:"));
          const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;

          if (eventType && data !== null) {
            yield { event: eventType, data };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Singleton instance
export const apiClient = new ApiClient();

// Helper to set base URL from environment
export function initializeApiClient(baseUrl?: string): void {
  if (baseUrl) {
    apiClient.setBaseUrl(baseUrl);
  }
}
