// =============================================================================
// SENSITIVE DATA DETECTION (PRD-09)
// =============================================================================
//
// Detects PII, confidential content, and validates recipients.
//

// =============================================================================
// TYPES
// =============================================================================

export interface SensitiveDataInput {
  content: string;
  recipients?: RecipientInfo[];
  organizationDomains?: string[];
}

export interface RecipientInfo {
  email: string;
  name?: string;
  isExternal?: boolean;
}

export interface SensitiveDataResult {
  hasSensitiveData: boolean;
  severity: "none" | "low" | "medium" | "high" | "critical";
  score: number;
  piiFindings: PIIFinding[];
  confidentialFindings: ConfidentialFinding[];
  recipientWarnings: RecipientWarning[];
}

export interface PIIFinding {
  id: string;
  type: PIIType;
  value: string;
  redactedValue: string;
  location: { start: number; end: number };
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
}

export type PIIType =
  | "ssn"
  | "credit_card"
  | "bank_account"
  | "phone"
  | "email"
  | "address"
  | "dob"
  | "passport"
  | "drivers_license"
  | "medical_record"
  | "ip_address";

export interface ConfidentialFinding {
  id: string;
  type: ConfidentialType;
  keyword: string;
  context: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
}

export type ConfidentialType =
  | "financial"
  | "legal"
  | "hr"
  | "strategy"
  | "technical"
  | "customer"
  | "internal_only"
  | "nda";

export interface RecipientWarning {
  recipient: string;
  isExternal: boolean;
  warning: string;
  severity: "low" | "medium" | "high";
  sensitiveDataTypes: string[];
}

// =============================================================================
// PII PATTERNS
// =============================================================================

const PII_PATTERNS: Array<{
  type: PIIType;
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  validate?: (match: string) => boolean;
}> = [
  {
    type: "ssn",
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    severity: "critical",
    validate: (match) => {
      const digits = match.replace(/\D/g, "");
      // Basic SSN validation - not starting with 000, 666, or 9xx
      return (
        digits.length === 9 &&
        !digits.startsWith("000") &&
        !digits.startsWith("666") &&
        !digits.startsWith("9")
      );
    },
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    severity: "critical",
    validate: (match) => {
      const digits = match.replace(/\D/g, "");
      // Luhn algorithm check
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      let isEven = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        const char = digits[i];
        if (char === undefined) continue;
        let digit = Number.parseInt(char, 10);
        if (isEven) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        isEven = !isEven;
      }
      return sum % 10 === 0;
    },
  },
  {
    type: "bank_account",
    pattern: /\b(?:account|acct|a\/c)[\s#:]*\d{8,17}\b/gi,
    severity: "high",
  },
  {
    type: "phone",
    pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: "medium",
  },
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    severity: "low",
  },
  {
    type: "dob",
    pattern:
      /\b(?:dob|date of birth|born on|birthday)[\s:]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    severity: "high",
  },
  {
    type: "passport",
    pattern: /\b(?:passport)[\s#:]*[A-Z0-9]{6,9}\b/gi,
    severity: "critical",
  },
  {
    type: "drivers_license",
    pattern:
      /\b(?:dl|driver'?s?\s*license|license\s*#?)[\s:]*[A-Z0-9]{5,15}\b/gi,
    severity: "high",
  },
  {
    type: "medical_record",
    pattern: /\b(?:mrn|medical record|patient id)[\s#:]*[A-Z0-9]{6,12}\b/gi,
    severity: "critical",
  },
  {
    type: "ip_address",
    pattern:
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    severity: "low",
  },
];

// =============================================================================
// CONFIDENTIAL PATTERNS
// =============================================================================

const CONFIDENTIAL_KEYWORDS: Array<{
  type: ConfidentialType;
  keywords: RegExp[];
  severity: "low" | "medium" | "high" | "critical";
}> = [
  {
    type: "financial",
    keywords: [
      /\b(?:revenue|profit|loss|margin|earnings|ebitda)\b/gi,
      /\b(?:budget|forecast|projection)\b/gi,
      /\b(?:acquisition|merger|ipo|valuation)\b/gi,
      /\bsalary\b/gi,
    ],
    severity: "high",
  },
  {
    type: "legal",
    keywords: [
      /\b(?:lawsuit|litigation|settlement)\b/gi,
      /\b(?:attorney.?client|privileged)\b/gi,
      /\b(?:contract terms|legal matter)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "hr",
    keywords: [
      /\b(?:termination|layoff|severance)\b/gi,
      /\b(?:performance review|disciplinary)\b/gi,
      /\b(?:compensation|bonus|raise)\b/gi,
      /\b(?:hiring|interview|candidate)\b/gi,
    ],
    severity: "medium",
  },
  {
    type: "strategy",
    keywords: [
      /\b(?:roadmap|strategy|competitive)\b/gi,
      /\b(?:launch date|release date)\b/gi,
      /\b(?:pricing strategy|market entry)\b/gi,
    ],
    severity: "medium",
  },
  {
    type: "technical",
    keywords: [
      /\b(?:api key|secret|token|password|credential)\b/gi,
      /\b(?:source code|algorithm|patent)\b/gi,
      /\b(?:vulnerability|exploit|security issue)\b/gi,
    ],
    severity: "critical",
  },
  {
    type: "customer",
    keywords: [
      /\b(?:customer list|client list)\b/gi,
      /\b(?:customer data|client data)\b/gi,
      /\b(?:deal|contract value|pricing)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "internal_only",
    keywords: [
      /\b(?:internal only|confidential|do not forward|do not share)\b/gi,
      /\b(?:for internal use|not for distribution)\b/gi,
    ],
    severity: "high",
  },
  {
    type: "nda",
    keywords: [
      /\b(?:nda|non.?disclosure|under agreement)\b/gi,
      /\b(?:trade secret|proprietary)\b/gi,
    ],
    severity: "critical",
  },
];

// =============================================================================
// SENSITIVE DATA DETECTOR CLASS
// =============================================================================

export class SensitiveDataDetector {
  private organizationDomains: Set<string>;

  constructor(organizationDomains: string[] = []) {
    this.organizationDomains = new Set(
      organizationDomains.map((d) => d.toLowerCase())
    );
  }

  /**
   * Check for sensitive data in content.
   */
  checkSensitiveData(input: SensitiveDataInput): SensitiveDataResult {
    // Update organization domains if provided
    if (input.organizationDomains) {
      this.organizationDomains = new Set(
        input.organizationDomains.map((d) => d.toLowerCase())
      );
    }

    // Detect PII
    const piiFindings = this.detectPII(input.content);

    // Detect confidential content
    const confidentialFindings = this.detectConfidentialContent(input.content);

    // Validate recipients
    const recipientWarnings = this.validateRecipients(
      input.recipients ?? [],
      piiFindings,
      confidentialFindings
    );

    // Calculate overall score and severity
    const score = this.calculateScore(
      piiFindings,
      confidentialFindings,
      recipientWarnings
    );
    const severity = this.getSeverity(score);

    return {
      hasSensitiveData:
        piiFindings.length > 0 ||
        confidentialFindings.length > 0 ||
        recipientWarnings.length > 0,
      severity,
      score,
      piiFindings,
      confidentialFindings,
      recipientWarnings,
    };
  }

  /**
   * Detect PII in content.
   */
  private detectPII(content: string): PIIFinding[] {
    const findings: PIIFinding[] = [];
    let findingId = 0;

    for (const piiType of PII_PATTERNS) {
      const matches = Array.from(content.matchAll(piiType.pattern));

      for (const match of matches) {
        const value = match[0];
        const start = match.index ?? 0;

        // Validate if validator exists
        if (piiType.validate && !piiType.validate(value)) {
          continue;
        }

        // Skip emails that are likely recipients
        if (piiType.type === "email" && this.isLikelyRecipientEmail(value)) {
          continue;
        }

        findings.push({
          id: `pii-${findingId++}`,
          type: piiType.type,
          value,
          redactedValue: this.redactValue(value, piiType.type),
          location: { start, end: start + value.length },
          confidence: this.calculatePIIConfidence(value, piiType.type),
          severity: piiType.severity,
        });
      }
    }

    return findings;
  }

  /**
   * Detect confidential content.
   */
  private detectConfidentialContent(content: string): ConfidentialFinding[] {
    const findings: ConfidentialFinding[] = [];
    let findingId = 0;

    for (const confType of CONFIDENTIAL_KEYWORDS) {
      for (const pattern of confType.keywords) {
        const matches = Array.from(content.matchAll(pattern));

        for (const match of matches) {
          const keyword = match[0];
          const start = match.index ?? 0;

          // Get surrounding context
          const contextStart = Math.max(0, start - 50);
          const contextEnd = Math.min(
            content.length,
            start + keyword.length + 50
          );
          const context = content.slice(contextStart, contextEnd);

          findings.push({
            id: `conf-${findingId++}`,
            type: confType.type,
            keyword,
            context,
            confidence: 0.8,
            severity: confType.severity,
          });
        }
      }
    }

    // Deduplicate by type and similar context
    return this.deduplicateFindings(findings);
  }

  /**
   * Validate recipients for external sharing.
   */
  private validateRecipients(
    recipients: RecipientInfo[],
    piiFindings: PIIFinding[],
    confidentialFindings: ConfidentialFinding[]
  ): RecipientWarning[] {
    const warnings: RecipientWarning[] = [];

    // Mark external recipients
    const externalRecipients = recipients.filter((r) =>
      this.isExternalRecipient(r.email)
    );

    if (externalRecipients.length === 0) {
      return warnings;
    }

    // Check what sensitive data is being shared with external recipients
    const sensitiveTypes: string[] = [];

    if (piiFindings.length > 0) {
      const criticalPII = piiFindings.filter(
        (p) => p.severity === "critical" || p.severity === "high"
      );
      if (criticalPII.length > 0) {
        sensitiveTypes.push(
          ...Array.from(new Set(criticalPII.map((p) => `PII: ${p.type}`)))
        );
      }
    }

    if (confidentialFindings.length > 0) {
      const criticalConf = confidentialFindings.filter(
        (c) => c.severity === "critical" || c.severity === "high"
      );
      if (criticalConf.length > 0) {
        sensitiveTypes.push(
          ...Array.from(
            new Set(criticalConf.map((c) => `Confidential: ${c.type}`))
          )
        );
      }
    }

    if (sensitiveTypes.length > 0) {
      for (const recipient of externalRecipients) {
        warnings.push({
          recipient: recipient.email,
          isExternal: true,
          warning: `Sending sensitive information to external recipient: ${sensitiveTypes.join(", ")}`,
          severity:
            piiFindings.some((p) => p.severity === "critical") ||
            confidentialFindings.some((c) => c.severity === "critical")
              ? "high"
              : "medium",
          sensitiveDataTypes: sensitiveTypes,
        });
      }
    }

    return warnings;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private isExternalRecipient(email: string): boolean {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return true;

    return !this.organizationDomains.has(domain);
  }

  private isLikelyRecipientEmail(email: string): boolean {
    // Common patterns for recipient-style emails
    const recipientPatterns = [
      /^(to|cc|bcc|from|sender|recipient)$/i,
      /^[a-z]+@[a-z]+\.[a-z]{2,}$/i, // Simple name@domain.tld
    ];

    return recipientPatterns.some((p) => p.test(email));
  }

  private redactValue(value: string, type: PIIType): string {
    switch (type) {
      case "ssn":
        return "XXX-XX-" + value.slice(-4).replace(/\D/g, "");
      case "credit_card":
        return "XXXX-XXXX-XXXX-" + value.slice(-4).replace(/\D/g, "");
      case "phone":
        return value.slice(0, -4).replace(/\d/g, "X") + value.slice(-4);
      case "email": {
        const [local, domain] = value.split("@");
        if (local && domain) {
          return (local[0] ?? "X") + "***@" + domain;
        }
        return value.replace(/[A-Za-z0-9]/g, "X");
      }
      default:
        return value.replace(/[A-Za-z0-9]/g, "X");
    }
  }

  private calculatePIIConfidence(_value: string, type: PIIType): number {
    // Base confidence by type
    const baseConfidence: Record<PIIType, number> = {
      ssn: 0.95,
      credit_card: 0.95,
      bank_account: 0.8,
      phone: 0.7,
      email: 0.9,
      address: 0.6,
      dob: 0.85,
      passport: 0.9,
      drivers_license: 0.85,
      medical_record: 0.85,
      ip_address: 0.7,
    };

    return baseConfidence[type] ?? 0.5;
  }

  private deduplicateFindings(
    findings: ConfidentialFinding[]
  ): ConfidentialFinding[] {
    const seen = new Map<string, ConfidentialFinding>();

    for (const finding of findings) {
      const key = `${finding.type}-${finding.keyword.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, finding);
      }
    }

    return Array.from(seen.values());
  }

  private calculateScore(
    piiFindings: PIIFinding[],
    confidentialFindings: ConfidentialFinding[],
    recipientWarnings: RecipientWarning[]
  ): number {
    const severityScores = {
      low: 10,
      medium: 30,
      high: 60,
      critical: 100,
    };

    let score = 0;

    // PII contributes most to score
    for (const pii of piiFindings) {
      score += severityScores[pii.severity] * pii.confidence;
    }

    // Confidential findings
    for (const conf of confidentialFindings) {
      score += severityScores[conf.severity] * conf.confidence * 0.7;
    }

    // Recipient warnings amplify the score
    if (recipientWarnings.length > 0) {
      score *= 1 + recipientWarnings.length * 0.2;
    }

    return Math.min(100, score);
  }

  private getSeverity(
    score: number
  ): "none" | "low" | "medium" | "high" | "critical" {
    if (score === 0) return "none";
    if (score < 20) return "low";
    if (score < 50) return "medium";
    if (score < 80) return "high";
    return "critical";
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createSensitiveDataDetector(
  organizationDomains?: string[]
): SensitiveDataDetector {
  return new SensitiveDataDetector(organizationDomains);
}
