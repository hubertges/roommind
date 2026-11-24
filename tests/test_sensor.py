"""Tests for the sensor platform."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import DOMAIN
from custom_components.roommind.sensor import (
    RoomMindModeSensor,
    RoomMindTargetTemperatureSensor,
    RoomMindTauronPriceSensor,
    _create_room_entities,
    async_setup_entry,
)
from custom_components.roommind.utils.price_utils import build_tauron_forecast, signal_from_state


def _make_coordinator(rooms_data=None):
    """Build a mock coordinator with data dict."""
    coordinator = MagicMock()
    coordinator.data = {"rooms": rooms_data or {}}
    return coordinator


@pytest.mark.asyncio
async def test_setup_entry_creates_entities(hass, mock_config_entry, store):
    """Entities are created for each existing room."""
    await store.async_load()
    await store.async_save_room("room_a", {"thermostats": ["climate.trv1"]})

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    # Callback stored on coordinator
    assert coordinator.async_add_entities is add_entities
    # 2 entities per room (target_temp + mode)
    add_entities.assert_called_once()
    entities = add_entities.call_args[0][0]
    assert len(entities) == 2


@pytest.mark.asyncio
async def test_setup_entry_no_rooms(hass, mock_config_entry, store):
    """No entities created when store has no rooms."""
    await store.async_load()

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    assert coordinator.async_add_entities is add_entities
    add_entities.assert_not_called()


@pytest.mark.asyncio
async def test_setup_entry_multiple_rooms(hass, mock_config_entry, store):
    """Entities created for each room."""
    await store.async_load()
    await store.async_save_room("room_a", {"thermostats": ["climate.trv1"]})
    await store.async_save_room("room_b", {"thermostats": ["climate.trv2"]})

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    entities = add_entities.call_args[0][0]
    assert len(entities) == 4  # 2 per room


def test_create_room_entities():
    """_create_room_entities returns target temp and mode sensors."""
    coordinator = _make_coordinator()
    entities = _create_room_entities(coordinator, "room_a")
    assert len(entities) == 2
    assert isinstance(entities[0], RoomMindTargetTemperatureSensor)
    assert isinstance(entities[1], RoomMindModeSensor)


def test_target_temp_sensor_value():
    """Target temperature sensor returns value from room data."""
    coordinator = _make_coordinator({"room_a": {"target_temp": 21.5}})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value == 21.5


def test_target_temp_sensor_missing_room():
    """Target temperature sensor returns None when room is missing."""
    coordinator = _make_coordinator({})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_target_temp_sensor_missing_key():
    """Target temperature sensor returns None when key is missing."""
    coordinator = _make_coordinator({"room_a": {"mode": "idle"}})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_mode_sensor_value():
    """Mode sensor returns value from room data."""
    coordinator = _make_coordinator({"room_a": {"mode": "heating"}})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value == "heating"


def test_mode_sensor_defaults_to_idle():
    """Mode sensor defaults to 'idle' when key is missing."""
    coordinator = _make_coordinator({"room_a": {"target_temp": 21.0}})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value == "idle"


def test_mode_sensor_missing_room():
    """Mode sensor returns 'idle' when room is missing."""
    coordinator = _make_coordinator({})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value == "idle"


def test_sensor_unique_id():
    """Sensors have correct unique_id format."""
    coordinator = _make_coordinator()
    temp_sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    mode_sensor = RoomMindModeSensor(coordinator, "room_a")
    assert temp_sensor.unique_id == f"{DOMAIN}_room_a_target_temp"
    assert mode_sensor.unique_id == f"{DOMAIN}_room_a_mode"


def test_sensor_entity_id():
    """Sensors have correct entity_id format."""
    coordinator = _make_coordinator()
    temp_sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    mode_sensor = RoomMindModeSensor(coordinator, "room_a")
    assert temp_sensor.entity_id == f"sensor.{DOMAIN}_room_a_target_temp"
    assert mode_sensor.entity_id == f"sensor.{DOMAIN}_room_a_mode"


def test_deprecated_sensors_are_disabled_for_new_rooms():
    """New registry entries of the deprecated sensors start disabled (#238)."""
    coordinator = _make_coordinator()
    assert RoomMindTargetTemperatureSensor(coordinator, "room_a").entity_registry_enabled_default is False
    assert RoomMindModeSensor(coordinator, "room_a").entity_registry_enabled_default is False


@pytest.mark.asyncio
async def test_setup_entry_creates_tauron_price_sensor_for_poland(hass, mock_config_entry, store):
    """Tauron electricity price sensor is created automatically when HA is configured for Poland/PLN."""
    await store.async_load()
    hass.config.country = "PL"
    hass.config.currency = "PLN"

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    add_entities.assert_called_once()
    entities = add_entities.call_args[0][0]
    assert len(entities) == 1
    sensor = entities[0]
    assert isinstance(sensor, RoomMindTauronPriceSensor)
    assert sensor.entity_id == "sensor.roommind_tauron_electricity_price"
    assert sensor.native_unit_of_measurement == "PLN/kWh"
    assert isinstance(sensor.native_value, float)
    attrs = sensor.extra_state_attributes
    assert len(attrs["raw_today"]) == 24
    assert len(attrs["raw_tomorrow"]) == 24
    assert len(attrs["forecast"]) == 48

    # Verify PriceManager / signal_from_state parses the Tauron forecast and detects cheap/expensive hours
    import time

    sig = signal_from_state("sensor", str(sensor.native_value), attrs, time.time())
    assert sig is not None
    assert sig.has_forecast is True


def test_tauron_forecast_weekday_zones():
    """Weekday off-peak hours (13:00-15:00, 22:00-06:00) have lower rate than peak hours."""
    from datetime import UTC, datetime

    # Wednesday 2026-11-25 10:00 UTC
    ts = datetime(2026, 11, 25, 10, 0, tzinfo=UTC).timestamp()
    data = build_tauron_forecast(now_ts=ts, tariff="G12w")
    prices = {entry["price"] for entry in data["raw_today"]}
    assert len(prices) == 2
    assert min(prices) < max(prices)


def test_room_humidity_dashboard_sensors():
    """Rooms with humidifier control expose enabled-by-default humidity action, target, and power sensors."""
    from custom_components.roommind.sensor import (
        RoomMindHumidifyingPowerSensor,
        RoomMindHumidityActionSensor,
        RoomMindHumidityTargetSensor,
        _create_room_humidity_sensors,
        has_humidity_dashboard_sensors,
    )

    assert has_humidity_dashboard_sensors({"thermostats": ["climate.trv1"]}) is False
    assert has_humidity_dashboard_sensors({"humidifier_entity": "humidifier.living"}) is True
    assert has_humidity_dashboard_sensors({"humidity_min": 45}) is True

    coordinator = _make_coordinator(
        {
            "living": {
                "humidity_action": "humidifying",
                "target_humidity": 50.0,
                "humidifying_power": 65,
                "humidifier_active": True,
                "humidity_mpc_active": True,
            }
        }
    )
    sensors = _create_room_humidity_sensors(coordinator, "living")
    assert len(sensors) == 3
    assert isinstance(sensors[0], RoomMindHumidityActionSensor)
    assert isinstance(sensors[1], RoomMindHumidityTargetSensor)
    assert isinstance(sensors[2], RoomMindHumidifyingPowerSensor)
    assert all(s.entity_registry_enabled_default is True for s in sensors)
    assert sensors[0].native_value == "humidifying"
    assert sensors[1].native_value == 50.0
    assert sensors[2].native_value == 65


def test_heat_plant_dashboard_sensors():
    """Heat plants expose enabled-by-default sensors for temps, power, kg fuel, cost, hopper, ash, and chimney."""
    from custom_components.roommind.sensor import _create_heat_plant_sensors

    coordinator = MagicMock()
    coordinator.data = {
        "rooms": {},
        "heat_plants": {
            "coal_1": {
                "state": "hold",
                "supply_temp": 48.5,
                "return_temp": 39.0,
                "dhw_temp": 52.0,
                "flue_temp": 120.0,
                "delta_t": 9.5,
                "current_thermal_kw": 2.4,
                "burn_rate_per_h": 0.45,
                "fuel_consumed_today": 14.2,
                "fuel_consumed_total": 340.5,
                "cost_today": 21.3,
                "cost_total": 510.75,
                "fuel_remaining_kg": 42.0,
                "ash_fill_pct": 31.0,
                "chimney_wear_pct": 45.0,
                "fuel_unit": "kg",
            }
        },
    }
    plant = {"id": "coal_1", "name": "Piec Ekogroszek", "currency": "PLN", "fuel_type": "coal"}
    sensors = _create_heat_plant_sensors(coordinator, plant)
    by_suffix = {s._spec.suffix: s for s in sensors}
    assert by_suffix["state"].native_value == "hold"
    assert by_suffix["supply_temp"].native_value == 48.5
    assert by_suffix["fuel_today"].native_value == 14.2
    assert by_suffix["fuel_today"].native_unit_of_measurement == "kg"
    assert by_suffix["cost_today"].native_value == 21.3
    assert by_suffix["cost_today"].native_unit_of_measurement == "PLN"
    assert by_suffix["fuel_remaining"].native_value == 42.0
    assert by_suffix["ash_level"].native_value == 31.0
    assert by_suffix["chimney_wear"].native_value == 45.0
    assert all(s.entity_registry_enabled_default is True for s in sensors)

