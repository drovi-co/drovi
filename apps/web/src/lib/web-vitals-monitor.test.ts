import { describe, expect, it } from "vitest";
import {
  computePercentile,
  computeTtiMsFromDomInteractive,
  evaluateWebVitalBudgets,
  hasWebVitalBudgetBreach,
  shouldSampleWebVitals,
  summarizeInteractionLatency,
  WEB_VITAL_BUDGETS,
} from "./web-vitals-monitor";

describe("web vitals monitor helpers", () => {
  it("normalizes domInteractive into a TTI metric", () => {
    expect(computeTtiMsFromDomInteractive(1288.6)).toBe(1289);
    expect(computeTtiMsFromDomInteractive(-3)).toBeNull();
    expect(computeTtiMsFromDomInteractive(undefined)).toBeNull();
  });

  it("computes percentiles and interaction summaries", () => {
    expect(computePercentile([12, 42, 64, 80, 120], 0.95)).toBe(120);
    expect(computePercentile([], 0.95)).toBeNull();

    expect(summarizeInteractionLatency([10, 25, 130, 200, 90])).toEqual({
      maxMs: 200,
      p95Ms: 200,
      count: 5,
    });
  });

  it("evaluates budget breaches across lcp/tti/interaction", () => {
    const withinBudget = evaluateWebVitalBudgets({
      lcpMs: WEB_VITAL_BUDGETS.lcpMs - 50,
      ttiMs: WEB_VITAL_BUDGETS.ttiMs - 100,
      interactionLatencyMs: WEB_VITAL_BUDGETS.interactionLatencyMs - 10,
      interactionP95Ms: WEB_VITAL_BUDGETS.interactionLatencyMs - 20,
      interactionCount: 4,
    });
    expect(withinBudget).toEqual({
      lcpBreached: false,
      ttiBreached: false,
      interactionBreached: false,
    });
    expect(hasWebVitalBudgetBreach(withinBudget)).toBe(false);

    const breached = evaluateWebVitalBudgets({
      lcpMs: WEB_VITAL_BUDGETS.lcpMs + 1,
      ttiMs: WEB_VITAL_BUDGETS.ttiMs + 10,
      interactionLatencyMs: WEB_VITAL_BUDGETS.interactionLatencyMs + 5,
      interactionP95Ms: WEB_VITAL_BUDGETS.interactionLatencyMs + 3,
      interactionCount: 7,
    });
    expect(breached).toEqual({
      lcpBreached: true,
      ttiBreached: true,
      interactionBreached: true,
    });
    expect(hasWebVitalBudgetBreach(breached)).toBe(true);
  });

  it("applies deterministic sampling bounds", () => {
    expect(shouldSampleWebVitals(0.1, 0.5)).toBe(true);
    expect(shouldSampleWebVitals(0.9, 0.5)).toBe(false);
    expect(shouldSampleWebVitals(0.3, 0)).toBe(false);
    expect(shouldSampleWebVitals(0.3, 1)).toBe(true);
  });
});
