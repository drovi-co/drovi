"""
Profile Communication Style Node

Analyzes communication patterns to build a profile of the contact's
communication preferences and style.
"""

import time
from collections import Counter
from datetime import datetime
from typing import Any

import structlog

from ..state import (
    ContactIntelligenceState,
    CommunicationProfile,
    FormalityLevel,
    PreferredChannel,
    NodeTiming,
)

logger = structlog.get_logger()


async def profile_communication_style_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Profile the contact's communication style.

    Analyzes:
    - Formality level (formal, professional, casual)
    - Preferred channel (email, slack, calendar)
    - Activity patterns (active hours, days)
    - Message characteristics (length, greetings, signatures)

    Returns:
        State update with communication_profile populated
    """
    start_time = time.time()

    logger.info(
        "Profiling communication style",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "profile_communication_style"
    state.trace.nodes.append("profile_communication_style")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        interactions = state.loaded_data.interactions
        profile = CommunicationProfile()

        if not interactions:
            return _complete_node(state, profile, start_time)

        # Get only inbound interactions (from the contact)
        inbound = [i for i in interactions if i.direction == "inbound"]

        if not inbound:
            return _complete_node(state, profile, start_time)

        # =================================================================
        # PREFERRED CHANNEL
        # =================================================================

        channel_counts = Counter(i.source_type for i in inbound)
        if channel_counts:
            most_common_channel = channel_counts.most_common(1)[0]
            total = sum(channel_counts.values())

            channel_map = {
                "email": PreferredChannel.EMAIL,
                "slack": PreferredChannel.SLACK,
                "calendar": PreferredChannel.CALENDAR,
                "whatsapp": PreferredChannel.WHATSAPP,
            }

            profile.preferred_channel = channel_map.get(
                most_common_channel[0], PreferredChannel.UNKNOWN
            )
            profile.channel_confidence = most_common_channel[1] / total

        # =================================================================
        # ACTIVITY PATTERNS
        # =================================================================

        # Analyze active hours (using inbound message timestamps)
        hour_counts = Counter(i.timestamp.hour for i in inbound)
        if hour_counts:
            # Get hours with significant activity (> 5% of messages)
            threshold = len(inbound) * 0.05
            active_hours = [h for h, c in hour_counts.items() if c >= threshold]
            profile.active_hours = sorted(active_hours)

            # Infer timezone based on activity patterns
            # If most activity is 9-17, assume local business hours
            peak_hours = hour_counts.most_common(3)
            avg_peak_hour = sum(h for h, _ in peak_hours) / len(peak_hours)

            if 6 <= avg_peak_hour <= 10:
                profile.timezone_inferred = "Americas (EST/PST)"
            elif 13 <= avg_peak_hour <= 17:
                profile.timezone_inferred = "Europe (CET/GMT)"
            elif 21 <= avg_peak_hour or avg_peak_hour <= 3:
                profile.timezone_inferred = "Asia Pacific (JST/AEST)"

        # Analyze active days
        day_counts = Counter(i.timestamp.weekday() for i in inbound)
        if day_counts:
            threshold = len(inbound) * 0.1
            active_days = [d for d, c in day_counts.items() if c >= threshold]
            profile.active_days = sorted(active_days)

        # =================================================================
        # MESSAGE CHARACTERISTICS
        # =================================================================

        # Average words per message
        word_counts = [i.word_count for i in inbound if i.word_count > 0]
        if word_counts:
            profile.avg_words_per_message = sum(word_counts) / len(word_counts)

        # Analyze message content for formality indicators
        snippets = [i.snippet or "" for i in inbound if i.snippet]
        if snippets:
            formality_score = _analyze_formality(snippets)
            profile.formality_level, profile.formality_confidence = formality_score

            # Check for greetings and signatures
            profile.uses_greetings = _check_uses_greetings(snippets)
            profile.uses_signatures = _check_uses_signatures(snippets)
            profile.emoji_usage = _analyze_emoji_usage(snippets)

        # =================================================================
        # RESPONSE PATTERNS
        # =================================================================

        # Typical response time (from relationship metrics)
        avg_response = state.relationship_metrics.avg_response_time_minutes
        if avg_response is not None:
            if avg_response < 60:
                profile.typical_response_time = "within an hour"
                profile.prefers_quick_replies = True
            elif avg_response < 240:
                profile.typical_response_time = "within a few hours"
            elif avg_response < 1440:
                profile.typical_response_time = "same day"
            else:
                profile.typical_response_time = "within a few days"

        logger.info(
            "Communication style profiled",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            preferred_channel=profile.preferred_channel.value,
            formality=profile.formality_level.value,
        )

        return _complete_node(state, profile, start_time)

    except Exception as e:
        logger.error(
            "Failed to profile communication style",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        return _error_node(state, start_time, str(e))


def _analyze_formality(snippets: list[str]) -> tuple[FormalityLevel, float]:
    """Analyze formality level from message snippets."""
    formal_indicators = [
        "dear", "sincerely", "regards", "respectfully",
        "please find", "i would like to", "thank you for your",
        "best regards", "kind regards", "yours truly",
    ]
    casual_indicators = [
        "hey", "hi!", "thanks!", "cool", "awesome", "great!",
        "lol", "haha", "btw", "fyi", "asap",
        "gonna", "wanna", "gotta",
    ]

    formal_count = 0
    casual_count = 0
    total_checked = 0

    for snippet in snippets:
        lower = snippet.lower()
        total_checked += 1

        for indicator in formal_indicators:
            if indicator in lower:
                formal_count += 1
                break

        for indicator in casual_indicators:
            if indicator in lower:
                casual_count += 1
                break

    if total_checked == 0:
        return FormalityLevel.MIXED, 0.0

    formal_ratio = formal_count / total_checked
    casual_ratio = casual_count / total_checked

    if formal_ratio > 0.3 and casual_ratio < 0.1:
        return FormalityLevel.FORMAL, min(formal_ratio * 2, 1.0)
    elif casual_ratio > 0.3 and formal_ratio < 0.1:
        return FormalityLevel.CASUAL, min(casual_ratio * 2, 1.0)
    elif formal_ratio > casual_ratio:
        return FormalityLevel.PROFESSIONAL, 0.6
    elif casual_ratio > formal_ratio:
        return FormalityLevel.CASUAL, 0.6
    else:
        return FormalityLevel.MIXED, 0.5


def _check_uses_greetings(snippets: list[str]) -> bool:
    """Check if contact typically uses greetings."""
    greetings = ["hi", "hello", "hey", "dear", "good morning", "good afternoon"]
    greeting_count = 0

    for snippet in snippets[:20]:  # Check first 20 messages
        lower = snippet.lower().strip()
        if any(lower.startswith(g) for g in greetings):
            greeting_count += 1

    return greeting_count / min(len(snippets), 20) > 0.3


def _check_uses_signatures(snippets: list[str]) -> bool:
    """Check if contact typically uses signatures."""
    signature_indicators = [
        "regards", "best", "thanks", "cheers", "sincerely",
        "sent from", "get outlook", "iphone",
    ]
    signature_count = 0

    for snippet in snippets[:20]:
        lower = snippet.lower()
        if any(ind in lower for ind in signature_indicators):
            signature_count += 1

    return signature_count / min(len(snippets), 20) > 0.3


def _analyze_emoji_usage(snippets: list[str]) -> str:
    """Analyze emoji usage frequency."""
    import re

    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags
        "]+",
        flags=re.UNICODE,
    )

    emoji_messages = 0
    for snippet in snippets:
        if emoji_pattern.search(snippet):
            emoji_messages += 1

    ratio = emoji_messages / len(snippets) if snippets else 0

    if ratio == 0:
        return "none"
    elif ratio < 0.1:
        return "minimal"
    elif ratio < 0.3:
        return "moderate"
    else:
        return "frequent"


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
            "current_node": "profile_communication_style",
            "node_timings": {
                **state.trace.node_timings,
                "profile_communication_style": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    profile: CommunicationProfile,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "communication_profile": profile.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "profile_communication_style",
            "node_timings": {
                **state.trace.node_timings,
                "profile_communication_style": node_timing,
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
        "communication_profile": CommunicationProfile().model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "profile_communication_style",
            "node_timings": {
                **state.trace.node_timings,
                "profile_communication_style": node_timing,
            },
            "errors": state.trace.errors + [f"profile_communication_style: {error}"],
        },
    }
