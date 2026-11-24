"""Binary sensor platform for RoomMind."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.typing import UNDEFINED, UndefinedType
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import RoomMindCoordinator, _get_area_name, has_air_quality_sensor
from .managers.heat_plant_manager import SOLID_FUEL_TYPES
from .utils.area_utils import assign_area_once, rooms_with_area


def _create_room_binary_sensors(
    coordinator: RoomMindCoordinator,
    area_id: str,
) -> list[BinarySensorEntity]:
    """Create binary sensor entities for a room."""
    return [RoomMindCoverPausedSensor(coordinator, area_id)]


_HEAT_PLANT_MAINTENANCE_SPECS: tuple[tuple[str, str, str, str, BinarySensorDeviceClass], ...] = (
    ("refill_needed", "Potrzebne dołożenie opału", "refill_needed", "mdi:fire-alert", BinarySensorDeviceClass.PROBLEM),
    (
        "ash_clean_needed",
        "Potrzebne opróżnienie popielnika",
        "ash_clean_needed",
        "mdi:delete-alert",
        BinarySensorDeviceClass.PROBLEM,
    ),
    (
        "chimney_clean_needed",
        "Potrzebne czyszczenie komina",
        "chimney_clean_needed",
        "mdi:chimney",
        BinarySensorDeviceClass.PROBLEM,
    ),
)

_HEAT_PLANT_OVERHEAT_SPEC = (
    "overheat",
    "Alarm przegrzania",
    "overheat_protect",
    "mdi:thermometer-alert",
    BinarySensorDeviceClass.HEAT,
)


def _create_heat_plant_binary_sensors(
    coordinator: RoomMindCoordinator,
    plant_cfg: dict[str, Any],
) -> list[BinarySensorEntity]:
    """Create overheat and maintenance alert binary sensors for heat plants."""
    plant_id = str(plant_cfg.get("id") or "")
    if not plant_id:
        return []
    entities: list[BinarySensorEntity] = [
        RoomMindHeatPlantMaintenanceBinarySensor(coordinator, plant_id, *_HEAT_PLANT_OVERHEAT_SPEC),
    ]
    fuel_type = str(plant_cfg.get("fuel_type") or "coal")
    if fuel_type in SOLID_FUEL_TYPES:
        entities.extend(
            RoomMindHeatPlantMaintenanceBinarySensor(coordinator, plant_id, *spec)
            for spec in _HEAT_PLANT_MAINTENANCE_SPECS
        )
    return entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind binary sensor entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]
    coordinator.async_add_binary_sensor_entities = async_add_entities
    if not hasattr(coordinator, "_heat_plant_binary_sensor_ids") or not isinstance(
        getattr(coordinator, "_heat_plant_binary_sensor_ids", None), set
    ):
        coordinator._heat_plant_binary_sensor_ids = set()

    rooms = rooms_with_area(hass, store.get_rooms())
    entities: list[BinarySensorEntity] = []
    for area_id, room in rooms.items():
        if room.get("covers"):
            entities.extend(_create_room_binary_sensors(coordinator, area_id))
            coordinator._binary_sensor_entity_areas.add(area_id)
        if has_air_quality_sensor(room):
            entities.append(RoomMindAirQualitySensor(coordinator, area_id))
            coordinator._air_quality_entity_areas.add(area_id)

    settings = store.get_settings() if hasattr(store, "get_settings") else {}
    raw_plants = settings.get("heat_plants", []) if isinstance(settings, dict) else []
    if isinstance(raw_plants, list):
        for plant_cfg in raw_plants:
            if isinstance(plant_cfg, dict) and plant_cfg.get("id"):
                pid = str(plant_cfg["id"])
                plant_ents = _create_heat_plant_binary_sensors(coordinator, plant_cfg)
                if plant_ents:
                    entities.extend(plant_ents)
                    coordinator._heat_plant_binary_sensor_ids.add(pid)

    if entities:
        async_add_entities(entities)


class RoomMindCoverPausedSensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor indicating if cover auto-control is paused by user override."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_cover_paused"
        self._attr_name = f"{area_id} Cover Paused"
        self._attr_icon = "mdi:hand-back-right"
        self.entity_id = f"binary_sensor.{DOMAIN}_{area_id}_cover_paused"

    @property
    def is_on(self) -> bool:
        """Return True if user override is active (auto-control paused)."""
        if self.coordinator.data is None:
            return False
        room = self.coordinator.data.get("rooms", {}).get(self._area_id)
        return bool(room.get("cover_auto_paused", False)) if room else False


class RoomMindAirQualitySensor(CoordinatorEntity, BinarySensorEntity):
    """On while the room's air is bad (CO2, VOC, or PM2.5/PM10/PM1 past threshold), for own automations."""

    _attr_has_entity_name = True
    _attr_translation_key = "air_quality"
    _attr_icon = "mdi:molecule-co2"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_air_quality"
        self.entity_id = f"binary_sensor.{DOMAIN}_{area_id}_air_quality"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        assign_area_once(self.hass, self.entity_id, self._area_id, DOMAIN)

    @property
    def translation_placeholders(self) -> dict[str, str]:
        room = self.coordinator.hass.data[DOMAIN]["store"].get_room(self._area_id) or {}
        return {"room": room.get("display_name") or _get_area_name(self.coordinator.hass, self._area_id)}

    @property
    def name(self) -> str | UndefinedType | None:
        # HA caches the name; built on every write so a renamed room shows without a restart
        platform_data = getattr(self, "platform_data", None)
        if platform_data is None:
            return UNDEFINED
        return self._name_internal(None, platform_data.platform_translations)

    def _live(self) -> dict:
        live: dict = ((self.coordinator.data or {}).get("rooms") or {}).get(self._area_id) or {}
        return live

    @property
    def available(self) -> bool:
        """Unavailable while no air quality sensor delivers a reading."""
        live = self._live()
        return super().available and any(
            live.get(k) is not None for k in ("co2", "voc", "pm25", "pm10", "pm1")
        )

    @property
    def is_on(self) -> bool:
        return bool(self._live().get("air_quality_bad", False))

    @property
    def extra_state_attributes(self) -> dict:
        live = self._live()
        attrs = {
            "co2": live.get("co2"),
            "voc": live.get("voc"),
            "reason": live.get("air_quality_reason"),
            "ventilation_active": live.get("ventilation_active", False),
        }
        if any(k in live and live.get(k) is not None for k in ("pm25", "pm10", "pm1")):
            attrs["pm25"] = live.get("pm25")
            attrs["pm10"] = live.get("pm10")
            attrs["pm1"] = live.get("pm1")
        return attrs


class RoomMindHeatPlantMaintenanceBinarySensor(CoordinatorEntity, BinarySensorEntity):
    """Binary sensor indicating a heat plant needs refueling, ash emptying, or chimney cleaning."""

    _attr_has_entity_name = False
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_registry_enabled_default = True

    def __init__(
        self,
        coordinator: RoomMindCoordinator,
        plant_id: str,
        suffix: str,
        label: str,
        data_key: str,
        icon: str,
        device_class: BinarySensorDeviceClass = BinarySensorDeviceClass.PROBLEM,
    ) -> None:
        super().__init__(coordinator)
        self._plant_id = plant_id
        self._label = label
        self._data_key = data_key
        self._attr_unique_id = f"{DOMAIN}_plant_{plant_id}_{suffix}"
        self._attr_icon = icon
        self._attr_device_class = device_class
        self.entity_id = f"binary_sensor.{DOMAIN}_plant_{plant_id}_{suffix}"

    def _plant_cfg(self) -> dict[str, Any]:
        store = self.coordinator.hass.data.get(DOMAIN, {}).get("store") if self.coordinator.hass else None
        settings = store.get_settings() if store else {}
        for p in settings.get("heat_plants", []) if isinstance(settings, dict) else []:
            if isinstance(p, dict) and p.get("id") == self._plant_id:
                return p
        return {}

    def _live(self) -> dict[str, Any]:
        plants_live = getattr(self.coordinator, "heat_plants_live", None)
        if isinstance(plants_live, dict) and self._plant_id in plants_live:
            return plants_live[self._plant_id]
        data_plants = (self.coordinator.data or {}).get("heat_plants")
        if isinstance(data_plants, dict) and self._plant_id in data_plants:
            return data_plants[self._plant_id]
        return {}

    @property
    def name(self) -> str:
        cfg = self._plant_cfg()
        plant_name = str(cfg.get("name") or self._plant_id)
        return f"{plant_name} — {self._label}"

    @property
    def is_on(self) -> bool:
        return bool(self._live().get(self._data_key, False))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        live = self._live()
        if self._data_key == "overheat_protect":
            return {
                "supply_temp": live.get("supply_temp"),
                "return_temp": live.get("return_temp"),
                "ch_pump_active": live.get("ch_pump_active"),
                "dhw_pump_active": live.get("dhw_pump_active"),
                "low_return_warning": live.get("low_return_warning"),
            }
        if self._data_key == "refill_needed":
            return {
                "fuel_remaining_kg": live.get("fuel_remaining_kg"),
                "hopper_pct": live.get("hopper_pct"),
                "hours_until_refill": live.get("hours_until_refill"),
                "fuel_since_refill_kg": live.get("fuel_since_refill_kg"),
            }
        if self._data_key == "ash_clean_needed":
            return {
                "fuel_since_ash_clean_kg": live.get("fuel_since_ash_clean_kg"),
                "estimated_ash_kg": live.get("estimated_ash_kg"),
                "ash_fill_pct": live.get("ash_fill_pct"),
                "days_since_ash_clean": live.get("days_since_ash_clean"),
            }
        if self._data_key == "chimney_clean_needed":
            return {
                "fuel_since_chimney_clean_kg": live.get("fuel_since_chimney_clean_kg"),
                "chimney_wear_pct": live.get("chimney_wear_pct"),
                "days_since_chimney_clean": live.get("days_since_chimney_clean"),
            }
        return {}
