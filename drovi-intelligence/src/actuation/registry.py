"""Driver registry for actuation."""

from __future__ import annotations

from typing import Dict

from src.actuation.drivers.base import ActuatorDriver


_REGISTRY: Dict[str, ActuatorDriver] = {}


def register_driver(driver: ActuatorDriver) -> None:
    """Register a driver by name."""
    _REGISTRY[driver.name] = driver


def get_driver(name: str) -> ActuatorDriver:
    driver = _REGISTRY.get(name)
    if not driver:
        raise ValueError(f"Actuation driver not found: {name}")
    return driver


def list_drivers() -> list[str]:
    return sorted(_REGISTRY.keys())


def clear_registry() -> None:
    _REGISTRY.clear()
