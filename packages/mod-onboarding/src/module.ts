import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_ONBOARDING_NAMESPACE, modOnboardingI18n } from "./messages";
import { defaultOnboardingSteps, type OnboardingStep } from "./steps";

export interface CreateOnboardingModuleOptions {
  steps?: OnboardingStep[];
}

export function createOnboardingModule(
  options?: CreateOnboardingModuleOptions
): DroviModule {
  const steps = options?.steps ?? defaultOnboardingSteps;

  return {
    id: "mod-onboarding",
    title: "Onboarding",
    capabilities: ["org.create", "team.invite", "sources.connect"],
    routes: [
      { id: "onboarding.index", path: "/onboarding", slot: "onboarding" },
      {
        id: "onboarding.create_org",
        path: "/onboarding/create-org",
        slot: "onboarding",
      },
      {
        id: "onboarding.invite_team",
        path: "/onboarding/invite-team",
        slot: "onboarding",
      },
      {
        id: "onboarding.connect_sources",
        path: "/onboarding/connect-sources",
        slot: "onboarding",
      },
      {
        id: "onboarding.complete",
        path: "/onboarding/complete",
        slot: "onboarding",
      },
    ],
    i18n: {
      namespaces: [modOnboardingI18n],
    },
    uiHints: {
      namespace: MOD_ONBOARDING_NAMESPACE,
      steps,
    },
  };
}
