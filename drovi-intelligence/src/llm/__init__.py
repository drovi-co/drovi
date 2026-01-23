"""LLM Service Layer with LiteLLM multi-provider routing."""

from .service import LLMService, get_llm_service
from .schemas import (
    ClassificationOutput,
    ClaimExtractionOutput,
    CommitmentExtractionOutput,
    DecisionExtractionOutput,
    RiskDetectionOutput,
    TaskExtractionOutput,
    ContactExtractionOutput,
)

__all__ = [
    "LLMService",
    "get_llm_service",
    "ClassificationOutput",
    "ClaimExtractionOutput",
    "CommitmentExtractionOutput",
    "DecisionExtractionOutput",
    "RiskDetectionOutput",
    "TaskExtractionOutput",
    "ContactExtractionOutput",
]
