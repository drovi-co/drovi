// devToolsMiddleware is only available in development
const devToolsMiddleware =
  process.env.NODE_ENV === "development"
    ? require("@ai-sdk/devtools").devToolsMiddleware
    : () => undefined;
import { google } from "@ai-sdk/google";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@memorystack/api/context";
import { appRouter } from "@memorystack/api/routers/index";
import { auth } from "@memorystack/auth";
import { checkDatabaseHealth, disconnectDatabase } from "@memorystack/db";
import {
  checkRedisHealth,
  disconnectRedis,
  isRedisConfigured,
} from "@memorystack/db/lib/redis";
import { env } from "@memorystack/env/server";
import { convertToModelMessages, streamText, wrapLanguageModel } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { log } from "./lib/logger";
import { captureException, initSentry } from "./lib/sentry";
import { rateLimit } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { composeRoutes } from "./routes/compose";
import { oauthRoutes } from "./routes/oauth";
import { publicApi } from "./routes/public-api";
import { gmailWebhook } from "./routes/webhooks/gmail";
import { polarWebhook } from "./routes/webhooks/polar";

// Initialize Sentry for error tracking
initSentry();

// =============================================================================
// GRACEFUL SHUTDOWN STATE
// =============================================================================

let isShuttingDown = false;
let activeRequests = 0;

const app = new Hono();

// Global error handler
app.onError((err, c) => {
  captureException(err instanceof Error ? err : new Error(String(err)), {
    path: c.req.path,
    method: c.req.method,
  });
  log.error("Unhandled request error", err, {
    path: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: "Internal Server Error" }, 500);
});

// Structured request logging
app.use(requestLogger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Apply strict rate limiting to auth endpoints (5 requests per 15 minutes) - skip in development
const skipInDev = () => env.NODE_ENV === "development";

app.use(
  "/api/auth/sign-in/*",
  rateLimit({ limit: 5, windowMs: 15 * 60 * 1000, skip: skipInDev })
);
app.use(
  "/api/auth/sign-up/*",
  rateLimit({ limit: 5, windowMs: 15 * 60 * 1000, skip: skipInDev })
);
app.use(
  "/api/auth/forgot-password/*",
  rateLimit({ limit: 5, windowMs: 15 * 60 * 1000, skip: skipInDev })
);
app.use(
  "/api/auth/reset-password/*",
  rateLimit({ limit: 5, windowMs: 15 * 60 * 1000, skip: skipInDev })
);

// Standard rate limiting for other auth endpoints (100 requests per minute) - skip in development
app.use(
  "/api/auth/*",
  rateLimit({ limit: 100, windowMs: 60 * 1000, skip: skipInDev })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Rate limit tRPC endpoints (100 requests per minute) - skip in development
app.use(
  "/trpc/*",
  rateLimit({
    limit: 100,
    windowMs: 60 * 1000,
    skip: () => env.NODE_ENV === "development",
  })
);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  })
);

// Rate limit AI endpoint (lower limit for expensive operations) - skip in development
app.use(
  "/ai",
  rateLimit({
    limit: 20,
    windowMs: 60 * 1000,
    message: "AI rate limit exceeded. Please wait before making more requests.",
    skip: skipInDev,
  })
);

app.post("/ai", async (c) => {
  const body = await c.req.json();
  const uiMessages = body.messages || [];
  const model = wrapLanguageModel({
    model: google("gemini-2.5-flash"),
    middleware: devToolsMiddleware(),
  });
  const result = streamText({
    model,
    messages: await convertToModelMessages(uiMessages),
  });

  return result.toUIMessageStreamResponse();
});

// Mount public API routes (v1)
app.route("/api/v1", publicApi);

// OAuth callback routes (for email provider integration)
app.route("/api/oauth", oauthRoutes);

// Compose routes (send email, manage drafts)
app.route("/api/compose", composeRoutes);

// Polar webhooks (for credit purchases and subscriptions)
app.route("/api/webhooks/polar", polarWebhook);

// Gmail webhooks (for push notifications via Google Pub/Sub)
app.route("/api/webhooks/gmail", gmailWebhook);

app.get("/", (c) => {
  return c.text("OK");
});

// =============================================================================
// HEALTH CHECK ENDPOINTS
// =============================================================================

/**
 * Liveness probe - is the process running?
 * Used by Kubernetes/load balancers to detect if the process is alive
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    shuttingDown: isShuttingDown,
  });
});

/**
 * Readiness probe - can we handle traffic?
 * Used by Kubernetes/load balancers to determine if the server can accept requests
 */
app.get("/ready", async (c) => {
  // If shutting down, report not ready
  if (isShuttingDown) {
    return c.json(
      {
        status: "shutting_down",
        message: "Server is shutting down",
      },
      503
    );
  }

  // Check all dependencies
  const [dbHealth, redisHealth] = await Promise.all([
    checkDatabaseHealth(),
    isRedisConfigured()
      ? checkRedisHealth()
      : Promise.resolve({ connected: true, latencyMs: null, error: undefined }),
  ]);

  const checks = {
    database: {
      connected: dbHealth.connected,
      latencyMs: dbHealth.latencyMs,
      poolSize: dbHealth.poolSize,
      idleConnections: dbHealth.idleConnections,
      waitingClients: dbHealth.waitingClients,
      error: dbHealth.error,
    },
    redis: {
      configured: isRedisConfigured(),
      connected: redisHealth.connected,
      latencyMs: redisHealth.latencyMs,
      error: redisHealth.error,
    },
  };

  // Redis is optional, only database is required
  const allHealthy = dbHealth.connected;

  return c.json(
    {
      status: allHealthy ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      activeRequests,
      checks,
    },
    allHealthy ? 200 : 503
  );
});

// =============================================================================
// REQUEST TRACKING MIDDLEWARE (for graceful shutdown)
// =============================================================================

app.use("*", async (c, next) => {
  // Reject new requests during shutdown
  if (isShuttingDown) {
    return c.json(
      {
        error: "SERVICE_UNAVAILABLE",
        message: "Server is shutting down",
      },
      503
    );
  }

  activeRequests++;
  try {
    return await next();
  } finally {
    activeRequests--;
  }
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn("Shutdown already in progress");
    return;
  }

  log.info(`Received ${signal}, starting graceful shutdown`);
  isShuttingDown = true;

  // Wait for active requests to complete (max 30 seconds)
  const deadline = Date.now() + 30_000;
  while (activeRequests > 0 && Date.now() < deadline) {
    log.info(`Waiting for ${activeRequests} active requests to complete...`);
    await new Promise((r) => setTimeout(r, 500));
  }

  if (activeRequests > 0) {
    log.warn(`Forcing shutdown with ${activeRequests} active requests`);
  }

  // Close database connections
  try {
    await disconnectDatabase();
  } catch (error) {
    log.error("Error closing database connections", error);
  }

  // Close Redis connection
  if (isRedisConfigured()) {
    try {
      await disconnectRedis();
    } catch (error) {
      log.error("Error closing Redis connection", error);
    }
  }

  log.info("Graceful shutdown complete");
  process.exit(0);
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
