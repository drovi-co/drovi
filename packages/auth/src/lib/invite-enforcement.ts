// =============================================================================
// INVITE CODE ENFORCEMENT
// =============================================================================
//
// Utilities for enforcing invite codes during signup.
// Allowed emails can bypass invite code requirements.
//

import { db } from "@memorystack/db";
import { inviteCode, waitlistApplication } from "@memorystack/db/schema";
import { and, eq, gt, isNull, or } from "drizzle-orm";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Emails that can bypass invite code requirements.
 * These are admin/founder emails with full platform access.
 */
export const ALLOWED_EMAILS = [
  "jeremy@drovi.co",
  "sos@bettercalljerem.com",
] as const;

export type AllowedEmail = (typeof ALLOWED_EMAILS)[number];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if an email is in the allowed list (bypasses invite code requirement)
 */
export function isAllowedEmail(email: string): email is AllowedEmail {
  return ALLOWED_EMAILS.includes(email.toLowerCase() as AllowedEmail);
}

/**
 * Validate an invite code against the database
 *
 * @returns The invite code record if valid, null otherwise
 */
export async function validateInviteCode(code: string): Promise<{
  valid: boolean;
  inviteCode?: typeof inviteCode.$inferSelect;
  error?: string;
}> {
  if (!code) {
    return { valid: false, error: "Invite code is required" };
  }

  // Normalize code (uppercase, trim)
  const normalizedCode = code.toUpperCase().trim();

  // Look up the code
  const codeRecord = await db.query.inviteCode.findFirst({
    where: and(
      eq(inviteCode.code, normalizedCode),
      isNull(inviteCode.usedAt), // Not already used
      or(
        isNull(inviteCode.expiresAt), // No expiration
        gt(inviteCode.expiresAt, new Date()) // Or not expired
      )
    ),
  });

  if (!codeRecord) {
    return { valid: false, error: "Invalid or expired invite code" };
  }

  return { valid: true, inviteCode: codeRecord };
}

/**
 * Enforce invite code requirement for signup
 *
 * @param email - User's email address
 * @param inviteCodeValue - The invite code provided (if any)
 * @returns Result indicating if signup should proceed
 */
export async function enforceInviteCode(
  email: string,
  inviteCodeValue: string | null | undefined
): Promise<{
  allowed: boolean;
  isSuperAdmin: boolean;
  inviteCodeId?: string;
  error?: string;
}> {
  // Allowed emails bypass invite code requirement
  if (isAllowedEmail(email)) {
    return { allowed: true, isSuperAdmin: true };
  }

  // Regular users need a valid invite code
  if (!inviteCodeValue) {
    return {
      allowed: false,
      isSuperAdmin: false,
      error:
        "An invite code is required to sign up. Join the waitlist to request access.",
    };
  }

  const result = await validateInviteCode(inviteCodeValue);

  if (!(result.valid && result.inviteCode)) {
    return {
      allowed: false,
      isSuperAdmin: false,
      error: result.error ?? "Invalid invite code",
    };
  }

  return {
    allowed: true,
    isSuperAdmin: false,
    inviteCodeId: result.inviteCode.id,
  };
}

/**
 * Mark an invite code as used after successful signup
 *
 * @param inviteCodeId - The ID of the invite code record
 * @param userId - The ID of the user who used the code
 */
export async function markInviteCodeUsed(
  inviteCodeId: string,
  userId: string
): Promise<void> {
  // Update the invite code record
  await db
    .update(inviteCode)
    .set({
      usedAt: new Date(),
      usedByUserId: userId,
    })
    .where(eq(inviteCode.id, inviteCodeId));

  // Update the waitlist application status
  const codeRecord = await db.query.inviteCode.findFirst({
    where: eq(inviteCode.id, inviteCodeId),
    columns: { waitlistApplicationId: true },
  });

  if (codeRecord?.waitlistApplicationId) {
    await db
      .update(waitlistApplication)
      .set({ status: "converted" })
      .where(eq(waitlistApplication.id, codeRecord.waitlistApplicationId));
  }
}
