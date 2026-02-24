from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def test_phase14_dlq_replay_runbook_exists_with_required_sections() -> None:
    repo = _repo_root()
    runbook = repo / "docs" / "world-brain" / "runbooks" / "DLQ_BACKLOG_AND_REPLAY_STORM_RUNBOOK.md"
    assert runbook.exists(), "Phase 14 DLQ/replay runbook is required"
    text = runbook.read_text(encoding="utf-8")
    assert "## 1. Detection Signals" in text
    assert "## 2. Immediate Containment" in text
    assert "## 4. Replay Recovery" in text
    assert "## 5. Exit Criteria" in text


def test_phase14_multi_region_drill_runbook_exists_with_required_sections() -> None:
    repo = _repo_root()
    runbook = repo / "docs" / "world-brain" / "runbooks" / "MULTI_REGION_BACKUP_RESTORE_DRILL_RUNBOOK.md"
    assert runbook.exists(), "Phase 14 DR drill runbook is required"
    text = runbook.read_text(encoding="utf-8")
    assert "## 1. Drill Objectives" in text
    assert "## 3. Execution Steps" in text
    assert "## 5. Pass/Fail Rules" in text
