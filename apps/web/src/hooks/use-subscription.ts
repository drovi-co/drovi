/**
 * useSubscription Hook
 *
 * Provides subscription status and feature gating for the current organization.
 * Use this to conditionally render features based on plan type.
 */

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/utils/trpc";

export type PlanType = "pro" | "enterprise";
export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

export interface SubscriptionData {
  id: string;
  planType: PlanType;
  planName: string;
  status: SubscriptionStatus;
  seatCount: number;
  pricePerSeat: number;
  monthlyTotal: number;
  trialEndsAt: string | null;
  trialDaysRemaining: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  features: string[];
  limits: {
    maxUsers: number;
    maxSources: number;
    aiCredits: number;
  };
  createdAt: string;
}

/**
 * Hook to access subscription data and feature gating utilities
 */
export function useSubscription() {
  const trpc = useTRPC();

  const {
    data: subscription,
    isLoading,
    error,
    refetch,
  } = useQuery(trpc.credits.getSubscription.queryOptions());

  // Computed properties
  const isPro = subscription?.planType === "pro";
  const isEnterprise = subscription?.planType === "enterprise";

  const isActive =
    subscription?.status === "active" || subscription?.status === "trial";
  const isTrialing = subscription?.status === "trial";
  const isPastDue = subscription?.status === "past_due";
  const isCanceled = subscription?.status === "canceled";
  const isExpired = subscription?.status === "expired";

  const trialDaysLeft = subscription?.trialDaysRemaining ?? 0;
  const trialExpiringSoon = isTrialing && trialDaysLeft <= 3;

  // Feature gating
  const canUseProFeatures = isActive;
  const canUseEnterpriseFeatures = isEnterprise && isActive;

  // Check if a specific feature is available
  const canUseFeature = (feature: string): boolean => {
    if (!(subscription && isActive)) {
      return false;
    }

    // Enterprise features
    const enterpriseOnlyFeatures = [
      "sso",
      "scim",
      "advanced_analytics",
      "custom_integrations",
      "sla",
      "on_premise",
    ];

    if (enterpriseOnlyFeatures.includes(feature)) {
      return isEnterprise;
    }

    // All other features are available for Pro and Enterprise
    return true;
  };

  // Check if seat limit is reached
  const canAddMoreSeats = (): boolean => {
    if (!subscription) {
      return false;
    }
    const limit = subscription.limits.maxUsers;
    return limit === Number.POSITIVE_INFINITY || subscription.seatCount < limit;
  };

  // Check if source limit is reached
  const canAddMoreSources = (currentCount: number): boolean => {
    if (!subscription) {
      return false;
    }
    const limit = subscription.limits.maxSources;
    return limit === Number.POSITIVE_INFINITY || currentCount < limit;
  };

  return {
    // Data
    subscription,
    isLoading,
    error,
    refetch,

    // Plan type
    isPro,
    isEnterprise,

    // Status
    isActive,
    isTrialing,
    isPastDue,
    isCanceled,
    isExpired,

    // Trial info
    trialDaysLeft,
    trialExpiringSoon,
    trialEndsAt: subscription?.trialEndsAt
      ? new Date(subscription.trialEndsAt)
      : null,

    // Feature gating
    canUseProFeatures,
    canUseEnterpriseFeatures,
    canUseFeature,
    canAddMoreSeats,
    canAddMoreSources,

    // Pricing
    monthlyTotal: subscription?.monthlyTotal ?? 0,
    pricePerSeat: subscription?.pricePerSeat ?? 29,
    seatCount: subscription?.seatCount ?? 0,
  };
}
