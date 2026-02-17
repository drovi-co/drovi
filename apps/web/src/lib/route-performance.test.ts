import { describe, expect, it } from "vitest";
import {
  buildRoutePerformancePayload,
  normalizeRoutePath,
  shouldTrackRoutePerformance,
  type RouteTransitionSample,
} from "./route-performance";

describe("route performance helpers", () => {
  it("normalizes route paths", () => {
    expect(normalizeRoutePath("/dashboard/drive#section-a")).toBe("/dashboard/drive");
    expect(normalizeRoutePath("")).toBe("/");
    expect(normalizeRoutePath(undefined)).toBe("/");
  });

  it("builds analytics payload for route transitions", () => {
    const sample: RouteTransitionSample = {
      fromRoute: "/dashboard",
      toRoute: "/dashboard/ledger?tab=records",
      durationMs: 134.7,
      navigationKind: "route_change",
    };

    expect(buildRoutePerformancePayload(sample)).toEqual({
      routeFrom: "/dashboard",
      routeTo: "/dashboard/ledger?tab=records",
      routeTransitionMs: 135,
      navigationKind: "route_change",
    });
  });

  it("applies sampling and duration guardrails", () => {
    const sample: RouteTransitionSample = {
      fromRoute: "/dashboard",
      toRoute: "/dashboard/sources",
      durationMs: 240,
      navigationKind: "route_change",
    };

    expect(shouldTrackRoutePerformance(sample, 0.2)).toBe(true);
    expect(shouldTrackRoutePerformance(sample, 0.9)).toBe(false);
    expect(
      shouldTrackRoutePerformance({ ...sample, durationMs: 500_000 }, 0.1)
    ).toBe(false);
  });
});
