import { env } from "@memorystack/env/server";
import pino from "pino";

// Create base logger with appropriate configuration
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",

  // Use pretty printing in development
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,

  // Base fields included in every log
  base: {
    env: env.NODE_ENV,
    service: "memorystack-server",
  },

  // Redact sensitive fields
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "apiKey",
      "secret",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
    ],
    remove: true,
  },

  // Custom serializers
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      params: req.params,
      headers: {
        "user-agent": req.headers?.["user-agent"],
        "content-type": req.headers?.["content-type"],
        "x-request-id": req.headers?.["x-request-id"],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
  },

  // Timestamp formatting
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(requestId: string, userId?: string) {
  return logger.child({
    requestId,
    ...(userId && { userId }),
  });
}

/**
 * Log levels with structured data
 */
export const log = {
  debug: (message: string, data?: Record<string, unknown>) => {
    logger.debug(data, message);
  },

  info: (message: string, data?: Record<string, unknown>) => {
    logger.info(data, message);
  },

  warn: (message: string, data?: Record<string, unknown>) => {
    logger.warn(data, message);
  },

  error: (
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>
  ) => {
    if (error instanceof Error) {
      logger.error({ err: error, ...data }, message);
    } else {
      logger.error({ error, ...data }, message);
    }
  },

  fatal: (
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>
  ) => {
    if (error instanceof Error) {
      logger.fatal({ err: error, ...data }, message);
    } else {
      logger.fatal({ error, ...data }, message);
    }
  },
};

/**
 * Audit log for security-sensitive operations
 */
export function auditLog(
  action: string,
  context: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }
) {
  logger.info(
    {
      audit: true,
      action,
      ...context,
    },
    `Audit: ${action}`
  );
}

/**
 * Performance log for tracking operation durations
 */
export function perfLog(
  operation: string,
  durationMs: number,
  metadata?: Record<string, unknown>
) {
  logger.info(
    {
      perf: true,
      operation,
      durationMs,
      ...metadata,
    },
    `Performance: ${operation} completed in ${durationMs}ms`
  );
}

/**
 * Get log level based on status code
 */
function getLogLevelForStatus(statusCode: number): "error" | "warn" | "info" {
  if (statusCode >= 500) {
    return "error";
  }
  if (statusCode >= 400) {
    return "warn";
  }
  return "info";
}

/**
 * API log for external service calls
 */
export function apiLog(
  service: string,
  method: string,
  statusCode: number,
  durationMs: number,
  metadata?: Record<string, unknown>
) {
  const level = getLogLevelForStatus(statusCode);
  logger[level](
    {
      api: true,
      service,
      method,
      statusCode,
      durationMs,
      ...metadata,
    },
    `API ${service}: ${method} -> ${statusCode} (${durationMs}ms)`
  );
}

export default logger;
