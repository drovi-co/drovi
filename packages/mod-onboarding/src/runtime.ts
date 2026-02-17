import { useMemo } from "react";
import { canRunOnboardingStep, type OnboardingStep } from "./steps";

export type OnboardingCompletionState = "pending" | "complete";

export interface OnboardingRouteStep extends OnboardingStep {
  route: string;
}

interface ResolveOnboardingStateInput {
  storedState: OnboardingCompletionState | null;
  inferredComplete: boolean;
}

export interface ResolveOnboardingStateResult {
  state: OnboardingCompletionState;
  shouldPersist: boolean;
}

export function resolveOnboardingState({
  storedState,
  inferredComplete,
}: ResolveOnboardingStateInput): ResolveOnboardingStateResult {
  if (storedState === "complete" && !inferredComplete) {
    return { state: "pending", shouldPersist: true };
  }

  if (storedState === null) {
    return {
      state: inferredComplete ? "complete" : "pending",
      shouldPersist: true,
    };
  }

  return { state: storedState, shouldPersist: false };
}

interface ResolveOnboardingRouteInput {
  steps: OnboardingRouteStep[];
  capabilities: Record<string, boolean>;
  completeRoute?: string;
}

export function resolveOnboardingRoute({
  steps,
  capabilities,
  completeRoute = "/onboarding/complete",
}: ResolveOnboardingRouteInput): string {
  const availableSteps = steps.filter((step) =>
    canRunOnboardingStep(step, capabilities)
  );
  const firstActionableStep = availableSteps.find((step) => step.id !== "complete");
  return firstActionableStep?.route ?? completeRoute;
}

export function useOnboardingRoute(input: ResolveOnboardingRouteInput): string {
  return useMemo(
    () => resolveOnboardingRoute(input),
    [input.capabilities, input.completeRoute, input.steps]
  );
}
