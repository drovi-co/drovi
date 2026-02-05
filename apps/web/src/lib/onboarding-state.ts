import type { OrgInfo } from "@/lib/api";

export type OnboardingState = "pending" | "complete";

export function getStoredOnboardingState(): OnboardingState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem("drovi:onboarding");
  return value === "pending" || value === "complete" ? value : null;
}

export function setStoredOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem("drovi:onboarding", state);
}

export function inferOnboardingComplete(orgInfo: OrgInfo | null | undefined): boolean {
  if (!orgInfo) {
    return false;
  }

  const hasConnectedSources = (orgInfo.connection_count ?? 0) > 0;
  const hasMultipleMembers = (orgInfo.member_count ?? 0) > 1;
  const hasOrgMetadata = Boolean(
    (orgInfo.allowed_domains?.length ?? 0) > 0 ||
      (orgInfo.notification_emails?.length ?? 0) > 0
  );

  return hasConnectedSources || hasMultipleMembers || hasOrgMetadata;
}
