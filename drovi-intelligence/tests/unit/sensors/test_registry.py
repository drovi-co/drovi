import pytest

from src.sensors import registry
from src.sensors.schemas import SensorDefinition, SensorCategory


def test_builtin_sensors_loaded():
    sensors = registry.list_sensors()
    assert sensors
    assert any(sensor.id == "sensor.email" for sensor in sensors)


def test_register_sensor_duplicate():
    registry.clear_registry()
    sensor = SensorDefinition(
        id="sensor.test",
        name="Test Sensor",
        category=SensorCategory.SYSTEM,
        description="Test",
    )
    registry.register_sensor(sensor)

    with pytest.raises(ValueError):
        registry.register_sensor(sensor)

    registry.clear_registry()
    registry.register_sensors(registry._builtin_sensors())
