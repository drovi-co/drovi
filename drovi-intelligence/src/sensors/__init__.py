"""Sensor registry exports."""

from src.sensors.registry import list_sensors, get_sensor, register_sensor, register_sensors
from src.sensors.schemas import (
    SensorDefinition,
    SensorCategory,
    SensorCapability,
    SensorStatus,
    PermissionScope,
)

__all__ = [
    "list_sensors",
    "get_sensor",
    "register_sensor",
    "register_sensors",
    "SensorDefinition",
    "SensorCategory",
    "SensorCapability",
    "SensorStatus",
    "PermissionScope",
]
