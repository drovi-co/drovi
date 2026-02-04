from src.actuation import load_builtin_drivers
from src.actuation.registry import clear_registry, list_drivers


def test_builtin_drivers_registered():
    clear_registry()
    load_builtin_drivers()
    drivers = list_drivers()
    assert "email" in drivers
    assert "docs" in drivers
    assert "calendar" in drivers
    assert "slack" in drivers
    assert "crm" in drivers
    assert "repo" in drivers
