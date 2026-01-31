"""
Blindspot Detection Service

Implements Deming's System of Profound Knowledge for organizational self-analysis.
From the "Trillion Dollar Hole" research:
- Systems cannot understand themselves from within
- Need meta-analysis to detect blind spots
- Outside view is essential for improvement

Blindspot Types:
- decision_vacuum: Active topic with no decisions
- responsibility_gap: Work mentioned but unowned
- recurring_question: Same question keeps appearing
- ignored_risk: Risk detected but not addressed
- communication_silo: Information not reaching stakeholders
"""

from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class BlindspotType(str, Enum):
    """Types of organizational blindspots."""

    DECISION_VACUUM = "decision_vacuum"  # Active topic, no decisions
    RESPONSIBILITY_GAP = "responsibility_gap"  # Work mentioned but unowned
    RECURRING_QUESTION = "recurring_question"  # Same question keeps appearing
    IGNORED_RISK = "ignored_risk"  # Risk detected but not addressed
    COMMUNICATION_SILO = "communication_silo"  # Information not reaching stakeholders
    OVERCOMMITMENT = "overcommitment"  # Too many commitments for capacity
    STALE_COMMITMENT = "stale_commitment"  # Commitments without progress
    DECISION_REVERSAL_PATTERN = "decision_reversal_pattern"  # Frequent reversals


class BlindspotSeverity(str, Enum):
    """Severity levels for blindspots."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class BlindspotIndicator(BaseModel):
    """A detected blindspot in the organization."""

    id: str
    blindspot_type: BlindspotType
    title: str = ""  # Short title for UI display
    severity: BlindspotSeverity
    description: str
    evidence_ids: list[str] = Field(default_factory=list)  # UIO IDs
    affected_contacts: list[str] = Field(default_factory=list)
    affected_topics: list[str] = Field(default_factory=list)
    suggested_action: str
    detected_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class OrganizationProfile(BaseModel):
    """Organizational intelligence profile."""

    organization_id: str

    # Summary metrics (for API response)
    total_commitments: int = 0
    open_commitments: int = 0
    total_decisions: int = 0
    total_risks_detected: int = 0
    risks_mitigated: int = 0

    # Decision patterns
    decisions_per_week: float = 0.0
    decision_reversal_rate: float = 0.0
    avg_decision_latency_days: float = 0.0

    # Commitment patterns
    commitments_per_week: float = 0.0
    commitment_fulfillment_rate: float = 0.0
    overdue_commitment_count: int = 0
    overcommitment_score: float = 0.0

    # Communication patterns
    active_topics_count: int = 0
    topics_without_decisions: int = 0
    communication_bottlenecks: list[str] = Field(default_factory=list)

    # Risk patterns
    open_risks_count: int = 0
    ignored_risks_count: int = 0
    recurring_risk_types: list[str] = Field(default_factory=list)

    # Blindspots
    blindspots: list[BlindspotIndicator] = Field(default_factory=list)

    # Overall health
    organizational_health_score: float = 0.0

    # Timestamps
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BlindspotDetectionService:
    """
    Service for detecting organizational blindspots.

    From Deming's System of Profound Knowledge:
    - Systems require external perspective to identify blind spots
    - Statistical thinking reveals patterns invisible from within
    - Variation analysis distinguishes signal from noise
    """

    def __init__(self, graph_client=None):
        """Initialize the service."""
        self._graph = graph_client

    async def _ensure_graph(self):
        """Lazy-load graph client."""
        if self._graph is None:
            from ..graph.client import get_graph_client
            self._graph = await get_graph_client()

    async def analyze_organization(
        self,
        organization_id: str,
        days: int = 30,
    ) -> OrganizationProfile:
        """
        Generate comprehensive organizational profile with blindspot detection.

        Args:
            organization_id: Organization to analyze
            days: Analysis window in days

        Returns:
            OrganizationProfile with metrics and blindspots
        """
        await self._ensure_graph()

        logger.info(
            "Analyzing organization for blindspots",
            organization_id=organization_id,
            days=days,
        )

        profile = OrganizationProfile(organization_id=organization_id)
        blindspots: list[BlindspotIndicator] = []

        try:
            # Analyze decision patterns
            decision_metrics = await self._analyze_decisions(organization_id, days)
            profile.decisions_per_week = decision_metrics.get("per_week", 0)
            profile.decision_reversal_rate = decision_metrics.get("reversal_rate", 0)
            profile.avg_decision_latency_days = decision_metrics.get("avg_latency", 0)
            profile.total_decisions = decision_metrics.get("total", 0)

            # Analyze commitment patterns
            commitment_metrics = await self._analyze_commitments(organization_id, days)
            profile.commitments_per_week = commitment_metrics.get("per_week", 0)
            profile.commitment_fulfillment_rate = commitment_metrics.get("fulfillment_rate", 0)
            profile.overdue_commitment_count = commitment_metrics.get("overdue_count", 0)
            profile.overcommitment_score = commitment_metrics.get("overcommitment_score", 0)
            profile.total_commitments = commitment_metrics.get("total", 0)
            profile.open_commitments = commitment_metrics.get("open_count", 0)

            # Analyze communication patterns
            comm_metrics = await self._analyze_communication(organization_id, days)
            profile.active_topics_count = comm_metrics.get("active_topics", 0)
            profile.topics_without_decisions = comm_metrics.get("topics_without_decisions", 0)
            profile.communication_bottlenecks = comm_metrics.get("bottlenecks", [])

            # Analyze risk patterns
            risk_metrics = await self._analyze_risks(organization_id, days)
            profile.open_risks_count = risk_metrics.get("open_count", 0)
            profile.ignored_risks_count = risk_metrics.get("ignored_count", 0)
            profile.recurring_risk_types = risk_metrics.get("recurring_types", [])
            profile.total_risks_detected = risk_metrics.get("total", 0)
            profile.risks_mitigated = risk_metrics.get("mitigated", 0)

            # Detect specific blindspots
            blindspots.extend(
                await self._detect_decision_vacuums(organization_id, days)
            )
            blindspots.extend(
                await self._detect_responsibility_gaps(organization_id, days)
            )
            blindspots.extend(
                await self._detect_recurring_questions(organization_id, days)
            )
            blindspots.extend(
                await self._detect_ignored_risks(organization_id, days)
            )
            blindspots.extend(
                await self._detect_communication_silos(organization_id, days)
            )
            blindspots.extend(
                await self._detect_overcommitment(organization_id, commitment_metrics)
            )
            blindspots.extend(
                await self._detect_stale_commitments(organization_id, days)
            )

            profile.blindspots = blindspots

            # Calculate organizational health score (0-1)
            # Based on fulfillment rate, risk management, and blindspot count
            fulfillment_factor = profile.commitment_fulfillment_rate
            decision_health = 1.0 - profile.decision_reversal_rate
            risk_health = (
                profile.risks_mitigated / max(profile.total_risks_detected, 1)
                if profile.total_risks_detected > 0
                else 1.0
            )
            blindspot_penalty = min(len(blindspots) * 0.05, 0.3)  # Max 30% penalty

            profile.organizational_health_score = max(
                0.0,
                (fulfillment_factor * 0.4 + decision_health * 0.3 + risk_health * 0.3)
                - blindspot_penalty,
            )

            logger.info(
                "Organization analysis complete",
                organization_id=organization_id,
                blindspots_found=len(blindspots),
                health_score=profile.organizational_health_score,
            )

        except Exception as e:
            logger.error(
                "Organization analysis failed",
                error=str(e),
                organization_id=organization_id,
            )

        return profile

    async def _analyze_decisions(
        self, organization_id: str, days: int
    ) -> dict[str, Any]:
        """Analyze decision patterns."""
        # Calculate cutoff date in Python for FalkorDB compatibility
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (d:Decision {organizationId: $org_id})
                WHERE d.createdAt > $cutoff_date
                WITH d,
                     CASE WHEN d.status = 'reversed' THEN 1 ELSE 0 END as reversed
                RETURN count(d) as total,
                       sum(reversed) as reversed_count
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            if result and len(result) > 0:
                row = result[0]
                total = row.get("total", 0) or 0
                reversed_count = row.get("reversed_count", 0) or 0
                weeks = days / 7

                return {
                    "total": total,
                    "per_week": total / weeks if weeks > 0 else 0,
                    "reversal_rate": reversed_count / total if total > 0 else 0,
                    "avg_latency": 0,  # Latency calculation not supported in FalkorDB
                }
        except Exception as e:
            logger.warning("Decision analysis failed", error=str(e))

        return {"total": 0}

    async def _analyze_commitments(
        self, organization_id: str, days: int
    ) -> dict[str, Any]:
        """Analyze commitment patterns."""
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Commitment {organizationId: $org_id})
                WHERE c.createdAt > $cutoff_date
                WITH c,
                     CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END as completed,
                     CASE WHEN c.status = 'overdue' THEN 1 ELSE 0 END as overdue
                RETURN count(c) as total,
                       sum(completed) as completed_count,
                       sum(overdue) as overdue_count
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            if result and len(result) > 0:
                row = result[0]
                total = row.get("total", 0) or 0
                completed = row.get("completed_count", 0) or 0
                overdue = row.get("overdue_count", 0) or 0
                weeks = days / 7

                # Overcommitment score: ratio of active to completed
                active = total - completed
                overcommitment = active / (completed + 1)  # Avoid div by zero

                return {
                    "total": total,
                    "open_count": active,
                    "per_week": total / weeks if weeks > 0 else 0,
                    "fulfillment_rate": completed / total if total > 0 else 1.0,
                    "overdue_count": overdue,
                    "overcommitment_score": min(overcommitment, 5.0),  # Cap at 5x
                }
        except Exception as e:
            logger.warning("Commitment analysis failed", error=str(e))

        return {"total": 0, "open_count": 0}

    async def _analyze_communication(
        self, organization_id: str, days: int
    ) -> dict[str, Any]:
        """Analyze communication patterns."""
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            # Get topics and their decision coverage
            result = await self._graph.query(
                """
                MATCH (t:Topic {organizationId: $org_id})
                WHERE t.lastSeen > $cutoff_date
                OPTIONAL MATCH (t)<-[:RELATED_TO]-(d:Decision)
                WHERE d.createdAt > $cutoff_date
                WITH t, count(d) as decision_count
                RETURN count(t) as total_topics,
                       sum(CASE WHEN decision_count = 0 THEN 1 ELSE 0 END) as topics_without_decisions
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            # Get communication bottlenecks (contacts with high betweenness)
            bottlenecks_result = await self._graph.query(
                """
                MATCH (c:Contact {organizationId: $org_id})
                WHERE c.betweennessScore > 0.5
                RETURN c.name as name, c.email as email
                LIMIT 5
                """,
                {"org_id": organization_id},
            )

            metrics = {}
            if result and len(result) > 0:
                row = result[0]
                metrics["active_topics"] = row.get("total_topics", 0) or 0
                metrics["topics_without_decisions"] = row.get("topics_without_decisions", 0) or 0

            metrics["bottlenecks"] = [
                r.get("name") or r.get("email")
                for r in (bottlenecks_result or [])
            ]

            return metrics

        except Exception as e:
            logger.warning("Communication analysis failed", error=str(e))

        return {}

    async def _analyze_risks(
        self, organization_id: str, days: int
    ) -> dict[str, Any]:
        """Analyze risk patterns."""
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (r:Risk {organizationId: $org_id})
                WHERE r.createdAt > $cutoff_date
                WITH r,
                     CASE WHEN r.status = 'open' THEN 1 ELSE 0 END as open_risk,
                     CASE WHEN r.status = 'ignored' THEN 1 ELSE 0 END as ignored_risk,
                     CASE WHEN r.status IN ['mitigated', 'resolved', 'closed'] THEN 1 ELSE 0 END as mitigated_risk
                RETURN count(r) as total,
                       sum(open_risk) as open_count,
                       sum(ignored_risk) as ignored_count,
                       sum(mitigated_risk) as mitigated_count,
                       collect(DISTINCT r.riskType) as risk_types
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            if result and len(result) > 0:
                row = result[0]
                total = row.get("total", 0) or 0
                return {
                    "total": total,
                    "open_count": row.get("open_count", 0) or 0,
                    "ignored_count": row.get("ignored_count", 0) or 0,
                    "mitigated": row.get("mitigated_count", 0) or 0,
                    "recurring_types": row.get("risk_types", [])[:5],
                }
        except Exception as e:
            logger.warning("Risk analysis failed", error=str(e))

        return {"total": 0, "mitigated": 0}

    async def _detect_decision_vacuums(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect topics that are actively discussed but have no decisions."""
        blindspots = []
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (t:Topic {organizationId: $org_id})
                WHERE t.lastSeen > $cutoff_date
                OPTIONAL MATCH (t)<-[:RELATED_TO]-(d:Decision)
                WITH t, count(d) as decision_count
                WHERE decision_count = 0
                MATCH (t)<-[:MENTIONED_IN]-(ep:Episode)
                WHERE ep.referenceTime > $cutoff_date
                WITH t, count(ep) as mention_count
                WHERE mention_count >= 3
                RETURN t.id as id, t.name as name, mention_count
                ORDER BY mention_count DESC
                LIMIT 5
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            for row in (result or []):
                blindspots.append(
                    BlindspotIndicator(
                        id=f"dv_{row['id']}",
                        blindspot_type=BlindspotType.DECISION_VACUUM,
                        title=f"Decision vacuum: {row['name']}",
                        severity=BlindspotSeverity.MEDIUM,
                        description=f"Topic '{row['name']}' mentioned {row['mention_count']} times but has no recorded decisions",
                        affected_topics=[row["name"]],
                        suggested_action=f"Review discussions about '{row['name']}' and identify if any decisions are needed",
                        detected_at=datetime.now(timezone.utc),
                        metadata={"mention_count": row["mention_count"]},
                    )
                )

        except Exception as e:
            logger.warning("Decision vacuum detection failed", error=str(e))

        return blindspots

    async def _detect_responsibility_gaps(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect commitments without clear ownership."""
        blindspots = []
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Commitment {organizationId: $org_id})
                WHERE c.status IN ['pending', 'in_progress']
                AND c.debtorContactId IS NULL
                AND c.creditorContactId IS NULL
                AND c.createdAt > $cutoff_date
                RETURN c.id as id, c.title as title
                LIMIT 10
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            if result and len(result) > 3:
                blindspots.append(
                    BlindspotIndicator(
                        id=f"rg_{organization_id}",
                        blindspot_type=BlindspotType.RESPONSIBILITY_GAP,
                        title=f"Responsibility gap: {len(result)} unowned commitments",
                        severity=BlindspotSeverity.HIGH,
                        description=f"{len(result)} commitments have no assigned owner",
                        evidence_ids=[row["id"] for row in result],
                        suggested_action="Assign owners to unowned commitments to ensure accountability",
                        detected_at=datetime.now(timezone.utc),
                        metadata={"unowned_count": len(result)},
                    )
                )

        except Exception as e:
            logger.warning("Responsibility gap detection failed", error=str(e))

        return blindspots

    async def _detect_recurring_questions(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect questions that keep appearing without resolution."""
        blindspots = []
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Claim {organizationId: $org_id, type: 'question'})
                WHERE c.createdAt > $cutoff_date
                WITH c.normalizedText as question, count(c) as occurrences, collect(c.id) as claim_ids
                WHERE occurrences >= 3
                RETURN question, occurrences, claim_ids[0..5] as evidence
                ORDER BY occurrences DESC
                LIMIT 5
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            for row in (result or []):
                question_text = row.get("question", "")[:50]
                blindspots.append(
                    BlindspotIndicator(
                        id=f"rq_{hash(row['question']) % 10000}",
                        blindspot_type=BlindspotType.RECURRING_QUESTION,
                        title=f"Recurring question: {question_text}...",
                        severity=BlindspotSeverity.MEDIUM,
                        description=f"Question asked {row['occurrences']} times: '{row['question'][:100]}...'",
                        evidence_ids=row.get("evidence", []),
                        suggested_action="Document the answer to this recurring question or create a decision about it",
                        detected_at=datetime.now(timezone.utc),
                        metadata={"occurrences": row["occurrences"]},
                    )
                )

        except Exception as e:
            logger.warning("Recurring question detection failed", error=str(e))

        return blindspots

    async def _detect_ignored_risks(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect risks that were identified but not addressed."""
        blindspots = []
        # Risks open for more than 7 days
        cutoff_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (r:Risk {organizationId: $org_id})
                WHERE r.severity IN ['high', 'critical']
                AND r.status = 'open'
                AND r.createdAt < $cutoff_7d
                RETURN r.id as id, r.title as title, r.severity as severity, r.createdAt as created_at
                ORDER BY r.severity DESC, r.createdAt ASC
                LIMIT 5
                """,
                {"org_id": organization_id, "cutoff_7d": cutoff_7d},
            )

            now = datetime.now(timezone.utc)
            for row in (result or []):
                # Calculate days_open in Python
                created_at_str = row.get("created_at", "")
                try:
                    if created_at_str:
                        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        days_open = (now - created_at).days
                    else:
                        days_open = 7  # Default if no date
                except Exception:
                    days_open = 7

                blindspots.append(
                    BlindspotIndicator(
                        id=f"ir_{row['id']}",
                        blindspot_type=BlindspotType.IGNORED_RISK,
                        title=f"Ignored {row['severity']} risk: {row['title'][:40]}",
                        severity=BlindspotSeverity.CRITICAL if row["severity"] == "critical" else BlindspotSeverity.HIGH,
                        description=f"{row['severity'].upper()} risk '{row['title']}' open for {days_open} days",
                        evidence_ids=[row["id"]],
                        suggested_action=f"Address this {row['severity']} risk or document mitigation strategy",
                        detected_at=now,
                        metadata={"days_open": days_open, "severity": row["severity"]},
                    )
                )

        except Exception as e:
            logger.warning("Ignored risk detection failed", error=str(e))

        return blindspots

    async def _detect_communication_silos(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect information that's not reaching relevant stakeholders."""
        blindspots = []
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            # Find decisions where stakeholders weren't included in discussions
            result = await self._graph.query(
                """
                MATCH (d:Decision {organizationId: $org_id})
                WHERE d.createdAt > $cutoff_date
                AND size(d.stakeholderContactIds) > 0
                WITH d
                MATCH (d)-[:EXTRACTED_FROM]->(ep:Episode)
                MATCH (stakeholder:Contact)
                WHERE stakeholder.id IN d.stakeholderContactIds
                AND NOT (stakeholder)-[:MENTIONED_IN|PARTICIPATED_IN]->(ep)
                RETURN d.id as decision_id, d.title as decision_title,
                       collect(DISTINCT stakeholder.name) as uninformed_stakeholders
                LIMIT 5
                """,
                {"org_id": organization_id, "cutoff_date": cutoff_date},
            )

            for row in (result or []):
                uninformed = row.get("uninformed_stakeholders", [])
                if len(uninformed) > 0:
                    blindspots.append(
                        BlindspotIndicator(
                            id=f"cs_{row['decision_id']}",
                            blindspot_type=BlindspotType.COMMUNICATION_SILO,
                            title=f"Communication silo: {row['decision_title'][:40]}",
                            severity=BlindspotSeverity.MEDIUM,
                            description=f"Decision '{row['decision_title']}' has {len(uninformed)} stakeholders not in discussion",
                            evidence_ids=[row["decision_id"]],
                            affected_contacts=uninformed[:5],
                            suggested_action=f"Inform stakeholders: {', '.join(uninformed[:3])}",
                            detected_at=datetime.now(timezone.utc),
                        )
                    )

        except Exception as e:
            logger.warning("Communication silo detection failed", error=str(e))

        return blindspots

    async def _detect_overcommitment(
        self, organization_id: str, metrics: dict
    ) -> list[BlindspotIndicator]:
        """Detect if organization is overcommitted."""
        blindspots = []

        overcommitment_score = metrics.get("overcommitment_score", 0)
        if overcommitment_score > 2.0:
            severity = BlindspotSeverity.CRITICAL if overcommitment_score > 4.0 else BlindspotSeverity.HIGH
            blindspots.append(
                BlindspotIndicator(
                    id=f"oc_{organization_id}",
                    blindspot_type=BlindspotType.OVERCOMMITMENT,
                    title=f"Overcommitment: {overcommitment_score:.1f}x capacity",
                    severity=severity,
                    description=f"Organization has {overcommitment_score:.1f}x more active commitments than completed ones",
                    suggested_action="Review and prioritize commitments. Consider declining new commitments.",
                    detected_at=datetime.now(timezone.utc),
                    metadata={"overcommitment_score": overcommitment_score},
                )
            )

        return blindspots

    async def _detect_stale_commitments(
        self, organization_id: str, days: int
    ) -> list[BlindspotIndicator]:
        """Detect commitments without recent progress."""
        blindspots = []
        cutoff_14d = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Commitment {organizationId: $org_id})
                WHERE c.status IN ['pending', 'in_progress']
                AND c.updatedAt < $cutoff_14d
                RETURN c.id as id, c.title as title, c.updatedAt as updated_at
                ORDER BY c.updatedAt ASC
                LIMIT 5
                """,
                {"org_id": organization_id, "cutoff_14d": cutoff_14d},
            )

            stale_count = len(result or [])
            if stale_count >= 3:
                blindspots.append(
                    BlindspotIndicator(
                        id=f"sc_{organization_id}",
                        blindspot_type=BlindspotType.STALE_COMMITMENT,
                        title=f"Stale commitments: {stale_count} without updates",
                        severity=BlindspotSeverity.MEDIUM,
                        description=f"{stale_count} commitments have no updates in 14+ days",
                        evidence_ids=[row["id"] for row in (result or [])],
                        suggested_action="Review stale commitments and update status or close if no longer relevant",
                        detected_at=datetime.now(timezone.utc),
                        metadata={"stale_count": stale_count},
                    )
                )

        except Exception as e:
            logger.warning("Stale commitment detection failed", error=str(e))

        return blindspots

    async def dismiss_blindspot(
        self,
        organization_id: str,
        blindspot_id: str,
        reason: str,
    ) -> bool:
        """
        Dismiss a blindspot with feedback.

        Args:
            organization_id: Organization ID
            blindspot_id: ID of the blindspot to dismiss
            reason: Reason for dismissal

        Returns:
            True if dismissed successfully, False otherwise
        """
        await self._ensure_graph()

        logger.info(
            "Dismissing blindspot",
            organization_id=organization_id,
            blindspot_id=blindspot_id,
            reason=reason,
        )

        # In a full implementation, we'd store the dismissal
        # and learn from the feedback to improve detection
        # For now, we just log it and return success
        try:
            # Store dismissal in graph (optional - can be added later)
            # await self._graph.query(...)
            return True
        except Exception as e:
            logger.error("Failed to dismiss blindspot", error=str(e))
            return False


# Singleton instance
_blindspot_service: BlindspotDetectionService | None = None


async def get_blindspot_service() -> BlindspotDetectionService:
    """Get or create the blindspot detection service."""
    global _blindspot_service
    if _blindspot_service is None:
        _blindspot_service = BlindspotDetectionService()
    return _blindspot_service


# Alias for backwards compatibility
async def get_blindspot_detection_service() -> BlindspotDetectionService:
    """Alias for get_blindspot_service."""
    return await get_blindspot_service()
