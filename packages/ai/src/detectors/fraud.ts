// =============================================================================
// FRAUD DETECTION (PRD-09)
// =============================================================================
//
// Detects fraud patterns: impersonation, invoice fraud, phishing.
//

// =============================================================================
// TYPES
// =============================================================================

export interface FraudDetectionInput {
  content: string;
  senderEmail: string;
  senderName?: string;
  subject?: string;
  links?: string[];
  attachments?: AttachmentInfo[];
  knownContacts?: KnownContact[];
  organizationDomains?: string[];
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface KnownContact {
  email: string;
  name: string;
  isVip?: boolean;
  isInternal?: boolean;
}

export interface FraudDetectionResult {
  hasFraudSignals: boolean;
  severity: "none" | "low" | "medium" | "high" | "critical";
  score: number;
  impersonationSignals: ImpersonationSignal[];
  invoiceFraudSignals: InvoiceFraudSignal[];
  phishingSignals: PhishingSignal[];
  recommendations: FraudRecommendation[];
}

export interface ImpersonationSignal {
  id: string;
  type:
    | "lookalike_domain"
    | "name_mismatch"
    | "executive_impersonation"
    | "known_sender_mismatch";
  senderEmail: string;
  senderName?: string;
  expectedEmail?: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface InvoiceFraudSignal {
  id: string;
  type:
    | "bank_change"
    | "urgent_payment"
    | "unusual_amount"
    | "vendor_impersonation"
    | "new_payment_method";
  indicator: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface PhishingSignal {
  id: string;
  type:
    | "suspicious_link"
    | "credential_request"
    | "urgency_pressure"
    | "mismatched_branding"
    | "suspicious_attachment";
  indicator: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface FraudRecommendation {
  type: "verify" | "block" | "report" | "ignore";
  action: string;
  priority: "low" | "medium" | "high" | "urgent";
}

// =============================================================================
// FRAUD PATTERNS
// =============================================================================

const URGENCY_PATTERNS = [
  /\b(?:urgent|immediately|asap|right away|today|now|critical)\b/gi,
  /\b(?:deadline|expires?|time.?sensitive|don't delay)\b/gi,
  /\b(?:act (?:fast|now|quickly)|hurry|rush)\b/gi,
];

const PAYMENT_PATTERNS = [
  /\b(?:wire transfer|bank transfer|payment|invoice|remit)\b/gi,
  /\b(?:account number|routing number|iban|swift)\b/gi,
  /\b(?:pay (?:immediately|now|today)|urgent payment)\b/gi,
];

const BANK_CHANGE_PATTERNS = [
  /\b(?:new bank|changed? (?:bank|account)|updated? (?:bank|account))\b/gi,
  /\b(?:different account|alternative account|temporary account)\b/gi,
  /\b(?:please update|change the payment|redirect payment)\b/gi,
];

const CREDENTIAL_PATTERNS = [
  /\b(?:password|login|credential|username)\b/gi,
  /\b(?:verify your|confirm your|update your)\s+(?:account|identity)\b/gi,
  /\b(?:click here to|click below to)\s+(?:verify|confirm|log ?in)\b/gi,
];

const EXECUTIVE_NAMES = [
  "ceo",
  "cfo",
  "cto",
  "coo",
  "president",
  "chief",
  "director",
  "vp",
  "vice president",
];

// =============================================================================
// FRAUD DETECTOR CLASS
// =============================================================================

export class FraudDetector {
  private organizationDomains: Set<string>;

  constructor() {
    this.organizationDomains = new Set();
  }

  /**
   * Detect fraud signals in a message.
   */
  detectFraud(input: FraudDetectionInput): FraudDetectionResult {
    // Update context
    if (input.organizationDomains) {
      this.organizationDomains = new Set(
        input.organizationDomains.map((d) => d.toLowerCase())
      );
    }

    // Run all detectors
    const impersonationSignals = this.detectImpersonation(input);
    const invoiceFraudSignals = this.detectInvoiceFraud(input);
    const phishingSignals = this.detectPhishing(input);

    // Calculate overall score
    const allSignals = [
      ...impersonationSignals,
      ...invoiceFraudSignals,
      ...phishingSignals,
    ];
    const score = this.calculateScore(allSignals);
    const severity = this.getSeverity(score);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      impersonationSignals,
      invoiceFraudSignals,
      phishingSignals
    );

    return {
      hasFraudSignals: allSignals.length > 0,
      severity,
      score,
      impersonationSignals,
      invoiceFraudSignals,
      phishingSignals,
      recommendations,
    };
  }

  // ===========================================================================
  // IMPERSONATION DETECTION
  // ===========================================================================

  private detectImpersonation(
    input: FraudDetectionInput
  ): ImpersonationSignal[] {
    const signals: ImpersonationSignal[] = [];
    const senderEmail = input.senderEmail.toLowerCase();
    const senderDomain = senderEmail.split("@")[1];

    // Skip domain checks if we can't parse the domain
    if (!senderDomain) {
      return signals;
    }

    // Check for lookalike domains
    const lookalikeDomain = this.detectLookalikeDomain(senderDomain);
    if (lookalikeDomain) {
      signals.push({
        id: "imp-lookalike",
        type: "lookalike_domain",
        senderEmail: input.senderEmail,
        senderName: input.senderName,
        expectedEmail: lookalikeDomain.legitimate,
        confidence: lookalikeDomain.confidence,
        severity: "high",
        explanation: `Domain "${senderDomain}" looks similar to known domain "${lookalikeDomain.legitimate}"`,
      });
    }

    // Check for known sender name but different email
    if (input.senderName && input.knownContacts) {
      const nameMismatch = this.detectNameMismatch(
        input.senderName,
        senderEmail,
        input.knownContacts
      );
      if (nameMismatch) {
        signals.push({
          id: "imp-name-mismatch",
          type: "name_mismatch",
          senderEmail: input.senderEmail,
          senderName: input.senderName,
          expectedEmail: nameMismatch.expectedEmail,
          confidence: nameMismatch.confidence,
          severity: "high",
          explanation: `Name "${input.senderName}" is associated with a different email: ${nameMismatch.expectedEmail}`,
        });
      }
    }

    // Check for executive impersonation patterns
    if (input.senderName) {
      const execImpersonation = this.detectExecutiveImpersonation(
        input.senderName,
        senderDomain,
        input.content
      );
      if (execImpersonation) {
        signals.push({
          id: "imp-exec",
          type: "executive_impersonation",
          senderEmail: input.senderEmail,
          senderName: input.senderName,
          confidence: execImpersonation.confidence,
          severity: "critical",
          explanation: execImpersonation.explanation,
        });
      }
    }

    return signals;
  }

  private detectLookalikeDomain(
    domain: string
  ): { legitimate: string; confidence: number } | null {
    if (!domain) return null;

    // Common typosquatting patterns
    const typoPatterns = [
      { pattern: /rn/, replacement: "m" }, // rn -> m
      { pattern: /vv/, replacement: "w" }, // vv -> w
      { pattern: /cl/, replacement: "d" }, // cl -> d
      { pattern: /1/, replacement: "l" }, // 1 -> l
      { pattern: /0/, replacement: "o" }, // 0 -> o
    ];

    for (const orgDomain of Array.from(this.organizationDomains)) {
      // Check for simple substitutions
      for (const typo of typoPatterns) {
        if (domain.replace(typo.pattern, typo.replacement) === orgDomain) {
          return { legitimate: orgDomain, confidence: 0.9 };
        }
      }

      // Check for character swaps
      if (this.hasCharacterSwap(domain, orgDomain)) {
        return { legitimate: orgDomain, confidence: 0.85 };
      }

      // Check for extra characters
      if (
        domain.length === orgDomain.length + 1 &&
        this.differsByOneChar(domain, orgDomain)
      ) {
        return { legitimate: orgDomain, confidence: 0.8 };
      }

      // Check for missing characters
      if (
        domain.length === orgDomain.length - 1 &&
        this.differsByOneChar(orgDomain, domain)
      ) {
        return { legitimate: orgDomain, confidence: 0.8 };
      }
    }

    // Check against common lookalike patterns
    const commonLookalikes = new Map([
      ["gmaii", "gmail"],
      ["gooogle", "google"],
      ["microsft", "microsoft"],
      ["micros0ft", "microsoft"],
      ["paypa1", "paypal"],
      ["amaz0n", "amazon"],
      ["app1e", "apple"],
    ]);

    for (const [fake, real] of Array.from(commonLookalikes.entries())) {
      if (domain.includes(fake)) {
        return { legitimate: domain.replace(fake, real), confidence: 0.95 };
      }
    }

    return null;
  }

  private hasCharacterSwap(str1: string, str2: string): boolean {
    if (str1.length !== str2.length) return false;

    let differences = 0;
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) differences++;
    }

    return (
      differences === 2 &&
      str1.split("").sort().join("") === str2.split("").sort().join("")
    );
  }

  private differsByOneChar(longer: string, shorter: string): boolean {
    if (longer.length !== shorter.length + 1) return false;

    let j = 0;
    for (let i = 0; i < longer.length && j < shorter.length; i++) {
      if (longer[i] === shorter[j]) {
        j++;
      }
    }

    return j === shorter.length;
  }

  private detectNameMismatch(
    senderName: string,
    senderEmail: string,
    knownContacts: KnownContact[]
  ): { expectedEmail: string; confidence: number } | null {
    const nameLower = senderName.toLowerCase();

    for (const contact of knownContacts) {
      const contactNameLower = contact.name.toLowerCase();
      const contactEmailLower = contact.email.toLowerCase();

      // Check for name similarity
      const similarity = this.calculateNameSimilarity(
        nameLower,
        contactNameLower
      );

      if (similarity > 0.8 && contactEmailLower !== senderEmail) {
        return {
          expectedEmail: contact.email,
          confidence: similarity,
        };
      }
    }

    return null;
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    // Simple word overlap similarity
    const words1 = name1.split(/\s+/).filter((w) => w.length > 1);
    const words2 = name2.split(/\s+/).filter((w) => w.length > 1);

    let matches = 0;
    for (const w1 of words1) {
      for (const w2 of words2) {
        if (w1 === w2 || this.levenshteinDistance(w1, w2) <= 1) {
          matches++;
          break;
        }
      }
    }

    return matches / Math.max(words1.length, words2.length);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array<number>(n + 1).fill(0)
    );

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]!;
        } else {
          dp[i]![j] =
            Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!) + 1;
        }
      }
    }

    return dp[m]![n]!;
  }

  private detectExecutiveImpersonation(
    senderName: string,
    senderDomain: string,
    content: string
  ): { confidence: number; explanation: string } | null {
    const nameLower = senderName.toLowerCase();
    const contentLower = content.toLowerCase();

    // Check if name contains executive title
    const hasExecTitle = EXECUTIVE_NAMES.some(
      (title) =>
        nameLower.includes(title) || content.toLowerCase().includes(title)
    );

    if (!hasExecTitle) return null;

    // Check for red flags
    const redFlags: string[] = [];

    // External domain claiming to be executive
    if (senderDomain && !this.organizationDomains.has(senderDomain)) {
      redFlags.push("external domain");
    }

    // Urgency + payment request
    const hasUrgency = URGENCY_PATTERNS.some((p) => p.test(contentLower));
    const hasPayment = PAYMENT_PATTERNS.some((p) => p.test(contentLower));

    if (hasUrgency && hasPayment) {
      redFlags.push("urgent payment request");
    }

    // Request for secrecy
    if (
      /\b(?:keep this between us|don't tell|confidential|secret|private)\b/i.test(
        contentLower
      )
    ) {
      redFlags.push("secrecy request");
    }

    if (redFlags.length > 0) {
      return {
        confidence: 0.7 + redFlags.length * 0.1,
        explanation: `Potential executive impersonation: ${redFlags.join(", ")}`,
      };
    }

    return null;
  }

  // ===========================================================================
  // INVOICE FRAUD DETECTION
  // ===========================================================================

  private detectInvoiceFraud(input: FraudDetectionInput): InvoiceFraudSignal[] {
    const signals: InvoiceFraudSignal[] = [];
    const contentLower = input.content.toLowerCase();

    // Check for bank change requests
    if (BANK_CHANGE_PATTERNS.some((p) => p.test(contentLower))) {
      signals.push({
        id: "inv-bank-change",
        type: "bank_change",
        indicator: "Bank account change request detected",
        confidence: 0.85,
        severity: "critical",
        explanation:
          "Email requests changing bank details for payments - common invoice fraud tactic",
      });
    }

    // Check for urgent payment requests
    const hasUrgency = URGENCY_PATTERNS.some((p) => p.test(contentLower));
    const hasPayment = PAYMENT_PATTERNS.some((p) => p.test(contentLower));

    if (hasUrgency && hasPayment) {
      signals.push({
        id: "inv-urgent-payment",
        type: "urgent_payment",
        indicator: "Urgent payment request",
        confidence: 0.7,
        severity: "high",
        explanation:
          "Urgent payment requests are a common fraud tactic to bypass verification",
      });
    }

    // Check for unusual amounts
    const amountMatch = contentLower.match(/\$[\d,]+(?:\.\d{2})?/);
    if (amountMatch) {
      const amount = Number.parseFloat(amountMatch[0].replace(/[$,]/g, ""));
      if (amount > 10_000) {
        signals.push({
          id: "inv-large-amount",
          type: "unusual_amount",
          indicator: `Large payment amount: ${amountMatch[0]}`,
          confidence: 0.6,
          severity: "medium",
          explanation: "Large payment amounts warrant additional verification",
        });
      }
    }

    // Check for new payment method requests
    if (
      /\b(?:new payment method|alternative payment|pay via|gift card|cryptocurrency|crypto|bitcoin)\b/i.test(
        contentLower
      )
    ) {
      signals.push({
        id: "inv-new-method",
        type: "new_payment_method",
        indicator: "Request for unusual payment method",
        confidence: 0.8,
        severity: "high",
        explanation:
          "Requests for gift cards or cryptocurrency are almost always fraud",
      });
    }

    return signals;
  }

  // ===========================================================================
  // PHISHING DETECTION
  // ===========================================================================

  private detectPhishing(input: FraudDetectionInput): PhishingSignal[] {
    const signals: PhishingSignal[] = [];
    const contentLower = input.content.toLowerCase();

    // Check for credential requests
    if (CREDENTIAL_PATTERNS.some((p) => p.test(contentLower))) {
      signals.push({
        id: "phish-credentials",
        type: "credential_request",
        indicator: "Request for login credentials",
        confidence: 0.9,
        severity: "critical",
        explanation:
          "Legitimate organizations never ask for passwords via email",
      });
    }

    // Check for suspicious links
    if (input.links) {
      for (const link of input.links) {
        const suspiciousLink = this.analyzeLinkSafety(link);
        if (suspiciousLink) {
          signals.push({
            id: `phish-link-${signals.length}`,
            type: "suspicious_link",
            indicator: link,
            confidence: suspiciousLink.confidence,
            severity: suspiciousLink.severity,
            explanation: suspiciousLink.reason,
          });
        }
      }
    }

    // Check for urgency pressure
    const urgencyCount = URGENCY_PATTERNS.filter((p) =>
      p.test(contentLower)
    ).length;
    if (urgencyCount >= 2) {
      signals.push({
        id: "phish-urgency",
        type: "urgency_pressure",
        indicator: "Multiple urgency indicators",
        confidence: 0.7,
        severity: "medium",
        explanation:
          "Excessive urgency is a common phishing tactic to prevent careful review",
      });
    }

    // Check for suspicious attachments
    if (input.attachments) {
      for (const attachment of input.attachments) {
        const suspiciousAttachment = this.analyzeAttachmentSafety(attachment);
        if (suspiciousAttachment) {
          signals.push({
            id: `phish-attach-${signals.length}`,
            type: "suspicious_attachment",
            indicator: attachment.filename,
            confidence: suspiciousAttachment.confidence,
            severity: suspiciousAttachment.severity,
            explanation: suspiciousAttachment.reason,
          });
        }
      }
    }

    return signals;
  }

  private analyzeLinkSafety(
    link: string
  ): {
    confidence: number;
    severity: "low" | "medium" | "high" | "critical";
    reason: string;
  } | null {
    const url = link.toLowerCase();

    // Check for IP address instead of domain
    if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url)) {
      return {
        confidence: 0.9,
        severity: "high",
        reason: "Link uses IP address instead of domain name",
      };
    }

    // Check for URL shorteners
    const shorteners = [
      "bit.ly",
      "tinyurl",
      "goo.gl",
      "t.co",
      "ow.ly",
      "is.gd",
      "buff.ly",
    ];
    if (shorteners.some((s) => url.includes(s))) {
      return {
        confidence: 0.6,
        severity: "medium",
        reason: "Link uses URL shortener which obscures destination",
      };
    }

    // Check for lookalike domains in links
    const lookalikes = ["g00gle", "micros0ft", "app1e", "amaz0n", "paypa1"];
    if (lookalikes.some((l) => url.includes(l))) {
      return {
        confidence: 0.95,
        severity: "critical",
        reason: "Link contains typosquatted domain",
      };
    }

    // Check for suspicious patterns
    if (
      url.includes("login") &&
      url.includes("verify") &&
      !this.isKnownDomain(url)
    ) {
      return {
        confidence: 0.75,
        severity: "high",
        reason: "Link to unknown domain with login/verify in URL",
      };
    }

    return null;
  }

  private analyzeAttachmentSafety(
    attachment: AttachmentInfo
  ): {
    confidence: number;
    severity: "low" | "medium" | "high" | "critical";
    reason: string;
  } | null {
    const filename = attachment.filename.toLowerCase();

    // High-risk extensions
    const dangerousExtensions = [
      ".exe",
      ".scr",
      ".bat",
      ".cmd",
      ".com",
      ".js",
      ".vbs",
    ];
    if (dangerousExtensions.some((ext) => filename.endsWith(ext))) {
      return {
        confidence: 0.95,
        severity: "critical",
        reason: "Executable file attachment - high risk of malware",
      };
    }

    // Medium-risk extensions
    const suspiciousExtensions = [".zip", ".rar", ".7z", ".iso", ".img"];
    if (suspiciousExtensions.some((ext) => filename.endsWith(ext))) {
      return {
        confidence: 0.7,
        severity: "medium",
        reason: "Archive file that could contain malware",
      };
    }

    // Double extension trick
    if (/\.(pdf|doc|xls|txt)\.(exe|scr|bat|js)$/i.test(filename)) {
      return {
        confidence: 0.95,
        severity: "critical",
        reason: "Double extension trick - disguised executable",
      };
    }

    return null;
  }

  private isKnownDomain(url: string): boolean {
    const knownDomains = [
      "google.com",
      "microsoft.com",
      "apple.com",
      "amazon.com",
      "paypal.com",
      "linkedin.com",
      "github.com",
    ];

    return (
      knownDomains.some((d) => url.includes(d)) ||
      Array.from(this.organizationDomains).some((d) => url.includes(d))
    );
  }

  // ===========================================================================
  // SCORING AND RECOMMENDATIONS
  // ===========================================================================

  private calculateScore(
    signals: Array<{ severity: string; confidence: number }>
  ): number {
    if (signals.length === 0) return 0;

    const severityScores: Record<string, number> = {
      low: 15,
      medium: 35,
      high: 65,
      critical: 100,
    };

    const totalScore = signals.reduce(
      (sum, s) => sum + (severityScores[s.severity] ?? 0) * s.confidence,
      0
    );

    // Cap at 100, with diminishing returns for multiple signals
    return Math.min(100, totalScore * (1 + signals.length * 0.1));
  }

  private getSeverity(
    score: number
  ): "none" | "low" | "medium" | "high" | "critical" {
    if (score === 0) return "none";
    if (score < 25) return "low";
    if (score < 50) return "medium";
    if (score < 75) return "high";
    return "critical";
  }

  private generateRecommendations(
    impersonation: ImpersonationSignal[],
    invoiceFraud: InvoiceFraudSignal[],
    phishing: PhishingSignal[]
  ): FraudRecommendation[] {
    const recommendations: FraudRecommendation[] = [];

    // Critical threats - block
    const hasCritical = [...impersonation, ...invoiceFraud, ...phishing].some(
      (s) => s.severity === "critical"
    );

    if (hasCritical) {
      recommendations.push({
        type: "block",
        action:
          "Block this message and do not interact with any links or attachments",
        priority: "urgent",
      });
      recommendations.push({
        type: "report",
        action: "Report this message to your IT security team",
        priority: "high",
      });
    }

    // Impersonation - verify
    if (impersonation.length > 0) {
      recommendations.push({
        type: "verify",
        action:
          "Verify the sender's identity through a known phone number or in-person",
        priority: impersonation.some((s) => s.severity === "critical")
          ? "urgent"
          : "high",
      });
    }

    // Invoice fraud - verify payment
    if (invoiceFraud.length > 0) {
      recommendations.push({
        type: "verify",
        action:
          "Call the vendor using a known number to verify any bank account changes",
        priority: "urgent",
      });
    }

    // Phishing - don't click
    if (phishing.length > 0) {
      recommendations.push({
        type: "block",
        action: "Do not click any links or open any attachments",
        priority: "high",
      });
    }

    return recommendations;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createFraudDetector(): FraudDetector {
  return new FraudDetector();
}
