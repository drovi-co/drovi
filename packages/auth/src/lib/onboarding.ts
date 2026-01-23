// =============================================================================
// MEMORYSTACK ONBOARDING
// =============================================================================
//
// Handles automatic organization creation and email account connection
// when a new user signs up via OAuth.
//

import { randomUUID } from "node:crypto";
import { db } from "@memorystack/db";
import { member, organization, sourceAccount } from "@memorystack/db/schema";

// =============================================================================
// TYPES
// =============================================================================

interface NewUser {
  id: string;
  email: string;
  name: string | null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a URL-safe slug from a name
 */
function generateSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Add random suffix to ensure uniqueness
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${baseSlug}-${suffix}`;
}

/**
 * Get a friendly org name from email
 */
function getOrgNameFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";

  // Check for common personal email domains
  const personalDomains = [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "protonmail.com",
    "proton.me",
  ];

  if (personalDomains.includes(domain.toLowerCase())) {
    return "Personal";
  }

  // For work emails, use the domain name as org name
  const domainName = domain.split(".")[0] ?? domain;
  return domainName.charAt(0).toUpperCase() + domainName.slice(1);
}

// =============================================================================
// MAIN ONBOARDING FUNCTION
// =============================================================================

/**
 * Called when a new user is created via OAuth.
 * Creates their first organization and connects their email account.
 *
 * @param user - The newly created user
 */
export async function onboardNewUser(user: NewUser): Promise<void> {
  try {
    // 1. Get the OAuth account that was just created
    // (better-auth creates an account record linked to the user)
    const oauthAccount = await db.query.account.findFirst({
      where: (acc, { eq }) => eq(acc.userId, user.id),
      orderBy: (acc, { desc }) => [desc(acc.createdAt)],
    });

    if (!oauthAccount) {
      console.warn(`[onboarding] No OAuth account found for user ${user.id}`);
      return;
    }

    // Determine provider from OAuth provider ID
    let provider: "gmail" | "outlook";
    if (oauthAccount.providerId === "google") {
      provider = "gmail";
    } else if (oauthAccount.providerId === "microsoft") {
      provider = "outlook";
    } else {
      console.warn(
        `[onboarding] Unknown provider ${oauthAccount.providerId} for user ${user.id}`
      );
      return;
    }

    // 2. Create the first organization
    const orgName = getOrgNameFromEmail(user.email);
    const orgSlug = generateSlug(orgName);
    const orgId = randomUUID();

    await db.insert(organization).values({
      id: orgId,
      name: orgName,
      slug: orgSlug,
      plan: "free",
    });

    // 3. Add user as owner of the organization
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: user.id,
      role: "owner",
    });

    // 4. Connect the email account to the organization
    // Note: The OAuth tokens from better-auth are stored in the account table
    // We need to copy them to our sourceAccount table
    if (oauthAccount.accessToken && oauthAccount.refreshToken) {
      await db.insert(sourceAccount).values({
        organizationId: orgId,
        addedByUserId: user.id,
        type: "email",
        provider,
        externalId: user.email,
        displayName: user.name,
        accessToken: oauthAccount.accessToken,
        refreshToken: oauthAccount.refreshToken,
        tokenExpiresAt:
          oauthAccount.accessTokenExpiresAt ?? new Date(Date.now() + 3_600_000),
        status: "connected",
        isPrimary: true,
        settings: {
          syncEnabled: true,
          syncFrequencyMinutes: 5,
        },
      });

      console.log(
        `[onboarding] Created org "${orgName}" and connected ${provider} account for ${user.email}`
      );
    } else {
      console.warn(
        `[onboarding] No tokens available for ${user.email}, email account not connected`
      );
    }
  } catch (error) {
    // Don't fail user creation if onboarding fails
    console.error(`[onboarding] Error onboarding user ${user.id}:`, error);
  }
}
