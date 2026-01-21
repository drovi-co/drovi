// =============================================================================
// RISK ANALYSIS PROMPTS (PRD-09)
// =============================================================================
//
// System prompts and templates for risk analysis.
//

// =============================================================================
// TYPES
// =============================================================================

export interface RiskAnalysisContext {
  content: string;
  subject?: string;
  sender: {
    email: string;
    name?: string;
  };
  recipients: Array<{
    email: string;
    name?: string;
    isExternal: boolean;
  }>;
  historicalContext?: {
    commitments: Array<{ text: string; date: string }>;
    decisions: Array<{ text: string; date: string }>;
    statements: Array<{ text: string; date: string }>;
  };
  organizationContext?: {
    knownDomains: string[];
    executiveNames: string[];
    sensitiveProjects: string[];
  };
}

export interface SemanticContradictionInput {
  draftContent: string;
  historicalStatements: Array<{
    id: string;
    text: string;
    source: string;
    date: string;
    type: "commitment" | "decision" | "statement";
  }>;
}

export interface FraudAnalysisInput {
  content: string;
  sender: {
    email: string;
    name?: string;
    domain: string;
  };
  signals: {
    impersonation: Array<{ type: string; details: string }>;
    invoiceFraud: Array<{ type: string; details: string }>;
    phishing: Array<{ type: string; details: string }>;
  };
}

// =============================================================================
// SYSTEM PROMPTS
// =============================================================================

export const RISK_ANALYSIS_SYSTEM_PROMPT = `You are a risk analysis expert specialized in email communication security.
Your role is to identify potential risks, contradictions, and policy violations in email communications.

You should analyze:
1. Contradictions with previous commitments, decisions, or statements
2. Sensitive information exposure (PII, confidential data)
3. Fraud indicators (impersonation, phishing, invoice fraud)
4. Policy compliance issues

Always provide:
- Clear risk assessments with severity levels
- Specific evidence for each finding
- Actionable recommendations
- Confidence scores for your assessments

Be thorough but avoid false positives. Focus on genuine risks rather than hypothetical concerns.`;

export const CONTRADICTION_ANALYSIS_PROMPT = `Analyze the following draft message for contradictions with historical statements.

DRAFT MESSAGE:
{draftContent}

HISTORICAL STATEMENTS:
{historicalStatements}

Identify any contradictions, including:
1. Direct contradictions (saying the opposite of a previous statement)
2. Commitment conflicts (promising something that conflicts with an existing commitment)
3. Decision reversals (contradicting a documented decision without acknowledgment)
4. Date/timeline inconsistencies

For each contradiction found, provide:
- The specific text in the draft that contradicts
- The historical statement being contradicted
- Severity (low/medium/high/critical)
- Suggested resolution

Respond in JSON format:
{
  "contradictions": [
    {
      "draftText": "string",
      "historicalId": "string",
      "historicalText": "string",
      "type": "direct|commitment|decision|timeline",
      "severity": "low|medium|high|critical",
      "explanation": "string",
      "suggestion": "string"
    }
  ],
  "overallAssessment": "string",
  "confidence": 0.0-1.0
}`;

export const FRAUD_ANALYSIS_PROMPT = `Analyze the following email for potential fraud indicators.

EMAIL CONTENT:
{content}

SENDER INFORMATION:
Email: {senderEmail}
Name: {senderName}
Domain: {senderDomain}

DETECTED SIGNALS:
{signals}

Analyze these signals and determine:
1. Is this likely a legitimate email or a fraud attempt?
2. What type of fraud (if any): impersonation, invoice fraud, phishing, BEC?
3. What specific red flags are present?
4. What action should be taken?

Consider:
- Domain similarity to known legitimate domains
- Writing style and tone abnormalities
- Urgency indicators
- Request patterns typical of fraud
- Technical indicators (mismatched reply-to, suspicious links)

Respond in JSON format:
{
  "isLikelyFraud": boolean,
  "fraudType": "impersonation|invoice_fraud|phishing|bec|none",
  "confidence": 0.0-1.0,
  "redFlags": [
    {
      "indicator": "string",
      "severity": "low|medium|high|critical",
      "explanation": "string"
    }
  ],
  "recommendation": {
    "action": "allow|warn|block|verify",
    "reason": "string",
    "verificationSteps": ["string"]
  }
}`;

export const SENSITIVE_DATA_PROMPT = `Analyze the following content for sensitive information exposure risks.

CONTENT:
{content}

RECIPIENTS:
{recipients}

Identify:
1. Personal Identifiable Information (PII)
   - Social Security Numbers
   - Credit card numbers
   - Bank account details
   - Personal addresses
   - Phone numbers
   - Dates of birth

2. Confidential Business Information
   - Financial data
   - Trade secrets
   - Strategic plans
   - Legal matters
   - HR/personnel information

3. Recipient Appropriateness
   - Are external recipients receiving sensitive internal data?
   - Are unverified recipients receiving PII?

For each finding, provide:
- Type of sensitive data
- Location in content
- Risk if exposed
- Recommended action (redact, encrypt, remove recipient)

Respond in JSON format:
{
  "findings": [
    {
      "type": "pii|confidential|restricted",
      "subtype": "string",
      "content": "string (redacted)",
      "location": "string",
      "risk": "low|medium|high|critical",
      "recommendation": "string"
    }
  ],
  "recipientIssues": [
    {
      "recipient": "string",
      "issue": "string",
      "recommendation": "string"
    }
  ],
  "overallRisk": "low|medium|high|critical",
  "summary": "string"
}`;

export const POLICY_EVALUATION_PROMPT = `Evaluate the following email against organizational policies.

EMAIL CONTENT:
{content}

SUBJECT: {subject}

SENDER: {sender}

RECIPIENTS:
{recipients}

APPLICABLE POLICIES:
{policies}

For each policy:
1. Determine if the email complies or violates
2. Identify specific violations
3. Assess severity
4. Recommend corrective actions

Consider:
- Communication policies (external recipients, confidentiality)
- Data handling policies (PII, classification)
- Financial policies (approval thresholds, segregation of duties)
- Compliance requirements (legal holds, regulatory)
- Security policies (attachments, links)

Respond in JSON format:
{
  "evaluations": [
    {
      "policyId": "string",
      "policyName": "string",
      "status": "compliant|warning|violation",
      "findings": ["string"],
      "severity": "info|warning|violation|critical",
      "requiredActions": ["string"]
    }
  ],
  "overallCompliance": "compliant|needs_attention|non_compliant",
  "blockedReasons": ["string"],
  "requiredApprovals": [
    {
      "reason": "string",
      "approverRole": "string"
    }
  ],
  "summary": "string"
}`;

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Build contradiction analysis prompt.
 */
export function buildContradictionPrompt(
  input: SemanticContradictionInput
): string {
  const historicalFormatted = input.historicalStatements
    .map(
      (s) => `[${s.id}] (${s.type}, ${s.date}, from: ${s.source}): "${s.text}"`
    )
    .join("\n");

  return CONTRADICTION_ANALYSIS_PROMPT.replace(
    "{draftContent}",
    input.draftContent
  ).replace("{historicalStatements}", historicalFormatted);
}

/**
 * Build fraud analysis prompt.
 */
export function buildFraudAnalysisPrompt(input: FraudAnalysisInput): string {
  const signalsFormatted = [
    ...input.signals.impersonation.map(
      (s) => `Impersonation: ${s.type} - ${s.details}`
    ),
    ...input.signals.invoiceFraud.map(
      (s) => `Invoice Fraud: ${s.type} - ${s.details}`
    ),
    ...input.signals.phishing.map((s) => `Phishing: ${s.type} - ${s.details}`),
  ].join("\n");

  return FRAUD_ANALYSIS_PROMPT.replace("{content}", input.content)
    .replace("{senderEmail}", input.sender.email)
    .replace("{senderName}", input.sender.name ?? "Unknown")
    .replace("{senderDomain}", input.sender.domain)
    .replace("{signals}", signalsFormatted || "No specific signals detected");
}

/**
 * Build sensitive data analysis prompt.
 */
export function buildSensitiveDataPrompt(
  content: string,
  recipients: Array<{ email: string; name?: string; isExternal: boolean }>
): string {
  const recipientsFormatted = recipients
    .map(
      (r) =>
        `${r.email} (${r.name ?? "Unknown"}) - ${r.isExternal ? "EXTERNAL" : "Internal"}`
    )
    .join("\n");

  return SENSITIVE_DATA_PROMPT.replace("{content}", content).replace(
    "{recipients}",
    recipientsFormatted
  );
}

/**
 * Build policy evaluation prompt.
 */
export function buildPolicyEvaluationPrompt(
  content: string,
  subject: string,
  sender: string,
  recipients: Array<{ email: string; isExternal: boolean }>,
  policies: Array<{ id: string; name: string; description: string }>
): string {
  const recipientsFormatted = recipients
    .map((r) => `${r.email} (${r.isExternal ? "EXTERNAL" : "Internal"})`)
    .join("\n");

  const policiesFormatted = policies
    .map((p) => `[${p.id}] ${p.name}: ${p.description}`)
    .join("\n");

  return POLICY_EVALUATION_PROMPT.replace("{content}", content)
    .replace("{subject}", subject)
    .replace("{sender}", sender)
    .replace("{recipients}", recipientsFormatted)
    .replace("{policies}", policiesFormatted);
}

// =============================================================================
// RESPONSE PARSERS
// =============================================================================

export interface ContradictionAnalysisResult {
  contradictions: Array<{
    draftText: string;
    historicalId: string;
    historicalText: string;
    type: "direct" | "commitment" | "decision" | "timeline";
    severity: "low" | "medium" | "high" | "critical";
    explanation: string;
    suggestion: string;
  }>;
  overallAssessment: string;
  confidence: number;
}

export interface FraudAnalysisResult {
  isLikelyFraud: boolean;
  fraudType: "impersonation" | "invoice_fraud" | "phishing" | "bec" | "none";
  confidence: number;
  redFlags: Array<{
    indicator: string;
    severity: "low" | "medium" | "high" | "critical";
    explanation: string;
  }>;
  recommendation: {
    action: "allow" | "warn" | "block" | "verify";
    reason: string;
    verificationSteps: string[];
  };
}

export interface SensitiveDataAnalysisResult {
  findings: Array<{
    type: "pii" | "confidential" | "restricted";
    subtype: string;
    content: string;
    location: string;
    risk: "low" | "medium" | "high" | "critical";
    recommendation: string;
  }>;
  recipientIssues: Array<{
    recipient: string;
    issue: string;
    recommendation: string;
  }>;
  overallRisk: "low" | "medium" | "high" | "critical";
  summary: string;
}

export interface PolicyEvaluationResult {
  evaluations: Array<{
    policyId: string;
    policyName: string;
    status: "compliant" | "warning" | "violation";
    findings: string[];
    severity: "info" | "warning" | "violation" | "critical";
    requiredActions: string[];
  }>;
  overallCompliance: "compliant" | "needs_attention" | "non_compliant";
  blockedReasons: string[];
  requiredApprovals: Array<{
    reason: string;
    approverRole: string;
  }>;
  summary: string;
}

/**
 * Parse JSON response from LLM.
 */
export function parseJsonResponse<T>(response: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1]) as T;
    }

    // Try direct JSON parse
    return JSON.parse(response) as T;
  } catch {
    // Try to find JSON object in response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
