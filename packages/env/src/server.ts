import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";

// Load .env files from multiple possible locations for monorepo compatibility
// Priority: apps/server/.env > .env (root)
const possibleEnvPaths = [
  resolve(process.cwd(), "apps/server/.env"),
  resolve(process.cwd(), ".env"),
];

for (const envPath of possibleEnvPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

// Skip validation during Trigger.dev build/indexing process or when explicitly requested
// Trigger.dev indexing runs in a worker context without env vars loaded
const skipValidation =
  !!process.env.SKIP_ENV_VALIDATION ||
  process.env.NODE_ENV === "test" ||
  // Detect Trigger.dev indexing context (no DATABASE_URL but has trigger-specific indicators)
  !(process.env.DATABASE_URL || process.env.BETTER_AUTH_SECRET);

export const env = createEnv({
  skipValidation,
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    POLAR_ACCESS_TOKEN: z.string().optional(),
    POLAR_PRO_PRODUCT_ID: z.string().optional(),
    POLAR_BUSINESS_PRODUCT_ID: z.string().optional(),
    POLAR_WEBHOOK_SECRET: z.string().optional(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // ==========================================================================
    // MEMORYSTACK: OAuth Providers
    // These are used for BOTH user authentication AND email access
    // ==========================================================================

    // Google/Gmail OAuth (requires Google Cloud project with Gmail API enabled)
    // Used for: User sign-up/sign-in AND Gmail email access
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Microsoft/Outlook OAuth (requires Azure AD app registration)
    // Used for: User sign-up/sign-in AND Outlook email access
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT_ID: z.string().default("common"), // 'common' for multi-tenant

    // Legacy aliases (for backward compatibility)
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),
    OUTLOOK_CLIENT_ID: z.string().optional(),
    OUTLOOK_CLIENT_SECRET: z.string().optional(),
    OUTLOOK_TENANT_ID: z.string().default("common"),

    // Token encryption key (32 bytes, base64 encoded for AES-256-GCM)
    // REQUIRED in production to encrypt OAuth tokens at rest
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .min(32)
      .optional()
      .refine((val) => process.env.NODE_ENV !== "production" || !!val, {
        message:
          "TOKEN_ENCRYPTION_KEY is required in production. Generate with: openssl rand -base64 32",
      }),

    // Gmail Push Notifications (Google Cloud Pub/Sub)
    // Topic name for Gmail to send notifications to (e.g., "projects/my-project/topics/gmail-push")
    GMAIL_PUBSUB_TOPIC: z.string().optional(),
    // Secret token to verify webhook requests come from Google
    GMAIL_WEBHOOK_SECRET: z.string().optional(),

    // Slack OAuth (for Slack integration)
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    // Signing secret for verifying webhook requests from Slack
    SLACK_SIGNING_SECRET: z.string().optional(),

    // WhatsApp Business API (Meta Graph API)
    // Requires a Meta Business account and WhatsApp Business app
    WHATSAPP_APP_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    // Verify token for webhook verification
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),

    // Notion OAuth (for Notion integration)
    // Create app at: https://www.notion.so/my-integrations
    NOTION_CLIENT_ID: z.string().optional(),
    NOTION_CLIENT_SECRET: z.string().optional(),
    // Optional: Override redirect URI (defaults to BETTER_AUTH_URL/api/oauth/notion/callback)
    NOTION_REDIRECT_URI: z.string().url().optional(),

    // Google Docs (uses existing Google OAuth credentials with additional scopes)
    // Set to true to enable Google Docs integration
    GOOGLE_DOCS_ENABLED: z.coerce.boolean().optional().default(false),

    // Email (Resend)
    RESEND_API_KEY: z.string().optional(),
    // Accepts both "email@domain.com" and "Display Name <email@domain.com>" formats
    EMAIL_FROM: z.string().optional(),

    // AI providers (optional)
    AI_PROVIDER: z
      .enum(["openai", "anthropic", "google", "groq"])
      .default("google"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    TAVILY_API_KEY: z.string().optional(),

    // Observability (optional)
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_HOST: z.string().url().optional(),

    // Sentry (optional)
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: z.string().default("development"),

    // PostHog Analytics (optional)
    POSTHOG_PROJECT_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),

    // Trigger.dev (optional)
    TRIGGER_SECRET_KEY: z.string().optional(),

    // Redis (optional, for rate limiting & caching)
    REDIS_URL: z.string().optional(),

    // S3/R2 Storage (optional)
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_PUBLIC_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
