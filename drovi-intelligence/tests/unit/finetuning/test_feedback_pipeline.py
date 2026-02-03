"""
Unit tests for feedback pipeline.
"""

from unittest.mock import AsyncMock, patch

import pytest

from src.finetuning.feedback_pipeline import record_uio_correction
from src.finetuning.schemas import TaskType


pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_record_uio_correction_collects_sample():
    props = {
        "labels": ["Commitment"],
        "title": "Send proposal to Acme",
        "description": "Send proposal by Friday",
    }

    memory = AsyncMock()
    memory.get_uio_evidence.return_value = {
        "uio_1": [{"quoted_text": "Send proposal by Friday"}]
    }

    collector = AsyncMock()
    collector.collect_correction = AsyncMock()

    with patch(
        "src.finetuning.feedback_pipeline.get_memory_service",
        AsyncMock(return_value=memory),
    ), patch(
        "src.finetuning.feedback_pipeline.get_collector",
        return_value=collector,
    ), patch(
        "src.finetuning.feedback_pipeline.update_org_profile",
        AsyncMock(),
    ):
        task_type = await record_uio_correction(
            organization_id="org_1",
            uio_id="uio_1",
            corrections={"canonical_title": "Send proposal to Acme"},
            user_id="user_1",
            props=props,
        )

    assert task_type == TaskType.COMMITMENT_EXTRACTION
    collector.collect_correction.assert_called()
