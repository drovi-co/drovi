import { useEffect } from "react";
import { track } from "@/lib/analytics";

export interface WebVitalsBudgets {
  lcpMs: number;
  ttiMs: number;
  interactionLatencyMs: number;
}

export interface WebVitalsSample {
  lcpMs: number | null;
  ttiMs: number | null;
  interactionLatencyMs: number | null;
  interactionP95Ms: number | null;
  interactionCount: number;
}

export interface WebVitalBudgetEvaluation {
  lcpBreached: boolean;
  ttiBreached: boolean;
  interactionBreached: boolean;
}

type WebVitalEmitReason = "settled" | "visibility_hidden" | "pagehide";

export const WEB_VITAL_BUDGETS: WebVitalsBudgets = {
  lcpMs: 2500,
  ttiMs: 3500,
  interactionLatencyMs: 200,
};

const WEB_VITAL_SAMPLE_RATE = 0.5;
const SETTLED_EMIT_DELAY_MS = 3000;

function toRoundedMetric(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

export function computeTtiMsFromDomInteractive(
  domInteractive: number | null | undefined
): number | null {
  return toRoundedMetric(domInteractive);
}

export function computePercentile(
  values: number[],
  percentile: number
): number | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const clampedPercentile = Math.max(0, Math.min(1, percentile));
  const sorted = [...values]
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * clampedPercentile) - 1)
  );
  const metric = sorted[index];
  return toRoundedMetric(metric);
}

export function summarizeInteractionLatency(values: number[]): {
  maxMs: number | null;
  p95Ms: number | null;
  count: number;
} {
  const normalized = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    maxMs:
      normalized.length === 0
        ? null
        : toRoundedMetric(Math.max(...normalized)),
    p95Ms: computePercentile(normalized, 0.95),
    count: normalized.length,
  };
}

export function evaluateWebVitalBudgets(
  sample: WebVitalsSample,
  budgets: WebVitalsBudgets = WEB_VITAL_BUDGETS
): WebVitalBudgetEvaluation {
  return {
    lcpBreached:
      typeof sample.lcpMs === "number" && sample.lcpMs > budgets.lcpMs,
    ttiBreached:
      typeof sample.ttiMs === "number" && sample.ttiMs > budgets.ttiMs,
    interactionBreached:
      typeof sample.interactionLatencyMs === "number" &&
      sample.interactionLatencyMs > budgets.interactionLatencyMs,
  };
}

export function hasWebVitalBudgetBreach(
  evaluation: WebVitalBudgetEvaluation
): boolean {
  return (
    evaluation.lcpBreached ||
    evaluation.ttiBreached ||
    evaluation.interactionBreached
  );
}

export function shouldSampleWebVitals(
  randomValue: number,
  sampleRate: number = WEB_VITAL_SAMPLE_RATE
): boolean {
  const normalizedRate = Math.max(0, Math.min(1, sampleRate));
  if (!Number.isFinite(randomValue)) {
    return false;
  }
  return randomValue <= normalizedRate;
}

function readDomInteractiveMs(): number | null {
  if (typeof window === "undefined" || !window.performance?.getEntriesByType) {
    return null;
  }
  const navEntry = window.performance.getEntriesByType(
    "navigation"
  )[0] as PerformanceNavigationTiming | undefined;
  if (!navEntry) {
    return null;
  }
  return computeTtiMsFromDomInteractive(navEntry.domInteractive);
}

function observeLcp(onValue: (value: number) => void): () => void {
  if (typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  try {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const latest = entries[entries.length - 1];
      if (!latest) {
        return;
      }
      const startTime = toRoundedMetric(latest.startTime);
      if (startTime !== null) {
        onValue(startTime);
      }
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
    return () => observer.disconnect();
  } catch {
    return () => undefined;
  }
}

function observeInteractionEvents(onDuration: (durationMs: number) => void): () => void {
  if (typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  try {
    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const duration = toRoundedMetric(entry.duration);
        if (duration !== null) {
          onDuration(duration);
        }
      }
    });
    observer.observe({
      type: "event",
      buffered: true,
      // `durationThreshold` is supported by modern browsers but not yet in TS lib.dom typing.
      durationThreshold: 40,
    } as unknown as PerformanceObserverInit);
    return () => observer.disconnect();
  } catch {
    return () => undefined;
  }
}

function buildBreachedMetrics(evaluation: WebVitalBudgetEvaluation): string[] {
  const breached: string[] = [];
  if (evaluation.lcpBreached) {
    breached.push("lcp");
  }
  if (evaluation.ttiBreached) {
    breached.push("tti");
  }
  if (evaluation.interactionBreached) {
    breached.push("interaction_latency");
  }
  return breached;
}

export function useWebVitalsMonitoring(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let latestLcpMs: number | null = null;
    const interactionDurations: number[] = [];
    const ttiMs = readDomInteractiveMs();
    let hasEmitted = false;

    const cleanupLcpObserver = observeLcp((value) => {
      latestLcpMs = value;
    });
    const cleanupInteractionObserver = observeInteractionEvents((value) => {
      interactionDurations.push(value);
    });

    const emitVitals = (reason: WebVitalEmitReason) => {
      if (hasEmitted) {
        return;
      }
      hasEmitted = true;

      if (!shouldSampleWebVitals(Math.random())) {
        return;
      }

      const interactionSummary = summarizeInteractionLatency(interactionDurations);
      const sample: WebVitalsSample = {
        lcpMs: latestLcpMs,
        ttiMs,
        interactionLatencyMs: interactionSummary.maxMs,
        interactionP95Ms: interactionSummary.p95Ms,
        interactionCount: interactionSummary.count,
      };
      const evaluation = evaluateWebVitalBudgets(sample);
      const breached = buildBreachedMetrics(evaluation);
      const budgetStatus = hasWebVitalBudgetBreach(evaluation)
        ? "breached"
        : "within_budget";

      const payload = {
        lcpMs: sample.lcpMs,
        ttiMs: sample.ttiMs,
        interactionLatencyMs: sample.interactionLatencyMs,
        interactionP95Ms: sample.interactionP95Ms,
        interactionCount: sample.interactionCount,
        performanceBudgetStatus: budgetStatus,
        performanceSampleTrigger: reason,
        lcpBudgetMs: WEB_VITAL_BUDGETS.lcpMs,
        ttiBudgetMs: WEB_VITAL_BUDGETS.ttiMs,
        interactionBudgetMs: WEB_VITAL_BUDGETS.interactionLatencyMs,
      } as const;

      track("web_vitals_sampled", payload);
      if (breached.length > 0) {
        track("web_vitals_budget_breached", {
          ...payload,
          breachedMetrics: breached,
        });
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        emitVitals("visibility_hidden");
      }
    };

    const onPageHide = () => emitVitals("pagehide");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    const settledTimer = window.setTimeout(() => emitVitals("settled"), SETTLED_EMIT_DELAY_MS);

    return () => {
      window.clearTimeout(settledTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      cleanupLcpObserver();
      cleanupInteractionObserver();
    };
  }, []);
}
