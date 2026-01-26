"""
Detect Role Influence Node

Analyzes interactions and intelligence to determine the contact's
role type (decision-maker, influencer, gatekeeper, etc.) and seniority.
"""

import time
from typing import Any

import structlog

from ..state import (
    ContactIntelligenceState,
    RoleDetection,
    RoleType,
    SeniorityLevel,
    NodeTiming,
)

logger = structlog.get_logger()


async def detect_role_influence_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Detect the contact's role and influence level.

    Analyzes:
    - Title for seniority indicators
    - Decision/commitment patterns
    - Communication patterns (delegates, approves, etc.)
    - Network position (from loaded data)

    Returns:
        State update with role_detection populated
    """
    start_time = time.time()

    logger.info(
        "Detecting role influence",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "detect_role_influence"
    state.trace.nodes.append("detect_role_influence")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        detection = RoleDetection()
        indicators: list[str] = []

        # =================================================================
        # SENIORITY FROM TITLE
        # =================================================================

        title = state.loaded_data.contact_title or ""
        if title:
            seniority, seniority_conf = _detect_seniority_from_title(title)
            detection.seniority_estimate = seniority
            detection.seniority_confidence = seniority_conf
            if seniority != SeniorityLevel.UNKNOWN:
                indicators.append(f"Title indicates {seniority.value}")

        # =================================================================
        # ROLE FROM TITLE
        # =================================================================

        if title:
            role_from_title = _detect_role_from_title(title)
            if role_from_title != RoleType.UNKNOWN:
                detection.role_type = role_from_title
                detection.role_confidence = 0.7
                indicators.append(f"Title suggests {role_from_title.value}")

        # =================================================================
        # DECISION-MAKING PATTERNS
        # =================================================================

        decisions = state.loaded_data.decisions
        if decisions:
            decision_maker_count = sum(1 for d in decisions if d.is_decision_maker)

            if decision_maker_count > 0:
                detection.makes_decisions = True
                indicators.append(f"Made {decision_maker_count} decisions")

                # Strong signal for decision-maker role
                if decision_maker_count >= 3:
                    if detection.role_type == RoleType.UNKNOWN:
                        detection.role_type = RoleType.DECISION_MAKER
                        detection.role_confidence = 0.8
                    elif detection.role_type == RoleType.INFLUENCER:
                        detection.role_type = RoleType.DECISION_MAKER
                        detection.role_confidence = 0.75

        # =================================================================
        # COMMITMENT PATTERNS
        # =================================================================

        commitments = state.loaded_data.commitments
        if commitments:
            # Analyze commitment directions
            owed_by_contact = sum(
                1 for c in commitments if c.direction == "owed_by_contact"
            )
            owed_to_contact = sum(
                1 for c in commitments if c.direction == "owed_to_contact"
            )

            if owed_to_contact > owed_by_contact * 2:
                # Contact receives more commitments than they make
                # Could indicate they delegate/assign work
                detection.delegates_tasks = True
                indicators.append("Frequently receives commitments from others")

                if detection.role_type == RoleType.UNKNOWN:
                    detection.role_type = RoleType.INFLUENCER
                    detection.role_confidence = 0.6

            if owed_by_contact > 3:
                detection.approves_commitments = True
                indicators.append(f"Has {owed_by_contact} active commitments")

        # =================================================================
        # COMMUNICATION PATTERNS
        # =================================================================

        # Analyze message content for role indicators
        interactions = state.loaded_data.interactions
        inbound = [i for i in interactions if i.direction == "inbound"]

        if inbound:
            snippets = [i.snippet or "" for i in inbound if i.snippet]
            role_signals = _analyze_role_signals(snippets)

            if role_signals["delegates"]:
                detection.delegates_tasks = True
                indicators.append("Language suggests delegation")

            if role_signals["approves"]:
                detection.approves_commitments = True
                indicators.append("Language suggests approval authority")

            if role_signals["reports"]:
                detection.receives_reports = True
                indicators.append("Receives status reports")

            # Update role based on signals
            if role_signals["decision_maker_signals"] > 2:
                if detection.role_type in [RoleType.UNKNOWN, RoleType.INFLUENCER]:
                    detection.role_type = RoleType.DECISION_MAKER
                    detection.role_confidence = max(detection.role_confidence, 0.7)

            if role_signals["gatekeeper_signals"] > 2:
                if detection.role_type == RoleType.UNKNOWN:
                    detection.role_type = RoleType.GATEKEEPER
                    detection.role_confidence = 0.6
                    indicators.append("Shows gatekeeper patterns")

            if role_signals["technical_signals"] > 3:
                if detection.role_type == RoleType.UNKNOWN:
                    detection.role_type = RoleType.TECHNICAL
                    detection.role_confidence = 0.7
                    indicators.append("Technical language detected")

        # =================================================================
        # NETWORK POSITION
        # =================================================================

        # If contact has many mutual connections, likely an influencer
        mutual_count = len(state.loaded_data.mutual_contact_ids)
        if mutual_count > 10:
            indicators.append(f"Connected to {mutual_count} mutual contacts")
            if detection.role_type == RoleType.UNKNOWN:
                detection.role_type = RoleType.INFLUENCER
                detection.role_confidence = 0.5

        # =================================================================
        # FINALIZE
        # =================================================================

        detection.role_indicators = indicators

        # Default if nothing detected
        if detection.role_type == RoleType.UNKNOWN and detection.seniority_estimate != SeniorityLevel.UNKNOWN:
            # Infer from seniority
            if detection.seniority_estimate in [SeniorityLevel.C_LEVEL, SeniorityLevel.VP]:
                detection.role_type = RoleType.DECISION_MAKER
                detection.role_confidence = 0.5
            elif detection.seniority_estimate == SeniorityLevel.DIRECTOR:
                detection.role_type = RoleType.INFLUENCER
                detection.role_confidence = 0.5
            elif detection.seniority_estimate == SeniorityLevel.MANAGER:
                detection.role_type = RoleType.INFLUENCER
                detection.role_confidence = 0.4

        logger.info(
            "Role influence detected",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            role=detection.role_type.value,
            seniority=detection.seniority_estimate.value,
        )

        return _complete_node(state, detection, start_time)

    except Exception as e:
        logger.error(
            "Failed to detect role influence",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        return _error_node(state, start_time, str(e))


def _detect_seniority_from_title(title: str) -> tuple[SeniorityLevel, float]:
    """Detect seniority level from job title."""
    title_lower = title.lower()

    c_level_indicators = [
        "ceo", "cto", "cfo", "coo", "cmo", "cio", "cpo",
        "chief", "founder", "co-founder", "owner", "president",
    ]
    vp_indicators = [
        "vp", "vice president", "svp", "evp", "avp",
        "head of", "general manager",
    ]
    director_indicators = [
        "director", "principal", "senior director",
    ]
    manager_indicators = [
        "manager", "lead", "team lead", "supervisor",
        "senior manager", "group manager",
    ]
    ic_indicators = [
        "engineer", "developer", "analyst", "specialist",
        "coordinator", "associate", "consultant", "designer",
        "architect", "scientist",
    ]
    intern_indicators = ["intern", "trainee", "apprentice"]

    # Check in order of seniority (highest first)
    for indicator in c_level_indicators:
        if indicator in title_lower:
            return SeniorityLevel.C_LEVEL, 0.9

    for indicator in vp_indicators:
        if indicator in title_lower:
            return SeniorityLevel.VP, 0.85

    for indicator in director_indicators:
        if indicator in title_lower:
            return SeniorityLevel.DIRECTOR, 0.8

    for indicator in manager_indicators:
        if indicator in title_lower:
            return SeniorityLevel.MANAGER, 0.75

    for indicator in intern_indicators:
        if indicator in title_lower:
            return SeniorityLevel.INTERN, 0.85

    for indicator in ic_indicators:
        if indicator in title_lower:
            # Check for "senior" prefix
            if "senior" in title_lower or "sr." in title_lower:
                return SeniorityLevel.IC, 0.7
            return SeniorityLevel.IC, 0.6

    return SeniorityLevel.UNKNOWN, 0.0


def _detect_role_from_title(title: str) -> RoleType:
    """Detect role type from job title."""
    title_lower = title.lower()

    executive_indicators = [
        "ceo", "cto", "cfo", "president", "chief", "founder",
        "vp", "vice president", "director",
    ]
    technical_indicators = [
        "engineer", "developer", "architect", "technical",
        "devops", "sre", "data scientist", "ml engineer",
    ]
    sales_indicators = [
        "sales", "account", "business development", "bd",
    ]
    operations_indicators = [
        "operations", "procurement", "purchasing", "buyer",
        "admin", "assistant",
    ]

    for indicator in executive_indicators:
        if indicator in title_lower:
            return RoleType.DECISION_MAKER

    for indicator in technical_indicators:
        if indicator in title_lower:
            return RoleType.TECHNICAL

    for indicator in sales_indicators:
        if indicator in title_lower:
            return RoleType.CHAMPION  # Sales contacts are often champions

    for indicator in operations_indicators:
        if indicator in title_lower:
            return RoleType.GATEKEEPER

    return RoleType.UNKNOWN


def _analyze_role_signals(snippets: list[str]) -> dict[str, Any]:
    """Analyze message content for role signals."""
    signals = {
        "delegates": False,
        "approves": False,
        "reports": False,
        "decision_maker_signals": 0,
        "gatekeeper_signals": 0,
        "technical_signals": 0,
    }

    delegation_phrases = [
        "please handle", "can you take care", "i need you to",
        "assign this to", "make sure", "follow up on",
    ]
    approval_phrases = [
        "approved", "i approve", "go ahead", "proceed",
        "you have my approval", "signed off",
    ]
    report_phrases = [
        "status update", "report", "what's the progress",
        "update me on", "brief me",
    ]
    decision_phrases = [
        "i've decided", "my decision is", "we're going with",
        "i'm choosing", "the answer is", "let's go with",
    ]
    gatekeeper_phrases = [
        "schedule a meeting", "check with", "need to verify",
        "i'll forward", "let me check", "i'll get back to you",
    ]
    technical_phrases = [
        "api", "code", "bug", "deploy", "server", "database",
        "implementation", "architecture", "technical",
    ]

    for snippet in snippets[:50]:  # Check first 50 messages
        lower = snippet.lower()

        for phrase in delegation_phrases:
            if phrase in lower:
                signals["delegates"] = True
                signals["decision_maker_signals"] += 1
                break

        for phrase in approval_phrases:
            if phrase in lower:
                signals["approves"] = True
                signals["decision_maker_signals"] += 1
                break

        for phrase in report_phrases:
            if phrase in lower:
                signals["reports"] = True
                signals["decision_maker_signals"] += 1
                break

        for phrase in decision_phrases:
            if phrase in lower:
                signals["decision_maker_signals"] += 1
                break

        for phrase in gatekeeper_phrases:
            if phrase in lower:
                signals["gatekeeper_signals"] += 1
                break

        for phrase in technical_phrases:
            if phrase in lower:
                signals["technical_signals"] += 1
                break

    return signals


def _skip_node(state: ContactIntelligenceState, start_time: float) -> dict[str, Any]:
    """Return skip state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "trace": {
            **state.trace.model_dump(),
            "current_node": "detect_role_influence",
            "node_timings": {
                **state.trace.node_timings,
                "detect_role_influence": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    detection: RoleDetection,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "role_detection": detection.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "detect_role_influence",
            "node_timings": {
                **state.trace.node_timings,
                "detect_role_influence": node_timing,
            },
        },
    }


def _error_node(
    state: ContactIntelligenceState,
    start_time: float,
    error: str,
) -> dict[str, Any]:
    """Return error state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "role_detection": RoleDetection().model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "detect_role_influence",
            "node_timings": {
                **state.trace.node_timings,
                "detect_role_influence": node_timing,
            },
            "errors": state.trace.errors + [f"detect_role_influence: {error}"],
        },
    }
