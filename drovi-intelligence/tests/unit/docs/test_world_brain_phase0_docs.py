from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def test_world_brain_phase0_charter_exists_and_has_required_sections() -> None:
    repo = _repo_root()
    charter = repo / "docs" / "world-brain" / "WORLD_BRAIN_PHASE0_CHARTER.md"

    assert charter.exists(), "Phase 0 charter is required for execution baseline"
    text = charter.read_text(encoding="utf-8")

    assert "## Product Contract" in text
    assert "## Non-Goals" in text
    assert "## Program Owner Matrix" in text
    assert "## North-Star KPI Suite" in text
    assert "## Risk Taxonomy" in text
    assert "## Severity and SLO Policy" in text


def test_world_brain_phase0_adrs_exist_and_are_accepted() -> None:
    repo = _repo_root()
    adr_dir = repo / "docs" / "adr"
    required_adrs = [
        "ADR-0011-world-brain-cognitive-object-taxonomy.md",
        "ADR-0012-world-brain-temporal-model.md",
        "ADR-0013-world-brain-epistemic-state-machine.md",
        "ADR-0014-world-brain-kafka-topic-taxonomy.md",
        "ADR-0015-world-brain-institutional-world-twin-materialization.md",
        "ADR-0016-world-brain-intervention-policy-and-rollback.md",
    ]

    for filename in required_adrs:
        path = adr_dir / filename
        assert path.exists(), f"Missing required ADR: {filename}"
        text = path.read_text(encoding="utf-8")
        assert "## Status" in text
        assert "Accepted" in text
