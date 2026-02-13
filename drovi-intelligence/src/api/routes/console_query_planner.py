"""Join planner for console queries.

The planner keeps query cost proportional to active filters/grouping instead of
always joining every extension table.
"""

from __future__ import annotations

from typing import Iterable


JOIN_SQL_BY_ALIAS: dict[str, str] = {
    "oc": "LEFT JOIN contact oc ON u.owner_contact_id = oc.id",
    "cd": "LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id",
    "dc": "LEFT JOIN contact dc ON cd.debtor_contact_id = dc.id",
    "cc": "LEFT JOIN contact cc ON cd.creditor_contact_id = cc.id",
    "dd": "LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id",
    "dmc": "LEFT JOIN contact dmc ON dd.decision_maker_contact_id = dmc.id",
    "td": "LEFT JOIN uio_task_details td ON u.id = td.uio_id",
    "ac": "LEFT JOIN contact ac ON td.assignee_contact_id = ac.id",
    "rd": "LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id",
    "uos": "LEFT JOIN unified_object_source uos ON u.id = uos.unified_object_id",
    "conv": (
        "LEFT JOIN conversation conv ON conv.external_id = uos.conversation_id "
        "AND conv.source_account_id = uos.source_account_id"
    ),
    "m": "LEFT JOIN message m ON m.external_id = uos.message_id AND m.conversation_id = conv.id",
}

JOIN_ORDER = ["oc", "cd", "dc", "cc", "dd", "dmc", "td", "ac", "rd", "uos", "conv", "m"]


def _add(joins: set[str], *aliases: str) -> None:
    for alias in aliases:
        joins.add(alias)


def plan_console_joins(
    *,
    filters: Iterable[object],
    group_by: str | None,
    include_projection: bool,
    include_source_sender: bool = False,
) -> set[str]:
    joins: set[str] = set()

    if include_projection:
        _add(joins, "oc", "cd", "dc", "cc", "dd", "dmc", "td", "ac", "rd", "uos")
        if include_source_sender:
            _add(joins, "conv", "m")

    for filt in filters:
        entity = str(getattr(filt, "entity", "") or "")
        if entity == "priority":
            _add(joins, "cd", "td")
        elif entity == "direction":
            _add(joins, "cd")
        elif entity == "owner":
            _add(joins, "oc")
        elif entity == "debtor":
            _add(joins, "cd", "dc")
        elif entity == "creditor":
            _add(joins, "cd", "cc")
        elif entity == "assignee":
            _add(joins, "td", "ac")
        elif entity == "decision_maker":
            _add(joins, "dd", "dmc")
        elif entity == "contact":
            _add(joins, "oc", "cd", "dc", "cc", "dd", "dmc", "td", "ac")
        elif entity == "source":
            _add(joins, "uos")

    if group_by == "priority":
        _add(joins, "cd", "td")
    elif group_by == "source":
        _add(joins, "uos")

    # Ensure join dependency closure.
    if "dc" in joins or "cc" in joins:
        joins.add("cd")
    if "ac" in joins:
        joins.add("td")
    if "dmc" in joins:
        joins.add("dd")
    if "conv" in joins or "m" in joins:
        joins.add("uos")
        joins.add("conv")
    if "m" in joins:
        joins.add("conv")

    return joins


def render_console_joins(joins: set[str]) -> str:
    parts = [JOIN_SQL_BY_ALIAS[alias] for alias in JOIN_ORDER if alias in joins]
    return "\n            ".join(parts)
