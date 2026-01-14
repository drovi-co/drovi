import {
  checkCredits,
  deductCredits,
  tokensToCredits,
} from "@memorystack/api/lib/credits";
import type { Context, MiddlewareHandler } from "hono";
import { log } from "../lib/logger";

export interface CreditContext {
  creditCheck: {
    organizationId: string;
    userId: string;
    requestId: string;
    estimatedCredits: number;
  };
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Credit check middleware
 * Validates that the organization has sufficient credits before processing
 *
 * @param estimatedTokens - Estimated tokens for this request (default: 1000 = 1 credit)
 */
export function creditCheck(estimatedTokens = 1000): MiddlewareHandler {
  return async (c, next) => {
    // Get user from session (assuming auth middleware has run)
    const session = c.get("session");

    if (!session?.session?.activeOrganizationId) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "No active organization. Please select an organization.",
        },
        401
      );
    }

    const organizationId = session.session.activeOrganizationId;
    const userId = session.user?.id;

    if (!userId) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "User not authenticated",
        },
        401
      );
    }

    const estimatedCredits = tokensToCredits(estimatedTokens);

    // Check if organization has sufficient credits
    const creditStatus = await checkCredits(organizationId, estimatedCredits);

    if (!creditStatus.hasCredits) {
      return c.json(
        {
          error: "INSUFFICIENT_CREDITS",
          message:
            "Insufficient credits. Please purchase more credits or upgrade your plan.",
          balance: creditStatus.balance,
          required: creditStatus.required,
        },
        402 // Payment Required
      );
    }

    // Generate request ID for tracking
    const requestId = generateRequestId();

    // Set credit context for later use
    c.set("creditCheck", {
      organizationId,
      userId,
      requestId,
      estimatedCredits,
    });

    return next();
  };
}

/**
 * Process AI credits after request completion
 * Call this in the onFinish callback of AI responses
 */
export async function processAICredits(params: {
  organizationId: string;
  userId: string;
  requestId: string;
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    const result = await deductCredits({
      organizationId: params.organizationId,
      userId: params.userId,
      tokensUsed: params.tokensUsed,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      model: params.model,
      requestId: params.requestId,
      description: params.description,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    log.error("Failed to deduct credits", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get credit context from Hono context
 */
export function getCreditContext(
  c: Context
): CreditContext["creditCheck"] | null {
  return c.get("creditCheck") ?? null;
}

/**
 * Helper to get client IP and user agent from context
 */
export function getRequestMetadata(c: Context) {
  // Get client IP
  let ipAddress = c.req.header("x-forwarded-for");
  if (ipAddress) {
    const firstIp = ipAddress.split(",")[0];
    ipAddress = firstIp?.trim();
  }
  ipAddress =
    ipAddress ??
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    "unknown";

  const userAgent = c.req.header("user-agent") ?? "unknown";

  return { ipAddress, userAgent };
}
