// Web-facing, camelCase models and transformers.
//
// We keep these explicit because UI code uses camelCase and the backend returns
// snake_case. Phase 8 will further modularize models per module.

export interface Contact {
  id: string;
  displayName: string | null;
  primaryEmail: string;
  avatarUrl: string | null;
  company: string | null;
  title: string | null;
}

export interface CommitmentDetails {
  status: string | null;
  priority: string | null;
  direction: string | null;
  dueDateSource: string | null;
  isConditional: boolean;
  condition: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
}

export interface DecisionDetails {
  status: string | null;
  statement: string | null;
  rationale: string | null;
  decidedAt: string | null;
  supersedesUioId: string | null;
  supersededByUioId: string | null;
  impactAreas: string[] | null;
}

export interface TaskDetails {
  status: string | null;
  priority: string | null;
  estimatedEffort: string | null;
  completedAt: string | null;
  project: string | null;
  tags: string[] | null;
}

export interface RiskDetails {
  severity: string | null;
  riskType: string | null;
  suggestedAction: string | null;
  findings: Record<string, unknown> | null;
}

export interface ClaimDetails {
  claimType: string | null;
  quotedText: string | null;
  normalizedText: string | null;
  importance: string | null;
}

export interface BriefDetails {
  priorityTier: string | null;
  summary: string | null;
  suggestedAction: string | null;
  actionReasoning: string | null;
  urgencyScore: number | null;
  importanceScore: number | null;
  intentClassification: string | null;
}

export interface SourceInfo {
  id: string;
  sourceType: string | null;
  sourceTimestamp: string | null;
  quotedText: string | null;
  segmentHash: string | null;
  conversationId: string | null;
  messageId: string | null;
  role: string | null;
}

export interface UIO {
  id: string;
  type:
    | "commitment"
    | "decision"
    | "task"
    | "claim"
    | "risk"
    | "topic"
    | "project"
    | "brief";
  canonicalTitle: string;
  canonicalDescription: string | null;
  userCorrectedTitle: string | null;
  status: string;
  overallConfidence: number | null;
  confidenceTier: "high" | "medium" | "low";
  isUserVerified: boolean;
  isUserDismissed: boolean;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string | null;
  firstSeenAt: string | null;

  // Resolved contacts
  owner: Contact | null;
  debtor: Contact | null;
  creditor: Contact | null;
  decisionMaker: Contact | null;
  assignee: Contact | null;
  createdBy: Contact | null;

  // Type-specific details (only one populated based on type)
  commitmentDetails: CommitmentDetails | null;
  decisionDetails: DecisionDetails | null;
  taskDetails: TaskDetails | null;
  riskDetails: RiskDetails | null;
  claimDetails: ClaimDetails | null;
  briefDetails: BriefDetails | null;

  // Evidence sources
  sources: SourceInfo[] | null;
  evidenceId: string | null;

  // Legacy compat - computed from details
  title: string;
  description: string | null;
  confidence: number;
  direction?: "owed_to_me" | "owed_by_me";
  extractedAt: string;
}

export interface UIOListResponse {
  items: UIO[];
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

function transformContact(raw: Record<string, unknown> | null): Contact | null {
  if (!raw?.id) return null;
  return {
    id: raw.id as string,
    displayName: (raw.display_name as string | null) ?? null,
    primaryEmail: (raw.primary_email as string) || (raw.email as string) || "",
    avatarUrl: (raw.avatar_url as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
  };
}

function transformCommitmentDetails(
  raw: Record<string, unknown> | null
): CommitmentDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    priority: (raw.priority as string | null) ?? null,
    direction: (raw.direction as string | null) ?? null,
    dueDateSource: (raw.due_date_source as string | null) ?? null,
    isConditional: (raw.is_conditional as boolean) ?? false,
    condition: (raw.condition as string | null) ?? null,
    snoozedUntil: (raw.snoozed_until as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
  };
}

function transformDecisionDetails(
  raw: Record<string, unknown> | null
): DecisionDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    statement: (raw.statement as string | null) ?? null,
    rationale: (raw.rationale as string | null) ?? null,
    decidedAt: (raw.decided_at as string | null) ?? null,
    supersedesUioId: (raw.supersedes_uio_id as string | null) ?? null,
    supersededByUioId: (raw.superseded_by_uio_id as string | null) ?? null,
    impactAreas: (raw.impact_areas as string[] | null) ?? null,
  };
}

function transformTaskDetails(
  raw: Record<string, unknown> | null
): TaskDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    priority: (raw.priority as string | null) ?? null,
    estimatedEffort: (raw.estimated_effort as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
    project: (raw.project as string | null) ?? null,
    tags: (raw.tags as string[] | null) ?? null,
  };
}

function transformRiskDetails(
  raw: Record<string, unknown> | null
): RiskDetails | null {
  if (!raw) return null;
  return {
    severity: (raw.severity as string | null) ?? null,
    riskType: (raw.risk_type as string | null) ?? null,
    suggestedAction: (raw.suggested_action as string | null) ?? null,
    findings: (raw.findings as Record<string, unknown> | null) ?? null,
  };
}

function transformClaimDetails(
  raw: Record<string, unknown> | null
): ClaimDetails | null {
  if (!raw) return null;
  return {
    claimType: (raw.claim_type as string | null) ?? null,
    quotedText: (raw.quoted_text as string | null) ?? null,
    normalizedText: (raw.normalized_text as string | null) ?? null,
    importance: (raw.importance as string | null) ?? null,
  };
}

function transformBriefDetails(
  raw: Record<string, unknown> | null
): BriefDetails | null {
  if (!raw) return null;
  return {
    priorityTier: (raw.priority_tier as string | null) ?? null,
    summary: (raw.summary as string | null) ?? null,
    suggestedAction: (raw.suggested_action as string | null) ?? null,
    actionReasoning: (raw.action_reasoning as string | null) ?? null,
    urgencyScore: (raw.urgency_score as number | null) ?? null,
    importanceScore: (raw.importance_score as number | null) ?? null,
    intentClassification: (raw.intent_classification as string | null) ?? null,
  };
}

function transformSourceInfo(raw: Record<string, unknown>): SourceInfo {
  return {
    id: raw.id as string,
    sourceType: (raw.source_type as string | null) ?? null,
    sourceTimestamp: (raw.source_timestamp as string | null) ?? null,
    quotedText: (raw.quoted_text as string | null) ?? null,
    segmentHash: (raw.segment_hash as string | null) ?? null,
    conversationId: (raw.conversation_id as string | null) ?? null,
    messageId: (raw.message_id as string | null) ?? null,
    role: (raw.role as string | null) ?? null,
  };
}

export function transformUIO(raw: Record<string, unknown>): UIO {
  const id = raw.id as string;
  const type = raw.type as UIO["type"];

  const canonicalTitle =
    (raw.canonical_title as string) ?? (raw.title as string) ?? "";
  const canonicalDescription =
    (raw.canonical_description as string | null) ??
    (raw.description as string | null) ??
    null;

  const overallConfidence = (raw.overall_confidence as number | null) ?? null;
  const confidenceTier =
    (raw.confidence_tier as UIO["confidenceTier"]) ?? "medium";

  const detailsByType: {
    commitment: Record<string, unknown> | null;
    decision: Record<string, unknown> | null;
    task: Record<string, unknown> | null;
    risk: Record<string, unknown> | null;
    claim: Record<string, unknown> | null;
    brief: Record<string, unknown> | null;
  } = {
    commitment:
      (raw.commitment_details as Record<string, unknown> | null) ?? null,
    decision: (raw.decision_details as Record<string, unknown> | null) ?? null,
    task: (raw.task_details as Record<string, unknown> | null) ?? null,
    risk: (raw.risk_details as Record<string, unknown> | null) ?? null,
    claim: (raw.claim_details as Record<string, unknown> | null) ?? null,
    brief: (raw.brief_details as Record<string, unknown> | null) ?? null,
  };

  const sourcesRaw = raw.sources as
    | Array<Record<string, unknown>>
    | null
    | undefined;
  const sources = Array.isArray(sourcesRaw)
    ? sourcesRaw.map(transformSourceInfo)
    : null;

  const extractedAt =
    (raw.extracted_at as string | null) ??
    (raw.created_at as string | null) ??
    (raw.createdAt as string | null) ??
    new Date().toISOString();

  const uio: UIO = {
    id,
    type,
    canonicalTitle,
    canonicalDescription,
    userCorrectedTitle: (raw.user_corrected_title as string | null) ?? null,
    status: (raw.status as string) ?? "active",
    overallConfidence,
    confidenceTier,
    isUserVerified: Boolean(
      raw.is_user_verified ?? raw.isUserVerified ?? false
    ),
    isUserDismissed: Boolean(
      raw.is_user_dismissed ?? raw.isUserDismissed ?? false
    ),
    dueDate: (raw.due_date as string | null) ?? null,
    createdAt: (raw.created_at as string) ?? extractedAt,
    updatedAt: (raw.updated_at as string | null) ?? null,
    firstSeenAt: (raw.first_seen_at as string | null) ?? null,

    owner: transformContact(
      (raw.owner as Record<string, unknown> | null) ?? null
    ),
    debtor: transformContact(
      (raw.debtor as Record<string, unknown> | null) ?? null
    ),
    creditor: transformContact(
      (raw.creditor as Record<string, unknown> | null) ?? null
    ),
    decisionMaker: transformContact(
      (raw.decision_maker as Record<string, unknown> | null) ?? null
    ),
    assignee: transformContact(
      (raw.assignee as Record<string, unknown> | null) ?? null
    ),
    createdBy: transformContact(
      (raw.created_by as Record<string, unknown> | null) ?? null
    ),

    commitmentDetails: transformCommitmentDetails(detailsByType.commitment),
    decisionDetails: transformDecisionDetails(detailsByType.decision),
    taskDetails: transformTaskDetails(detailsByType.task),
    riskDetails: transformRiskDetails(detailsByType.risk),
    claimDetails: transformClaimDetails(detailsByType.claim),
    briefDetails: transformBriefDetails(detailsByType.brief),

    sources,
    evidenceId: (raw.evidence_id as string | null) ?? null,

    // Legacy compat fields
    title: canonicalTitle,
    description: canonicalDescription,
    confidence: overallConfidence ?? 0.5,
    direction:
      (detailsByType.commitment?.direction as
        | "owed_to_me"
        | "owed_by_me"
        | undefined) ?? undefined,
    extractedAt,
  };

  // Type-specific computed defaults.
  if (
    type === "commitment" &&
    uio.commitmentDetails &&
    !uio.commitmentDetails.direction
  ) {
    uio.commitmentDetails.direction = "owed_to_me";
  }

  return uio;
}
