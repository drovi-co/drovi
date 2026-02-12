export interface CustomerCommitment {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  direction: string;
  dueDate: string | null;
  confidence: number;
}

export interface CustomerDecision {
  id: string;
  title: string;
  statement: string | null;
  status: string;
  decidedAt: string | null;
}

export interface CustomerContact {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  interactionCount: number;
}

export interface CustomerTimelineEvent {
  id: string;
  eventType: string;
  title: string;
  summary: string | null;
  sourceType: string | null;
  timestamp: string | null;
  participants: string[];
}

export interface CustomerContext {
  contactId: string;
  email: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  interactionCount: number;
  lastInteraction: string | null;
  relationshipHealth: number;
  sourceTypes: string[];
  openCommitments: CustomerCommitment[];
  relatedDecisions: CustomerDecision[];
  topContacts: CustomerContact[];
  topTopics: string[];
  timeline: CustomerTimelineEvent[];
  relationshipSummary: string | null;
}

export interface CustomerTimeline {
  contactId: string;
  events: CustomerTimelineEvent[];
  total: number;
}

export interface RelationshipHealth {
  contactId: string;
  healthScore: number;
  factors: Record<string, unknown>;
}

export function transformCustomerCommitment(
  raw: Record<string, unknown>
): CustomerCommitment {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? "Untitled",
    status: (raw.status as string) ?? "open",
    priority: (raw.priority as string | null) ?? null,
    direction: (raw.direction as string) ?? "unknown",
    dueDate: (raw.due_date as string | null) ?? null,
    confidence: (raw.confidence as number) ?? 0,
  };
}

export function transformCustomerDecision(
  raw: Record<string, unknown>
): CustomerDecision {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? "Untitled",
    statement: (raw.statement as string | null) ?? null,
    status: (raw.status as string) ?? "active",
    decidedAt: (raw.decided_at as string | null) ?? null,
  };
}

export function transformCustomerContact(
  raw: Record<string, unknown>
): CustomerContact {
  return {
    id: raw.id as string,
    email: (raw.email as string | null) ?? null,
    name: (raw.name as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
    interactionCount: (raw.interaction_count as number) ?? 0,
  };
}

export function transformCustomerTimelineEvent(
  raw: Record<string, unknown>
): CustomerTimelineEvent {
  return {
    id: raw.id as string,
    eventType: (raw.event_type as string) ?? "event",
    title: (raw.title as string) ?? "Event",
    summary: (raw.summary as string | null) ?? null,
    sourceType: (raw.source_type as string | null) ?? null,
    timestamp: (raw.reference_time as string | null) ?? null,
    participants: (raw.participants as string[] | null) ?? [],
  };
}

export function transformCustomerContext(
  raw: Record<string, unknown>
): CustomerContext {
  return {
    contactId: raw.contact_id as string,
    email: (raw.email as string | null) ?? null,
    name: (raw.name as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
    interactionCount: (raw.interaction_count as number) ?? 0,
    lastInteraction: (raw.last_interaction as string | null) ?? null,
    relationshipHealth: (raw.relationship_health as number) ?? 1,
    sourceTypes: (raw.source_types as string[] | null) ?? [],
    openCommitments: (raw.open_commitments as Record<string, unknown>[] | null)
      ? (raw.open_commitments as Record<string, unknown>[]).map(
          transformCustomerCommitment
        )
      : [],
    relatedDecisions: (raw.related_decisions as
      | Record<string, unknown>[]
      | null)
      ? (raw.related_decisions as Record<string, unknown>[]).map(
          transformCustomerDecision
        )
      : [],
    topContacts: (raw.top_contacts as Record<string, unknown>[] | null)
      ? (raw.top_contacts as Record<string, unknown>[]).map(
          transformCustomerContact
        )
      : [],
    topTopics: (raw.top_topics as string[] | null) ?? [],
    timeline: (raw.timeline as Record<string, unknown>[] | null)
      ? (raw.timeline as Record<string, unknown>[]).map(
          transformCustomerTimelineEvent
        )
      : [],
    relationshipSummary: (raw.relationship_summary as string | null) ?? null,
  };
}
