import { useMemo } from "react";

export type TrustConfidenceTier = "high" | "medium" | "low";

const TRUST_TONE_BY_TIER: Record<TrustConfidenceTier, string> = {
  high: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  low: "border-red-500/30 bg-red-500/10 text-red-600",
};

export function resolveTrustConfidenceTier(
  confidence: number
): TrustConfidenceTier {
  if (confidence >= 0.75) {
    return "high";
  }
  if (confidence >= 0.5) {
    return "medium";
  }
  return "low";
}

export function resolveTrustToneClass(confidence: number): string {
  return TRUST_TONE_BY_TIER[resolveTrustConfidenceTier(confidence)];
}

export function normalizeInvalidAuditEntries(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter((entry): entry is string => typeof entry === "string");
}

export function useTrustToneClass(confidence: number): string {
  return useMemo(() => resolveTrustToneClass(confidence), [confidence]);
}
