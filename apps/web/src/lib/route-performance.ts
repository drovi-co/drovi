import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

const ROUTE_PERF_SAMPLE_RATE = 0.5;
const ROUTE_PERF_MAX_DURATION_MS = 120_000;

export type NavigationKind = "initial_load" | "route_change";

export interface RouteTransitionSample {
  fromRoute: string | null;
  toRoute: string;
  durationMs: number;
  navigationKind: NavigationKind;
}

export function normalizeRoutePath(path: string | null | undefined): string {
  if (!path) {
    return "/";
  }
  const [withoutHash] = path.split("#");
  return withoutHash || "/";
}

export function buildRoutePerformancePayload(sample: RouteTransitionSample): {
  routeFrom: string;
  routeTo: string;
  routeTransitionMs: number;
  navigationKind: NavigationKind;
} {
  return {
    routeFrom: sample.fromRoute ?? "initial",
    routeTo: normalizeRoutePath(sample.toRoute),
    routeTransitionMs: Math.max(0, Math.round(sample.durationMs)),
    navigationKind: sample.navigationKind,
  };
}

export function shouldTrackRoutePerformance(
  sample: RouteTransitionSample,
  randomValue: number
): boolean {
  return (
    sample.durationMs >= 0 &&
    sample.durationMs <= ROUTE_PERF_MAX_DURATION_MS &&
    randomValue <= ROUTE_PERF_SAMPLE_RATE
  );
}

function getInitialLoadDurationMs(): number | null {
  if (typeof window === "undefined" || !window.performance?.getEntriesByType) {
    return null;
  }
  const entries = window.performance.getEntriesByType("navigation");
  const nav = entries[0] as PerformanceNavigationTiming | undefined;
  if (!nav) {
    return null;
  }
  const duration = nav.domContentLoadedEventEnd || nav.loadEventEnd || nav.duration;
  return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null;
}

export function emitRoutePerformanceSample(
  sample: RouteTransitionSample,
  randomValue: number = Math.random()
): void {
  if (!shouldTrackRoutePerformance(sample, randomValue)) {
    return;
  }
  track("route_performance_sampled", buildRoutePerformancePayload(sample));
}

export function useRoutePerformanceInstrumentation(): void {
  const route = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.search}`,
  });
  const previousRouteRef = useRef<string | null>(null);
  const routeChangeStartedAtRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);

  useEffect(() => {
    if (typeof window === "undefined" || typeof performance === "undefined") {
      return;
    }

    const fromRoute = previousRouteRef.current;
    const toRoute = normalizeRoutePath(route);
    const startedAt = routeChangeStartedAtRef.current;
    const navigationKind: NavigationKind = fromRoute ? "route_change" : "initial_load";

    const rafId = window.requestAnimationFrame(() => {
      const fallbackDuration = Math.max(0, Math.round(performance.now() - startedAt));
      const durationMs =
        navigationKind === "initial_load"
          ? (getInitialLoadDurationMs() ?? fallbackDuration)
          : fallbackDuration;

      emitRoutePerformanceSample({
        fromRoute,
        toRoute,
        durationMs,
        navigationKind,
      });
    });

    previousRouteRef.current = toRoute;
    routeChangeStartedAtRef.current = performance.now();

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [route]);
}
