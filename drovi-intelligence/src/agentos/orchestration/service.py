from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.serialization import json_dumps_canonical

from .models import TeamMemberSpec


def _parse_json_field(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            import json

            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    try:
        return dict(value)
    except Exception:
        return {}


@dataclass(frozen=True)
class TeamRecord:
    id: str
    organization_id: str
    name: str
    description: str | None
    metadata: dict[str, Any]
    created_by_user_id: str | None
    created_at: Any
    updated_at: Any


class AgentTeamService:
    async def list_teams(self, *, organization_id: str) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT t.id,
                           t.organization_id,
                           t.name,
                           t.description,
                           t.metadata,
                           t.created_by_user_id,
                           t.created_at,
                           t.updated_at,
                           COUNT(m.id) AS member_count
                    FROM agent_team t
                    LEFT JOIN agent_team_member m
                      ON m.team_id = t.id
                     AND m.organization_id = t.organization_id
                    WHERE t.organization_id = :organization_id
                    GROUP BY t.id, t.organization_id, t.name, t.description, t.metadata,
                             t.created_by_user_id, t.created_at, t.updated_at
                    ORDER BY t.updated_at DESC
                    """
                ),
                {"organization_id": organization_id},
            )
            rows = result.fetchall()

        payload: list[dict[str, Any]] = []
        for row in rows:
            row_payload = dict(row._mapping)
            row_payload["metadata"] = _parse_json_field(row_payload.get("metadata"))
            row_payload["member_count"] = int(row_payload.get("member_count") or 0)
            payload.append(row_payload)
        return payload

    async def get_team(self, *, organization_id: str, team_id: str) -> TeamRecord | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id,
                           organization_id,
                           name,
                           description,
                           metadata,
                           created_by_user_id,
                           created_at,
                           updated_at
                    FROM agent_team
                    WHERE organization_id = :organization_id
                      AND id = :team_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "team_id": team_id,
                },
            )
            row = result.fetchone()

        if row is None:
            return None

        payload = dict(row._mapping)
        payload["metadata"] = _parse_json_field(payload.get("metadata"))
        return TeamRecord(**payload)

    async def create_team(
        self,
        *,
        team_id: str,
        organization_id: str,
        name: str,
        description: str | None,
        metadata: dict[str, Any],
        created_by_user_id: str | None,
    ) -> TeamRecord:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_team (
                        id,
                        organization_id,
                        name,
                        description,
                        metadata,
                        created_by_user_id,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id,
                        :organization_id,
                        :name,
                        :description,
                        CAST(:metadata AS JSONB),
                        :created_by_user_id,
                        NOW(),
                        NOW()
                    )
                    """
                ),
                {
                    "id": team_id,
                    "organization_id": organization_id,
                    "name": name,
                    "description": description,
                    "metadata": json_dumps_canonical(metadata),
                    "created_by_user_id": created_by_user_id,
                },
            )
            await session.commit()

        team = await self.get_team(organization_id=organization_id, team_id=team_id)
        if team is None:
            raise RuntimeError("Team creation failed")
        return team

    async def list_team_members(
        self,
        *,
        organization_id: str,
        team_id: str,
        team_metadata: dict[str, Any] | None = None,
    ) -> list[TeamMemberSpec]:
        member_overrides = _read_member_overrides(team_metadata or {})

        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT m.role_id,
                           m.priority,
                           m.is_required,
                           r.name AS role_name
                    FROM agent_team_member m
                    JOIN agent_role r
                      ON r.id = m.role_id
                     AND r.organization_id = m.organization_id
                    WHERE m.organization_id = :organization_id
                      AND m.team_id = :team_id
                    ORDER BY m.priority ASC, m.role_id ASC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "team_id": team_id,
                },
            )
            rows = result.fetchall()

        members: list[TeamMemberSpec] = []
        for row in rows:
            payload = dict(row._mapping)
            override = member_overrides.get(str(payload["role_id"]), {})
            members.append(
                TeamMemberSpec(
                    role_id=str(payload["role_id"]),
                    role_name=payload.get("role_name"),
                    priority=int(payload.get("priority") or 0),
                    is_required=bool(payload.get("is_required")),
                    stage=_coerce_stage(override.get("stage")),
                    specialization_prompt=_coerce_text(override.get("specialization_prompt")),
                    constraints=_coerce_dict(override.get("constraints")),
                )
            )
        return members

    async def replace_team_members(
        self,
        *,
        organization_id: str,
        team_id: str,
        members: list[TeamMemberSpec],
        team_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        overrides: dict[str, dict[str, Any]] = {}
        for member in members:
            override_payload: dict[str, Any] = {}
            if member.stage is not None:
                override_payload["stage"] = int(member.stage)
            if member.specialization_prompt:
                override_payload["specialization_prompt"] = member.specialization_prompt
            if member.constraints:
                override_payload["constraints"] = member.constraints
            if override_payload:
                overrides[member.role_id] = override_payload

        merged_metadata = {
            **team_metadata,
            "member_overrides": overrides,
        }

        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    DELETE FROM agent_team_member
                    WHERE organization_id = :organization_id
                      AND team_id = :team_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "team_id": team_id,
                },
            )

            for member in members:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_team_member (
                            organization_id,
                            team_id,
                            role_id,
                            priority,
                            is_required,
                            created_at
                        ) VALUES (
                            :organization_id,
                            :team_id,
                            :role_id,
                            :priority,
                            :is_required,
                            NOW()
                        )
                        """
                    ),
                    {
                        "organization_id": organization_id,
                        "team_id": team_id,
                        "role_id": member.role_id,
                        "priority": member.priority,
                        "is_required": member.is_required,
                    },
                )

            await session.execute(
                text(
                    """
                    UPDATE agent_team
                    SET metadata = CAST(:metadata AS JSONB),
                        updated_at = NOW()
                    WHERE organization_id = :organization_id
                      AND id = :team_id
                    """
                ),
                {
                    "metadata": json_dumps_canonical(merged_metadata),
                    "organization_id": organization_id,
                    "team_id": team_id,
                },
            )
            await session.commit()

        return merged_metadata

    async def resolve_role_deployments(
        self,
        *,
        organization_id: str,
        role_ids: list[str],
    ) -> dict[str, str]:
        if not role_ids:
            return {}

        deployments_by_role: dict[str, str] = {}
        async with get_db_session() as session:
            for role_id in role_ids:
                result = await session.execute(
                    text(
                        """
                        SELECT id,
                               status,
                               version,
                               updated_at
                        FROM agent_deployment
                        WHERE organization_id = :organization_id
                          AND role_id = :role_id
                        ORDER BY CASE status
                                   WHEN 'active' THEN 0
                                   WHEN 'canary' THEN 1
                                   WHEN 'draft' THEN 2
                                   ELSE 3
                                 END,
                                 version DESC,
                                 updated_at DESC
                        LIMIT 1
                        """
                    ),
                    {
                        "organization_id": organization_id,
                        "role_id": role_id,
                    },
                )
                row = result.fetchone()
                if row is not None:
                    deployments_by_role[role_id] = str(row.id)

        return deployments_by_role


def _read_member_overrides(metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = metadata.get("member_overrides")
    if not isinstance(raw, dict):
        return {}
    parsed: dict[str, dict[str, Any]] = {}
    for role_id, value in raw.items():
        if isinstance(role_id, str) and isinstance(value, dict):
            parsed[role_id] = value
    return parsed


def _coerce_stage(value: Any) -> int | None:
    if value is None:
        return None
    try:
        stage = int(value)
    except (TypeError, ValueError):
        return None
    if stage < 0:
        return None
    return stage


def _coerce_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _coerce_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}
