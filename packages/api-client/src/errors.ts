export type ApiErrorCode =
  | "api.unreachable"
  | "auth.unauthorized"
  | "auth.forbidden"
  | "http.validation_error"
  | "request.validation_error"
  | "request.conflict"
  | "resource.not_found"
  | "rate.limited"
  | "internal.unhandled"
  | "http.unknown"
  | "unknown";

export interface ApiErrorPayload {
  code?: string;
  detail?: unknown;
  request_id?: string;
  meta?: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly endpoint?: string;
  public readonly method?: string;
  public readonly requestId?: string;
  public readonly url?: string;
  public readonly meta?: unknown;
  public readonly detail?: unknown;

  constructor(params: {
    message: string;
    status: number;
    code: ApiErrorCode;
    endpoint?: string;
    method?: string;
    requestId?: string;
    url?: string;
    meta?: unknown;
    detail?: unknown;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.endpoint = params.endpoint;
    this.method = params.method;
    this.requestId = params.requestId;
    this.url = params.url;
    this.meta = params.meta;
    this.detail = params.detail;
  }
}

function coerceErrorCode(
  raw: string | undefined,
  status: number
): ApiErrorCode {
  if (!raw) {
    if (status === 401) return "auth.unauthorized";
    if (status === 403) return "auth.forbidden";
    if (status === 409) return "request.conflict";
    if (status === 404) return "resource.not_found";
    if (status === 429) return "rate.limited";
    if (status === 422) return "http.validation_error";
    if (status >= 500) return "internal.unhandled";
    return "http.unknown";
  }

  const normalized = raw.trim();
  switch (normalized) {
    case "auth.unauthorized":
      return "auth.unauthorized";
    case "auth.forbidden":
      return "auth.forbidden";
    case "request.validation_error":
      return "request.validation_error";
    case "http.validation_error":
      return "http.validation_error";
    case "request.conflict":
      return "request.conflict";
    case "resource.not_found":
      return "resource.not_found";
    case "internal.unhandled":
      return "internal.unhandled";
    default:
      return "http.unknown";
  }
}

function formatDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (!detail) return undefined;

  // FastAPI validation errors: [{loc, msg, type}, ...]
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg?: unknown }).msg ?? "");
        }
        return String(item);
      })
      .filter(Boolean)
      .slice(0, 3);
    if (messages.length) return messages.join("; ");
  }

  // Fallback to a conservative stringification.
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function apiErrorFromHttp(params: {
  status: number;
  payload: ApiErrorPayload | undefined;
  endpoint?: string;
  method?: string;
  url?: string;
  requestId?: string;
}): ApiError {
  const code = coerceErrorCode(params.payload?.code, params.status);
  const message =
    formatDetail(params.payload?.detail) ??
    (params.status === 401
      ? "Not authenticated"
      : params.status === 403
        ? "Forbidden"
        : params.status === 404
          ? "Not found"
          : "Request failed");

  return new ApiError({
    message,
    status: params.status,
    code,
    endpoint: params.endpoint,
    method: params.method,
    url: params.url,
    requestId: params.requestId ?? params.payload?.request_id,
    meta: params.payload?.meta,
    detail: params.payload?.detail,
  });
}

export function apiErrorUnreachable(params: {
  message: string;
  endpoint?: string;
  method?: string;
  url?: string;
  cause?: unknown;
}): ApiError {
  const detail =
    params.cause instanceof Error
      ? params.cause.message
      : String(params.cause ?? "");
  return new ApiError({
    message: params.message,
    status: 0,
    code: "api.unreachable",
    endpoint: params.endpoint,
    method: params.method,
    url: params.url,
    detail,
  });
}
