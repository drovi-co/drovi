import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_ONBOARDING_NAMESPACE = "mod_onboarding";

export const modOnboardingMessages: Record<string, string> = {
  "onboarding.title": "Onboarding",
  "onboarding.createOrg": "Create organization",
  "onboarding.inviteTeam": "Invite team",
  "onboarding.connectSources": "Connect sources",
  "onboarding.complete": "Complete onboarding",
};

export const modOnboardingI18n: ModuleI18nNamespace = {
  namespace: MOD_ONBOARDING_NAMESPACE,
  defaultLocale: "en",
  messages: modOnboardingMessages,
};
