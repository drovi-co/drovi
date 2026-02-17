export type ProofSupersessionState =
  | "active"
  | "final"
  | "superseding"
  | "superseded";

export interface ProofSummaryInput {
  evidenceCount?: number | null;
  lastVerifiedAt?: Date | string | null;
  supersessionState?: ProofSupersessionState | null;
  confidence?: number | null;
  locale?: string;
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortDate(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(value);
}

export function proofSupersessionToken(
  state: ProofSupersessionState | null | undefined
): { code: string; label: string } {
  switch (state) {
    case "superseded":
      return { code: "S↓", label: "Superseded" };
    case "superseding":
      return { code: "S↑", label: "Superseding prior record" };
    case "final":
      return { code: "S✓", label: "Finalized" };
    case "active":
    default:
      return { code: "S•", label: "Active" };
  }
}

export function buildProofSummary({
  evidenceCount,
  lastVerifiedAt,
  supersessionState,
  confidence,
  locale = "en-US",
}: ProofSummaryInput) {
  const verifiedDate = normalizeDate(lastVerifiedAt);
  const supersession = proofSupersessionToken(supersessionState);
  const confidencePct =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? Math.max(0, Math.min(100, Math.round(confidence * 100)))
      : null;

  return {
    evidenceCode: `E${Math.max(0, evidenceCount ?? 0)}`,
    evidenceLabel: `${Math.max(0, evidenceCount ?? 0)} evidence items`,
    verifiedCode: verifiedDate ? `V ${shortDate(verifiedDate, locale)}` : "V --",
    verifiedLabel: verifiedDate
      ? `Last verified ${verifiedDate.toISOString()}`
      : "No verification timestamp",
    confidenceCode: confidencePct === null ? "C --" : `C${confidencePct}`,
    confidenceLabel:
      confidencePct === null
        ? "No confidence score"
        : `Confidence ${confidencePct}%`,
    supersessionCode: supersession.code,
    supersessionLabel: supersession.label,
  };
}
