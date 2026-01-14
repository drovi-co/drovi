import { devToolsMiddleware } from "@ai-sdk/devtools";
import { google } from "@ai-sdk/google";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@memorystack/api/context";
import { appRouter } from "@memorystack/api/routers/index";
import { auth } from "@memorystack/auth";
import { env } from "@memorystack/env/server";
import { convertToModelMessages, streamText, wrapLanguageModel } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { log } from "./lib/logger";
import { captureException, initSentry } from "./lib/sentry";
import {
  rateLimit,
  standardRateLimit,
  strictRateLimit,
} from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { composeRoutes } from "./routes/compose";
import { oauthRoutes } from "./routes/oauth";
import { publicApi } from "./routes/public-api";
import { gmailWebhook } from "./routes/webhooks/gmail";
import { polarWebhook } from "./routes/webhooks/polar";

// Initialize Sentry for error tracking
initSentry();

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

// Apply strict rate limiting to auth endpoints (5 requests per 15 minutes)
app.use("/api/auth/sign-in/*", strictRateLimit);
app.use("/api/auth/sign-up/*", strictRateLimit);
app.use("/api/auth/forgot-password/*", strictRateLimit);
app.use("/api/auth/reset-password/*", strictRateLimit);

// Standard rate limiting for other auth endpoints (100 requests per minute)
app.use("/api/auth/*", standardRateLimit);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Rate limit tRPC endpoints (100 requests per minute)
app.use("/trpc/*", standardRateLimit);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  })
);

// Rate limit AI endpoint (lower limit for expensive operations)
app.use(
  "/ai",
  rateLimit({
    limit: 20,
    windowMs: 60 * 1000,
    message: "AI rate limit exceeded. Please wait before making more requests.",
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

export default app;
