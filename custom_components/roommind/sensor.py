"""Sensor platform for RoomMind."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import RoomMindCoordinator
from .utils.area_utils import rooms_with_area
from .utils.price_utils import build_tauron_forecast


def _create_room_entities(coordinator: RoomMindCoordinator, area_id: str) -> list[SensorEntity]:
    """Create the standard set of sensor entities for a room."""
    return [
        RoomMindTargetTemperatureSensor(coordinator, area_id),
        RoomMindModeSensor(coordinator, area_id),
    ]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind sensor entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]

    # Store the callback on the coordinator so dynamic entity creation works
    coordinator.async_add_entities = async_add_entities

    # Create entities for rooms that already exist in the store
    rooms = rooms_with_area(hass, store.get_rooms())
    entities: list[SensorEntity] = []
    for area_id in rooms:
        entities.extend(_create_room_entities(coordinator, area_id))
        coordinator._entity_areas.add(area_id)
    if getattr(hass.config, "country", None) == "PL" or getattr(hass.config, "currency", None) == "PLN":
        entities.append(RoomMindTauronPriceSensor(coordinator))
    if entities:
        async_add_entities(entities)


class _RoomMindBaseSensor(CoordinatorEntity, SensorEntity):
    """Base class for all RoomMind room sensors."""

    _attr_has_entity_name = True
    # Deprecated (#238): only rooms set up before 2.0 keep them enabled; HA applies this to new registry entries only
    _attr_entity_registry_enabled_default = False
    _data_key: str  # Key in the room state dict (e.g. "current_temp")

    def __init__(
        self,
        coordinator: RoomMindCoordinator,
        area_id: str,
        suffix: str,
        name_label: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_{suffix}"
        self._attr_name = f"{area_id} {name_label}"
        self.entity_id = f"sensor.{DOMAIN}_{area_id}_{suffix}"

    @property
    def native_value(self) -> float | str | None:
        """Return the sensor value from the coordinator data."""
        room = self.coordinator.data.get("rooms", {}).get(self._area_id)
        if room:
            val = room.get(self._data_key)
            return val if isinstance(val, (float, int, str)) else None
        return None


class RoomMindTargetTemperatureSensor(_RoomMindBaseSensor):
    """Sensor showing the target temperature for a RoomMind room."""

    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _data_key = "target_temp"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "target_temp", "Target Temperature")


class RoomMindModeSensor(_RoomMindBaseSensor):
    """Sensor showing the current mode for a RoomMind room."""

    _data_key = "mode"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "mode", "Mode")

    @property
    def native_value(self) -> str | None:
        """Return the current mode, defaulting to 'idle'."""
        room = self.coordinator.data.get("rooms", {}).get(self._area_id)
        if room:
            val = room.get("mode", "idle")
            return str(val) if val is not None else "idle"
        return "idle"


class RoomMindTauronPriceSensor(CoordinatorEntity, SensorEntity):
    """Tauron Polska Energia electricity price sensor with 48h forecast (PLN/kWh)."""

    _attr_has_entity_name = False
    _attr_icon = "mdi:transmission-tower"
    _attr_native_unit_of_measurement = "PLN/kWh"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: RoomMindCoordinator, tariff: str = "G12w") -> None:
        """Initialize the Tauron electricity price sensor."""
        super().__init__(coordinator)
        self._tariff = tariff
        self._attr_unique_id = f"{DOMAIN}_tauron_electricity_price"
        self._attr_name = "Tauron Cena Prądu"
        self.entity_id = f"sensor.{DOMAIN}_tauron_electricity_price"

    @property
    def native_value(self) -> float:
        """Return the current Tauron electricity rate in PLN/kWh."""
        data = build_tauron_forecast(tariff=self._tariff)
        return float(data["current_price"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return Tauron zone info and 48h hourly price forecast for PriceManager & MPC."""
        data = build_tauron_forecast(tariff=self._tariff)
        return {
            "tariff": data["tariff"],
            "zone": data["zone"],
            "operator": data["operator"],
            "region": data["region"],
            "peak_rate_pln_kwh": data["peak_rate_pln_kwh"],
            "offpeak_rate_pln_kwh": data["offpeak_rate_pln_kwh"],
            "g11_rate_pln_kwh": data["g11_rate_pln_kwh"],
            "raw_today": data["raw_today"],
            "raw_tomorrow": data["raw_tomorrow"],
            "forecast": data["forecast"],
        }
