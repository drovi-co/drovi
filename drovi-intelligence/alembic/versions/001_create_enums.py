"""Create PostgreSQL enums and extensions.

Revision ID: 001_create_enums
Revises:
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_create_enums"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable required PostgreSQL extensions
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ==========================================================================
    # UIO Type Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE unified_object_type AS ENUM (
            'commitment', 'decision', 'topic', 'project',
            'claim', 'task', 'risk', 'brief'
        )
    """)

    op.execute("""
        CREATE TYPE unified_object_status AS ENUM (
            'active', 'merged', 'archived', 'dismissed'
        )
    """)

    op.execute("""
        CREATE TYPE source_role AS ENUM (
            'origin', 'update', 'confirmation', 'context', 'supersession'
        )
    """)

    op.execute("""
        CREATE TYPE timeline_event_type AS ENUM (
            'created', 'status_changed', 'due_date_changed', 'due_date_confirmed',
            'participant_added', 'source_added', 'merged', 'user_verified',
            'user_corrected', 'auto_completed'
        )
    """)

    op.execute("""
        CREATE TYPE deduplication_status AS ENUM (
            'pending_review', 'auto_merged', 'user_merged', 'user_rejected', 'expired'
        )
    """)

    # ==========================================================================
    # UIO Detail Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE uio_task_status AS ENUM (
            'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'
        )
    """)

    op.execute("""
        CREATE TYPE uio_task_priority AS ENUM (
            'no_priority', 'low', 'medium', 'high', 'urgent'
        )
    """)

    op.execute("""
        CREATE TYPE uio_risk_type AS ENUM (
            'deadline_risk', 'commitment_conflict', 'unclear_ownership',
            'missing_information', 'escalation_needed', 'policy_violation',
            'financial_risk', 'relationship_risk', 'sensitive_data',
            'contradiction', 'fraud_signal', 'other'
        )
    """)

    op.execute("""
        CREATE TYPE uio_risk_severity AS ENUM ('low', 'medium', 'high', 'critical')
    """)

    op.execute("""
        CREATE TYPE uio_decision_status AS ENUM (
            'made', 'pending', 'deferred', 'reversed'
        )
    """)

    op.execute("""
        CREATE TYPE uio_brief_action AS ENUM (
            'respond', 'review', 'delegate', 'schedule', 'wait',
            'escalate', 'archive', 'follow_up', 'none'
        )
    """)

    op.execute("""
        CREATE TYPE uio_brief_priority AS ENUM ('urgent', 'high', 'medium', 'low')
    """)

    # ==========================================================================
    # Signal Detection Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE signal_classification AS ENUM ('signal', 'noise', 'uncertain')
    """)

    op.execute("""
        CREATE TYPE control_chart_zone AS ENUM ('A', 'B', 'C')
    """)

    # ==========================================================================
    # Source and Embedding Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE source_type AS ENUM (
            'email', 'slack', 'calendar', 'whatsapp', 'notion', 'google_docs',
            'google_sheets', 'meeting_transcript', 'teams', 'discord', 'linear',
            'github', 'crm_salesforce', 'crm_hubspot', 'crm_pipedrive', 'crm_zoho'
        )
    """)

    op.execute("""
        CREATE TYPE embedding_status AS ENUM ('pending', 'processing', 'completed', 'failed')
    """)

    # ==========================================================================
    # Contact Intelligence Enums
    # ==========================================================================
    op.execute("""
        CREATE TYPE lifecycle_stage AS ENUM (
            'unknown', 'lead', 'prospect', 'opportunity', 'customer',
            'churned', 'partner', 'vendor', 'colleague'
        )
    """)

    op.execute("""
        CREATE TYPE role_type AS ENUM (
            'unknown', 'decision_maker', 'influencer', 'gatekeeper',
            'champion', 'end_user', 'evaluator', 'blocker'
        )
    """)

    op.execute("""
        CREATE TYPE seniority_level AS ENUM (
            'unknown', 'intern', 'ic', 'manager', 'senior_manager',
            'director', 'vp', 'c_level', 'founder'
        )
    """)

    # ==========================================================================
    # Commitment Direction Enum
    # ==========================================================================
    op.execute("""
        CREATE TYPE commitment_direction AS ENUM (
            'made_by_me', 'made_to_me', 'third_party'
        )
    """)

    op.execute("""
        CREATE TYPE commitment_status AS ENUM (
            'pending', 'in_progress', 'completed', 'overdue', 'cancelled'
        )
    """)


def downgrade() -> None:
    # Drop enums in reverse order
    enums = [
        "commitment_status",
        "commitment_direction",
        "seniority_level",
        "role_type",
        "lifecycle_stage",
        "embedding_status",
        "source_type",
        "control_chart_zone",
        "signal_classification",
        "uio_brief_priority",
        "uio_brief_action",
        "uio_decision_status",
        "uio_risk_severity",
        "uio_risk_type",
        "uio_task_priority",
        "uio_task_status",
        "deduplication_status",
        "timeline_event_type",
        "source_role",
        "unified_object_status",
        "unified_object_type",
    ]
    for enum in enums:
        op.execute(f"DROP TYPE IF EXISTS {enum}")

    # Drop extensions
    op.execute("DROP EXTENSION IF EXISTS vector")
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp"')
