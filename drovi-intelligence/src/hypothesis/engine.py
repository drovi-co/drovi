"""Alternative hypothesis generation and ranking."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from typing import Any


def _stable_id(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class HypothesisCandidate:
    hypothesis_id: str
    belief_id: str
    hypothesis_text: str
    prior_probability: float
    posterior_probability: float
    evidence_fit: float
    novelty: float
    confidence: float
    tags: list[str] = field(default_factory=list)

    def score(self) -> float:
        return (
            (0.45 * self.posterior_probability)
            + (0.30 * self.evidence_fit)
            + (0.15 * self.novelty)
            + (0.10 * self.confidence)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "hypothesis_id": self.hypothesis_id,
            "belief_id": self.belief_id,
            "hypothesis_text": self.hypothesis_text,
            "prior_probability": round(self.prior_probability, 4),
            "posterior_probability": round(self.posterior_probability, 4),
            "evidence_fit": round(self.evidence_fit, 4),
            "novelty": round(self.novelty, 4),
            "confidence": round(self.confidence, 4),
            "tags": list(self.tags),
            "score": round(self.score(), 4),
        }


class HypothesisEngine:
    """Generates competing explanations for a belief proposition."""

    def generate_alternatives(
        self,
        *,
        belief_id: str,
        proposition: str,
        observations: list[str],
        base_probability: float = 0.5,
        max_candidates: int = 3,
    ) -> list[HypothesisCandidate]:
        normalized_proposition = proposition.strip()
        normalized_observations = [item.strip() for item in observations if item.strip()]
        observation_count = len(normalized_observations)

        base = _clamp(base_probability, 0.01, 0.99)
        evidence_density = _clamp(observation_count / 10.0, 0.0, 1.0)

        candidates = [
            self._build_candidate(
                belief_id=belief_id,
                proposition=normalized_proposition,
                variant="primary_mechanism",
                text=f"Primary mechanism remains valid: {normalized_proposition}",
                prior=base,
                posterior=_clamp(base + (0.15 * evidence_density), 0.01, 0.99),
                evidence_fit=_clamp(0.55 + (0.35 * evidence_density), 0.0, 1.0),
                novelty=0.3,
                confidence=_clamp(0.5 + (0.3 * evidence_density), 0.0, 1.0),
                tags=["baseline"],
            ),
            self._build_candidate(
                belief_id=belief_id,
                proposition=normalized_proposition,
                variant="measurement_error",
                text=f"Observed shift is partially explained by measurement drift around: {normalized_proposition}",
                prior=_clamp(0.20 + ((1 - evidence_density) * 0.25), 0.01, 0.99),
                posterior=_clamp(0.30 + ((1 - evidence_density) * 0.35), 0.01, 0.99),
                evidence_fit=_clamp(0.45 + ((1 - evidence_density) * 0.30), 0.0, 1.0),
                novelty=0.7,
                confidence=0.55,
                tags=["data_quality", "alternative"],
            ),
            self._build_candidate(
                belief_id=belief_id,
                proposition=normalized_proposition,
                variant="external_driver",
                text=f"An external driver now dominates outcomes linked to: {normalized_proposition}",
                prior=0.35,
                posterior=_clamp(0.40 + (0.25 * evidence_density), 0.01, 0.99),
                evidence_fit=_clamp(0.40 + (0.30 * evidence_density), 0.0, 1.0),
                novelty=0.8,
                confidence=0.6,
                tags=["external_shock", "alternative"],
            ),
            self._build_candidate(
                belief_id=belief_id,
                proposition=normalized_proposition,
                variant="adversarial_signal",
                text=f"Signal contamination or adversarial behavior is distorting evidence for: {normalized_proposition}",
                prior=0.15,
                posterior=_clamp(0.20 + ((1 - evidence_density) * 0.3), 0.01, 0.99),
                evidence_fit=_clamp(0.25 + ((1 - evidence_density) * 0.35), 0.0, 1.0),
                novelty=0.95,
                confidence=0.45,
                tags=["adversarial", "alternative"],
            ),
        ]

        ranked = sorted(candidates, key=lambda item: item.score(), reverse=True)
        return ranked[:max(1, max_candidates)]

    def reject_low_quality(
        self,
        candidates: list[HypothesisCandidate],
        *,
        min_score: float = 0.45,
    ) -> tuple[list[HypothesisCandidate], list[HypothesisCandidate]]:
        accepted: list[HypothesisCandidate] = []
        rejected: list[HypothesisCandidate] = []
        for candidate in candidates:
            if candidate.score() >= min_score:
                accepted.append(candidate)
            else:
                rejected.append(candidate)
        return accepted, rejected

    @staticmethod
    def _build_candidate(
        *,
        belief_id: str,
        proposition: str,
        variant: str,
        text: str,
        prior: float,
        posterior: float,
        evidence_fit: float,
        novelty: float,
        confidence: float,
        tags: list[str],
    ) -> HypothesisCandidate:
        candidate_id = f"hyp_{_stable_id(f'{belief_id}:{variant}:{proposition}')}"
        return HypothesisCandidate(
            hypothesis_id=candidate_id,
            belief_id=belief_id,
            hypothesis_text=text,
            prior_probability=_clamp(prior, 0.01, 0.99),
            posterior_probability=_clamp(posterior, 0.01, 0.99),
            evidence_fit=_clamp(evidence_fit, 0.0, 1.0),
            novelty=_clamp(novelty, 0.0, 1.0),
            confidence=_clamp(confidence, 0.0, 1.0),
            tags=list(tags),
        )
