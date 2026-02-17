export type MandateBarMode = "ask" | "act" | "inspect";

export interface MandateActionCard {
  id: string;
  mode: MandateBarMode;
  title: string;
  description: string;
  query: string;
  auditCode: string;
  keywords: readonly string[];
  route?: string;
  allowedRoles?: readonly string[];
}

export interface PrivateBriefingSource {
  title?: string | null;
  name?: string | null;
  quoted_text?: string | null;
  source_timestamp?: string | null;
}

export interface PrivateBriefingInput {
  question: string;
  answer: string;
  generatedAt?: string | Date | null;
  templateTitle?: string | null;
  auditCode?: string | null;
  requestId?: string | null;
  sources?: PrivateBriefingSource[];
}

function normalizeIntent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRoleAllowed(
  card: MandateActionCard,
  role: string | null | undefined
): boolean {
  if (!card.allowedRoles || card.allowedRoles.length === 0) {
    return true;
  }
  if (!role) {
    return false;
  }
  return card.allowedRoles.includes(role);
}

export const MANDATE_ACTION_CARDS: readonly MandateActionCard[] = [
  {
    id: "weekly-continuity-briefing",
    mode: "ask",
    title: "Prepare weekly continuity briefing",
    description: "Generate an evidence-first continuity memo for this week.",
    query:
      "Prepare this week's continuity briefing with key changes, unresolved risks, and superseded records.",
    auditCode: "MBR-001",
    keywords: ["weekly", "continuity", "briefing", "memo"],
  },
  {
    id: "unresolved-high-risk-commitments",
    mode: "ask",
    title: "Show unresolved high-risk commitments",
    description: "List open obligations ranked by risk and due pressure.",
    query:
      "Show unresolved high-risk commitments with due dates, owners, evidence count, and contradiction risk.",
    auditCode: "MBR-002",
    keywords: ["unresolved", "high risk", "commitments", "obligations"],
  },
  {
    id: "contradictions-by-matter-engagement",
    mode: "ask",
    title: "Show contradictions by matter or engagement",
    description:
      "Surface contradictory records grouped by matter, engagement, or client.",
    query:
      "Show contradictions grouped by matter or engagement with supporting evidence and supersession history.",
    auditCode: "MBR-003",
    keywords: ["contradictions", "matter", "engagement", "drift"],
  },
  {
    id: "commitments-due-7-days",
    mode: "ask",
    title: "Commitments due in the next 7 days",
    description: "Identify near-term commitments with no confirmation trail.",
    query:
      "List commitments due in the next 7 days, grouped by owner, with missing confirmation signals.",
    auditCode: "MBR-004",
    keywords: ["due", "7 days", "next week", "commitments"],
  },
  {
    id: "decisions-changed-30-days",
    mode: "ask",
    title: "Decisions changed in the last 30 days",
    description: "Track decisions that were superseded or materially revised.",
    query:
      "Show decisions that changed in the last 30 days with supersession chains and evidence references.",
    auditCode: "MBR-005",
    keywords: ["decisions", "changed", "superseded", "30 days"],
  },
  {
    id: "silent-client-matters",
    mode: "ask",
    title: "Silent client matters",
    description: "Find active matters with unresolved asks and no client reply.",
    query:
      "Find active matters where we requested client input and have no response for more than 7 days.",
    auditCode: "MBR-006",
    keywords: ["silent", "client", "no response", "matter"],
  },
  {
    id: "evidence-gaps-register",
    mode: "inspect",
    title: "Evidence gaps register",
    description: "List records that cannot be defended with direct evidence.",
    query:
      "Show records with missing or low-quality evidence links and rank them by operational risk.",
    auditCode: "MBR-007",
    keywords: ["evidence", "gaps", "missing", "unsupported"],
    route: "/dashboard/trust",
  },
  {
    id: "records-updated-last-24h",
    mode: "inspect",
    title: "Record changes in the last 24 hours",
    description: "Review what changed and why it changed.",
    query:
      "What records changed in the last 24 hours and what evidence triggered each change?",
    auditCode: "MBR-008",
    keywords: ["changes", "24 hours", "updated", "record feed"],
    route: "/dashboard/reality-stream",
  },
  {
    id: "new-risks-this-week",
    mode: "ask",
    title: "New risks opened this week",
    description: "Surface risks created this week and their confidence trail.",
    query:
      "Show risks opened this week with owner, confidence, and linked commitments.",
    auditCode: "MBR-009",
    keywords: ["new risks", "this week", "opened", "risk"],
  },
  {
    id: "decisions-without-owner",
    mode: "ask",
    title: "Decisions without clear owner",
    description: "Find decisions lacking accountable ownership metadata.",
    query:
      "List recent decisions without a clear owner and include originating evidence.",
    auditCode: "MBR-010",
    keywords: ["decision", "owner", "unassigned", "accountability"],
  },
  {
    id: "task-due-date-gaps",
    mode: "ask",
    title: "Tasks missing due dates",
    description: "Identify tasks with implied deadlines but no explicit due date.",
    query:
      "Show tasks missing explicit due dates where source evidence implies a deadline.",
    auditCode: "MBR-011",
    keywords: ["tasks", "missing due date", "deadline", "implied"],
  },
  {
    id: "source-health-overview",
    mode: "inspect",
    title: "Connector health overview",
    description: "Inspect live sync status, lag, and failure signals by source.",
    query:
      "Summarize source connector health, lag, and failed sync attempts in the last 24 hours.",
    auditCode: "MBR-012",
    keywords: ["connector", "health", "lag", "sync"],
    route: "/dashboard/sources",
  },
  {
    id: "evidence-readiness-audit",
    mode: "inspect",
    title: "Evidence readiness audit",
    description: "Validate that high-stakes records meet proof requirements.",
    query:
      "Audit high-stakes records for evidence completeness and verification recency.",
    auditCode: "MBR-013",
    keywords: ["audit", "evidence readiness", "high stakes", "verification"],
    route: "/dashboard/trust",
    allowedRoles: ["pilot_owner", "pilot_admin"],
  },
  {
    id: "pilot-kpi-ledger",
    mode: "act",
    title: "Pilot KPI ledger snapshot",
    description: "Open the ledger view for operational pilot KPIs.",
    query: "Open the pilot KPI ledger and highlight SLA drifts.",
    auditCode: "MBR-014",
    keywords: ["kpi", "ledger", "pilot", "sla"],
    route: "/dashboard/console",
  },
  {
    id: "pending-approvals-register",
    mode: "ask",
    title: "Pending approvals register",
    description: "List pending approvals and stalled review threads.",
    query:
      "Show pending approvals with request date, approver, and evidence trail.",
    auditCode: "MBR-015",
    keywords: ["pending approvals", "approval", "stalled", "register"],
  },
  {
    id: "superseded-commitments-trail",
    mode: "ask",
    title: "Superseded commitments trail",
    description: "Track commitments replaced by newer commitments.",
    query:
      "Show commitments superseded in the last 60 days and the records that replaced them.",
    auditCode: "MBR-016",
    keywords: ["superseded", "commitments", "trail", "replaced"],
  },
  {
    id: "owner-workload-imbalance",
    mode: "ask",
    title: "Owner workload imbalance",
    description: "Highlight commitment concentration and bottleneck owners.",
    query:
      "Identify owners with concentrated high-risk commitments and overdue load.",
    auditCode: "MBR-017",
    keywords: ["owner", "workload", "imbalance", "overdue"],
  },
  {
    id: "high-risk-no-evidence",
    mode: "ask",
    title: "High-risk records with weak proof",
    description:
      "Surface high-risk records that lack sufficient evidence confidence.",
    query:
      "Show high-risk records with low confidence or missing evidence and provide remediation actions.",
    auditCode: "MBR-018",
    keywords: ["high risk", "weak proof", "low confidence", "evidence"],
  },
  {
    id: "relationship-map-contradictions",
    mode: "inspect",
    title: "Graph contradictions map",
    description: "Open relationship map focused on contradiction edges.",
    query:
      "Open the relationship graph and highlight contradiction-linked entities.",
    auditCode: "MBR-019",
    keywords: ["graph", "contradictions", "relationship", "map"],
    route: "/dashboard/graph",
  },
  {
    id: "cross-channel-escalations",
    mode: "act",
    title: "Cross-channel escalation queue",
    description: "Review actionable escalation queue from inbox channels.",
    query:
      "Open escalation queue for Slack, Teams, and email threads requiring immediate action.",
    auditCode: "MBR-020",
    keywords: ["escalation", "slack", "teams", "email"],
    route: "/dashboard/agents/inbox",
    allowedRoles: ["pilot_owner", "pilot_admin"],
  },
];

export function getMandateActionCardById(id: string): MandateActionCard | null {
  return MANDATE_ACTION_CARDS.find((card) => card.id === id) ?? null;
}

export function getMandateActionCards(
  mode: MandateBarMode,
  role: string | null | undefined
): MandateActionCard[] {
  return MANDATE_ACTION_CARDS.filter(
    (card) => card.mode === mode && isRoleAllowed(card, role)
  );
}

export function getPriorityMandateActionCards(
  role: string | null | undefined
): MandateActionCard[] {
  const ordered = [
    "weekly-continuity-briefing",
    "unresolved-high-risk-commitments",
    "contradictions-by-matter-engagement",
  ];
  return ordered
    .map((id) => getMandateActionCardById(id))
    .filter((card): card is MandateActionCard =>
      Boolean(card && isRoleAllowed(card, role))
    );
}

export function resolveMandateActionCard(
  input: string,
  role: string | null | undefined
): MandateActionCard | null {
  const normalized = normalizeIntent(input);
  if (!normalized) {
    return null;
  }

  let bestCard: MandateActionCard | null = null;
  let bestScore = -1;

  for (const card of MANDATE_ACTION_CARDS) {
    if (!isRoleAllowed(card, role)) {
      continue;
    }

    let score = 0;
    for (const keyword of card.keywords) {
      if (normalized.includes(normalizeIntent(keyword))) {
        score += 3;
      }
    }

    const normalizedTitle = normalizeIntent(card.title);
    if (normalizedTitle && normalized.includes(normalizedTitle)) {
      score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  if (bestScore <= 0) {
    return null;
  }
  return bestCard;
}

export function buildPrivateBriefingExport({
  question,
  answer,
  generatedAt,
  templateTitle,
  auditCode,
  requestId,
  sources = [],
}: PrivateBriefingInput): string {
  const timestamp = generatedAt
    ? new Date(generatedAt).toISOString()
    : new Date().toISOString();
  const header = [
    "Drovi — Private Briefing",
    `Generated: ${timestamp}`,
    templateTitle ? `Mandate card: ${templateTitle}` : null,
    auditCode ? `Audit code: ${auditCode}` : null,
    requestId ? `Request ID: ${requestId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const evidenceLines = sources.length
    ? sources
        .slice(0, 10)
        .map((source, index) => {
          const title = source.title || source.name || `Source ${index + 1}`;
          const quote =
            typeof source.quoted_text === "string" &&
            source.quoted_text.trim().length > 0
              ? ` — "${source.quoted_text.trim()}"`
              : "";
          const at = source.source_timestamp
            ? ` (${source.source_timestamp})`
            : "";
          return `${index + 1}. ${title}${at}${quote}`;
        })
        .join("\n")
    : "No evidence citations attached.";

  return [
    header,
    "",
    "Question",
    question.trim(),
    "",
    "Briefing",
    answer.trim(),
    "",
    "Evidence",
    evidenceLines,
  ].join("\n");
}
