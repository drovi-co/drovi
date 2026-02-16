import { createAskModule } from "@memorystack/mod-ask";
import { createAuthModule } from "@memorystack/mod-auth";
import { createConsoleModule } from "@memorystack/mod-console";
import { createDriveModule } from "@memorystack/mod-drive";
import { createEvidenceModule } from "@memorystack/mod-evidence";
import { resolveModules } from "@memorystack/mod-kit";
import {
  createOnboardingModule,
  type OnboardingStep,
} from "@memorystack/mod-onboarding";
import { createSourcesModule } from "@memorystack/mod-sources";
import { createTeamsModule } from "@memorystack/mod-teams";

export interface RuntimeOnboardingStep extends OnboardingStep {
  route: string;
}

const ONBOARDING_ROUTES_BY_STEP_ID: Record<string, string> = {
  create_org: "/onboarding/create-org",
  invite_team: "/onboarding/invite-team",
  connect_sources: "/onboarding/connect-sources",
  complete: "/onboarding/complete",
};

const webModules = resolveModules({
  modules: [
    createAuthModule({
      policy: {
        postLoginRedirect: "/dashboard",
      },
    }),
    createOnboardingModule(),
    createSourcesModule(),
    createTeamsModule(),
    createDriveModule(),
    createEvidenceModule(),
    createAskModule(),
    createConsoleModule(),
  ],
  enabledCapabilities: {
    "ops.internal": true,
  },
});

export function getWebModules() {
  return webModules;
}

export function getWebModule(moduleId: string) {
  return webModules.find((module) => module.id === moduleId) ?? null;
}

export function getWebCapabilities(): Record<string, boolean> {
  const capabilities: Record<string, boolean> = {};
  for (const module of webModules) {
    for (const capability of module.capabilities) {
      capabilities[capability] = true;
    }
  }
  return capabilities;
}

export function getWebPostLoginRedirect(): string {
  const authModule = getWebModule("mod-auth");
  const value = authModule?.uiHints.postLoginRedirect;
  return typeof value === "string" && value.length > 0 ? value : "/dashboard";
}

export function getWebAllowedConnectorIds(): string[] | null {
  const sourcesModule = getWebModule("mod-sources");
  const value = sourcesModule?.uiHints.allowedConnectors;
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function getWebOnboardingSteps(): RuntimeOnboardingStep[] {
  const onboardingModule = getWebModule("mod-onboarding");
  const value = onboardingModule?.uiHints.steps;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (
        item
      ): item is { id: string; requiredCapabilities: string[] | undefined } =>
        typeof item === "object" && item !== null && "id" in item
    )
    .map((item) => ({
      id: item.id,
      requiredCapabilities: Array.isArray(item.requiredCapabilities)
        ? item.requiredCapabilities.filter(
            (capability): capability is string => typeof capability === "string"
          )
        : [],
      route: ONBOARDING_ROUTES_BY_STEP_ID[item.id] ?? "/onboarding/create-org",
    }));
}
