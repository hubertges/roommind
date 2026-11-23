"""Humidifier platform for RoomMind per-room humidity control."""

from __future__ import annotations

from typing import Any

from homeassistant.components.humidifier import (
    MODE_COMFORT,
    MODE_ECO,
    MODE_NORMAL,
    HumidifierAction,
    HumidifierDeviceClass,
    HumidifierEntity,
    HumidifierEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import (
    DEFAULT_COMFORT_DEHUMIDIFY,
    DEFAULT_COMFORT_HUMIDIFY,
    DOMAIN,
    HUMIDITY_LIMIT_GAP,
    HUMIDITY_MODE_AUTO,
    HUMIDITY_MODE_DEHUMIDIFY_ONLY,
    HUMIDITY_MODE_HUMIDIFY_ONLY,
    MAX_TARGET_HUMIDITY,
    MIN_TARGET_HUMIDITY,
    MODE_DEHUMIDIFYING,
    MODE_HUMIDIFYING,
    OVERRIDE_BOOST,
    OVERRIDE_CUSTOM,
    OVERRIDE_ECO,
    is_humidity_override_active,
)
from .coordinator import RoomMindCoordinator, _get_area_name
from .utils.area_utils import assign_area_once, rooms_with_area
from .utils.schedule_utils import (
    humidity_band_in_force,
    humidity_override_preset_band,
    mask_humidity_override_band,
    override_hold_until,
)

MODE_MANUAL = "manual"
_OVERRIDE_TO_MODE: dict[str, str] = {
    OVERRIDE_BOOST: MODE_COMFORT,
    OVERRIDE_ECO: MODE_ECO,
    OVERRIDE_CUSTOM: MODE_MANUAL,
}
_MODE_TO_OVERRIDE: dict[str, str] = {
    MODE_COMFORT: OVERRIDE_BOOST,
    MODE_ECO: OVERRIDE_ECO,
}


def _create_room_humidifiers(
    coordinator: RoomMindCoordinator,
    area_id: str,
) -> list[HumidifierEntity]:
    """Create humidifier entity for a room."""
    return [RoomMindRoomHumidifier(coordinator, area_id)]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind humidifier entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]
    coordinator.async_add_humidifier_entities = async_add_entities
    rooms = rooms_with_area(hass, store.get_rooms())
    entities: list[HumidifierEntity] = []
    for area_id in rooms:
        entities.extend(_create_room_humidifiers(coordinator, area_id))
        coordinator._humidifier_entity_areas.add(area_id)
    if entities:
        async_add_entities(entities)


class RoomMindRoomHumidifier(CoordinatorEntity, HumidifierEntity):
    """The room as a unified humidifier/hygrostat entity with MPC and schedule presets."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:air-humidifier"
    _attr_min_humidity = MIN_TARGET_HUMIDITY
    _attr_max_humidity = MAX_TARGET_HUMIDITY
    _attr_available_modes = [MODE_NORMAL, MODE_COMFORT, MODE_ECO, MODE_MANUAL]
    _attr_supported_features = HumidifierEntityFeature.MODES

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_humidifier"
        self.entity_id = f"humidifier.{DOMAIN}_{area_id}"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._assign_area_once()

    @callback
    def _assign_area_once(self) -> None:
        assign_area_once(self.hass, self.entity_id, self._area_id, DOMAIN)

    def _store(self) -> Any:
        return self.coordinator.hass.data[DOMAIN]["store"]

    def _room(self) -> dict:
        room: dict | None = self._store().get_room(self._area_id)
        return room or {}

    def _live(self) -> dict:
        live: dict = ((self.coordinator.data or {}).get("rooms") or {}).get(self._area_id) or {}
        return live

    def _humidity_mode(self) -> str:
        mode: str = self._room().get("humidity_mode", HUMIDITY_MODE_AUTO)
        return mode

    def _override_in_force(self) -> bool:
        return is_humidity_override_active(self._room()) and not self._live().get(
            "override_suppressed", False
        )

    @property
    def name(self) -> str:
        base = self._room().get("display_name") or _get_area_name(
            self.coordinator.hass, self._area_id
        )
        return f"{base} Humidity"

    @property
    def device_class(self) -> HumidifierDeviceClass:
        room = self._room()
        if (
            self._humidity_mode() == HUMIDITY_MODE_DEHUMIDIFY_ONLY
            or (room.get("dehumidifier_entity") and not room.get("humidifier_entity"))
        ):
            return HumidifierDeviceClass.DEHUMIDIFIER
        return HumidifierDeviceClass.HUMIDIFIER

    @property
    def is_on(self) -> bool:
        room = self._room()
        if room.get("is_outdoor", False) or not room.get("climate_control_enabled", True):
            return False
        if not self._store().get_settings().get("climate_control_active", True):
            return False
        hum, dehum = humidity_band_in_force(room, self._live())
        return hum is not None or dehum is not None

    @property
    def action(self) -> HumidifierAction | None:
        if not self.is_on:
            return HumidifierAction.OFF
        live = self._live()
        if not live:
            return HumidifierAction.IDLE
        h_action = live.get("humidity_action", "idle")
        if h_action == MODE_HUMIDIFYING or live.get("humidifier_active"):
            return HumidifierAction.HUMIDIFYING
        if (
            h_action == MODE_DEHUMIDIFYING
            or live.get("dehumidifier_active")
            or live.get("ac_dry_active")
            or live.get("humidity_ventilate")
        ):
            return HumidifierAction.DRYING
        return HumidifierAction.IDLE

    @property
    def current_humidity(self) -> float | None:
        val = self._live().get("current_humidity")
        return float(val) if isinstance(val, (int, float)) else None

    @property
    def target_humidity(self) -> float | None:
        room = self._room()
        live = self._live()
        hum, dehum = humidity_band_in_force(room, live)
        h_mode = self._humidity_mode()
        if h_mode == HUMIDITY_MODE_DEHUMIDIFY_ONLY:
            return float(dehum) if isinstance(dehum, (int, float)) else DEFAULT_COMFORT_DEHUMIDIFY
        if h_mode == HUMIDITY_MODE_HUMIDIFY_ONLY:
            return float(hum) if isinstance(hum, (int, float)) else DEFAULT_COMFORT_HUMIDIFY
        h_action = live.get("humidity_action", "idle")
        if h_action == MODE_DEHUMIDIFYING and isinstance(dehum, (int, float)):
            return float(dehum)
        if isinstance(hum, (int, float)):
            return float(hum)
        if isinstance(dehum, (int, float)):
            return float(dehum)
        return DEFAULT_COMFORT_HUMIDIFY

    @property
    def mode(self) -> str | None:
        if not self._override_in_force():
            return str(MODE_NORMAL)
        return _OVERRIDE_TO_MODE.get(
            self._room().get("override_humidity_type") or "",
            str(MODE_MANUAL),
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        room = self._room()
        live = self._live()
        hum, dehum = humidity_band_in_force(room, live)
        until = room.get("override_humidity_until") if self._override_in_force() else None
        return {
            "humidity_mode": self._humidity_mode(),
            "humidify_target": hum,
            "dehumidify_target": dehum,
            "humidity_action": live.get("humidity_action", "idle"),
            "humidifying_power": live.get("humidifying_power", 0),
            "humidity_device_setpoint": live.get("humidity_device_setpoint"),
            "humidity_mpc_active": bool(live.get("humidity_mpc_active", False)),
            "humidity_confidence": live.get("humidity_confidence"),
            "prehumidify": bool(live.get("prehumidify", False)),
            "override_until": dt_util.utc_from_timestamp(until).isoformat() if until else None,
        }

    async def _async_set_humidity_override(
        self,
        humidify: float | None,
        dehumidify: float | None,
        override_type: str,
    ) -> None:
        humidify, dehumidify = mask_humidity_override_band(
            humidify, dehumidify, self._humidity_mode()
        )
        await self._store().async_update_room(
            self._area_id,
            {
                "override_humidify": humidify,
                "override_dehumidify": dehumidify,
                "override_humidity_until": override_hold_until(
                    self.coordinator.hass, self._room()
                ),
                "override_humidity_type": override_type,
            },
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_set_humidity(self, humidity: int) -> None:
        """Hold the given target humidity until the schedule changes next."""
        target = float(max(MIN_TARGET_HUMIDITY, min(MAX_TARGET_HUMIDITY, humidity)))
        room = self._room()
        h_mode = self._humidity_mode()
        if h_mode == HUMIDITY_MODE_DEHUMIDIFY_ONLY or (
            room.get("dehumidifier_entity") and not room.get("humidifier_entity")
        ):
            hum, dehum = None, target
        elif h_mode == HUMIDITY_MODE_HUMIDIFY_ONLY or (
            room.get("humidifier_entity") and not room.get("dehumidifier_entity")
        ):
            hum, dehum = target, None
        else:
            cur_hum, cur_dehum = humidity_band_in_force(room, self._live())
            base_dehum = cur_dehum if cur_dehum is not None else DEFAULT_COMFORT_DEHUMIDIFY
            hum = target
            dehum = max(target + HUMIDITY_LIMIT_GAP, base_dehum)
            dehum = min(MAX_TARGET_HUMIDITY, dehum)
        await self._async_set_humidity_override(hum, dehum, OVERRIDE_CUSTOM)

    async def async_set_mode(self, mode: str) -> None:
        """Switch between schedule (normal), comfort, eco, or manual hold."""
        if mode == MODE_MANUAL:
            hum, dehum = humidity_band_in_force(self._room(), self._live())
            if self.mode != MODE_MANUAL and (hum is not None or dehum is not None):
                await self._async_set_humidity_override(hum, dehum, OVERRIDE_CUSTOM)
            return
        override_type = _MODE_TO_OVERRIDE.get(mode)
        if override_type is not None:
            hum, dehum = humidity_override_preset_band(self._room(), override_type)
            await self._async_set_humidity_override(hum, dehum, override_type)
            return
        await self._store().async_update_room(
            self._area_id,
            {
                "override_humidify": None,
                "override_dehumidify": None,
                "override_humidity_until": None,
                "override_humidity_type": None,
            },
        )
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Enable room control and ensure humidity targets are active."""
        room = self._room()
        changes: dict[str, Any] = {"climate_control_enabled": True}
        hum, dehum = humidity_band_in_force(room, self._live())
        if hum is None and dehum is None:
            if room.get("humidifier_entity") or not room.get("dehumidifier_entity"):
                changes["comfort_humidify"] = DEFAULT_COMFORT_HUMIDIFY
                changes["humidity_min"] = DEFAULT_COMFORT_HUMIDIFY
            if room.get("dehumidifier_entity") or not room.get("humidifier_entity"):
                changes["comfort_dehumidify"] = DEFAULT_COMFORT_DEHUMIDIFY
                changes["humidity_max"] = DEFAULT_COMFORT_DEHUMIDIFY
        await self._store().async_update_room(self._area_id, changes)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Clear any active humidity override and turn off room control if no climate devices exist."""
        room = self._room()
        changes: dict[str, Any] = {
            "override_humidify": None,
            "override_dehumidify": None,
            "override_humidity_until": None,
            "override_humidity_type": None,
        }
        if not room.get("devices"):
            await self.coordinator.async_turn_room_off(self._area_id)
        await self._store().async_update_room(self._area_id, changes)
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()
