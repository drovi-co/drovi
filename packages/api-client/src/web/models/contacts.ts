export interface ContactSummary {
  id: string;
  primaryEmail: string;
  displayName: string | null;
  avatarUrl: string | null;
  company: string | null;
  title: string | null;
  healthScore: number | null;
  importanceScore: number | null;
  engagementScore: number | null;
  sentimentScore: number | null;
  isVip: boolean;
  isAtRisk: boolean;
  isInternal: boolean;
  lifecycleStage: string | null;
  roleType: string | null;
  totalThreads: number;
  totalMessages: number;
  lastInteractionAt: string | null;
  daysSinceLastContact: number | null;
}

export interface ContactDetail extends ContactSummary {
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phone: string | null;
  linkedinUrl: string | null;
  department: string | null;
  seniorityLevel: string | null;
  roleConfidence: number | null;
  avgResponseTimeMinutes: number | null;
  responseRate: number | null;
  avgWordsPerMessage: number | null;
  communicationProfile: Record<string, unknown> | null;
  influenceScore: number | null;
  bridgingScore: number | null;
  communityIds: string[];
  contactBrief: string | null;
  riskReason: string | null;
  notes: string | null;
  lastIntelligenceAt: string | null;
  intelligenceVersion: number | null;
  firstInteractionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContactListResponse {
  items: ContactSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ContactStats {
  totalContacts: number;
  vipCount: number;
  atRiskCount: number;
  internalCount: number;
  newThisWeek: number;
  avgHealthScore: number | null;
}

export interface MeetingBrief {
  contactId: string;
  contactName: string | null;
  brief: string;
  talkingPoints: string[];
  openCommitments: string[];
  pendingDecisions: string[];
  generatedAt: string;
}

export interface ContactIdentityRecord {
  id: string;
  identityType: string;
  identityValue: string;
  confidence: number;
  isVerified: boolean;
  source: string | null;
  sourceAccountId: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContactMergeSuggestion {
  contactAId: string;
  contactAName: string | null;
  contactAEmail: string | null;
  contactBId: string;
  contactBName: string | null;
  contactBEmail: string | null;
  confidence: number;
  matchReasons: string[];
}

export function transformContactSummary(
  raw: Record<string, unknown>
): ContactSummary {
  return {
    id: raw.id as string,
    primaryEmail: raw.primary_email as string,
    displayName: raw.display_name as string | null,
    avatarUrl: raw.avatar_url as string | null,
    company: raw.company as string | null,
    title: raw.title as string | null,
    healthScore: raw.health_score as number | null,
    importanceScore: raw.importance_score as number | null,
    engagementScore: raw.engagement_score as number | null,
    sentimentScore: raw.sentiment_score as number | null,
    isVip: (raw.is_vip as boolean) ?? false,
    isAtRisk: (raw.is_at_risk as boolean) ?? false,
    isInternal: (raw.is_internal as boolean) ?? false,
    lifecycleStage: raw.lifecycle_stage as string | null,
    roleType: raw.role_type as string | null,
    totalThreads: (raw.total_threads as number) ?? 0,
    totalMessages: (raw.total_messages as number) ?? 0,
    lastInteractionAt: raw.last_interaction_at as string | null,
    daysSinceLastContact: raw.days_since_last_contact as number | null,
  };
}

export function transformContactDetail(
  raw: Record<string, unknown>
): ContactDetail {
  return {
    ...transformContactSummary(raw),
    firstName: raw.first_name as string | null,
    lastName: raw.last_name as string | null,
    emails: (raw.emails as string[]) ?? [],
    phone: raw.phone as string | null,
    linkedinUrl: raw.linkedin_url as string | null,
    department: raw.department as string | null,
    seniorityLevel: raw.seniority_level as string | null,
    roleConfidence: raw.role_confidence as number | null,
    avgResponseTimeMinutes: raw.avg_response_time_minutes as number | null,
    responseRate: raw.response_rate as number | null,
    avgWordsPerMessage: raw.avg_words_per_message as number | null,
    communicationProfile: raw.communication_profile as Record<
      string,
      unknown
    > | null,
    influenceScore: raw.influence_score as number | null,
    bridgingScore: raw.bridging_score as number | null,
    communityIds: (raw.community_ids as string[]) ?? [],
    contactBrief: raw.contact_brief as string | null,
    riskReason: raw.risk_reason as string | null,
    notes: raw.notes as string | null,
    lastIntelligenceAt: raw.last_intelligence_at as string | null,
    intelligenceVersion: raw.intelligence_version as number | null,
    firstInteractionAt: raw.first_interaction_at as string | null,
    createdAt: raw.created_at as string | null,
    updatedAt: raw.updated_at as string | null,
  };
}

export function transformContactStats(
  raw: Record<string, unknown>
): ContactStats {
  return {
    totalContacts: (raw.total_contacts as number) ?? 0,
    vipCount: (raw.vip_count as number) ?? 0,
    atRiskCount: (raw.at_risk_count as number) ?? 0,
    internalCount: (raw.internal_count as number) ?? 0,
    newThisWeek: (raw.new_this_week as number) ?? 0,
    avgHealthScore: raw.avg_health_score as number | null,
  };
}

export function transformMeetingBrief(
  raw: Record<string, unknown>
): MeetingBrief {
  return {
    contactId: raw.contact_id as string,
    contactName: raw.contact_name as string | null,
    brief: raw.brief as string,
    talkingPoints: (raw.talking_points as string[]) ?? [],
    openCommitments: (raw.open_commitments as string[]) ?? [],
    pendingDecisions: (raw.pending_decisions as string[]) ?? [],
    generatedAt: raw.generated_at as string,
  };
}
