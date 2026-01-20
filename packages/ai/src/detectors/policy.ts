// =============================================================================
// POLICY ENFORCEMENT DETECTOR (PRD-09)
// =============================================================================
//
// Detects policy violations and triggers approval workflows.
//

// =============================================================================
// TYPES
// =============================================================================

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  category: PolicyCategory;
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  severity: PolicySeverity;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PolicyCategory =
  | "communication"
  | "data_handling"
  | "financial"
  | "compliance"
  | "security"
  | "custom";

export type PolicySeverity = "info" | "warning" | "violation" | "critical";

export interface PolicyCondition {
  type: ConditionType;
  field: string;
  operator: ConditionOperator;
  value: string | number | string[];
  caseSensitive?: boolean;
}

export type ConditionType =
  | "content_contains"
  | "content_matches"
  | "recipient_domain"
  | "recipient_external"
  | "attachment_type"
  | "attachment_size"
  | "sender_role"
  | "thread_classification"
  | "amount_exceeds"
  | "custom";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "matches"
  | "greater_than"
  | "less_than"
  | "in"
  | "not_in";

export interface PolicyAction {
  type: ActionType;
  config?: Record<string, unknown>;
}

export type ActionType =
  | "block"
  | "warn"
  | "require_approval"
  | "notify"
  | "audit_log"
  | "redact"
  | "encrypt";

export interface PolicyInput {
  content: string;
  subject?: string;
  recipients: RecipientInfo[];
  sender: SenderInfo;
  attachments?: AttachmentInfo[];
  threadClassification?: string;
  extractedAmounts?: ExtractedAmount[];
  organizationId: string;
  accountId: string;
}

export interface RecipientInfo {
  email: string;
  name?: string;
  domain: string;
  isExternal: boolean;
  isVerified?: boolean;
}

export interface SenderInfo {
  email: string;
  name?: string;
  role?: string;
  department?: string;
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  hasPassword?: boolean;
}

export interface ExtractedAmount {
  value: number;
  currency: string;
  context: string;
}

export interface PolicyResult {
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  requiredApprovals: ApprovalRequest[];
  auditEntries: AuditEntry[];
  overallStatus: "allowed" | "blocked" | "pending_approval" | "warning";
  blockedReason?: string;
}

export interface PolicyViolation {
  ruleId: string;
  ruleName: string;
  category: PolicyCategory;
  severity: PolicySeverity;
  description: string;
  matchedContent?: string;
  suggestedAction: string;
}

export interface PolicyWarning {
  ruleId: string;
  ruleName: string;
  message: string;
  severity: "info" | "warning";
}

export interface ApprovalRequest {
  ruleId: string;
  ruleName: string;
  reason: string;
  approverRoles: string[];
  expiresIn?: number; // hours
  escalationPath?: string[];
}

export interface AuditEntry {
  timestamp: Date;
  action: string;
  ruleId?: string;
  details: Record<string, unknown>;
  userId?: string;
  organizationId: string;
}

// =============================================================================
// DEFAULT POLICY RULES
// =============================================================================

export const DEFAULT_POLICY_RULES: Omit<
  PolicyRule,
  "id" | "createdAt" | "updatedAt"
>[] = [
  // Communication policies
  {
    name: "External recipient warning",
    description: "Warn when sending to external recipients",
    category: "communication",
    conditions: [
      {
        type: "recipient_external",
        field: "recipients",
        operator: "equals",
        value: "true",
      },
    ],
    actions: [{ type: "warn" }],
    severity: "info",
    enabled: true,
  },
  {
    name: "Large attachment warning",
    description: "Warn for attachments over 10MB",
    category: "communication",
    conditions: [
      {
        type: "attachment_size",
        field: "attachments",
        operator: "greater_than",
        value: 10 * 1024 * 1024, // 10MB
      },
    ],
    actions: [{ type: "warn" }],
    severity: "info",
    enabled: true,
  },

  // Data handling policies
  {
    name: "PII to external block",
    description: "Block sending PII to external recipients",
    category: "data_handling",
    conditions: [
      {
        type: "content_matches",
        field: "content",
        operator: "matches",
        value: "\\b\\d{3}-\\d{2}-\\d{4}\\b", // SSN pattern
      },
      {
        type: "recipient_external",
        field: "recipients",
        operator: "equals",
        value: "true",
      },
    ],
    actions: [{ type: "block" }, { type: "audit_log" }],
    severity: "critical",
    enabled: true,
  },
  {
    name: "Confidential external approval",
    description: "Require approval for confidential content to external",
    category: "data_handling",
    conditions: [
      {
        type: "content_contains",
        field: "content",
        operator: "contains",
        value: ["confidential", "internal only", "do not distribute"],
      },
      {
        type: "recipient_external",
        field: "recipients",
        operator: "equals",
        value: "true",
      },
    ],
    actions: [
      {
        type: "require_approval",
        config: { approverRoles: ["manager", "compliance"] },
      },
    ],
    severity: "violation",
    enabled: true,
  },

  // Financial policies
  {
    name: "High value transaction approval",
    description: "Require approval for amounts over $10,000",
    category: "financial",
    conditions: [
      {
        type: "amount_exceeds",
        field: "extractedAmounts",
        operator: "greater_than",
        value: 10_000,
      },
    ],
    actions: [
      {
        type: "require_approval",
        config: { approverRoles: ["finance_manager", "director"] },
      },
      { type: "audit_log" },
    ],
    severity: "warning",
    enabled: true,
  },
  {
    name: "Bank account change verification",
    description: "Flag messages about bank account changes",
    category: "financial",
    conditions: [
      {
        type: "content_contains",
        field: "content",
        operator: "contains",
        value: [
          "new bank account",
          "updated bank details",
          "wire transfer",
          "routing number changed",
        ],
      },
    ],
    actions: [{ type: "warn" }, { type: "audit_log" }],
    severity: "warning",
    enabled: true,
  },

  // Compliance policies
  {
    name: "Legal hold notification",
    description: "Audit log when legal keywords detected",
    category: "compliance",
    conditions: [
      {
        type: "content_contains",
        field: "content",
        operator: "contains",
        value: ["litigation", "lawsuit", "subpoena", "legal hold", "discovery"],
      },
    ],
    actions: [{ type: "audit_log" }, { type: "notify" }],
    severity: "info",
    enabled: true,
  },

  // Security policies
  {
    name: "Executable attachment block",
    description: "Block executable file attachments",
    category: "security",
    conditions: [
      {
        type: "attachment_type",
        field: "attachments",
        operator: "in",
        value: [".exe", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".msi"],
      },
    ],
    actions: [{ type: "block" }, { type: "audit_log" }],
    severity: "critical",
    enabled: true,
  },
  {
    name: "Password-protected attachment warning",
    description: "Warn for password-protected attachments",
    category: "security",
    conditions: [
      {
        type: "custom",
        field: "attachments",
        operator: "equals",
        value: "hasPassword",
      },
    ],
    actions: [{ type: "warn" }],
    severity: "warning",
    enabled: true,
  },
];

// =============================================================================
// POLICY DETECTOR
// =============================================================================

export class PolicyDetector {
  private rules: PolicyRule[];
  private organizationRules: Map<string, PolicyRule[]> = new Map();

  constructor(customRules?: PolicyRule[]) {
    // Initialize with default rules
    this.rules = DEFAULT_POLICY_RULES.map((rule, index) => ({
      ...rule,
      id: `default_${index}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Add custom rules
    if (customRules) {
      this.rules.push(...customRules);
    }
  }

  /**
   * Load organization-specific rules.
   */
  loadOrganizationRules(organizationId: string, rules: PolicyRule[]): void {
    this.organizationRules.set(organizationId, rules);
  }

  /**
   * Evaluate all policies against input.
   */
  evaluate(input: PolicyInput): PolicyResult {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    const requiredApprovals: ApprovalRequest[] = [];
    const auditEntries: AuditEntry[] = [];

    // Get applicable rules
    const applicableRules = this.getApplicableRules(input.organizationId);

    for (const rule of applicableRules) {
      if (!rule.enabled) continue;

      const matches = this.evaluateRule(rule, input);
      if (matches) {
        // Process rule actions
        for (const action of rule.actions) {
          switch (action.type) {
            case "block":
              violations.push({
                ruleId: rule.id,
                ruleName: rule.name,
                category: rule.category,
                severity: rule.severity,
                description: rule.description,
                matchedContent: matches.matchedContent,
                suggestedAction: "This message cannot be sent due to policy",
              });
              break;

            case "warn":
              warnings.push({
                ruleId: rule.id,
                ruleName: rule.name,
                message: rule.description,
                severity:
                  rule.severity === "info" || rule.severity === "warning"
                    ? rule.severity
                    : "warning",
              });
              break;

            case "require_approval": {
              const config = action.config as
                | { approverRoles?: string[]; expiresIn?: number }
                | undefined;
              requiredApprovals.push({
                ruleId: rule.id,
                ruleName: rule.name,
                reason: rule.description,
                approverRoles: config?.approverRoles ?? ["manager"],
                expiresIn: config?.expiresIn,
              });
              break;
            }

            case "audit_log":
              auditEntries.push({
                timestamp: new Date(),
                action: `Policy triggered: ${rule.name}`,
                ruleId: rule.id,
                details: {
                  category: rule.category,
                  severity: rule.severity,
                  matchedContent: matches.matchedContent,
                  recipients: input.recipients.map((r) => r.email),
                },
                organizationId: input.organizationId,
              });
              break;

            case "notify":
              // Add to audit with notification flag
              auditEntries.push({
                timestamp: new Date(),
                action: `Notification: ${rule.name}`,
                ruleId: rule.id,
                details: {
                  requiresNotification: true,
                  category: rule.category,
                },
                organizationId: input.organizationId,
              });
              break;

            case "redact":
            case "encrypt":
              // These would be handled by the email system
              warnings.push({
                ruleId: rule.id,
                ruleName: rule.name,
                message: `Content will be ${action.type}ed before sending`,
                severity: "info",
              });
              break;
          }
        }
      }
    }

    // Determine overall status
    let overallStatus: PolicyResult["overallStatus"] = "allowed";
    let blockedReason: string | undefined;

    const criticalViolations = violations.filter(
      (v) => v.severity === "critical"
    );
    if (criticalViolations.length > 0) {
      overallStatus = "blocked";
      blockedReason = criticalViolations.map((v) => v.description).join("; ");
    } else if (requiredApprovals.length > 0) {
      overallStatus = "pending_approval";
    } else if (violations.length > 0 || warnings.length > 0) {
      overallStatus = "warning";
    }

    return {
      violations,
      warnings,
      requiredApprovals,
      auditEntries,
      overallStatus,
      blockedReason,
    };
  }

  /**
   * Get rules applicable to an organization.
   */
  private getApplicableRules(organizationId: string): PolicyRule[] {
    const orgRules = this.organizationRules.get(organizationId) ?? [];
    return [...this.rules, ...orgRules];
  }

  /**
   * Evaluate a single rule against input.
   */
  private evaluateRule(
    rule: PolicyRule,
    input: PolicyInput
  ): { matches: boolean; matchedContent?: string } | null {
    // All conditions must match (AND logic)
    let matchedContent: string | undefined;

    for (const condition of rule.conditions) {
      const result = this.evaluateCondition(condition, input);
      if (!result.matches) {
        return null;
      }
      if (result.matchedContent) {
        matchedContent = result.matchedContent;
      }
    }

    return { matches: true, matchedContent };
  }

  /**
   * Evaluate a single condition.
   */
  private evaluateCondition(
    condition: PolicyCondition,
    input: PolicyInput
  ): { matches: boolean; matchedContent?: string } {
    switch (condition.type) {
      case "content_contains":
        return this.evaluateContentContains(condition, input.content);

      case "content_matches":
        return this.evaluateContentMatches(condition, input.content);

      case "recipient_external":
        return {
          matches: input.recipients.some((r) => r.isExternal),
        };

      case "recipient_domain": {
        const targetDomains = Array.isArray(condition.value)
          ? condition.value
          : [String(condition.value)];
        const hasMatchingDomain = input.recipients.some((r) =>
          targetDomains.includes(r.domain.toLowerCase())
        );
        return {
          matches:
            condition.operator === "in"
              ? hasMatchingDomain
              : !hasMatchingDomain,
        };
      }

      case "attachment_type":
        return this.evaluateAttachmentType(condition, input.attachments ?? []);

      case "attachment_size":
        return this.evaluateAttachmentSize(condition, input.attachments ?? []);

      case "sender_role":
        return {
          matches: this.compareValue(
            condition.operator,
            input.sender.role ?? "",
            condition.value
          ),
        };

      case "thread_classification":
        return {
          matches: this.compareValue(
            condition.operator,
            input.threadClassification ?? "",
            condition.value
          ),
        };

      case "amount_exceeds":
        return this.evaluateAmountExceeds(
          condition,
          input.extractedAmounts ?? []
        );

      case "custom":
        return this.evaluateCustomCondition(condition, input);

      default:
        return { matches: false };
    }
  }

  /**
   * Evaluate content_contains condition.
   */
  private evaluateContentContains(
    condition: PolicyCondition,
    content: string
  ): { matches: boolean; matchedContent?: string } {
    const searchTerms = Array.isArray(condition.value)
      ? condition.value
      : [String(condition.value)];

    const searchContent = condition.caseSensitive
      ? content
      : content.toLowerCase();

    for (const term of searchTerms) {
      const searchTerm = condition.caseSensitive ? term : term.toLowerCase();
      if (searchContent.includes(searchTerm)) {
        // Extract context around the match
        const index = searchContent.indexOf(searchTerm);
        const start = Math.max(0, index - 30);
        const end = Math.min(content.length, index + searchTerm.length + 30);
        return {
          matches: true,
          matchedContent: content.slice(start, end),
        };
      }
    }

    return { matches: false };
  }

  /**
   * Evaluate content_matches condition (regex).
   */
  private evaluateContentMatches(
    condition: PolicyCondition,
    content: string
  ): { matches: boolean; matchedContent?: string } {
    try {
      const flags = condition.caseSensitive ? "g" : "gi";
      const regex = new RegExp(String(condition.value), flags);
      const match = regex.exec(content);

      if (match) {
        return {
          matches: true,
          matchedContent: match[0],
        };
      }
    } catch {
      // Invalid regex, treat as no match
    }

    return { matches: false };
  }

  /**
   * Evaluate attachment type condition.
   */
  private evaluateAttachmentType(
    condition: PolicyCondition,
    attachments: AttachmentInfo[]
  ): { matches: boolean; matchedContent?: string } {
    const targetTypes = Array.isArray(condition.value)
      ? condition.value.map((v) => String(v).toLowerCase())
      : [String(condition.value).toLowerCase()];

    for (const attachment of attachments) {
      const ext = attachment.filename.toLowerCase().split(".").pop() ?? "";
      const extWithDot = `.${ext}`;

      if (
        targetTypes.includes(ext) ||
        targetTypes.includes(extWithDot) ||
        targetTypes.includes(attachment.mimeType.toLowerCase())
      ) {
        return {
          matches: true,
          matchedContent: attachment.filename,
        };
      }
    }

    return { matches: false };
  }

  /**
   * Evaluate attachment size condition.
   */
  private evaluateAttachmentSize(
    condition: PolicyCondition,
    attachments: AttachmentInfo[]
  ): { matches: boolean; matchedContent?: string } {
    const threshold = Number(condition.value);

    for (const attachment of attachments) {
      if (
        condition.operator === "greater_than" &&
        attachment.size > threshold
      ) {
        return {
          matches: true,
          matchedContent: `${attachment.filename} (${formatBytes(attachment.size)})`,
        };
      }
      if (condition.operator === "less_than" && attachment.size < threshold) {
        return {
          matches: true,
          matchedContent: attachment.filename,
        };
      }
    }

    return { matches: false };
  }

  /**
   * Evaluate amount exceeds condition.
   */
  private evaluateAmountExceeds(
    condition: PolicyCondition,
    amounts: ExtractedAmount[]
  ): { matches: boolean; matchedContent?: string } {
    const threshold = Number(condition.value);

    for (const amount of amounts) {
      if (amount.value > threshold) {
        return {
          matches: true,
          matchedContent: `${amount.currency}${amount.value.toLocaleString()} - ${amount.context}`,
        };
      }
    }

    return { matches: false };
  }

  /**
   * Evaluate custom condition.
   */
  private evaluateCustomCondition(
    condition: PolicyCondition,
    input: PolicyInput
  ): { matches: boolean; matchedContent?: string } {
    // Handle specific custom conditions
    if (
      condition.field === "attachments" &&
      condition.value === "hasPassword"
    ) {
      const passwordProtected = input.attachments?.find((a) => a.hasPassword);
      if (passwordProtected) {
        return {
          matches: true,
          matchedContent: passwordProtected.filename,
        };
      }
    }

    return { matches: false };
  }

  /**
   * Compare values based on operator.
   */
  private compareValue(
    operator: ConditionOperator,
    actual: string | number,
    expected: string | number | string[]
  ): boolean {
    switch (operator) {
      case "equals":
        return actual === expected;
      case "not_equals":
        return actual !== expected;
      case "contains":
        return String(actual).includes(String(expected));
      case "not_contains":
        return !String(actual).includes(String(expected));
      case "greater_than":
        return Number(actual) > Number(expected);
      case "less_than":
        return Number(actual) < Number(expected);
      case "in":
        return Array.isArray(expected) && expected.includes(String(actual));
      case "not_in":
        return Array.isArray(expected) && !expected.includes(String(actual));
      case "matches":
        try {
          return new RegExp(String(expected)).test(String(actual));
        } catch {
          return false;
        }
      default:
        return false;
    }
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format bytes to human readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * Create a custom policy rule.
 */
export function createPolicyRule(
  rule: Omit<PolicyRule, "id" | "createdAt" | "updatedAt">
): PolicyRule {
  return {
    ...rule,
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create a policy detector with optional custom rules.
 */
export function createPolicyDetector(
  customRules?: PolicyRule[]
): PolicyDetector {
  return new PolicyDetector(customRules);
}
