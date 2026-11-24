"""Sensor platform for RoomMind."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfMass, UnitOfPower, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import RoomMindCoordinator, _get_area_name
from .managers.heat_plant_manager import SOLID_FUEL_TYPES
from .utils.area_utils import assign_area_once, rooms_with_area
from .utils.price_utils import build_tauron_forecast


def has_humidity_dashboard_sensors(room: dict) -> bool:
    """Whether a room has humidity monitoring/control and should expose humidifier dashboard sensors."""
    return bool(
        room.get("humidifier_entity")
        or room.get("dehumidifier_entity")
        or room.get("humidity_min") is not None
        or room.get("humidity_max") is not None
        or room.get("comfort_humidify") is not None
        or room.get("comfort_dehumidify") is not None
    ) and not room.get("is_outdoor", False)


def _create_room_entities(coordinator: RoomMindCoordinator, area_id: str) -> list[SensorEntity]:
    """Create the standard set of sensor entities for a room."""
    return [
        RoomMindTargetTemperatureSensor(coordinator, area_id),
        RoomMindModeSensor(coordinator, area_id),
    ]


def _create_room_humidity_sensors(coordinator: RoomMindCoordinator, area_id: str) -> list[SensorEntity]:
    """Create humidifier/humidity control dashboard sensor entities for a room."""
    return [
        RoomMindHumidityActionSensor(coordinator, area_id),
        RoomMindHumidityTargetSensor(coordinator, area_id),
        RoomMindHumidifyingPowerSensor(coordinator, area_id),
    ]


@dataclass(frozen=True)
class _PlantSensorSpec:
    suffix: str
    label: str
    data_key: str
    icon: str
    device_class: SensorDeviceClass | None = None
    state_class: SensorStateClass | None = SensorStateClass.MEASUREMENT
    unit: str | None = None
    dynamic_unit: str | None = None  # "fuel" | "fuel_rate" | "currency"
    solid_fuel_only: bool = False


_HEAT_PLANT_SENSOR_SPECS: tuple[_PlantSensorSpec, ...] = (
    _PlantSensorSpec("state", "Stan", "state", "mdi:fire", state_class=None),
    _PlantSensorSpec(
        "supply_temp",
        "Temperatura zasilania",
        "supply_temp",
        "mdi:thermometer-chevron-up",
        device_class=SensorDeviceClass.TEMPERATURE,
        unit=UnitOfTemperature.CELSIUS,
    ),
    _PlantSensorSpec(
        "return_temp",
        "Temperatura powrotu",
        "return_temp",
        "mdi:thermometer-chevron-down",
        device_class=SensorDeviceClass.TEMPERATURE,
        unit=UnitOfTemperature.CELSIUS,
    ),
    _PlantSensorSpec(
        "dhw_temp",
        "Temperatura CWU",
        "dhw_temp",
        "mdi:water-thermometer",
        device_class=SensorDeviceClass.TEMPERATURE,
        unit=UnitOfTemperature.CELSIUS,
    ),
    _PlantSensorSpec(
        "flue_temp",
        "Temperatura spalin",
        "flue_temp",
        "mdi:smoke",
        device_class=SensorDeviceClass.TEMPERATURE,
        unit=UnitOfTemperature.CELSIUS,
    ),
    _PlantSensorSpec(
        "delta_t",
        "Delta T (Zasilanie-Powrót)",
        "delta_t",
        "mdi:thermometer-lines",
        unit="°C",
    ),
    _PlantSensorSpec(
        "power",
        "Moc grzewcza",
        "current_thermal_kw",
        "mdi:flash",
        device_class=SensorDeviceClass.POWER,
        unit=UnitOfPower.KILO_WATT,
    ),
    _PlantSensorSpec(
        "burn_rate",
        "Spalanie chwilowe",
        "burn_rate_per_h",
        "mdi:fire-circle",
        dynamic_unit="fuel_rate",
    ),
    _PlantSensorSpec(
        "fuel_today",
        "Spalony opał dziś",
        "fuel_consumed_today",
        "mdi:scale-balance",
        state_class=SensorStateClass.TOTAL_INCREASING,
        dynamic_unit="fuel",
    ),
    _PlantSensorSpec(
        "fuel_total",
        "Spalony opał łącznie",
        "fuel_consumed_total",
        "mdi:weight-kilogram",
        state_class=SensorStateClass.TOTAL_INCREASING,
        dynamic_unit="fuel",
    ),
    _PlantSensorSpec(
        "cost_today",
        "Koszt ogrzewania dziś",
        "cost_today",
        "mdi:cash",
        state_class=SensorStateClass.TOTAL_INCREASING,
        dynamic_unit="currency",
    ),
    _PlantSensorSpec(
        "cost_total",
        "Koszt ogrzewania łącznie",
        "cost_total",
        "mdi:cash-multiple",
        state_class=SensorStateClass.TOTAL_INCREASING,
        dynamic_unit="currency",
    ),
    _PlantSensorSpec(
        "fuel_remaining",
        "Pozostały opał w zasobniku",
        "fuel_remaining_kg",
        "mdi:silo",
        unit=UnitOfMass.KILOGRAMS,
        solid_fuel_only=True,
    ),
    _PlantSensorSpec(
        "ash_level",
        "Zapełnienie popielnika",
        "ash_fill_pct",
        "mdi:delete-variant",
        unit=PERCENTAGE,
        solid_fuel_only=True,
    ),
    _PlantSensorSpec(
        "chimney_wear",
        "Zużycie komina",
        "chimney_wear_pct",
        "mdi:chimney",
        unit=PERCENTAGE,
        solid_fuel_only=True,
    ),
)

HEAT_PLANT_SENSOR_SUFFIXES = tuple(f"_{spec.suffix}" for spec in _HEAT_PLANT_SENSOR_SPECS)


def _create_heat_plant_sensors(
    coordinator: RoomMindCoordinator,
    plant_cfg: dict[str, Any],
) -> list[SensorEntity]:
    """Create dashboard sensor entities for a configured heat plant (boiler, fireplace, underfloor, etc.)."""
    plant_id = str(plant_cfg.get("id") or "")
    if not plant_id:
        return []
    fuel_type = str(plant_cfg.get("fuel_type") or "coal")
    is_solid = fuel_type in SOLID_FUEL_TYPES
    entities: list[SensorEntity] = []
    for spec in _HEAT_PLANT_SENSOR_SPECS:
        if spec.solid_fuel_only and not is_solid:
            continue
        entities.append(RoomMindHeatPlantSensor(coordinator, plant_id, spec))
    return entities


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
    if not hasattr(coordinator, "_humidity_sensor_areas") or not isinstance(
        getattr(coordinator, "_humidity_sensor_areas", None), set
    ):
        coordinator._humidity_sensor_areas = set()
    if not hasattr(coordinator, "_heat_plant_sensor_ids") or not isinstance(
        getattr(coordinator, "_heat_plant_sensor_ids", None), set
    ):
        coordinator._heat_plant_sensor_ids = set()

    # Create entities for rooms that already exist in the store
    rooms = rooms_with_area(hass, store.get_rooms())
    entities: list[SensorEntity] = []
    for area_id, room in rooms.items():
        entities.extend(_create_room_entities(coordinator, area_id))
        coordinator._entity_areas.add(area_id)
        if has_humidity_dashboard_sensors(room):
            entities.extend(_create_room_humidity_sensors(coordinator, area_id))
            coordinator._humidity_sensor_areas.add(area_id)

    # Create sensor entities for configured heat plants (boilers, fireplaces, underfloor, etc.)
    settings = store.get_settings() if hasattr(store, "get_settings") else {}
    raw_plants = settings.get("heat_plants", []) if isinstance(settings, dict) else []
    if isinstance(raw_plants, list):
        for plant_cfg in raw_plants:
            if isinstance(plant_cfg, dict) and plant_cfg.get("id"):
                pid = str(plant_cfg["id"])
                entities.extend(_create_heat_plant_sensors(coordinator, plant_cfg))
                coordinator._heat_plant_sensor_ids.add(pid)

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
        room = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id)
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
        room = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id)
        if room:
            val = room.get("mode", "idle")
            return str(val) if val is not None else "idle"
        return "idle"


class _RoomMindHumidifierDashboardSensor(CoordinatorEntity, SensorEntity):
    """Enabled-by-default dashboard sensor exposing RoomMind humidification state per room."""

    _attr_has_entity_name = False
    _attr_entity_registry_enabled_default = True

    def __init__(
        self,
        coordinator: RoomMindCoordinator,
        area_id: str,
        suffix: str,
        label: str,
        icon: str,
    ) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._label = label
        self._attr_unique_id = f"{DOMAIN}_{area_id}_{suffix}"
        self._attr_icon = icon
        self.entity_id = f"sensor.{DOMAIN}_{area_id}_{suffix}"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        assign_area_once(self.hass, self.entity_id, self._area_id, DOMAIN)

    @property
    def name(self) -> str:
        store = self.coordinator.hass.data.get(DOMAIN, {}).get("store") if self.coordinator.hass else None
        room = store.get_room(self._area_id) if store else None
        room_name = (
            (room or {}).get("display_name")
            or (_get_area_name(self.coordinator.hass, self._area_id) if self.coordinator.hass else self._area_id)
        )
        return f"{room_name} {self._label}"

    def _live(self) -> dict[str, Any]:
        live: dict[str, Any] = ((self.coordinator.data or {}).get("rooms") or {}).get(self._area_id) or {}
        return live


class RoomMindHumidityActionSensor(_RoomMindHumidifierDashboardSensor):
    """Dashboard sensor showing the current humidification action (humidifying / dehumidifying / idle)."""

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "humidity_action", "Stan nawilżania", "mdi:air-humidifier")

    @property
    def native_value(self) -> str:
        live = self._live()
        action = live.get("humidity_action")
        if action in ("humidifying", "dehumidifying", "idle"):
            return str(action)
        if live.get("humidifier_active"):
            return "humidifying"
        if live.get("dehumidifier_active") or live.get("ac_dry_active"):
            return "dehumidifying"
        return "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        live = self._live()
        return {
            "current_humidity": live.get("current_humidity"),
            "target_humidity": live.get("target_humidity"),
            "humidify_target": live.get("humidify_target"),
            "dehumidify_target": live.get("dehumidify_target"),
            "humidifying_power": live.get("humidifying_power", 0),
            "humidity_mpc_active": live.get("humidity_mpc_active", False),
            "humidity_confidence": live.get("humidity_confidence"),
            "humidifier_active": live.get("humidifier_active", False),
            "dehumidifier_active": live.get("dehumidifier_active", False),
            "prehumidify": live.get("prehumidify", False),
        }


class RoomMindHumidityTargetSensor(_RoomMindHumidifierDashboardSensor):
    """Dashboard sensor showing the resolved target humidity (% RH)."""

    _attr_device_class = SensorDeviceClass.HUMIDITY
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "humidity_target", "Docelowa wilgotność", "mdi:water-percent")

    @property
    def native_value(self) -> float | None:
        live = self._live()
        val = live.get("target_humidity")
        if val is None:
            val = live.get("humidify_target") if live.get("humidify_target") is not None else live.get("dehumidify_target")
        return float(val) if isinstance(val, (int, float)) else None


class RoomMindHumidifyingPowerSensor(_RoomMindHumidifierDashboardSensor):
    """Dashboard sensor showing the MPC humidifying / dehumidifying output power (%)."""

    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "humidifying_power", "Moc nawilżania", "mdi:water-sync")

    @property
    def native_value(self) -> int:
        live = self._live()
        val = live.get("humidifying_power")
        if isinstance(val, (int, float)):
            return int(round(val))
        return 100 if (live.get("humidifier_active") or live.get("dehumidifier_active")) else 0


class RoomMindHeatPlantSensor(CoordinatorEntity, SensorEntity):
    """Dashboard sensor exposing live boiler/fireplace/underfloor telemetry to Home Assistant."""

    _attr_has_entity_name = False
    _attr_entity_registry_enabled_default = True

    def __init__(
        self,
        coordinator: RoomMindCoordinator,
        plant_id: str,
        spec: _PlantSensorSpec,
    ) -> None:
        super().__init__(coordinator)
        self._plant_id = plant_id
        self._spec = spec
        self._attr_unique_id = f"{DOMAIN}_plant_{plant_id}_{spec.suffix}"
        self._attr_icon = spec.icon
        self._attr_device_class = spec.device_class
        self._attr_state_class = spec.state_class
        self.entity_id = f"sensor.{DOMAIN}_plant_{plant_id}_{spec.suffix}"

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
        return f"{plant_name} — {self._spec.label}"

    @property
    def native_unit_of_measurement(self) -> str | None:
        if self._spec.unit is not None:
            return self._spec.unit
        if self._spec.dynamic_unit == "fuel":
            return str(self._live().get("fuel_unit") or "kg")
        if self._spec.dynamic_unit == "fuel_rate":
            fuel_u = str(self._live().get("fuel_unit") or "kg")
            return f"{fuel_u}/h"
        if self._spec.dynamic_unit == "currency":
            return str(self._plant_cfg().get("currency") or "PLN")
        return None

    @property
    def native_value(self) -> float | str | None:
        live = self._live()
        val = live.get(self._spec.data_key)
        if isinstance(val, (int, float, str)):
            return val
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        live = self._live()
        if self._spec.suffix == "state":
            return {
                "plant_type": live.get("plant_type"),
                "cannot_extinguish": live.get("cannot_extinguish", False),
                "in_fire_hold": live.get("in_fire_hold", False),
                "heating_demand": live.get("heating_demand", False),
                "dhw_demand": live.get("dhw_demand", False),
                "overheat_protect": live.get("overheat_protect", False),
                "ch_pump_active": live.get("ch_pump_active", False),
                "dhw_pump_active": live.get("dhw_pump_active", False),
                "demanding_rooms": live.get("demanding_rooms", []),
                "maintenance_alerts": live.get("maintenance_alerts", []),
            }
        if self._spec.suffix == "fuel_remaining":
            return {
                "hopper_pct": live.get("hopper_pct"),
                "hours_until_refill": live.get("hours_until_refill"),
                "fuel_since_refill_kg": live.get("fuel_since_refill_kg"),
                "refill_needed": live.get("refill_needed", False),
            }
        if self._spec.suffix == "ash_level":
            return {
                "estimated_ash_kg": live.get("estimated_ash_kg"),
                "fuel_since_ash_clean_kg": live.get("fuel_since_ash_clean_kg"),
                "days_since_ash_clean": live.get("days_since_ash_clean"),
                "ash_clean_needed": live.get("ash_clean_needed", False),
            }
        if self._spec.suffix == "chimney_wear":
            return {
                "fuel_since_chimney_clean_kg": live.get("fuel_since_chimney_clean_kg"),
                "days_since_chimney_clean": live.get("days_since_chimney_clean"),
                "chimney_clean_needed": live.get("chimney_clean_needed", False),
            }
        return {}


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
