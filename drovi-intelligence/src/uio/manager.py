"""
UIO Manager

Manages the lifecycle of Universal Intelligence Objects (UIOs) across
PostgreSQL, FalkorDB, and Graphiti stores.

UIOs are the core abstraction for all extracted intelligence:
- Commitments
- Decisions
- Tasks
- Claims
- Risks
- Briefs

Each UIO follows a complete lifecycle:
draft → active → in_progress → completed/cancelled → archived

This manager provides:
- Tri-store synchronization (PostgreSQL + FalkorDB + Graphiti)
- Type-specific extension table creation
- Source linkage and evidence tracking
"""

from datetime import datetime
import json
from typing import Literal
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.db import get_db_session
from src.graph.client import get_graph_client
from src.graph.evolution import MemoryEvolution, SupersessionReason
from src.graph.types import GraphNodeType
from src.memory.graphiti_memory import get_graphiti_memory
from src.orchestrator.state import UIOStatus
from src.db.client import get_db_session

from .schemas import (
    BriefDetailsCreate,
    ClaimDetailsCreate,
    CommitmentDetailsCreate,
    CreateBriefUIO,
    CreateClaimUIO,
    CreateCommitmentUIO,
    CreateDecisionUIO,
    CreateRiskUIO,
    CreateTaskUIO,
    DecisionDetailsCreate,
    RiskDetailsCreate,
    SourceContext,
    TaskDetailsCreate,
    UIOCreate,
    UIOType as UIOTypeEnum,
)

logger = structlog.get_logger()

UIOType = Literal["commitment", "decision", "task", "claim", "risk", "brief"]


class UIOManager:
    """
    Manages UIO lifecycle across all stores.

    Responsibilities:
    - Create UIOs with proper initial state
    - Update UIO status with validation
    - Handle user corrections
    - Merge duplicate UIOs
    - Sync across PostgreSQL, FalkorDB, and Graphiti
    """

    def __init__(self, organization_id: str):
        self.organization_id = organization_id
        self._graph = None
        self._memory = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def _get_memory(self):
        """Lazy load Graphiti memory."""
        if self._memory is None:
            self._memory = await get_graphiti_memory(self.organization_id)
        return self._memory

    # =========================================================================
    # Create UIOs
    # =========================================================================

    async def create_uio(
        self,
        uio_type: UIOType,
        data: dict,
        source_type: str,
        source_id: str | None = None,
        episode_id: str | None = None,
        confidence: float = 0.0,
    ) -> str:
        """
        Create a new UIO with proper lifecycle initialization.

        The UIO is created in DRAFT status and requires review
        before becoming active.

        Args:
            uio_type: Type of UIO (commitment, decision, task, claim, risk)
            data: UIO-specific data (title, description, etc.)
            source_type: Source of extraction (email, slack, etc.)
            source_id: Optional source identifier
            episode_id: Optional Graphiti episode ID
            confidence: Extraction confidence score

        Returns:
            The created UIO ID
        """
        graph = await self._get_graph()

        uio_id = str(uuid4())
        now = datetime.utcnow()

        logger.info(
            "Creating UIO",
            organization_id=self.organization_id,
            uio_type=uio_type,
            uio_id=uio_id,
        )

        # Build node properties
        node_props = {
            "id": uio_id,
            "organizationId": self.organization_id,
            "status": UIOStatus.DRAFT.value,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
            "sourceType": source_type,
            "sourceId": source_id,
            "episodeId": episode_id,
            "confidence": confidence,
            "needsReview": True,
            "userCorrected": False,
            **self._sanitize_properties(data),
        }

        # Determine label based on type
        label_map = {
            "commitment": "Commitment",
            "decision": "Decision",
            "task": "Task",
            "claim": "Claim",
            "risk": "Risk",
        }
        label = label_map.get(uio_type, "UIO")

        # Create node in FalkorDB
        try:
            # FalkorDB doesn't support $props directly - use explicit properties
            props_clause, props_params = graph.build_create_properties(node_props)
            await graph.query(
                f"""
                CREATE (u:UIO:{label} {{{props_clause}}})
                """,
                props_params,
            )

            # Link to episode if provided
            if episode_id:
                await graph.query(
                    """
                    MATCH (u:UIO {id: $uioId})
                    MATCH (e:Episode {id: $episodeId})
                    CREATE (u)-[:EXTRACTED_FROM]->(e)
                    """,
                    {"uioId": uio_id, "episodeId": episode_id},
                )

            logger.info(
                "UIO created in FalkorDB",
                uio_id=uio_id,
                uio_type=uio_type,
            )

        except Exception as e:
            logger.error(
                "Failed to create UIO in FalkorDB",
                uio_id=uio_id,
                error=str(e),
            )
            raise

        return uio_id

    # =========================================================================
    # Create UIOs with Extension Details (PostgreSQL + FalkorDB)
    # =========================================================================

    async def create_commitment_uio(
        self,
        request: CreateCommitmentUIO,
    ) -> str:
        """
        Create a commitment UIO with full details.

        Creates records in:
        1. PostgreSQL: unified_intelligence_object + uio_commitment_details
        2. FalkorDB: UIO:Commitment node
        3. Links source context

        Returns:
            The created UIO ID
        """
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating commitment UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        # Create in PostgreSQL
        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        due_date, due_date_confidence,
                        owner_contact_id, participant_contact_ids,
                        overall_confidence, first_seen_at, last_updated_at,
                        is_user_verified, is_user_dismissed,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'commitment', :status,
                        :canonical_title, :canonical_description,
                        :due_date, :due_date_confidence,
                        :owner_contact_id, :participant_contact_ids,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :is_user_verified, :is_user_dismissed,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.base.canonical_description,
                    "due_date": request.base.due_date,
                    "due_date_confidence": request.base.due_date_confidence,
                    "owner_contact_id": request.base.owner_contact_id,
                    "participant_contact_ids": request.base.participant_contact_ids,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "is_user_verified": request.base.is_user_verified,
                    "is_user_dismissed": request.base.is_user_dismissed,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create commitment details
            import json
            extraction_context_json = None
            if request.details.extraction_context:
                extraction_context_json = json.dumps(request.details.extraction_context.model_dump())

            await session.execute(
                text("""
                    INSERT INTO uio_commitment_details (
                        id, uio_id,
                        direction, debtor_contact_id, creditor_contact_id,
                        due_date_source, due_date_original_text,
                        priority, status,
                        is_conditional, condition,
                        completed_at, completed_via, snoozed_until,
                        supersedes_uio_id, superseded_by_uio_id,
                        extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :direction, :debtor_contact_id, :creditor_contact_id,
                        :due_date_source, :due_date_original_text,
                        :priority, :status,
                        :is_conditional, :condition,
                        :completed_at, :completed_via, :snoozed_until,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :extraction_context::jsonb,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "direction": request.details.direction.value,
                    "debtor_contact_id": request.details.debtor_contact_id,
                    "creditor_contact_id": request.details.creditor_contact_id,
                    "due_date_source": request.details.due_date_source,
                    "due_date_original_text": request.details.due_date_original_text,
                    "priority": request.details.priority.value,
                    "status": request.details.status.value,
                    "is_conditional": request.details.is_conditional,
                    "condition": request.details.condition,
                    "completed_at": request.details.completed_at,
                    "completed_via": request.details.completed_via,
                    "snoozed_until": request.details.snoozed_until,
                    "supersedes_uio_id": request.details.supersedes_uio_id,
                    "superseded_by_uio_id": request.details.superseded_by_uio_id,
                    "extraction_context": extraction_context_json,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            if request.details.supersedes_uio_id:
                await self._mark_superseded_uio(
                    session=session,
                    supersedes_uio_id=request.details.supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="commitment",
                    source=request.source,
                    confidence=request.base.overall_confidence,
                    now=now,
                )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="commitment",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="commitment",
            data={
                "title": request.base.canonical_title,
                "description": request.base.canonical_description,
                "direction": request.details.direction.value,
                "priority": request.details.priority.value,
                "status": request.details.status.value,
                "dueDate": request.base.due_date.isoformat() if request.base.due_date else None,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Commitment UIO created", uio_id=uio_id)
        return uio_id

    async def create_decision_uio(
        self,
        request: CreateDecisionUIO,
    ) -> str:
        """Create a decision UIO with full details."""
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating decision UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        owner_contact_id, participant_contact_ids,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'decision', :status,
                        :canonical_title, :canonical_description,
                        :owner_contact_id, :participant_contact_ids,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.base.canonical_description,
                    "owner_contact_id": request.details.decision_maker_contact_id,
                    "participant_contact_ids": request.details.stakeholder_contact_ids,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create decision details
            import json
            alternatives_json = None
            if request.details.alternatives:
                alternatives_json = json.dumps([a.model_dump() for a in request.details.alternatives])

            extraction_context_json = None
            if request.details.extraction_context:
                extraction_context_json = json.dumps(request.details.extraction_context.model_dump())

            await session.execute(
                text("""
                    INSERT INTO uio_decision_details (
                        id, uio_id,
                        statement, rationale, alternatives,
                        decision_maker_contact_id, stakeholder_contact_ids, impact_areas,
                        status, decided_at,
                        supersedes_uio_id, superseded_by_uio_id,
                        extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :statement, :rationale, :alternatives::jsonb,
                        :decision_maker_contact_id, :stakeholder_contact_ids, :impact_areas,
                        :status, :decided_at,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :extraction_context::jsonb,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "statement": request.details.statement,
                    "rationale": request.details.rationale,
                    "alternatives": alternatives_json,
                    "decision_maker_contact_id": request.details.decision_maker_contact_id,
                    "stakeholder_contact_ids": request.details.stakeholder_contact_ids,
                    "impact_areas": request.details.impact_areas,
                    "status": request.details.status.value,
                    "decided_at": request.details.decided_at or now,
                    "supersedes_uio_id": request.details.supersedes_uio_id,
                    "superseded_by_uio_id": request.details.superseded_by_uio_id,
                    "extraction_context": extraction_context_json,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            if request.details.supersedes_uio_id:
                await self._mark_superseded_uio(
                    session=session,
                    supersedes_uio_id=request.details.supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="decision",
                    source=request.source,
                    confidence=request.base.overall_confidence,
                    now=now,
                )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="decision",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="decision",
            data={
                "title": request.base.canonical_title,
                "statement": request.details.statement,
                "rationale": request.details.rationale,
                "status": request.details.status.value,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Decision UIO created", uio_id=uio_id)
        return uio_id

    async def create_claim_uio(
        self,
        request: CreateClaimUIO,
    ) -> str:
        """Create a claim UIO with full details."""
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating claim UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'claim', :status,
                        :canonical_title, :canonical_description,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.base.canonical_description,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create claim details
            import json
            extraction_context_json = None
            if request.details.extraction_context:
                extraction_context_json = json.dumps(request.details.extraction_context.model_dump())

            await session.execute(
                text("""
                    INSERT INTO uio_claim_details (
                        id, uio_id,
                        claim_type, quoted_text, quoted_text_start, quoted_text_end,
                        normalized_text, importance, source_message_index,
                        extraction_context,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :claim_type, :quoted_text, :quoted_text_start, :quoted_text_end,
                        :normalized_text, :importance, :source_message_index,
                        :extraction_context::jsonb,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "claim_type": request.details.claim_type.value,
                    "quoted_text": request.details.quoted_text,
                    "quoted_text_start": request.details.quoted_text_start,
                    "quoted_text_end": request.details.quoted_text_end,
                    "normalized_text": request.details.normalized_text,
                    "importance": request.details.importance.value,
                    "source_message_index": request.details.source_message_index,
                    "extraction_context": extraction_context_json,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="claim",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="claim",
            data={
                "title": request.base.canonical_title,
                "claimType": request.details.claim_type.value,
                "importance": request.details.importance.value,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Claim UIO created", uio_id=uio_id)
        return uio_id

    async def create_task_uio(
        self,
        request: CreateTaskUIO,
    ) -> str:
        """Create a task UIO with full details."""
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating task UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        due_date, owner_contact_id,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'task', :status,
                        :canonical_title, :canonical_description,
                        :due_date, :owner_contact_id,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.base.canonical_description,
                    "due_date": request.base.due_date,
                    "owner_contact_id": request.details.assignee_contact_id,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create task details
            import json
            user_overrides_json = None
            if request.details.user_overrides:
                user_overrides_json = json.dumps(request.details.user_overrides.model_dump())

            await session.execute(
                text("""
                    INSERT INTO uio_task_details (
                        id, uio_id,
                        status, priority,
                        assignee_contact_id, created_by_contact_id,
                        estimated_effort, completed_at,
                        depends_on_uio_ids, blocks_uio_ids,
                        parent_task_uio_id, commitment_uio_id,
                        project, tags, user_overrides,
                        supersedes_uio_id, superseded_by_uio_id,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :status, :priority,
                        :assignee_contact_id, :created_by_contact_id,
                        :estimated_effort, :completed_at,
                        :depends_on_uio_ids, :blocks_uio_ids,
                        :parent_task_uio_id, :commitment_uio_id,
                        :project, :tags, :user_overrides::jsonb,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "status": request.details.status.value,
                    "priority": request.details.priority.value,
                    "assignee_contact_id": request.details.assignee_contact_id,
                    "created_by_contact_id": request.details.created_by_contact_id,
                    "estimated_effort": request.details.estimated_effort,
                    "completed_at": request.details.completed_at,
                    "depends_on_uio_ids": request.details.depends_on_uio_ids,
                    "blocks_uio_ids": request.details.blocks_uio_ids,
                    "parent_task_uio_id": request.details.parent_task_uio_id,
                    "commitment_uio_id": request.details.commitment_uio_id,
                    "project": request.details.project,
                    "tags": request.details.tags,
                    "user_overrides": user_overrides_json,
                    "supersedes_uio_id": request.details.supersedes_uio_id,
                    "superseded_by_uio_id": request.details.superseded_by_uio_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            if request.details.supersedes_uio_id:
                await self._mark_superseded_uio(
                    session=session,
                    supersedes_uio_id=request.details.supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="task",
                    source=request.source,
                    confidence=request.base.overall_confidence,
                    now=now,
                )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="task",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="task",
            data={
                "title": request.base.canonical_title,
                "description": request.base.canonical_description,
                "status": request.details.status.value,
                "priority": request.details.priority.value,
                "project": request.details.project,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Task UIO created", uio_id=uio_id)
        return uio_id

    async def create_risk_uio(
        self,
        request: CreateRiskUIO,
    ) -> str:
        """Create a risk UIO with full details."""
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating risk UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'risk', :status,
                        :canonical_title, :canonical_description,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.base.canonical_description,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create risk details
            import json
            findings_json = None
            if request.details.findings:
                findings_json = json.dumps(request.details.findings.model_dump())

            extraction_context_json = None
            if request.details.extraction_context:
                extraction_context_json = json.dumps(request.details.extraction_context.model_dump())

            await session.execute(
                text("""
                    INSERT INTO uio_risk_details (
                        id, uio_id,
                        risk_type, severity,
                        related_commitment_uio_ids, related_decision_uio_ids,
                        suggested_action, findings, extraction_context,
                        supersedes_uio_id, superseded_by_uio_id,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :risk_type, :severity,
                        :related_commitment_uio_ids, :related_decision_uio_ids,
                        :suggested_action, :findings::jsonb, :extraction_context::jsonb,
                        :supersedes_uio_id, :superseded_by_uio_id,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "risk_type": request.details.risk_type.value,
                    "severity": request.details.severity.value,
                    "related_commitment_uio_ids": request.details.related_commitment_uio_ids,
                    "related_decision_uio_ids": request.details.related_decision_uio_ids,
                    "suggested_action": request.details.suggested_action,
                    "findings": findings_json,
                    "extraction_context": extraction_context_json,
                    "supersedes_uio_id": request.details.supersedes_uio_id,
                    "superseded_by_uio_id": request.details.superseded_by_uio_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            if request.details.supersedes_uio_id:
                await self._mark_superseded_uio(
                    session=session,
                    supersedes_uio_id=request.details.supersedes_uio_id,
                    new_uio_id=uio_id,
                    uio_type="risk",
                    source=request.source,
                    confidence=request.base.overall_confidence,
                    now=now,
                )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="risk",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="risk",
            data={
                "title": request.base.canonical_title,
                "riskType": request.details.risk_type.value,
                "severity": request.details.severity.value,
                "suggestedAction": request.details.suggested_action,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Risk UIO created", uio_id=uio_id)
        return uio_id

    async def create_brief_uio(
        self,
        request: CreateBriefUIO,
    ) -> str:
        """Create a brief UIO with full details."""
        uio_id = request.base.id
        now = datetime.utcnow()

        logger.info(
            "Creating brief UIO",
            organization_id=request.base.organization_id,
            uio_id=uio_id,
        )

        async with get_db_session() as session:
            # 1. Create base UIO
            await session.execute(
                text("""
                    INSERT INTO unified_intelligence_object (
                        id, organization_id, type, status,
                        canonical_title, canonical_description,
                        overall_confidence, first_seen_at, last_updated_at,
                        valid_from, valid_to, system_from, system_to,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, 'brief', :status,
                        :canonical_title, :canonical_description,
                        :overall_confidence, :first_seen_at, :last_updated_at,
                        :valid_from, :valid_to, :system_from, :system_to,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": uio_id,
                    "organization_id": request.base.organization_id,
                    "status": request.base.status.value,
                    "canonical_title": request.base.canonical_title,
                    "canonical_description": request.details.summary,
                    "overall_confidence": request.base.overall_confidence,
                    "first_seen_at": request.base.first_seen_at,
                    "last_updated_at": request.base.last_updated_at,
                    "valid_from": now,
                    "valid_to": None,
                    "system_from": now,
                    "system_to": None,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 2. Create brief details
            import json
            open_loops_json = None
            if request.details.open_loops:
                open_loops_json = json.dumps([ol.model_dump() for ol in request.details.open_loops])

            await session.execute(
                text("""
                    INSERT INTO uio_brief_details (
                        id, uio_id,
                        summary, suggested_action, action_reasoning,
                        open_loops, priority_tier,
                        urgency_score, importance_score, sentiment_score,
                        intent_classification, conversation_id,
                        created_at, updated_at
                    ) VALUES (
                        :id, :uio_id,
                        :summary, :suggested_action, :action_reasoning,
                        :open_loops::jsonb, :priority_tier,
                        :urgency_score, :importance_score, :sentiment_score,
                        :intent_classification, :conversation_id,
                        :created_at, :updated_at
                    )
                """),
                {
                    "id": str(uuid4()),
                    "uio_id": uio_id,
                    "summary": request.details.summary,
                    "suggested_action": request.details.suggested_action.value,
                    "action_reasoning": request.details.action_reasoning,
                    "open_loops": open_loops_json,
                    "priority_tier": request.details.priority_tier.value,
                    "urgency_score": request.details.urgency_score,
                    "importance_score": request.details.importance_score,
                    "sentiment_score": request.details.sentiment_score,
                    "intent_classification": request.details.intent_classification,
                    "conversation_id": request.details.conversation_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )

            # 3. Create source linkage
            await self._create_source_linkage(session, uio_id, request.source, now)

            # 4. Record timeline creation event
            await self._record_uio_timeline(
                session,
                uio_id=uio_id,
                uio_type="brief",
                title=request.base.canonical_title,
                description=request.base.canonical_description,
                source=request.source,
                confidence=request.base.overall_confidence,
                now=now,
            )

        # 4. Sync to FalkorDB
        await self._sync_to_falkordb(
            uio_id=uio_id,
            uio_type="brief",
            data={
                "title": request.base.canonical_title,
                "summary": request.details.summary,
                "suggestedAction": request.details.suggested_action.value,
                "priorityTier": request.details.priority_tier.value,
                "urgencyScore": request.details.urgency_score,
                "importanceScore": request.details.importance_score,
                "confidence": request.base.overall_confidence,
            },
            source_type=request.source.source_type,
            confidence=request.source.confidence,
            valid_from=now,
            system_from=now,
        )

        logger.info("Brief UIO created", uio_id=uio_id)
        return uio_id

    async def _create_source_linkage(
        self,
        session,
        uio_id: str,
        source: SourceContext,
        now: datetime,
    ) -> None:
        """Create a source linkage record for a UIO."""
        await session.execute(
            text("""
                INSERT INTO unified_object_source (
                    id, unified_object_id,
                    source_type, source_account_id,
                    role, conversation_id, message_id,
                    quoted_text, quoted_text_start, quoted_text_end, segment_hash,
                    confidence, added_at, source_timestamp,
                    created_at
                ) VALUES (
                    :id, :unified_object_id,
                    :source_type, :source_account_id,
                    'origin', :conversation_id, :message_id,
                    :quoted_text, :quoted_text_start, :quoted_text_end, :segment_hash,
                    :confidence, :added_at, :source_timestamp,
                    :created_at
                )
            """),
            {
                "id": str(uuid4()),
                "unified_object_id": uio_id,
                "source_type": source.source_type,
                "source_account_id": source.source_account_id,
                "conversation_id": source.conversation_id,
                "message_id": source.message_id,
                "quoted_text": source.quoted_text,
                "quoted_text_start": source.quoted_text_start,
                "quoted_text_end": source.quoted_text_end,
                "segment_hash": source.segment_hash,
                "confidence": source.confidence,
                "added_at": now,
                "source_timestamp": now,
                "created_at": now,
            },
        )

    async def _record_uio_timeline(
        self,
        session,
        uio_id: str,
        uio_type: str,
        title: str | None,
        description: str | None,
        source: SourceContext,
        confidence: float | None,
        now: datetime,
    ) -> None:
        """Record a creation event in the UIO timeline."""
        new_value = {
            "type": uio_type,
            "title": title,
            "description": description,
        }
        await session.execute(
            text(
                """
                INSERT INTO unified_object_timeline (
                    id, unified_object_id,
                    event_type, event_description,
                    previous_value, new_value,
                    source_type, source_id, source_name,
                    message_id, quoted_text,
                    triggered_by, confidence, event_at
                ) VALUES (
                    :id, :unified_object_id,
                    :event_type, :event_description,
                    :previous_value, :new_value,
                    :source_type, :source_id, :source_name,
                    :message_id, :quoted_text,
                    :triggered_by, :confidence, :event_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "unified_object_id": uio_id,
                "event_type": "created",
                "event_description": f"Created {uio_type} from {source.source_type}",
                "previous_value": None,
                "new_value": json.dumps(new_value),
                "source_type": source.source_type,
                "source_id": source.conversation_id,
                "source_name": None,
                "message_id": source.message_id,
                "quoted_text": source.quoted_text,
                "triggered_by": "system",
                "confidence": confidence,
                "event_at": now,
            },
        )

    async def _mark_superseded_uio(
        self,
        session,
        supersedes_uio_id: str,
        new_uio_id: str,
        uio_type: str,
        source: SourceContext,
        confidence: float | None,
        now: datetime,
    ) -> None:
        """Mark a UIO as superseded in Postgres + Graph."""
        await session.execute(
            text(
                """
                UPDATE unified_intelligence_object
                SET valid_to = :now,
                    system_to = :now,
                    updated_at = :now
                WHERE id = :supersedes_id
                  AND organization_id = :org_id
                """
            ),
            {
                "now": now,
                "supersedes_id": supersedes_uio_id,
                "org_id": self.organization_id,
            },
        )

        await session.execute(
            text(
                """
                INSERT INTO unified_object_timeline (
                    id, unified_object_id,
                    event_type, event_description,
                    previous_value, new_value,
                    source_type, source_id, source_name,
                    message_id, quoted_text,
                    triggered_by, confidence, event_at
                ) VALUES (
                    :id, :unified_object_id,
                    :event_type, :event_description,
                    :previous_value, :new_value,
                    :source_type, :source_id, :source_name,
                    :message_id, :quoted_text,
                    :triggered_by, :confidence, :event_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "unified_object_id": supersedes_uio_id,
                "event_type": "superseded",
                "event_description": f"Superseded by {uio_type} {new_uio_id}",
                "previous_value": None,
                "new_value": None,
                "source_type": source.source_type,
                "source_id": source.conversation_id,
                "source_name": None,
                "message_id": source.message_id,
                "quoted_text": source.quoted_text,
                "triggered_by": new_uio_id,
                "confidence": confidence,
                "event_at": now,
            },
        )

        try:
            graph = await self._get_graph()
            evolution = MemoryEvolution(graph)
            node_type_map = {
                "commitment": GraphNodeType.COMMITMENT,
                "decision": GraphNodeType.DECISION,
                "task": GraphNodeType.TASK,
                "risk": GraphNodeType.RISK,
                "claim": GraphNodeType.CLAIM,
                "brief": GraphNodeType.UIO,
            }
            node_type = node_type_map.get(uio_type, GraphNodeType.UIO)
            await evolution.supersede_node(
                old_node_id=supersedes_uio_id,
                new_node_id=new_uio_id,
                node_type=node_type,
                reason=SupersessionReason.UPDATED,
                metadata={"sourceType": source.source_type},
            )
        except Exception as exc:
            logger.warning("Graph supersession failed", error=str(exc))

    async def _sync_to_falkordb(
        self,
        uio_id: str,
        uio_type: str,
        data: dict,
        source_type: str,
        confidence: float,
        valid_from: datetime | None = None,
        valid_to: datetime | None = None,
        system_from: datetime | None = None,
        system_to: datetime | None = None,
    ) -> None:
        """Sync a UIO to FalkorDB."""
        try:
            graph = await self._get_graph()

            node_props = {
                "id": uio_id,
                "organizationId": self.organization_id,
                "status": UIOStatus.ACTIVE.value,
                "createdAt": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
                "validFrom": (valid_from or datetime.utcnow()).isoformat(),
                "validTo": valid_to.isoformat() if valid_to else None,
                "systemFrom": (system_from or datetime.utcnow()).isoformat(),
                "systemTo": system_to.isoformat() if system_to else None,
                "sourceType": source_type,
                "confidence": confidence,
                "needsReview": False,
                "userCorrected": False,
                **self._sanitize_properties(data),
            }

            label_map = {
                "commitment": "Commitment",
                "decision": "Decision",
                "task": "Task",
                "claim": "Claim",
                "risk": "Risk",
                "brief": "Brief",
            }
            label = label_map.get(uio_type, "UIO")

            props_clause, props_params = graph.build_create_properties(node_props)
            await graph.query(
                f"""
                CREATE (u:UIO:{label} {{{props_clause}}})
                """,
                props_params,
            )

            logger.debug(
                "UIO synced to FalkorDB",
                uio_id=uio_id,
                uio_type=uio_type,
            )

        except Exception as e:
            logger.warning(
                "Failed to sync UIO to FalkorDB",
                uio_id=uio_id,
                error=str(e),
            )
            # Don't fail the whole operation - PostgreSQL is primary

    # =========================================================================
    # Update UIO Status
    # =========================================================================

    async def update_status(
        self,
        uio_id: str,
        new_status: UIOStatus,
        user_id: str | None = None,
    ) -> bool:
        """
        Update UIO status with validation.

        Valid transitions:
        - draft → active, cancelled
        - active → in_progress, completed, cancelled
        - in_progress → completed, cancelled, active
        - completed → archived
        - cancelled → archived

        Args:
            uio_id: UIO ID
            new_status: New status
            user_id: User making the change (for audit)

        Returns:
            True if status was updated
        """
        graph = await self._get_graph()

        # Get current status
        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN u.status as status
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if not result:
            logger.warning(
                "UIO not found for status update",
                uio_id=uio_id,
            )
            return False

        current_status = UIOStatus(result[0].get("status", "draft"))

        # Validate transition
        if not self._is_valid_transition(current_status, new_status):
            logger.warning(
                "Invalid status transition",
                uio_id=uio_id,
                from_status=current_status.value,
                to_status=new_status.value,
            )
            return False

        now = datetime.utcnow()

        # Build update properties
        update_props = {
            "status": new_status.value,
            "updatedAt": now.isoformat(),
            "statusChangedAt": now.isoformat(),
        }

        # Set completed_at if completing
        if new_status in (UIOStatus.COMPLETED, UIOStatus.CANCELLED):
            update_props["completedAt"] = now.isoformat()

        # Set reviewed info if activating from draft
        if current_status == UIOStatus.DRAFT and new_status == UIOStatus.ACTIVE:
            update_props["needsReview"] = False
            if user_id:
                update_props["reviewedBy"] = user_id
                update_props["reviewedAt"] = now.isoformat()

        # Update in FalkorDB
        try:
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", update_props)
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $id, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            logger.info(
                "UIO status updated",
                uio_id=uio_id,
                from_status=current_status.value,
                to_status=new_status.value,
            )

            # Update PostgreSQL + timeline
            async with get_db_session() as session:
                await session.execute(
                    text(
                        """
                        UPDATE unified_intelligence_object
                        SET status = :status,
                            updated_at = :now
                        WHERE id = :id
                          AND organization_id = :org_id
                        """
                    ),
                    {
                        "status": new_status.value,
                        "now": now,
                        "id": uio_id,
                        "org_id": self.organization_id,
                    },
                )

                await session.execute(
                    text(
                        """
                        INSERT INTO unified_object_timeline (
                            id, unified_object_id,
                            event_type, event_description,
                            previous_value, new_value,
                            source_type, source_id, source_name,
                            message_id, quoted_text,
                            triggered_by, confidence, event_at
                        ) VALUES (
                            :id, :unified_object_id,
                            :event_type, :event_description,
                            :previous_value, :new_value,
                            :source_type, :source_id, :source_name,
                            :message_id, :quoted_text,
                            :triggered_by, :confidence, :event_at
                        )
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "unified_object_id": uio_id,
                        "event_type": "status_changed",
                        "event_description": f"Status changed from {current_status.value} to {new_status.value}",
                        "previous_value": json.dumps({"status": current_status.value}),
                        "new_value": json.dumps({"status": new_status.value}),
                        "source_type": "system",
                        "source_id": None,
                        "source_name": None,
                        "message_id": None,
                        "quoted_text": None,
                        "triggered_by": user_id or "system",
                        "confidence": None,
                        "event_at": now,
                    },
                )

            # Create status change episode in memory
            try:
                memory = await self._get_memory()
                await memory.add_episode(
                    name=f"UIO Status Change: {new_status.value}",
                    content=f"UIO {uio_id} status changed from {current_status.value} to {new_status.value}",
                    source_type="system",
                    reference_time=now,
                )
            except Exception as e:
                logger.warning(
                    "Failed to create status change episode",
                    error=str(e),
                )

            return True

        except Exception as e:
            logger.error(
                "Failed to update UIO status",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    def _is_valid_transition(
        self,
        from_status: UIOStatus,
        to_status: UIOStatus,
    ) -> bool:
        """Check if status transition is valid."""
        valid_transitions = {
            UIOStatus.DRAFT: [UIOStatus.ACTIVE, UIOStatus.CANCELLED],
            UIOStatus.ACTIVE: [UIOStatus.IN_PROGRESS, UIOStatus.COMPLETED, UIOStatus.CANCELLED],
            UIOStatus.IN_PROGRESS: [UIOStatus.COMPLETED, UIOStatus.CANCELLED, UIOStatus.ACTIVE],
            UIOStatus.COMPLETED: [UIOStatus.ARCHIVED],
            UIOStatus.CANCELLED: [UIOStatus.ARCHIVED],
            UIOStatus.ARCHIVED: [],  # No transitions from archived
        }

        return to_status in valid_transitions.get(from_status, [])

    # =========================================================================
    # User Corrections
    # =========================================================================

    async def apply_correction(
        self,
        uio_id: str,
        corrections: dict,
        user_id: str,
    ) -> bool:
        """
        Apply user corrections to a UIO.

        Stores the original extraction for training data and marks
        the UIO as user-corrected.

        Args:
            uio_id: UIO ID
            corrections: Dict of field corrections
            user_id: User making the correction

        Returns:
            True if correction was applied
        """
        graph = await self._get_graph()

        # Get current UIO data
        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN properties(u) as props
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if not result:
            logger.warning(
                "UIO not found for correction",
                uio_id=uio_id,
            )
            return False

        current_props = result[0].get("props", {})
        now = datetime.utcnow()

        # Store original if not already corrected
        original_extraction = None
        if not current_props.get("userCorrected"):
            # Store original values for the corrected fields
            original_extraction = {
                k: current_props.get(k)
                for k in corrections.keys()
                if k in current_props
            }

        # Build update
        update_props = {
            **self._sanitize_properties(corrections),
            "updatedAt": now.isoformat(),
            "userCorrected": True,
            "reviewedBy": user_id,
            "reviewedAt": now.isoformat(),
            "needsReview": False,
        }

        if original_extraction:
            # Store as JSON string for FalkorDB compatibility
            import json
            update_props["originalExtraction"] = json.dumps(original_extraction)

        try:
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", update_props)
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $id, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            logger.info(
                "UIO correction applied",
                uio_id=uio_id,
                corrected_fields=list(corrections.keys()),
            )

            # Apply correction to PostgreSQL (best-effort for core fields)
            core_updates = {}
            if "canonical_title" in corrections:
                core_updates["canonical_title"] = corrections["canonical_title"]
                core_updates["user_corrected_title"] = corrections["canonical_title"]
            if "canonical_description" in corrections:
                core_updates["canonical_description"] = corrections["canonical_description"]
            if "due_date" in corrections:
                core_updates["due_date"] = corrections["due_date"]
                core_updates["due_date_last_updated_at"] = now
                core_updates["due_date_last_updated_source_id"] = "user"
            if core_updates:
                core_updates["updated_at"] = now
                core_updates["is_user_verified"] = True

                async with get_db_session() as session:
                    set_clause = ", ".join(f"{key} = :{key}" for key in core_updates.keys())
                    await session.execute(
                        text(
                            f"""
                            UPDATE unified_intelligence_object
                            SET {set_clause}
                            WHERE id = :id
                              AND organization_id = :org_id
                            """
                        ),
                        {
                            **core_updates,
                            "id": uio_id,
                            "org_id": self.organization_id,
                        },
                    )

                    await session.execute(
                        text(
                            """
                            INSERT INTO unified_object_timeline (
                                id, unified_object_id,
                                event_type, event_description,
                                previous_value, new_value,
                                source_type, source_id, source_name,
                                message_id, quoted_text,
                                triggered_by, confidence, event_at
                            ) VALUES (
                                :id, :unified_object_id,
                                :event_type, :event_description,
                                :previous_value, :new_value,
                                :source_type, :source_id, :source_name,
                                :message_id, :quoted_text,
                                :triggered_by, :confidence, :event_at
                            )
                            """
                        ),
                        {
                            "id": str(uuid4()),
                            "unified_object_id": uio_id,
                            "event_type": "corrected",
                            "event_description": "User correction applied",
                            "previous_value": json.dumps(original_extraction) if original_extraction else None,
                            "new_value": json.dumps(corrections),
                            "source_type": "user",
                            "source_id": None,
                            "source_name": None,
                            "message_id": None,
                            "quoted_text": None,
                            "triggered_by": user_id,
                            "confidence": None,
                            "event_at": now,
                        },
                    )

            return True

        except Exception as e:
            logger.error(
                "Failed to apply UIO correction",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    # =========================================================================
    # Merge UIOs
    # =========================================================================

    async def merge_uios(
        self,
        source_uio_id: str,
        target_uio_id: str,
        merge_strategy: Literal["newest_wins", "highest_confidence", "manual"] = "newest_wins",
        manual_resolution: dict | None = None,
    ) -> bool:
        """
        Merge duplicate UIOs.

        The source UIO is archived and linked to the target via
        MERGED_INTO relationship. All relationships from source
        are transferred to target.

        Args:
            source_uio_id: UIO to be merged (will be archived)
            target_uio_id: UIO to merge into (will be updated)
            merge_strategy: How to resolve conflicts
            manual_resolution: Field values for manual strategy

        Returns:
            True if merge was successful
        """
        graph = await self._get_graph()

        logger.info(
            "Merging UIOs",
            source_uio_id=source_uio_id,
            target_uio_id=target_uio_id,
            strategy=merge_strategy,
        )

        # Get both UIOs
        result = await graph.query(
            """
            MATCH (source:UIO {id: $sourceId, organizationId: $orgId})
            MATCH (target:UIO {id: $targetId, organizationId: $orgId})
            RETURN properties(source) as sourceProps, properties(target) as targetProps
            """,
            {
                "sourceId": source_uio_id,
                "targetId": target_uio_id,
                "orgId": self.organization_id,
            },
        )

        if not result:
            logger.warning(
                "UIOs not found for merge",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
            )
            return False

        source_props = result[0].get("sourceProps", {})
        target_props = result[0].get("targetProps", {})

        # Determine merged values based on strategy
        if merge_strategy == "manual" and manual_resolution:
            merged_data = manual_resolution
        elif merge_strategy == "highest_confidence":
            if source_props.get("confidence", 0) > target_props.get("confidence", 0):
                merged_data = {**target_props, **source_props}
            else:
                merged_data = {**source_props, **target_props}
        else:  # newest_wins
            source_updated = source_props.get("updatedAt", "")
            target_updated = target_props.get("updatedAt", "")
            if source_updated > target_updated:
                merged_data = {**target_props, **source_props}
            else:
                merged_data = {**source_props, **target_props}

        # Don't override critical fields
        merged_data["id"] = target_uio_id
        merged_data["organizationId"] = self.organization_id
        merged_data["updatedAt"] = datetime.utcnow().isoformat()

        try:
            # Update target with merged data
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("target", merged_data)
            await graph.query(
                f"""
                MATCH (target:UIO {{id: $targetId, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"targetId": target_uio_id, "orgId": self.organization_id, **set_params},
            )

            # Transfer relationships from source to target
            await graph.query(
                """
                MATCH (source:UIO {id: $sourceId, organizationId: $orgId})-[r]->(related)
                MATCH (target:UIO {id: $targetId, organizationId: $orgId})
                WHERE NOT (target)-[:MERGED_INTO]->(related)
                CREATE (target)-[newRel:TRANSFERRED_FROM_MERGE]->(related)
                """,
                {
                    "sourceId": source_uio_id,
                    "targetId": target_uio_id,
                    "orgId": self.organization_id,
                },
            )

            # Archive source and create MERGED_INTO relationship
            from datetime import datetime
            now = datetime.utcnow().isoformat()
            await graph.query(
                """
                MATCH (source:UIO {id: $sourceId, organizationId: $orgId})
                MATCH (target:UIO {id: $targetId, organizationId: $orgId})
                SET source.status = 'archived',
                    source.archivedAt = $archivedAt,
                    source.mergedInto = $targetId
                CREATE (source)-[:MERGED_INTO]->(target)
                """,
                {
                    "sourceId": source_uio_id,
                    "targetId": target_uio_id,
                    "orgId": self.organization_id,
                    "archivedAt": now,
                },
            )

            logger.info(
                "UIOs merged successfully",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to merge UIOs",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
                error=str(e),
            )
            return False

    # =========================================================================
    # Query UIOs
    # =========================================================================

    async def get_uio(self, uio_id: str) -> dict | None:
        """Get a single UIO by ID."""
        graph = await self._get_graph()

        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN properties(u) as props, labels(u) as labels
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if result:
            props = result[0].get("props", {})
            labels = result[0].get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            return props
        return None

    async def list_uios(
        self,
        uio_type: UIOType | None = None,
        status: UIOStatus | None = None,
        needs_review: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """
        List UIOs with filtering.

        Args:
            uio_type: Filter by type
            status: Filter by status
            needs_review: Filter by review status
            limit: Maximum results
            offset: Pagination offset

        Returns:
            List of UIO dicts
        """
        graph = await self._get_graph()

        # Build label filter
        label = "UIO"
        if uio_type:
            label_map = {
                "commitment": "Commitment",
                "decision": "Decision",
                "task": "Task",
                "claim": "Claim",
                "risk": "Risk",
            }
            label = f"UIO:{label_map.get(uio_type, 'UIO')}"

        # Build WHERE conditions
        conditions = ["u.organizationId = $orgId"]
        params = {"orgId": self.organization_id, "limit": limit, "offset": offset}

        if status:
            conditions.append("u.status = $status")
            params["status"] = status.value

        if needs_review is not None:
            conditions.append("u.needsReview = $needsReview")
            params["needsReview"] = needs_review

        where_clause = " AND ".join(conditions)

        result = await graph.query(
            f"""
            MATCH (u:{label})
            WHERE {where_clause}
            RETURN properties(u) as props, labels(u) as labels
            ORDER BY u.createdAt DESC
            SKIP $offset
            LIMIT $limit
            """,
            params,
        )

        uios = []
        for r in result:
            props = r.get("props", {})
            labels = r.get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            uios.append(props)

        return uios

    async def get_pending_review(self, limit: int = 50) -> list[dict]:
        """Get UIOs pending review."""
        return await self.list_uios(needs_review=True, limit=limit)

    async def get_uio_history(self, uio_id: str) -> list[dict]:
        """Get status change history for a UIO."""
        graph = await self._get_graph()

        # This would require a separate history table/nodes
        # For now, return the current state
        uio = await self.get_uio(uio_id)
        if uio:
            return [
                {
                    "status": uio.get("status"),
                    "changedAt": uio.get("statusChangedAt") or uio.get("createdAt"),
                    "changedBy": uio.get("reviewedBy"),
                }
            ]
        return []

    async def get_related_uios(self, uio_id: str, depth: int = 1) -> list[dict]:
        """Get UIOs related to this one in the graph."""
        graph = await self._get_graph()

        result = await graph.query(
            f"""
            MATCH (u:UIO {{id: $id, organizationId: $orgId}})
            MATCH (u)-[*1..{depth}]-(related:UIO)
            WHERE related.organizationId = $orgId
            RETURN DISTINCT properties(related) as props, labels(related) as labels
            LIMIT 20
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        uios = []
        for r in result:
            props = r.get("props", {})
            labels = r.get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            uios.append(props)

        return uios

    # =========================================================================
    # Helpers
    # =========================================================================

    def _sanitize_properties(self, data: dict) -> dict:
        """Sanitize properties for FalkorDB storage."""
        sanitized = {}
        for key, value in data.items():
            if value is None:
                continue
            if isinstance(value, datetime):
                sanitized[key] = value.isoformat()
            elif isinstance(value, (list, dict)):
                import json
                sanitized[key] = json.dumps(value)
            else:
                sanitized[key] = value
        return sanitized

    def _get_uio_type_from_labels(self, labels: list[str]) -> str:
        """Extract UIO type from node labels."""
        type_labels = {"Commitment", "Decision", "Task", "Claim", "Risk"}
        for label in labels:
            if label in type_labels:
                return label.lower()
        return "uio"


# =============================================================================
# Singleton
# =============================================================================

_uio_managers: dict[str, UIOManager] = {}


async def get_uio_manager(organization_id: str) -> UIOManager:
    """Get a UIOManager for an organization."""
    global _uio_managers

    if organization_id not in _uio_managers:
        _uio_managers[organization_id] = UIOManager(organization_id)

    return _uio_managers[organization_id]
