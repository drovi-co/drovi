"""
Unit tests for GraphRAG temporal consistency helpers.
"""

from datetime import datetime
from unittest.mock import patch

import pytest

from src.graphrag.query import DroviGraphRAG


pytestmark = pytest.mark.unit


class TestTemporalConsistency:
    def test_temporal_split_classifies_results(self):
        graphrag = DroviGraphRAG()
        now = datetime(2024, 1, 10, 12, 0, 0)

        results = [
            {"id": "historical", "valid_to": "2024-01-01T00:00:00"},
            {"id": "future", "valid_from": "2024-02-01T00:00:00"},
            {"id": "current", "valid_from": "2024-01-05T00:00:00", "valid_to": "2024-02-01T00:00:00"},
            {"id": "unknown"},
            {"id": "cross", "commitment_valid_to": "2024-01-05T00:00:00"},
        ]

        with patch("src.graphrag.query.utc_now", return_value=now):
            temporal = graphrag._apply_temporal_consistency(results)

        ids_current = {r["id"] for r in temporal["current"]}
        ids_historical = {r["id"] for r in temporal["historical"]}
        ids_future = {r["id"] for r in temporal["future"]}

        assert "current" in ids_current
        assert "unknown" in ids_current
        assert "historical" in ids_historical
        assert "cross" in ids_historical
        assert "future" in ids_future
