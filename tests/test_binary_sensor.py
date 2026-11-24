"""Tests for RoomMind binary sensor platform."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.helpers.typing import UNDEFINED

from custom_components.roommind.binary_sensor import (
    RoomMindCoverPausedSensor,
    _create_room_binary_sensors,
    async_setup_entry,
)
from custom_components.roommind.const import DOMAIN


@pytest.fixture
def mock_coordinator():
    coordinator = MagicMock()
    coordinator.data = {"rooms": {"living_room": {"cover_auto_paused": False}}}
    return coordinator


def test_cover_paused_off(mock_coordinator):
    """Binary sensor OFF when no user override active."""
    mock_coordinator.data = {"rooms": {"living_room": {"cover_auto_paused": False}}}
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "living_room")
    assert sensor.is_on is False


def test_cover_paused_on(mock_coordinator):
    """Binary sensor ON when user override is active."""
    mock_coordinator.data = {"rooms": {"living_room": {"cover_auto_paused": True}}}
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "living_room")
    assert sensor.is_on is True


def test_cover_paused_missing_room(mock_coordinator):
    """Binary sensor returns False when room doesn't exist."""
    mock_coordinator.data = {"rooms": {}}
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "nonexistent")
    assert sensor.is_on is False


def test_cover_paused_missing_key(mock_coordinator):
    """Binary sensor returns False when cover_auto_paused key is missing."""
    mock_coordinator.data = {"rooms": {"living_room": {}}}
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "living_room")
    assert sensor.is_on is False


def test_binary_sensor_unique_id_and_entity_id(mock_coordinator):
    """Binary sensor has correct unique_id and entity_id."""
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "living_room")
    assert sensor.unique_id == "roommind_living_room_cover_paused"
    assert sensor.entity_id == "binary_sensor.roommind_living_room_cover_paused"


def test_create_room_binary_sensors(mock_coordinator):
    """Factory creates exactly one binary sensor per room."""
    sensors = _create_room_binary_sensors(mock_coordinator, "living_room")
    assert len(sensors) == 1
    assert isinstance(sensors[0], RoomMindCoverPausedSensor)


def test_cover_paused_coordinator_data_none(mock_coordinator):
    """Binary sensor returns False when coordinator.data is None (before first update)."""
    mock_coordinator.data = None
    sensor = RoomMindCoverPausedSensor(mock_coordinator, "living_room")
    assert sensor.is_on is False


@pytest.mark.asyncio
async def test_async_setup_entry_creates_entities_for_rooms_with_covers():
    """async_setup_entry creates binary sensors for rooms with covers configured."""
    coordinator = MagicMock()
    coordinator._binary_sensor_entity_areas = set()

    store = MagicMock()
    store.get_rooms.return_value = {
        "living_room": {"covers": ["cover.blinds"]},
        "bedroom": {},  # no covers — should be skipped
    }

    entry = MagicMock()
    entry.entry_id = "test_entry"

    hass = MagicMock()
    hass.data = {DOMAIN: {entry.entry_id: coordinator, "store": store}}

    async_add_entities = MagicMock()

    await async_setup_entry(hass, entry, async_add_entities)

    # Callback stored on coordinator
    assert coordinator.async_add_binary_sensor_entities is async_add_entities
    # Only living_room has covers, so one entity created
    async_add_entities.assert_called_once()
    entities = async_add_entities.call_args[0][0]
    assert len(entities) == 1
    assert isinstance(entities[0], RoomMindCoverPausedSensor)
    # Area tracked
    assert "living_room" in coordinator._binary_sensor_entity_areas
    assert "bedroom" not in coordinator._binary_sensor_entity_areas


@pytest.mark.asyncio
async def test_async_setup_entry_no_covers_no_entities():
    """async_setup_entry does not call async_add_entities when no rooms have covers."""
    coordinator = MagicMock()
    coordinator._binary_sensor_entity_areas = set()

    store = MagicMock()
    store.get_rooms.return_value = {"bedroom": {}}

    entry = MagicMock()
    entry.entry_id = "test_entry"

    hass = MagicMock()
    hass.data = {DOMAIN: {entry.entry_id: coordinator, "store": store}}

    async_add_entities = MagicMock()

    await async_setup_entry(hass, entry, async_add_entities)

    async_add_entities.assert_not_called()


def _aq_coordinator(live, room=None):
    coordinator = MagicMock()
    coordinator.data = {"rooms": {"bed": live}}
    coordinator.hass.data = {DOMAIN: {"store": MagicMock(get_room=MagicMock(return_value=room or {}))}}
    return coordinator


def test_air_quality_sensor_reads_the_live_state():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    live = {
        "co2": 1250.0,
        "voc": None,
        "air_quality_bad": True,
        "air_quality_reason": "co2",
        "ventilation_active": True,
    }
    sensor = RoomMindAirQualitySensor(_aq_coordinator(live, {"display_name": "Schlafzimmer"}), "bed")
    assert sensor.unique_id == "roommind_bed_air_quality"
    assert sensor.entity_id == "binary_sensor.roommind_bed_air_quality"
    assert sensor.translation_placeholders == {"room": "Schlafzimmer"}
    assert sensor.is_on is True
    assert sensor.available is True
    assert sensor.extra_state_attributes == {"co2": 1250.0, "voc": None, "reason": "co2", "ventilation_active": True}


def test_air_quality_sensor_unavailable_without_a_reading():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    coordinator = _aq_coordinator({"co2": None, "voc": None, "air_quality_bad": False})
    sensor = RoomMindAirQualitySensor(coordinator, "bed")
    assert sensor.available is False
    assert sensor.is_on is False
    coordinator.data = None
    assert sensor.is_on is False


@pytest.mark.asyncio
async def test_async_setup_entry_creates_the_air_quality_sensor_next_to_the_cover_one():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    coordinator = MagicMock()
    coordinator._binary_sensor_entity_areas = set()
    coordinator._air_quality_entity_areas = set()
    store = MagicMock()
    store.get_rooms.return_value = {
        "living_room": {"covers": ["cover.blinds"], "co2_sensor": "sensor.co2"},
        "garden": {"co2_sensor": "sensor.garden_co2", "is_outdoor": True},
    }
    store.get_room.return_value = {"display_name": "Wohnzimmer"}
    entry = MagicMock()
    entry.entry_id = "test_entry"
    hass = MagicMock()
    hass.data = {DOMAIN: {entry.entry_id: coordinator, "store": store}}
    coordinator.hass = hass
    add = MagicMock()
    await async_setup_entry(hass, entry, add)
    entities = add.call_args[0][0]
    assert [type(e) for e in entities] == [RoomMindCoverPausedSensor, RoomMindAirQualitySensor]
    assert coordinator._air_quality_entity_areas == {"living_room"}


def test_air_quality_sensor_name_follows_a_renamed_room():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    room = {"display_name": "Schlafzimmer"}
    coordinator = _aq_coordinator({}, room)
    sensor = RoomMindAirQualitySensor(coordinator, "bed")
    # CI's older HA reads the translation key through ``platform``, newer ones through ``platform_data``
    sensor.platform = sensor.platform_data = MagicMock(
        platform_name=DOMAIN,
        domain="binary_sensor",
        platform_translations={f"component.{DOMAIN}.entity.binary_sensor.air_quality.name": "{room} air quality poor"},
    )
    assert sensor.name == "Schlafzimmer air quality poor"
    room["display_name"] = "Kinderzimmer"
    assert sensor.name == "Kinderzimmer air quality poor"
    assert RoomMindAirQualitySensor(coordinator, "bed").name is UNDEFINED


def test_air_quality_sensor_falls_back_to_the_area_name():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    sensor = RoomMindAirQualitySensor(_aq_coordinator({}), "bed")
    with patch("custom_components.roommind.binary_sensor._get_area_name", return_value="Bedroom"):
        assert sensor.translation_placeholders == {"room": "Bedroom"}


@pytest.mark.asyncio
async def test_air_quality_sensor_lands_in_its_area_once():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    sensor = RoomMindAirQualitySensor(_aq_coordinator({}), "bed")
    sensor.hass = MagicMock()
    with (
        patch("homeassistant.helpers.update_coordinator.CoordinatorEntity.async_added_to_hass", new=AsyncMock()),
        patch("custom_components.roommind.binary_sensor.assign_area_once") as assign,
    ):
        await sensor.async_added_to_hass()
    assign.assert_called_once_with(sensor.hass, "binary_sensor.roommind_bed_air_quality", "bed", DOMAIN)


def test_air_quality_binary_sensor_includes_pm_attributes():
    from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor

    coordinator = _aq_coordinator(
        {
            "co2": None,
            "voc": None,
            "pm25": 42.0,
            "pm10": 68.0,
            "pm1": 19.0,
            "air_quality_bad": True,
            "air_quality_reason": "pm25",
            "ventilation_active": True,
        }
    )
    sensor = RoomMindAirQualitySensor(coordinator, "bed")
    assert sensor.available is True
    assert sensor.is_on is True
    attrs = sensor.extra_state_attributes
    assert attrs["pm25"] == 42.0
    assert attrs["pm10"] == 68.0
    assert attrs["pm1"] == 19.0
    assert attrs["reason"] == "pm25"


def test_heat_plant_maintenance_binary_sensors():
    from custom_components.roommind.binary_sensor import _create_heat_plant_binary_sensors

    coordinator = MagicMock()
    coordinator.data = {
        "rooms": {},
        "heat_plants": {
            "coal_1": {
                "overheat_protect": False,
                "supply_temp": 60.0,
                "return_temp": 48.0,
                "ch_pump_active": True,
                "dhw_pump_active": False,
                "low_return_warning": False,
                "refill_needed": True,
                "ash_clean_needed": False,
                "chimney_clean_needed": True,
                "fuel_remaining_kg": 12.0,
                "hopper_pct": 12.0,
                "fuel_since_ash_clean_kg": 40.0,
                "fuel_since_chimney_clean_kg": 520.0,
                "chimney_wear_pct": 104.0,
            }
        },
    }
    plant = {"id": "coal_1", "name": "Piec Ekogroszek"}
    sensors = _create_heat_plant_binary_sensors(coordinator, plant)
    by_key = {s._data_key: s for s in sensors}
    assert set(by_key) == {"overheat_protect", "refill_needed", "ash_clean_needed", "chimney_clean_needed"}
    assert by_key["overheat_protect"].is_on is False
    assert by_key["overheat_protect"].extra_state_attributes["supply_temp"] == 60.0
    assert by_key["refill_needed"].is_on is True
    assert by_key["refill_needed"].extra_state_attributes["fuel_remaining_kg"] == 12.0
    assert by_key["ash_clean_needed"].is_on is False
    assert by_key["chimney_clean_needed"].is_on is True

