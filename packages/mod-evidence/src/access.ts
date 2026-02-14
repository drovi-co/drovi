export interface EvidenceAccessPolicy {
  redactQuotedText: boolean;
  allowExternalLinks: boolean;
}

export function defaultEvidenceAccessPolicy(): EvidenceAccessPolicy {
  return {
    redactQuotedText: false,
    allowExternalLinks: true,
  };
}

export function canOpenEvidenceSource(policy: EvidenceAccessPolicy): boolean {
  return policy.allowExternalLinks;
}

export function resolveEvidenceQuote(
  quote: string | null | undefined,
  policy: EvidenceAccessPolicy
): string | null {
  if (!quote) {
    return null;
  }
  if (policy.redactQuotedText) {
    return "[REDACTED]";
  }
  return quote;
}
