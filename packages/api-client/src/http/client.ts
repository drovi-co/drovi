import { z } from "zod";

import {
  type ApiErrorPayload,
  apiErrorFromHttp,
  apiErrorUnreachable,
} from "../errors";

export type ApiAuthStrategy =
  | { kind: "cookie" }
  | { kind: "bearer"; getToken: () => string | null }
  | { kind: "apiKey"; getKey: () => string | null; headerName?: string };

export interface ApiTraceEvent {
  kind: "ok" | "error";
  at: number;
  method: string;
  endpoint: string;
  url: string;
  status: number;
  requestId?: string;
  durationMs: number;
}

export interface ApiClientConfig {
  /** Absolute base URL for Node/test environments. In browsers, prefer empty string + relative paths. */
  baseUrl: string;
  /** Prefix for v1 endpoints, default: `/api/v1`. */
  apiPrefix?: string;
  /** Default request timeout (ms). */
  timeoutMs?: number;
  /** Default auth strategies to apply. */
  auth?: ApiAuthStrategy[];
  /** Include cookies by default (browser session auth). */
  credentials?: RequestCredentials;
  /** Custom fetch implementation (tests/Node). */
  fetch?: FetchLike;
  /** Hook for observability/diagnostics in apps. */
  onTrace?: (event: ApiTraceEvent) => void;
}

export interface ApiRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  /** When true, allows retrying non-idempotent calls. Default false. */
  allowRetry?: boolean;
  /** Override timeout per-request (ms). */
  timeoutMs?: number;
  /** Query parameters to append. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PREFIX = "/api/v1";
const DEFAULT_CREDENTIALS: RequestCredentials = "include";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function normalizeHeaders(
  headers: HeadersInit | undefined
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers } as Record<string, string>;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function appendQuery(url: string, query: ApiRequestOptions["query"]): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return url;
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

const errorPayloadSchema = z
  .object({
    code: z.string().optional(),
    detail: z.unknown().optional(),
    request_id: z.string().optional(),
    meta: z.unknown().optional(),
  })
  .passthrough();

function coerceErrorPayload(raw: unknown): ApiErrorPayload | undefined {
  const parsed = errorPayloadSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return undefined;
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isIdempotent(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function backoffDelayMs(attempt: number): number {
  // Deterministic exponential backoff: 250ms, 500ms, 1000ms (capped).
  // Jitter is intentionally omitted to keep client behavior test-friendly.
  const base = 250 * 2 ** Math.max(0, attempt);
  return Math.min(2000, base);
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly timeoutMs: number;
  private readonly auth: ApiAuthStrategy[];
  private readonly credentials: RequestCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly onTrace?: (event: ApiTraceEvent) => void;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiPrefix = config.apiPrefix ?? DEFAULT_PREFIX;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.auth = config.auth ?? [{ kind: "cookie" }];
    this.credentials = config.credentials ?? DEFAULT_CREDENTIALS;
    // Do not capture `fetch` at construction time because test harnesses (MSW)
    // patch `globalThis.fetch` after modules are evaluated. This wrapper keeps
    // the default behavior interceptable.
    this.fetchImpl =
      config.fetch ??
      ((input, init) => {
        if (typeof globalThis.fetch !== "function") {
          throw new Error(
            "ApiClient requires fetch; provide ApiClientConfig.fetch"
          );
        }
        return globalThis.fetch(input, init);
      });
    this.onTrace = config.onTrace;
  }

  get diagnosticsBaseUrl(): string {
    // This is only for diagnostics surfaces (e.g. "API unreachable" banners).
    if (typeof window !== "undefined") return window.location.origin;
    return this.baseUrl;
  }

  async requestJson<T>(
    path: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const endpoint = `${this.apiPrefix}${path}`;

    const headers = normalizeHeaders(options.headers);
    if (!hasHeader(headers, "Content-Type")) {
      headers["Content-Type"] = "application/json";
    }

    // Auth injection: do not override explicit Authorization header.
    if (!hasHeader(headers, "Authorization")) {
      for (const strategy of this.auth) {
        if (strategy.kind === "bearer") {
          const token = strategy.getToken();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
            break;
          }
        }
      }
    }
    // API key injection: do not override explicit header.
    for (const strategy of this.auth) {
      if (strategy.kind !== "apiKey") continue;
      const headerName = strategy.headerName ?? "X-API-Key";
      if (hasHeader(headers, headerName)) continue;
      const key = strategy.getKey();
      if (key) {
        headers[headerName] = key;
      }
    }

    const url = appendQuery(
      typeof window !== "undefined" ? endpoint : `${this.baseUrl}${endpoint}`,
      options.query
    );

    const startedAt = nowMs();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    const attemptRequest = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body =
          options.body === undefined
            ? undefined
            : typeof options.body === "string"
              ? options.body
              : JSON.stringify(options.body);
        return await this.fetchImpl(url, {
          method,
          headers,
          body,
          credentials: this.credentials,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    const maxRetries = 2;
    const canRetry = isIdempotent(method) || Boolean(options.allowRetry);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await attemptRequest();
      } catch (cause) {
        const durationMs = Math.max(0, Math.round(nowMs() - startedAt));
        this.onTrace?.({
          kind: "error",
          at: Date.now(),
          method,
          endpoint,
          url,
          status: 0,
          durationMs,
        });
        throw apiErrorUnreachable({
          message: `Drovi API unreachable (${method} ${endpoint}).`,
          endpoint,
          method,
          url,
          cause,
        });
      }

      const requestId = res.headers.get("X-Request-ID") ?? undefined;
      const durationMs = Math.max(0, Math.round(nowMs() - startedAt));

      if (res.ok) {
        this.onTrace?.({
          kind: "ok",
          at: Date.now(),
          method,
          endpoint,
          url,
          status: res.status,
          requestId,
          durationMs,
        });

        // Allow 204 responses without a body.
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      this.onTrace?.({
        kind: "error",
        at: Date.now(),
        method,
        endpoint,
        url,
        status: res.status,
        requestId,
        durationMs,
      });

      let payload: ApiErrorPayload | undefined;
      try {
        payload = coerceErrorPayload(await res.json());
      } catch {
        payload = undefined;
      }

      if (canRetry && attempt < maxRetries && shouldRetry(res.status)) {
        // Respect server-provided Retry-After when present.
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterMs = retryAfterHeader
          ? Math.max(0, Number(retryAfterHeader) * 1000)
          : undefined;
        const delay = retryAfterMs ?? backoffDelayMs(attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw apiErrorFromHttp({
        status: res.status,
        payload,
        endpoint,
        method,
        url,
        requestId,
      });
    }

    // Should be unreachable.
    throw apiErrorUnreachable({
      message: `Drovi API unreachable (${method} ${endpoint}).`,
      endpoint,
      method,
      url:
        typeof window !== "undefined" ? endpoint : `${this.baseUrl}${endpoint}`,
    });
  }
}
