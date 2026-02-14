export * as admin from "./admin";
export {
  ApiError,
  type ApiErrorCode,
  type ApiErrorPayload,
  apiErrorFromHttp,
  apiErrorUnreachable,
} from "./errors";
export type {
  ApiAuthStrategy,
  ApiClientConfig,
  ApiRequestOptions,
  ApiTraceEvent,
  FetchLike,
} from "./http/client";
export { ApiClient } from "./http/client";

export * from "./support/models";
export { createSupportApi } from "./support/support-api";

export * as web from "./web";
