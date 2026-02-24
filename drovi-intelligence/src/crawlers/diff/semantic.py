"""Semantic diffing and change significance scoring."""

from __future__ import annotations

from dataclasses import dataclass
import math
import re


TOKEN_RE = re.compile(r"[a-zA-Z0-9]{3,}")


@dataclass(frozen=True)
class SemanticDiffResult:
    significance_score: float
    jaccard_distance: float
    length_delta_ratio: float
    added_terms: list[str]
    removed_terms: list[str]
    meaningful: bool


def _tokenize(text: str) -> set[str]:
    tokens = TOKEN_RE.findall((text or "").lower())
    return set(tokens)


def compute_semantic_diff(
    *,
    previous_text: str,
    current_text: str,
    significance_threshold: float = 0.22,
) -> SemanticDiffResult:
    previous_tokens = _tokenize(previous_text)
    current_tokens = _tokenize(current_text)

    if not previous_tokens and not current_tokens:
        return SemanticDiffResult(
            significance_score=0.0,
            jaccard_distance=0.0,
            length_delta_ratio=0.0,
            added_terms=[],
            removed_terms=[],
            meaningful=False,
        )

    intersection = previous_tokens & current_tokens
    union = previous_tokens | current_tokens
    jaccard_similarity = len(intersection) / max(1, len(union))
    jaccard_distance = 1.0 - jaccard_similarity

    previous_length = max(1, len(previous_text or ""))
    current_length = max(1, len(current_text or ""))
    length_delta_ratio = min(
        1.0,
        abs(current_length - previous_length) / float(max(previous_length, current_length)),
    )

    # Non-linear blending to emphasize large conceptual shifts while tolerating small edits.
    significance_score = max(
        0.0,
        min(
            1.0,
            (0.75 * jaccard_distance) + (0.25 * math.sqrt(length_delta_ratio)),
        ),
    )

    added_terms = sorted(list(current_tokens - previous_tokens))[:100]
    removed_terms = sorted(list(previous_tokens - current_tokens))[:100]

    return SemanticDiffResult(
        significance_score=significance_score,
        jaccard_distance=jaccard_distance,
        length_delta_ratio=length_delta_ratio,
        added_terms=added_terms,
        removed_terms=removed_terms,
        meaningful=significance_score >= float(significance_threshold),
    )
