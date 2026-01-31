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

# V2 Strict Prompts (for high-quality extraction)
from .prompts_v2 import (
    get_commitment_extraction_v2_prompt,
    get_decision_extraction_v2_prompt,
    get_claim_extraction_v2_prompt,
    get_contact_extraction_v2_prompt,
    get_calendar_extraction_prompt,
    get_task_extraction_v2_prompt,
    get_risk_detection_v2_prompt,
)

__all__ = [
    # Service
    "LLMService",
    "get_llm_service",
    # Schemas
    "ClassificationOutput",
    "ClaimExtractionOutput",
    "CommitmentExtractionOutput",
    "DecisionExtractionOutput",
    "RiskDetectionOutput",
    "TaskExtractionOutput",
    "ContactExtractionOutput",
    # V2 Prompts
    "get_commitment_extraction_v2_prompt",
    "get_decision_extraction_v2_prompt",
    "get_claim_extraction_v2_prompt",
    "get_contact_extraction_v2_prompt",
    "get_calendar_extraction_prompt",
    "get_task_extraction_v2_prompt",
    "get_risk_detection_v2_prompt",
]
