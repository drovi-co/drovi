import { db } from "@memorystack/db";
import { featureFlag } from "@memorystack/db/schema";
import { eq } from "drizzle-orm";

export interface FeatureFlagContext {
  userId?: string;
  organizationId?: string;
}

/**
 * Check if a feature flag is enabled for a given context
 */
export async function isFeatureEnabled(
  key: string,
  context: FeatureFlagContext = {}
): Promise<boolean> {
  const flag = await db.query.featureFlag.findFirst({
    where: eq(featureFlag.key, key),
  });

  if (!flag) {
    return false;
  }

  // If flag is globally disabled, return false
  if (!flag.enabled) {
    return false;
  }

  // Check if user is in allowed users list
  if (context.userId && flag.allowedUsers?.includes(context.userId)) {
    return true;
  }

  // Check if organization is in allowed organizations list
  if (
    context.organizationId &&
    flag.allowedOrganizations?.includes(context.organizationId)
  ) {
    return true;
  }

  // Check percentage rollout
  const percentage = Number.parseInt(flag.percentage ?? "0", 10);
  if (percentage >= 100) {
    return true;
  }

  if (percentage > 0 && context.userId) {
    // Use a consistent hash based on user ID and flag key
    // This ensures the same user always gets the same result for a flag
    const hash = simpleHash(`${context.userId}:${key}`);
    const userPercentile = hash % 100;
    return userPercentile < percentage;
  }

  // If no percentage and no allowed lists match, return false
  return (
    flag.allowedUsers?.length === 0 && flag.allowedOrganizations?.length === 0
  );
}

/**
 * Get all feature flags with their status for a context
 */
export async function getAllFeatureFlags(
  context: FeatureFlagContext = {}
): Promise<Record<string, boolean>> {
  const flags = await db.query.featureFlag.findMany();

  const result: Record<string, boolean> = {};

  for (const flag of flags) {
    result[flag.key] = await isFeatureEnabledForFlag(flag, context);
  }

  return result;
}

/**
 * Helper to check a flag object (without DB query)
 */
function isFeatureEnabledForFlag(
  flag: typeof featureFlag.$inferSelect,
  context: FeatureFlagContext
): boolean {
  if (!flag.enabled) {
    return false;
  }

  if (context.userId && flag.allowedUsers?.includes(context.userId)) {
    return true;
  }

  if (
    context.organizationId &&
    flag.allowedOrganizations?.includes(context.organizationId)
  ) {
    return true;
  }

  const percentage = Number.parseInt(flag.percentage ?? "0", 10);
  if (percentage >= 100) {
    return true;
  }

  if (percentage > 0 && context.userId) {
    const hash = simpleHash(`${context.userId}:${flag.key}`);
    const userPercentile = hash % 100;
    return userPercentile < percentage;
  }

  return (
    flag.allowedUsers?.length === 0 && flag.allowedOrganizations?.length === 0
  );
}

/**
 * Simple hash function for consistent percentage rollout
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a new feature flag
 */
export async function createFeatureFlag(data: {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  percentage?: number;
  allowedUsers?: string[];
  allowedOrganizations?: string[];
}) {
  const id = crypto.randomUUID();

  await db.insert(featureFlag).values({
    id,
    key: data.key,
    name: data.name,
    description: data.description,
    enabled: data.enabled ?? false,
    percentage: String(data.percentage ?? 0),
    allowedUsers: data.allowedUsers ?? [],
    allowedOrganizations: data.allowedOrganizations ?? [],
  });

  return { id, ...data };
}

/**
 * Update a feature flag
 */
export async function updateFeatureFlag(
  key: string,
  data: Partial<{
    name: string;
    description: string;
    enabled: boolean;
    percentage: number;
    allowedUsers: string[];
    allowedOrganizations: string[];
  }>
) {
  const updates: Partial<typeof featureFlag.$inferInsert> = {};

  if (data.name !== undefined) {
    updates.name = data.name;
  }
  if (data.description !== undefined) {
    updates.description = data.description;
  }
  if (data.enabled !== undefined) {
    updates.enabled = data.enabled;
  }
  if (data.percentage !== undefined) {
    updates.percentage = String(data.percentage);
  }
  if (data.allowedUsers !== undefined) {
    updates.allowedUsers = data.allowedUsers;
  }
  if (data.allowedOrganizations !== undefined) {
    updates.allowedOrganizations = data.allowedOrganizations;
  }

  await db.update(featureFlag).set(updates).where(eq(featureFlag.key, key));
}

/**
 * Delete a feature flag
 */
export async function deleteFeatureFlag(key: string) {
  await db.delete(featureFlag).where(eq(featureFlag.key, key));
}
