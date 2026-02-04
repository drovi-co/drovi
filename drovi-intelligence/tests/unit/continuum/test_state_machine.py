from src.continuum.models import ContinuumStatus
from src.continuum.state_machine import can_transition, require_transition


def test_valid_transition():
    assert can_transition(ContinuumStatus.DRAFT, ContinuumStatus.ACTIVE) is True
    assert can_transition(ContinuumStatus.ACTIVE, ContinuumStatus.PAUSED) is True


def test_invalid_transition():
    assert can_transition(ContinuumStatus.COMPLETED, ContinuumStatus.PAUSED) is False
    try:
        require_transition(ContinuumStatus.COMPLETED, ContinuumStatus.PAUSED)
    except ValueError as exc:
        assert "Invalid Continuum transition" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid transition")
