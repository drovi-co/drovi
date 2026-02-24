from __future__ import annotations

from src.crawlers.diff.semantic import compute_semantic_diff


def test_semantic_diff_flags_large_content_change_as_meaningful() -> None:
    result = compute_semantic_diff(
        previous_text="federal reserve signals gradual rate cuts with labor cooling",
        current_text="emergency rate hike announced after inflation shock and energy disruption",
        significance_threshold=0.2,
    )

    assert result.meaningful is True
    assert result.significance_score >= 0.2
    assert result.jaccard_distance > 0.4


def test_semantic_diff_suppresses_minor_copy_edit() -> None:
    result = compute_semantic_diff(
        previous_text="company announces quarterly results and guidance update for investors",
        current_text="company announces quarterly results and guidance updates for investors",
        significance_threshold=0.3,
    )

    assert result.meaningful is False
    assert result.significance_score < 0.3
