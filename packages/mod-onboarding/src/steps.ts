export interface OnboardingStep {
  id: string;
  requiredCapabilities: string[];
}

export const defaultOnboardingSteps: OnboardingStep[] = [
  {
    id: "create_org",
    requiredCapabilities: ["org.create"],
  },
  {
    id: "invite_team",
    requiredCapabilities: ["team.invite"],
  },
  {
    id: "connect_sources",
    requiredCapabilities: ["sources.connect"],
  },
  {
    id: "complete",
    requiredCapabilities: [],
  },
];

export function canRunOnboardingStep(
  step: OnboardingStep,
  capabilities: Record<string, boolean>
): boolean {
  return step.requiredCapabilities.every(
    (capability) => capabilities[capability] !== false
  );
}

export function resolveAvailableOnboardingSteps(
  steps: OnboardingStep[],
  capabilities: Record<string, boolean>
): OnboardingStep[] {
  return steps.filter((step) => canRunOnboardingStep(step, capabilities));
}
