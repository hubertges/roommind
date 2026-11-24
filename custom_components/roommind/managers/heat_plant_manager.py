"""Heat plant manager: boilers (coal/pellet/wood/gas), fireplaces, heaters, and heat pumps.

Manages:
- Multiple cooperating heat sources (e.g. ekogroszek coal boiler + fireplace + heat pump)
  with priority handling and parent/child source propagation.
- Non-extinguishable solid-fuel safety ("cannot_extinguish"): coal boilers, wood boilers, and fireplaces
  are never commanded to completely turn off on normal idle; instead they transition to a safe
  fire-hold / ember-standby mode ("hold") with minimum power tracking and overheat heat-dumping.
- Assigned heat emitters / receivers — radiators (TRVs) and underfloor heating (podłogówka) — and rooms
  driven by each heat source, plus an optional dedicated underfloor heating circuit (obieg podłogówki:
  pump + supply thermometer + overheat cutoff) powered by the boiler/heat source.
- Supply, return, DHW (CWU), and flue/buffer temperature monitoring + delta-T calculation.
- Active control of the heat source entity (climate.*, water_heater.*, switch.*, fan.*, input_boolean.*)
  and circulation pumps (C.O. central heating pump, underfloor heating pump, and CWU domestic hot water pump)
  with minimum supply temperature protection, boiler overheat protection, underfloor overheat cutoff,
  and DHW differential hysteresis.
- Fuel consumption in kg from: HA cumulative kg/g sensor, auger/feeder screw entity (podajnik) +
  kg/h throughput, manual kg entries, energy sensor, or calorific/power estimation.
- Maintenance tracking & throttled notifications for:
  1. Fuel refill / top-up (dołożenie opału / zasyp zasobnika)
  2. Ash container emptying (posprzątanie zbiornika na popiół)
  3. Chimney cleaning (czyszczenie komina)
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from homeassistant.util import dt as dt_util

from ..const import (
    DEFAULT_HEAT_PLANT_NOTIFICATION_COOLDOWN_MINUTES,
    MODE_HEATING,
    make_roommind_context,
)
from ..utils.notification_utils import (
    NotificationThrottler,
    async_send_notification,
    dismiss_notification,
)
from ..utils.sensor_utils import read_sensor_value
from ..utils.temp_utils import celsius_to_ha_temp, ha_temp_to_celsius

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

PLANT_TYPE_COAL_BOILER = "coal_boiler"
PLANT_TYPE_PELLET_BOILER = "pellet_boiler"
PLANT_TYPE_WOOD_BOILER = "wood_boiler"
PLANT_TYPE_FIREPLACE = "fireplace"
PLANT_TYPE_GAS_BOILER = "gas_boiler"
PLANT_TYPE_ELECTRIC_HEATER = "electric_heater"
PLANT_TYPE_AIR_HEATER = "air_heater"
PLANT_TYPE_HEAT_PUMP = "heat_pump"

HEAT_PLANT_TYPES = (
    PLANT_TYPE_COAL_BOILER,
    PLANT_TYPE_PELLET_BOILER,
    PLANT_TYPE_WOOD_BOILER,
    PLANT_TYPE_FIREPLACE,
    PLANT_TYPE_GAS_BOILER,
    PLANT_TYPE_ELECTRIC_HEATER,
    PLANT_TYPE_AIR_HEATER,
    PLANT_TYPE_HEAT_PUMP,
)

# Solid-fuel heat sources that maintain a live firebed and cannot be switched off completely on idle
NON_EXTINGUISHABLE_PLANT_TYPES = (
    PLANT_TYPE_COAL_BOILER,
    PLANT_TYPE_WOOD_BOILER,
    PLANT_TYPE_FIREPLACE,
)

FUEL_TYPE_COAL = "coal"
FUEL_TYPE_PELLET = "pellet"
FUEL_TYPE_WOOD = "wood"
FUEL_TYPE_GAS = "gas"
FUEL_TYPE_ELECTRICITY = "electricity"

FUEL_TYPES = (
    FUEL_TYPE_COAL,
    FUEL_TYPE_PELLET,
    FUEL_TYPE_WOOD,
    FUEL_TYPE_GAS,
    FUEL_TYPE_ELECTRICITY,
)

SOLID_FUEL_TYPES = (FUEL_TYPE_COAL, FUEL_TYPE_PELLET, FUEL_TYPE_WOOD)

HEAT_PLANT_SOURCE_DOMAINS = (
    "climate",
    "water_heater",
    "switch",
    "input_boolean",
    "fan",
)
HEAT_PLANT_PUMP_DOMAINS = ("switch", "input_boolean", "fan")

# 1 kWh = 3.6 MJ
MJ_PER_KWH = 3.6
NOTIF_PLANT_PREFIX = "roommind_plant_"


def mj_kg_to_kwh_kg(calorific_mj_kg: float) -> float:
    """Convert fuel calorific value from MJ/kg to chemical energy in kWh/kg."""
    if calorific_mj_kg <= 0:
        return 0.0
    return calorific_mj_kg / MJ_PER_KWH


def usable_kwh_per_kg(calorific_mj_kg: float, efficiency_pct: float) -> float:
    """Return usable thermal kWh obtained from 1 kg of solid fuel at given boiler efficiency."""
    chem_kwh = mj_kg_to_kwh_kg(calorific_mj_kg)
    eff = max(0.05, min(1.0, efficiency_pct / 100.0))
    return chem_kwh * eff


@dataclass
class HeatPlantConfig:
    """Configuration for a single boiler, fireplace, heater, or heat pump (heat source)."""

    id: str
    name: str
    plant_type: str = PLANT_TYPE_COAL_BOILER
    enabled: bool = True
    # Multi-source coordination
    priority: int = 1  # Lower number = higher priority (e.g. 1 = fireplace, 2 = main boiler)
    parent_plant_id: str = ""  # Optional parent heat source
    # Non-extinguishable solid-fuel protection (fire-hold / podtrzymanie ognia)
    cannot_extinguish: bool = True
    min_power_pct: float = 12.0  # Ember/standby burn fraction [%] when fire is held
    # Assigned heat receivers/emitters (radiator TRVs, underfloor heating thermostats) and/or room area_ids
    assigned_devices: list[str] = field(default_factory=list)
    assigned_rooms: list[str] = field(default_factory=list)
    # Main heat source entity (climate.*, water_heater.*, switch.*, input_boolean.*, fan.*)
    source_entity: str = ""
    target_supply_temp: float = 55.0
    idle_supply_temp: float = 42.0
    off_mode: str = "temperature"  # "off" | "temperature"
    min_rooms_demand: int = 1
    # Thermometers (sensor.* / input_number.*)
    supply_temp_sensor: str = ""
    return_temp_sensor: str = ""
    dhw_temp_sensor: str = ""
    flue_temp_sensor: str = ""
    # Central heating (C.O.) circulation pump (radiators / main circuit)
    ch_pump_entity: str = ""
    ch_pump_min_supply_temp: float = 40.0
    ch_pump_overrun_temp: float = 80.0
    # Underfloor heating receiver circuit (obieg odbiornika podłogówki zasilany z tego pieca/źródła)
    ufh_pump_entity: str = ""
    ufh_supply_temp_sensor: str = ""
    ufh_min_supply_temp: float = 25.0
    ufh_max_supply_temp: float = 48.0  # Safety cutoff: stops UFH pump if supply exceeds this temp
    # Domestic hot water (CWU) loading pump
    dhw_pump_entity: str = ""
    dhw_target_temp: float = 50.0
    dhw_hysteresis: float = 3.0
    dhw_min_supply_delta: float = 3.0
    # Fuel & energy cost parameters
    fuel_type: str = FUEL_TYPE_COAL
    calorific_value_mj_kg: float = 26.0  # Coal / pellet / wood calorific value [MJ/kg]
    calorific_value_kwh_m3: float = 10.5  # Natural gas calorific value [kWh/m³]
    efficiency_pct: float = 85.0  # Boiler / heater efficiency [%]
    cop: float = 3.5  # Heat pump COP
    nominal_power_kw: float = 15.0  # Nominal thermal output [kW]
    fuel_price: float = 1500.0  # Price: per ton (1000 kg) for coal/pellet/wood, per m³ for gas, per kWh for electricity
    currency: str = "PLN"
    energy_sensor: str = ""  # Optional HA sensor (kWh or W/kW)
    fuel_consumption_sensor: str = ""  # Optional HA sensor (kg, g or m³)
    # Auger/feeder screw (podajnik) kg tracking & hopper/ash/chimney maintenance
    feeder_entity: str = ""  # Optional switch/binary_sensor for auger/podajnik
    feeder_kg_per_hour: float = 12.0  # Feeder throughput [kg/h] of continuous screw run
    hopper_capacity_kg: float = 100.0  # Fuel hopper / load capacity [kg]
    hopper_level_sensor: str = ""  # Optional HA sensor (% or kg remaining)
    ash_content_pct: float = 7.0  # Ash percentage in fuel [%] (coal ~7%, pellet ~0.7%, wood ~1.5%)
    # Maintenance notifications
    notify_refill_enabled: bool = False
    refill_alert_kg: float = 20.0
    refill_alert_pct: float = 20.0
    notify_ash_enabled: bool = False
    ash_clean_interval_kg: float = 150.0
    ash_clean_interval_days: int = 7
    notify_chimney_enabled: bool = False
    chimney_clean_interval_kg: float = 1000.0
    chimney_clean_interval_days: int = 90

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HeatPlantConfig:
        """Build a HeatPlantConfig from a settings dictionary."""
        plant_type = str(data.get("plant_type") or PLANT_TYPE_COAL_BOILER)
        if plant_type not in HEAT_PLANT_TYPES:
            plant_type = PLANT_TYPE_COAL_BOILER

        default_fuel = {
            PLANT_TYPE_COAL_BOILER: FUEL_TYPE_COAL,
            PLANT_TYPE_PELLET_BOILER: FUEL_TYPE_PELLET,
            PLANT_TYPE_WOOD_BOILER: FUEL_TYPE_WOOD,
            PLANT_TYPE_FIREPLACE: FUEL_TYPE_WOOD,
            PLANT_TYPE_GAS_BOILER: FUEL_TYPE_GAS,
            PLANT_TYPE_ELECTRIC_HEATER: FUEL_TYPE_ELECTRICITY,
            PLANT_TYPE_AIR_HEATER: FUEL_TYPE_ELECTRICITY,
            PLANT_TYPE_HEAT_PUMP: FUEL_TYPE_ELECTRICITY,
        }.get(plant_type, FUEL_TYPE_COAL)
        fuel_type = str(data.get("fuel_type") or default_fuel)
        if fuel_type not in FUEL_TYPES:
            fuel_type = default_fuel

        default_cannot_extinguish = plant_type in NON_EXTINGUISHABLE_PLANT_TYPES
        if "cannot_extinguish" in data:
            cannot_extinguish = bool(data["cannot_extinguish"])
        else:
            cannot_extinguish = default_cannot_extinguish

        default_ash_pct = {
            FUEL_TYPE_COAL: 7.0,
            FUEL_TYPE_PELLET: 0.7,
            FUEL_TYPE_WOOD: 1.5,
        }.get(fuel_type, 0.0)

        default_off_mode = "temperature" if cannot_extinguish else "off"

        return cls(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or ""),
            plant_type=plant_type,
            enabled=bool(data.get("enabled", True)),
            priority=max(1, min(20, int(data.get("priority", 1) or 1))),
            parent_plant_id=str(data.get("parent_plant_id") or ""),
            cannot_extinguish=cannot_extinguish,
            min_power_pct=max(0.0, min(50.0, float(data.get("min_power_pct", 12.0 if cannot_extinguish else 0.0)))),
            assigned_devices=[str(x) for x in (data.get("assigned_devices") or []) if x],
            assigned_rooms=[str(x) for x in (data.get("assigned_rooms") or []) if x],
            source_entity=str(data.get("source_entity") or ""),
            target_supply_temp=float(data.get("target_supply_temp", 55.0) or 55.0),
            idle_supply_temp=float(
                data.get("idle_supply_temp", 42.0 if cannot_extinguish else 35.0) or 35.0
            ),
            off_mode=str(data.get("off_mode") or default_off_mode),
            min_rooms_demand=max(1, int(data.get("min_rooms_demand", 1) or 1)),
            supply_temp_sensor=str(data.get("supply_temp_sensor") or ""),
            return_temp_sensor=str(data.get("return_temp_sensor") or ""),
            dhw_temp_sensor=str(data.get("dhw_temp_sensor") or ""),
            flue_temp_sensor=str(data.get("flue_temp_sensor") or ""),
            ch_pump_entity=str(data.get("ch_pump_entity") or ""),
            ch_pump_min_supply_temp=float(data.get("ch_pump_min_supply_temp", 40.0) or 0.0),
            ch_pump_overrun_temp=float(data.get("ch_pump_overrun_temp", 80.0) or 80.0),
            ufh_pump_entity=str(data.get("ufh_pump_entity") or ""),
            ufh_supply_temp_sensor=str(data.get("ufh_supply_temp_sensor") or ""),
            ufh_min_supply_temp=float(data.get("ufh_min_supply_temp", 25.0) or 0.0),
            ufh_max_supply_temp=float(data.get("ufh_max_supply_temp", 48.0) or 48.0),
            dhw_pump_entity=str(data.get("dhw_pump_entity") or ""),
            dhw_target_temp=float(data.get("dhw_target_temp", 50.0) or 50.0),
            dhw_hysteresis=max(0.5, float(data.get("dhw_hysteresis", 3.0) or 3.0)),
            dhw_min_supply_delta=float(data.get("dhw_min_supply_delta", 3.0) or 0.0),
            fuel_type=fuel_type,
            calorific_value_mj_kg=max(1.0, float(data.get("calorific_value_mj_kg", 26.0) or 26.0)),
            calorific_value_kwh_m3=max(1.0, float(data.get("calorific_value_kwh_m3", 10.5) or 10.5)),
            efficiency_pct=max(10.0, min(110.0, float(data.get("efficiency_pct", 85.0) or 85.0))),
            cop=max(1.0, min(10.0, float(data.get("cop", 3.5) or 3.5))),
            nominal_power_kw=max(0.1, float(data.get("nominal_power_kw", 15.0) or 15.0)),
            fuel_price=max(0.0, float(data.get("fuel_price", 1500.0) or 0.0)),
            currency=str(data.get("currency") or "PLN"),
            energy_sensor=str(data.get("energy_sensor") or ""),
            fuel_consumption_sensor=str(data.get("fuel_consumption_sensor") or ""),
            feeder_entity=str(data.get("feeder_entity") or ""),
            feeder_kg_per_hour=max(0.1, float(data.get("feeder_kg_per_hour", 12.0) or 12.0)),
            hopper_capacity_kg=max(1.0, float(data.get("hopper_capacity_kg", 100.0) or 100.0)),
            hopper_level_sensor=str(data.get("hopper_level_sensor") or ""),
            ash_content_pct=max(0.0, min(40.0, float(data.get("ash_content_pct", default_ash_pct)))),
            notify_refill_enabled=bool(data.get("notify_refill_enabled", False)),
            refill_alert_kg=max(0.0, float(data.get("refill_alert_kg", 20.0) or 0.0)),
            refill_alert_pct=max(0.0, min(100.0, float(data.get("refill_alert_pct", 20.0) or 0.0))),
            notify_ash_enabled=bool(data.get("notify_ash_enabled", False)),
            ash_clean_interval_kg=max(0.0, float(data.get("ash_clean_interval_kg", 150.0) or 0.0)),
            ash_clean_interval_days=max(0, int(data.get("ash_clean_interval_days", 7) or 0)),
            notify_chimney_enabled=bool(data.get("notify_chimney_enabled", False)),
            chimney_clean_interval_kg=max(0.0, float(data.get("chimney_clean_interval_kg", 1000.0) or 0.0)),
            chimney_clean_interval_days=max(0, int(data.get("chimney_clean_interval_days", 90) or 0)),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize configuration to a dict."""
        return {
            "id": self.id,
            "name": self.name,
            "plant_type": self.plant_type,
            "enabled": self.enabled,
            "priority": self.priority,
            "parent_plant_id": self.parent_plant_id,
            "cannot_extinguish": self.cannot_extinguish,
            "min_power_pct": self.min_power_pct,
            "assigned_devices": list(self.assigned_devices),
            "assigned_rooms": list(self.assigned_rooms),
            "source_entity": self.source_entity,
            "target_supply_temp": self.target_supply_temp,
            "idle_supply_temp": self.idle_supply_temp,
            "off_mode": self.off_mode,
            "min_rooms_demand": self.min_rooms_demand,
            "supply_temp_sensor": self.supply_temp_sensor,
            "return_temp_sensor": self.return_temp_sensor,
            "dhw_temp_sensor": self.dhw_temp_sensor,
            "flue_temp_sensor": self.flue_temp_sensor,
            "ch_pump_entity": self.ch_pump_entity,
            "ch_pump_min_supply_temp": self.ch_pump_min_supply_temp,
            "ch_pump_overrun_temp": self.ch_pump_overrun_temp,
            "ufh_pump_entity": self.ufh_pump_entity,
            "ufh_supply_temp_sensor": self.ufh_supply_temp_sensor,
            "ufh_min_supply_temp": self.ufh_min_supply_temp,
            "ufh_max_supply_temp": self.ufh_max_supply_temp,
            "dhw_pump_entity": self.dhw_pump_entity,
            "dhw_target_temp": self.dhw_target_temp,
            "dhw_hysteresis": self.dhw_hysteresis,
            "dhw_min_supply_delta": self.dhw_min_supply_delta,
            "fuel_type": self.fuel_type,
            "calorific_value_mj_kg": self.calorific_value_mj_kg,
            "calorific_value_kwh_m3": self.calorific_value_kwh_m3,
            "efficiency_pct": self.efficiency_pct,
            "cop": self.cop,
            "nominal_power_kw": self.nominal_power_kw,
            "fuel_price": self.fuel_price,
            "currency": self.currency,
            "energy_sensor": self.energy_sensor,
            "fuel_consumption_sensor": self.fuel_consumption_sensor,
            "feeder_entity": self.feeder_entity,
            "feeder_kg_per_hour": self.feeder_kg_per_hour,
            "hopper_capacity_kg": self.hopper_capacity_kg,
            "hopper_level_sensor": self.hopper_level_sensor,
            "ash_content_pct": self.ash_content_pct,
            "notify_refill_enabled": self.notify_refill_enabled,
            "refill_alert_kg": self.refill_alert_kg,
            "refill_alert_pct": self.refill_alert_pct,
            "notify_ash_enabled": self.notify_ash_enabled,
            "ash_clean_interval_kg": self.ash_clean_interval_kg,
            "ash_clean_interval_days": self.ash_clean_interval_days,
            "notify_chimney_enabled": self.notify_chimney_enabled,
            "chimney_clean_interval_kg": self.chimney_clean_interval_kg,
            "chimney_clean_interval_days": self.chimney_clean_interval_days,
        }


@dataclass
class HeatPlantRuntimeState:
    """Persisted and in-memory runtime counters for a heat plant."""

    day_str: str = ""
    dhw_charging: bool = False
    last_ts: float | None = None
    last_energy_reading: float | None = None
    last_fuel_reading: float | None = None
    runtime_hours_today: float = 0.0
    runtime_hours_total: float = 0.0
    thermal_kwh_today: float = 0.0
    thermal_kwh_total: float = 0.0
    input_kwh_today: float = 0.0
    input_kwh_total: float = 0.0
    fuel_consumed_today: float = 0.0  # kg for coal/pellet/wood, m³ for gas, kWh for electricity
    fuel_consumed_total: float = 0.0
    cost_today: float = 0.0
    cost_total: float = 0.0
    # Hopper & maintenance tracking
    fuel_loaded_kg: float | None = None  # Amount loaded at last refill
    fuel_since_refill_kg: float = 0.0
    fuel_since_ash_clean_kg: float = 0.0
    fuel_since_chimney_clean_kg: float = 0.0
    last_refill_ts: float | None = None
    last_ash_clean_ts: float | None = None
    last_chimney_clean_ts: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "day_str": self.day_str,
            "dhw_charging": self.dhw_charging,
            "last_energy_reading": self.last_energy_reading,
            "last_fuel_reading": self.last_fuel_reading,
            "runtime_hours_today": round(self.runtime_hours_today, 4),
            "runtime_hours_total": round(self.runtime_hours_total, 4),
            "thermal_kwh_today": round(self.thermal_kwh_today, 4),
            "thermal_kwh_total": round(self.thermal_kwh_total, 4),
            "input_kwh_today": round(self.input_kwh_today, 4),
            "input_kwh_total": round(self.input_kwh_total, 4),
            "fuel_consumed_today": round(self.fuel_consumed_today, 4),
            "fuel_consumed_total": round(self.fuel_consumed_total, 4),
            "cost_today": round(self.cost_today, 4),
            "cost_total": round(self.cost_total, 4),
            "fuel_loaded_kg": round(self.fuel_loaded_kg, 4) if self.fuel_loaded_kg is not None else None,
            "fuel_since_refill_kg": round(self.fuel_since_refill_kg, 4),
            "fuel_since_ash_clean_kg": round(self.fuel_since_ash_clean_kg, 4),
            "fuel_since_chimney_clean_kg": round(self.fuel_since_chimney_clean_kg, 4),
            "last_refill_ts": self.last_refill_ts,
            "last_ash_clean_ts": self.last_ash_clean_ts,
            "last_chimney_clean_ts": self.last_chimney_clean_ts,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HeatPlantRuntimeState:
        def _opt_float(key: str) -> float | None:
            v = data.get(key)
            return float(v) if isinstance(v, (int, float)) else None

        return cls(
            day_str=str(data.get("day_str") or ""),
            dhw_charging=bool(data.get("dhw_charging", False)),
            last_energy_reading=_opt_float("last_energy_reading"),
            last_fuel_reading=_opt_float("last_fuel_reading"),
            runtime_hours_today=float(data.get("runtime_hours_today", 0.0) or 0.0),
            runtime_hours_total=float(data.get("runtime_hours_total", 0.0) or 0.0),
            thermal_kwh_today=float(data.get("thermal_kwh_today", 0.0) or 0.0),
            thermal_kwh_total=float(data.get("thermal_kwh_total", 0.0) or 0.0),
            input_kwh_today=float(data.get("input_kwh_today", 0.0) or 0.0),
            input_kwh_total=float(data.get("input_kwh_total", 0.0) or 0.0),
            fuel_consumed_today=float(data.get("fuel_consumed_today", 0.0) or 0.0),
            fuel_consumed_total=float(data.get("fuel_consumed_total", 0.0) or 0.0),
            cost_today=float(data.get("cost_today", 0.0) or 0.0),
            cost_total=float(data.get("cost_total", 0.0) or 0.0),
            fuel_loaded_kg=_opt_float("fuel_loaded_kg"),
            fuel_since_refill_kg=float(data.get("fuel_since_refill_kg", 0.0) or 0.0),
            fuel_since_ash_clean_kg=float(data.get("fuel_since_ash_clean_kg", 0.0) or 0.0),
            fuel_since_chimney_clean_kg=float(data.get("fuel_since_chimney_clean_kg", 0.0) or 0.0),
            last_refill_ts=_opt_float("last_refill_ts"),
            last_ash_clean_ts=_opt_float("last_ash_clean_ts"),
            last_chimney_clean_ts=_opt_float("last_chimney_clean_ts"),
        )


class HeatPlantManager:
    """Evaluates and controls boilers, fireplaces, underfloor manifolds, heaters, heat pumps, and maintenance."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._plants: dict[str, HeatPlantConfig] = {}
        self._states: dict[str, HeatPlantRuntimeState] = {}
        self._live: dict[str, dict[str, Any]] = {}
        self._throttler = NotificationThrottler()
        self.state_dirty: bool = False

    def load_configs(self, configs: list[dict[str, Any]]) -> None:
        """Load heat plant configurations from settings."""
        new_plants: dict[str, HeatPlantConfig] = {}
        now = time.time()
        for raw in configs:
            if not isinstance(raw, dict) or not raw.get("id"):
                continue
            cfg = HeatPlantConfig.from_dict(raw)
            new_plants[cfg.id] = cfg
            if cfg.id not in self._states:
                st = HeatPlantRuntimeState(
                    fuel_loaded_kg=cfg.hopper_capacity_kg if cfg.fuel_type in SOLID_FUEL_TYPES else None,
                    last_refill_ts=now,
                    last_ash_clean_ts=now,
                    last_chimney_clean_ts=now,
                )
                self._states[cfg.id] = st
            else:
                st = self._states[cfg.id]
                if st.fuel_loaded_kg is None and cfg.fuel_type in SOLID_FUEL_TYPES:
                    st.fuel_loaded_kg = cfg.hopper_capacity_kg
                if st.last_ash_clean_ts is None:
                    st.last_ash_clean_ts = now
                if st.last_chimney_clean_ts is None:
                    st.last_chimney_clean_ts = now
        for old_id in list(self._states):
            if old_id not in new_plants:
                del self._states[old_id]
                self._live.pop(old_id, None)
        self._plants = new_plants

    def load_state(self, saved: dict[str, Any]) -> None:
        """Load persisted counters from settings."""
        if not isinstance(saved, dict):
            return
        for pid, raw in saved.items():
            if isinstance(raw, dict):
                self._states[str(pid)] = HeatPlantRuntimeState.from_dict(raw)

    def get_state(self) -> dict[str, dict[str, Any]]:
        """Return serializable runtime state for persistence."""
        return {pid: st.to_dict() for pid, st in self._states.items()}

    def get_live(self) -> dict[str, dict[str, Any]]:
        """Return live telemetry for all configured heat plants."""
        return dict(self._live)

    def reset_stats(self, plant_id: str | None = None) -> bool:
        """Reset today and total energy/fuel/cost counters for a plant (or all if None)."""
        today = dt_util.now().date().isoformat()
        targets = [plant_id] if plant_id else list(self._states)
        changed = False
        for pid in targets:
            if pid in self._states:
                st = self._states[pid]
                self._states[pid] = HeatPlantRuntimeState(
                    day_str=today,
                    dhw_charging=st.dhw_charging,
                    last_ts=st.last_ts,
                    last_energy_reading=st.last_energy_reading,
                    last_fuel_reading=st.last_fuel_reading,
                    fuel_loaded_kg=st.fuel_loaded_kg,
                    fuel_since_refill_kg=st.fuel_since_refill_kg,
                    fuel_since_ash_clean_kg=st.fuel_since_ash_clean_kg,
                    fuel_since_chimney_clean_kg=st.fuel_since_chimney_clean_kg,
                    last_refill_ts=st.last_refill_ts,
                    last_ash_clean_ts=st.last_ash_clean_ts,
                    last_chimney_clean_ts=st.last_chimney_clean_ts,
                )
                changed = True
        if changed:
            self.state_dirty = True
        return changed

    def log_fuel(self, plant_id: str, kg: float, mode: str = "burned") -> bool:
        """Manually log fuel burned (kg) or refilled into hopper/fireplace (kg).

        - ``mode == "burned"``: Adds kg to today/total consumption, computes kWh & cost,
          and advances refill/ash/chimney counters.
        - ``mode == "refill"``: Records a fuel top-up / hopper fill of *kg* (or adds to remaining)
          and clears the refill alert.
        """
        if plant_id not in self._plants or kg <= 0:
            return False
        plant = self._plants[plant_id]
        st = self._states.setdefault(plant_id, HeatPlantRuntimeState())
        now = time.time()
        today = dt_util.now().date().isoformat()
        if st.day_str != today:
            st.day_str = today
            st.runtime_hours_today = 0.0
            st.thermal_kwh_today = 0.0
            st.input_kwh_today = 0.0
            st.fuel_consumed_today = 0.0
            st.cost_today = 0.0

        if mode == "refill":
            current_remaining = max(0.0, (st.fuel_loaded_kg or 0.0) - st.fuel_since_refill_kg)
            new_loaded = min(plant.hopper_capacity_kg * 2.0, current_remaining + kg)
            st.fuel_loaded_kg = new_loaded
            st.fuel_since_refill_kg = 0.0
            st.last_refill_ts = now
            self._throttler.clear(f"refill_{plant_id}")
            dismiss_notification(self.hass, f"{NOTIF_PLANT_PREFIX}{plant_id}_refill")
            self.state_dirty = True
            return True

        # mode == "burned": calculate energy & cost directly from kg of fuel
        chem_kwh_per_kg = mj_kg_to_kwh_kg(plant.calorific_value_mj_kg)
        eff = max(0.05, plant.efficiency_pct / 100.0)
        d_in_kwh = kg * chem_kwh_per_kg
        d_th_kwh = d_in_kwh * eff
        price_per_unit = plant.fuel_price / 1000.0 if plant.fuel_price > 20.0 else plant.fuel_price
        d_cost = kg * price_per_unit

        st.fuel_consumed_today += kg
        st.fuel_consumed_total += kg
        st.input_kwh_today += d_in_kwh
        st.input_kwh_total += d_in_kwh
        st.thermal_kwh_today += d_th_kwh
        st.thermal_kwh_total += d_th_kwh
        st.cost_today += d_cost
        st.cost_total += d_cost
        st.fuel_since_refill_kg += kg
        st.fuel_since_ash_clean_kg += kg
        st.fuel_since_chimney_clean_kg += kg
        self.state_dirty = True
        return True

    def confirm_maintenance(
        self,
        plant_id: str,
        action: str,
        kg: float | None = None,
    ) -> bool:
        """Mark maintenance completed: 'refill', 'ash_cleaned', or 'chimney_cleaned'."""
        if plant_id not in self._plants:
            return False
        plant = self._plants[plant_id]
        st = self._states.setdefault(plant_id, HeatPlantRuntimeState())
        now = time.time()

        if action == "refill":
            amount = kg if (kg is not None and kg > 0) else plant.hopper_capacity_kg
            st.fuel_loaded_kg = amount
            st.fuel_since_refill_kg = 0.0
            st.last_refill_ts = now
            self._throttler.clear(f"refill_{plant_id}")
            dismiss_notification(self.hass, f"{NOTIF_PLANT_PREFIX}{plant_id}_refill")
        elif action == "ash_cleaned":
            st.fuel_since_ash_clean_kg = 0.0
            st.last_ash_clean_ts = now
            self._throttler.clear(f"ash_{plant_id}")
            dismiss_notification(self.hass, f"{NOTIF_PLANT_PREFIX}{plant_id}_ash")
        elif action == "chimney_cleaned":
            st.fuel_since_chimney_clean_kg = 0.0
            st.last_chimney_clean_ts = now
            self._throttler.clear(f"chimney_{plant_id}")
            dismiss_notification(self.hass, f"{NOTIF_PLANT_PREFIX}{plant_id}_chimney")
        else:
            return False

        self.state_dirty = True
        return True

    def _read_temp_celsius(self, entity_id: str, label: str) -> float | None:
        if not entity_id:
            return None
        raw = read_sensor_value(self.hass, entity_id, "heat_plant", label)
        if raw is None:
            return None
        return ha_temp_to_celsius(self.hass, raw, entity_id=entity_id)

    def _collect_demand(
        self,
        plant: HeatPlantConfig,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
        suppressed_rooms: set[str] | None = None,
    ) -> tuple[list[str], list[str], float, float]:
        """Collect demanding rooms and active assigned devices for a heat plant.

        Returns (demanding_rooms, active_devices, mean_pf, max_pf).
        """
        assigned_devs = set(plant.assigned_devices)
        assigned_rms = set(plant.assigned_rooms)
        suppressed = suppressed_rooms or set()

        demanding_rooms: list[str] = []
        active_devices: list[str] = []
        pfs: list[float] = []

        # Build map of device_eid -> owning room area_id
        dev_to_room: dict[str, str] = {}
        for area_id, room in rooms.items():
            for dev in room.get("devices", []):
                eid = dev.get("entity_id", "")
                if eid:
                    dev_to_room[eid] = area_id

        for area_id, room in rooms.items():
            if room.get("is_outdoor", False):
                continue
            if area_id in suppressed:
                continue
            room_devs = {d.get("entity_id", "") for d in room.get("devices", []) if d.get("entity_id")}
            matching_devs = room_devs & assigned_devs
            room_assigned = area_id in assigned_rms or bool(matching_devs)
            if not room_assigned:
                continue
            rs = room_states.get(area_id) or {}
            mode = rs.get("commanded_mode", rs.get("mode", "idle"))
            active_sources = rs.get("active_heat_sources")
            if mode == MODE_HEATING:
                running_in_room: list[str] = []
                for dev in room.get("devices", []):
                    eid = dev.get("entity_id", "")
                    if not eid:
                        continue
                    if matching_devs and eid not in matching_devs:
                        continue
                    dtype = dev.get("type", "trv")
                    if active_sources == "primary" and dtype == "ac":
                        continue
                    if active_sources == "secondary" and dtype == "trv":
                        continue
                    running_in_room.append(eid)
                if running_in_room or (area_id in assigned_rms and not matching_devs):
                    demanding_rooms.append(area_id)
                    active_devices.extend(running_in_room)
                    pf = float(rs.get("heating_power", 100) or 0) / 100.0
                    pfs.append(max(0.15, pf))

        # Also check any standalone assigned devices not in rooms
        for eid in plant.assigned_devices:
            if eid in dev_to_room or eid in active_devices:
                continue
            st = self.hass.states.get(eid)
            if st is None or st.state in ("unavailable", "unknown", "off"):
                continue
            hvac_action = st.attributes.get("hvac_action")
            if hvac_action in ("heating", "preheating") or (
                hvac_action is None and st.state in ("heat", "heat_cool", "auto")
            ):
                active_devices.append(eid)
                pfs.append(1.0)

        mean_pf = sum(pfs) / len(pfs) if pfs else 0.0
        max_pf = max(pfs) if pfs else 0.0
        return demanding_rooms, sorted(set(active_devices)), mean_pf, max_pf

    async def _async_set_switch_like(self, entity_id: str, turn_on: bool) -> None:
        if not entity_id:
            return
        domain = entity_id.split(".", 1)[0]
        if domain not in HEAT_PLANT_PUMP_DOMAINS:
            return
        st = self.hass.states.get(entity_id)
        desired_state = "on" if turn_on else "off"
        if st is not None and st.state == desired_state:
            return
        service = "turn_on" if turn_on else "turn_off"
        try:
            await self.hass.services.async_call(
                domain,
                service,
                {"entity_id": entity_id},
                blocking=True,
                context=make_roommind_context(),
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Heat plant: failed to %s '%s'", service, entity_id, exc_info=True)

    async def _async_control_source(
        self,
        plant: HeatPlantConfig,
        active_demand: bool,
        *,
        overheat_protect: bool = False,
    ) -> None:
        """Command the heat source entity while respecting non-extinguishable fire-hold safety."""
        eid = plant.source_entity
        if not eid:
            return
        domain = eid.split(".", 1)[0]

        if domain in ("switch", "input_boolean", "fan"):
            if active_demand:
                await self._async_set_switch_like(eid, True)
            elif overheat_protect:
                # Emergency overheat: cut blower/feeder switch to prevent boiling while pump dumps heat
                await self._async_set_switch_like(eid, False)
            elif not plant.cannot_extinguish:
                # Only switch off sources that CAN be completely extinguished (gas/electric/HP)
                await self._async_set_switch_like(eid, False)
            # When cannot_extinguish is True and normal idle: keep switch untouched (podtrzymanie ognia)
            return

        st = self.hass.states.get(eid)
        if st is None or st.state in ("unavailable", "unknown"):
            return

        if domain == "water_heater":
            target_c = plant.target_supply_temp if active_demand else plant.idle_supply_temp
            target_ha = celsius_to_ha_temp(self.hass, target_c)
            cur_temp = st.attributes.get("temperature")
            if cur_temp is None or abs(float(cur_temp) - target_ha) > 0.5:
                try:
                    await self.hass.services.async_call(
                        "water_heater",
                        "set_temperature",
                        {"entity_id": eid, "temperature": target_ha},
                        blocking=True,
                        context=make_roommind_context(),
                    )
                except Exception:  # noqa: BLE001
                    _LOGGER.warning(
                        "Heat plant '%s': water_heater.set_temperature failed", plant.name, exc_info=True
                    )
            return

        if domain == "climate":
            modes = st.attributes.get("hvac_modes") or []
            if active_demand:
                desired_mode = "heat" if "heat" in modes else ("auto" if "auto" in modes else "heat_cool")
                target_ha = celsius_to_ha_temp(self.hass, plant.target_supply_temp)
                if st.state != desired_mode and desired_mode in modes:
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {"entity_id": eid, "hvac_mode": desired_mode},
                            blocking=True,
                            context=make_roommind_context(),
                        )
                    except Exception:  # noqa: BLE001
                        _LOGGER.warning(
                            "Heat plant '%s': climate.set_hvac_mode failed", plant.name, exc_info=True
                        )
                cur_sp = st.attributes.get("temperature")
                if cur_sp is None or abs(float(cur_sp) - target_ha) > 0.5:
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_temperature",
                            {"entity_id": eid, "temperature": target_ha},
                            blocking=True,
                            context=make_roommind_context(),
                        )
                    except Exception:  # noqa: BLE001
                        _LOGGER.warning(
                            "Heat plant '%s': climate.set_temperature failed", plant.name, exc_info=True
                        )
            else:
                # Non-extinguishable sources NEVER enter hvac_mode="off": they hold at idle_supply_temp!
                use_temp_hold = plant.cannot_extinguish or plant.off_mode == "temperature"
                if use_temp_hold and ("heat" in modes or "auto" in modes):
                    hold_mode = "heat" if "heat" in modes else "auto"
                    if plant.cannot_extinguish and st.state == "off" and hold_mode in modes:
                        try:
                            await self.hass.services.async_call(
                                "climate",
                                "set_hvac_mode",
                                {"entity_id": eid, "hvac_mode": hold_mode},
                                blocking=True,
                                context=make_roommind_context(),
                            )
                        except Exception:  # noqa: BLE001
                            pass
                    idle_ha = celsius_to_ha_temp(self.hass, plant.idle_supply_temp)
                    cur_sp = st.attributes.get("temperature")
                    if cur_sp is None or abs(float(cur_sp) - idle_ha) > 0.5:
                        try:
                            await self.hass.services.async_call(
                                "climate",
                                "set_temperature",
                                {"entity_id": eid, "temperature": idle_ha},
                                blocking=True,
                                context=make_roommind_context(),
                            )
                        except Exception:  # noqa: BLE001
                            pass
                elif not plant.cannot_extinguish and "off" in modes and st.state != "off":
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {"entity_id": eid, "hvac_mode": "off"},
                            blocking=True,
                            context=make_roommind_context(),
                        )
                    except Exception:  # noqa: BLE001
                        _LOGGER.warning(
                            "Heat plant '%s': climate.set_hvac_mode off failed", plant.name, exc_info=True
                        )

    def _compute_thermal_power_factor(
        self,
        plant: HeatPlantConfig,
        supply_temp: float | None,
        return_temp: float | None,
        flue_temp: float | None,
        delta_t: float | None,
        heating_demand: bool,
        dhw_demand: bool,
        mean_pf: float,
        source_active: bool,
        in_fire_hold: bool,
    ) -> float:
        """Compute continuous power fraction (0..1) from boiler temperatures, ΔT, demand, and fire-hold state.

        A non-extinguishable solid-fuel boiler (coal/ekogroszek, wood, fireplace) burns continuously:
        - Even without room/DHW demand, it burns at least ``min_power_pct`` (fire-hold / podtrzymanie ognia)
          plus extra thermal modulation when supply or flue temperatures are elevated.
        - When heating or charging DHW, power scales with room demand, supply temperature relative to
          target, and supply-return ΔT (heat extraction rate).
        """
        min_hold_pf = (
            max(0.05, plant.min_power_pct / 100.0)
            if (plant.cannot_extinguish and plant.enabled)
            else 0.0
        )

        # Temperature-derived power factor from supply, return (ΔT), and flue temperatures
        temp_pf = 0.0
        if supply_temp is not None and supply_temp > 25.0:
            target = max(35.0, plant.target_supply_temp)
            idle = max(25.0, min(target - 5.0, plant.idle_supply_temp))
            if supply_temp <= idle:
                # Warm water in boiler below idle hold setpoint
                temp_pf = min_hold_pf * max(0.4, (supply_temp - 20.0) / max(10.0, idle - 20.0))
            else:
                # Modulate between min_hold_pf and 1.0 as supply approaches/exceeds target_supply_temp
                span = max(5.0, target - idle)
                ratio = min(1.15, max(0.0, (supply_temp - idle) / span))
                temp_pf = min_hold_pf + (0.85 - min_hold_pf) * min(1.0, ratio)

            # Adjust for heat extraction across radiators / UFH (ΔT = supply - return)
            if delta_t is not None and delta_t > 0:
                # Typical nominal ΔT at full load is ~12-15 K
                dt_factor = min(1.25, max(0.2, delta_t / 12.0))
                temp_pf = max(temp_pf, min(1.0, temp_pf * (0.65 + 0.35 * dt_factor)))

        if flue_temp is not None and flue_temp > 45.0:
            # Flue gas temperature strongly reflects instantaneous combustion intensity (55°C ember -> 180°C+ full fire)
            flue_pf = min(1.0, max(min_hold_pf, (flue_temp - 45.0) / 135.0))
            temp_pf = max(temp_pf, flue_pf)

        if heating_demand and dhw_demand:
            demand_pf = max(mean_pf, 0.85, temp_pf)
        elif heating_demand:
            base_demand = mean_pf if mean_pf > 0 else 0.65
            # When room demand is known, use it as base and boost if actual boiler temp/ΔT/flue exceeds it
            demand_pf = max(base_demand, temp_pf * 0.85, min_hold_pf)
        elif dhw_demand:
            demand_pf = max(0.75, temp_pf, min_hold_pf)
        elif in_fire_hold or (plant.cannot_extinguish and plant.enabled):
            # Continuous fire-hold burn: at least min_hold_pf; modulate up when supply > target or flue is hot
            extra_hold = 0.0
            if supply_temp is not None and supply_temp > plant.target_supply_temp:
                extra_hold = min(0.25, (supply_temp - plant.target_supply_temp) / 40.0)
            if flue_temp is not None and flue_temp > 110.0:
                extra_hold = max(extra_hold, min(0.35, (flue_temp - 110.0) / 150.0))
            demand_pf = min(1.0, min_hold_pf + extra_hold)
        elif source_active:
            demand_pf = max(0.5, temp_pf)
        else:
            demand_pf = 0.0

        return max(0.0, min(1.0, demand_pf))

    def _compute_rates_and_accumulate(
        self,
        plant: HeatPlantConfig,
        st: HeatPlantRuntimeState,
        is_running: bool,
        in_fire_hold: bool,
        effective_pf: float,
        now: float,
        dynamic_elec_price: float | None,
    ) -> dict[str, Any]:
        """Compute instantaneous burn/power/cost rates and continuously update counters over elapsed time."""
        today = dt_util.now().date().isoformat()
        if st.day_str != today:
            st.day_str = today
            st.runtime_hours_today = 0.0
            st.thermal_kwh_today = 0.0
            st.input_kwh_today = 0.0
            st.fuel_consumed_today = 0.0
            st.cost_today = 0.0
            self.state_dirty = True

        dt_hours = 0.0
        if st.last_ts is not None and now > st.last_ts:
            # Cap single gap at 24h so multi-hour intervals still integrate continuous burn accurately
            dt_hours = min(24.0, (now - st.last_ts) / 3600.0)
        elif st.last_ts is None and st.last_refill_ts is not None and 0 < (now - st.last_refill_ts) <= 86400:
            # First cycle after creation/restart: integrate elapsed time since last timestamp
            dt_hours = min(1.0, (now - st.last_refill_ts) / 3600.0)
        st.last_ts = now

        # 1. Check external energy_sensor (can be power in W/kW or cumulative energy in kWh)
        sensor_power_kw: float | None = None
        sensor_energy_delta_kwh: float | None = None
        if plant.energy_sensor:
            e_val = read_sensor_value(self.hass, plant.energy_sensor, plant.id, "energy")
            e_state = self.hass.states.get(plant.energy_sensor)
            unit = str(e_state.attributes.get("unit_of_measurement") or "") if e_state else ""
            if e_val is not None:
                if unit in ("W", "kW"):
                    sensor_power_kw = e_val / 1000.0 if unit == "W" else e_val
                else:
                    if st.last_energy_reading is not None:
                        if e_val >= st.last_energy_reading:
                            sensor_energy_delta_kwh = e_val - st.last_energy_reading
                        elif e_val >= 0:
                            # Sensor reset (e.g. daily utility meter)
                            sensor_energy_delta_kwh = e_val
                    st.last_energy_reading = e_val

        # 2. Check external fuel_consumption_sensor (cumulative kg, g, or m³)
        sensor_fuel_delta: float | None = None
        if plant.fuel_consumption_sensor:
            f_val = read_sensor_value(self.hass, plant.fuel_consumption_sensor, plant.id, "fuel")
            f_state = self.hass.states.get(plant.fuel_consumption_sensor)
            f_unit = str(f_state.attributes.get("unit_of_measurement") or "").strip().lower() if f_state else ""
            if f_val is not None:
                if f_unit == "g":
                    f_val = f_val / 1000.0
                if st.last_fuel_reading is not None:
                    if f_val >= st.last_fuel_reading:
                        sensor_fuel_delta = f_val - st.last_fuel_reading
                    elif f_val >= 0:
                        # Daily-resetting kg counter
                        sensor_fuel_delta = f_val
                st.last_fuel_reading = f_val

        # 3. Check auger / feeder screw entity (podajnik ślimakowy)
        feeder_active = False
        feeder_fuel_delta: float | None = None
        if plant.feeder_entity:
            feeder_st = self.hass.states.get(plant.feeder_entity)
            if feeder_st is not None and feeder_st.state == "on":
                feeder_active = True
                if dt_hours > 0:
                    feeder_fuel_delta = plant.feeder_kg_per_hour * dt_hours

        # Effective power fraction: continuous for non-extinguishable boilers (heating + fire-hold)
        if is_running or in_fire_hold or (plant.cannot_extinguish and plant.enabled):
            pf = max(
                effective_pf,
                (plant.min_power_pct / 100.0) if (plant.cannot_extinguish and plant.enabled) else 0.0,
            )
        else:
            pf = 0.0

        eff = max(0.05, plant.efficiency_pct / 100.0)
        cop = max(1.0, plant.cop)

        # Calorific conversions
        chem_kwh_per_kg = mj_kg_to_kwh_kg(plant.calorific_value_mj_kg)
        usable_kwh_kg = usable_kwh_per_kg(plant.calorific_value_mj_kg, plant.efficiency_pct)

        if feeder_active and plant.fuel_type in SOLID_FUEL_TYPES and chem_kwh_per_kg > 0:
            burn_rate_per_h = plant.feeder_kg_per_hour
            current_input_kw = burn_rate_per_h * chem_kwh_per_kg
            current_thermal_kw = current_input_kw * eff
        elif plant.plant_type == PLANT_TYPE_HEAT_PUMP:
            if sensor_power_kw is not None:
                current_input_kw = sensor_power_kw
                current_thermal_kw = current_input_kw * cop
            else:
                current_thermal_kw = plant.nominal_power_kw * pf
                current_input_kw = current_thermal_kw / cop
        else:
            if sensor_power_kw is not None:
                if plant.fuel_type == FUEL_TYPE_ELECTRICITY:
                    current_input_kw = sensor_power_kw
                    current_thermal_kw = current_input_kw * eff
                else:
                    current_thermal_kw = sensor_power_kw
                    current_input_kw = current_thermal_kw / eff
            else:
                current_thermal_kw = plant.nominal_power_kw * pf
                current_input_kw = current_thermal_kw / eff

        # Fuel burn rate & unit price
        if plant.fuel_type in SOLID_FUEL_TYPES:
            fuel_unit = "kg"
            if not feeder_active:
                burn_rate_per_h = current_input_kw / chem_kwh_per_kg if chem_kwh_per_kg > 0 else 0.0
            # fuel_price is per ton (1000 kg) if > 20, or per kg if <= 20
            price_per_unit = plant.fuel_price / 1000.0 if plant.fuel_price > 20.0 else plant.fuel_price
        elif plant.fuel_type == FUEL_TYPE_GAS:
            fuel_unit = "m³"
            burn_rate_per_h = (
                current_input_kw / plant.calorific_value_kwh_m3
                if plant.calorific_value_kwh_m3 > 0
                else 0.0
            )
            price_per_unit = plant.fuel_price
        else:
            fuel_unit = "kWh"
            burn_rate_per_h = current_input_kw
            price_per_unit = (
                plant.fuel_price
                if plant.fuel_price > 0
                else (dynamic_elec_price if dynamic_elec_price is not None else 0.0)
            )

        cost_per_hour = burn_rate_per_h * price_per_unit
        if current_thermal_kw > 1e-6:
            cost_per_kwh_thermal = cost_per_hour / current_thermal_kw
        elif plant.fuel_type in SOLID_FUEL_TYPES and usable_kwh_kg > 0:
            cost_per_kwh_thermal = price_per_unit / usable_kwh_kg
        elif plant.fuel_type == FUEL_TYPE_GAS and plant.calorific_value_kwh_m3 > 0:
            cost_per_kwh_thermal = price_per_unit / (plant.calorific_value_kwh_m3 * eff)
        elif plant.plant_type == PLANT_TYPE_HEAT_PUMP:
            cost_per_kwh_thermal = price_per_unit / cop
        else:
            cost_per_kwh_thermal = price_per_unit / eff

        fuel_source_mode = "estimated"
        if plant.fuel_consumption_sensor:
            fuel_source_mode = "fuel_sensor"
        elif plant.feeder_entity:
            fuel_source_mode = "feeder"
        elif plant.energy_sensor:
            fuel_source_mode = "energy_sensor"

        if dt_hours > 0 or sensor_fuel_delta is not None or sensor_energy_delta_kwh is not None:
            if (is_running or in_fire_hold) and dt_hours > 0:
                st.runtime_hours_today += dt_hours
                st.runtime_hours_total += dt_hours

            d_in_kwh = (
                sensor_energy_delta_kwh
                if sensor_energy_delta_kwh is not None
                else current_input_kw * dt_hours
            )
            d_th_kwh = (
                d_in_kwh * (cop if plant.plant_type == PLANT_TYPE_HEAT_PUMP else eff)
                if sensor_energy_delta_kwh is not None
                else current_thermal_kw * dt_hours
            )
            if sensor_fuel_delta is not None:
                d_fuel = sensor_fuel_delta
                if plant.fuel_type in SOLID_FUEL_TYPES:
                    d_in_kwh = d_fuel * chem_kwh_per_kg
                    d_th_kwh = d_in_kwh * eff
                elif plant.fuel_type == FUEL_TYPE_GAS:
                    d_in_kwh = d_fuel * plant.calorific_value_kwh_m3
                    d_th_kwh = d_in_kwh * eff
            elif feeder_fuel_delta is not None:
                d_fuel = feeder_fuel_delta
                if plant.fuel_type in SOLID_FUEL_TYPES:
                    d_in_kwh = d_fuel * chem_kwh_per_kg
                    d_th_kwh = d_in_kwh * eff
            elif plant.feeder_entity:
                # Feeder entity configured but currently off: 0 kg fed this cycle
                d_fuel = 0.0
                d_in_kwh = 0.0
                d_th_kwh = 0.0
            else:
                d_fuel = burn_rate_per_h * dt_hours

            d_cost = d_fuel * price_per_unit
            if d_in_kwh > 0 or d_fuel > 0 or is_running:
                st.thermal_kwh_today += d_th_kwh
                st.thermal_kwh_total += d_th_kwh
                st.input_kwh_today += d_in_kwh
                st.input_kwh_total += d_in_kwh
                st.fuel_consumed_today += d_fuel
                st.fuel_consumed_total += d_fuel
                st.cost_today += d_cost
                st.cost_total += d_cost
                if plant.fuel_type in SOLID_FUEL_TYPES and d_fuel > 0:
                    st.fuel_since_refill_kg += d_fuel
                    st.fuel_since_ash_clean_kg += d_fuel
                    st.fuel_since_chimney_clean_kg += d_fuel
                self.state_dirty = True

        return {
            "fuel_unit": fuel_unit,
            "fuel_source_mode": fuel_source_mode,
            "feeder_active": feeder_active,
            "chemical_kwh_per_kg": round(chem_kwh_per_kg, 2),
            "usable_kwh_per_kg": round(usable_kwh_kg, 2),
            "current_thermal_kw": round(current_thermal_kw, 2),
            "current_input_kw": round(current_input_kw, 2),
            "burn_rate_per_h": round(burn_rate_per_h, 3),
            "cost_per_hour": round(cost_per_hour, 2),
            "cost_per_kwh_thermal": round(cost_per_kwh_thermal, 3),
            "runtime_hours_today": round(st.runtime_hours_today, 2),
            "runtime_hours_total": round(st.runtime_hours_total, 2),
            "thermal_kwh_today": round(st.thermal_kwh_today, 2),
            "thermal_kwh_total": round(st.thermal_kwh_total, 2),
            "input_kwh_today": round(st.input_kwh_today, 2),
            "input_kwh_total": round(st.input_kwh_total, 2),
            "fuel_consumed_today": round(st.fuel_consumed_today, 2),
            "fuel_consumed_total": round(st.fuel_consumed_total, 2),
            "cost_today": round(st.cost_today, 2),
            "cost_total": round(st.cost_total, 2),
        }

    async def _evaluate_maintenance_and_notify(
        self,
        plant: HeatPlantConfig,
        st: HeatPlantRuntimeState,
        burn_rate_per_h: float,
        now: float,
        settings: dict[str, Any],
    ) -> dict[str, Any]:
        """Compute hopper level, ash accumulation, chimney wear, and send throttled notifications."""
        is_solid = plant.fuel_type in SOLID_FUEL_TYPES
        if not is_solid:
            return {
                "fuel_remaining_kg": None,
                "hopper_pct": None,
                "hours_until_refill": None,
                "fuel_since_refill_kg": 0.0,
                "fuel_since_ash_clean_kg": 0.0,
                "estimated_ash_kg": 0.0,
                "ash_fill_pct": 0.0,
                "days_since_ash_clean": 0.0,
                "fuel_since_chimney_clean_kg": 0.0,
                "chimney_wear_pct": 0.0,
                "days_since_chimney_clean": 0.0,
                "refill_needed": False,
                "ash_clean_needed": False,
                "chimney_clean_needed": False,
                "maintenance_alerts": [],
            }

        # Hopper remaining kg & %
        loaded = st.fuel_loaded_kg if st.fuel_loaded_kg is not None else plant.hopper_capacity_kg
        fuel_remaining_kg = max(0.0, loaded - st.fuel_since_refill_kg)
        hopper_pct = (
            max(0.0, min(100.0, (fuel_remaining_kg / plant.hopper_capacity_kg) * 100.0))
            if plant.hopper_capacity_kg > 0
            else 0.0
        )

        # Optional HA hopper level sensor overrides calculated remaining level
        if plant.hopper_level_sensor:
            h_val = read_sensor_value(self.hass, plant.hopper_level_sensor, plant.id, "hopper level")
            h_state = self.hass.states.get(plant.hopper_level_sensor)
            h_unit = str(h_state.attributes.get("unit_of_measurement") or "").strip().lower() if h_state else ""
            if h_val is not None:
                if h_unit == "%":
                    hopper_pct = max(0.0, min(100.0, h_val))
                    fuel_remaining_kg = (hopper_pct / 100.0) * plant.hopper_capacity_kg
                else:
                    fuel_remaining_kg = max(0.0, h_val)
                    hopper_pct = (
                        max(0.0, min(100.0, (fuel_remaining_kg / plant.hopper_capacity_kg) * 100.0))
                        if plant.hopper_capacity_kg > 0
                        else 0.0
                    )

        hours_until_refill: float | None = None
        if burn_rate_per_h > 0.05:
            hours_until_refill = round(fuel_remaining_kg / burn_rate_per_h, 1)

        # Ash accumulation: continuously increases with every gram of fuel burned (not only on refill!)
        ash_burned_kg = max(st.fuel_since_ash_clean_kg, st.fuel_consumed_total if st.last_ash_clean_ts is None else 0.0)
        estimated_ash_kg = ash_burned_kg * (plant.ash_content_pct / 100.0)
        days_since_ash = (now - st.last_ash_clean_ts) / 86400.0 if st.last_ash_clean_ts else 0.0
        ash_kg_pct = (
            (ash_burned_kg / plant.ash_clean_interval_kg) * 100.0
            if plant.ash_clean_interval_kg > 0
            else 0.0
        )
        ash_days_pct = (
            (days_since_ash / plant.ash_clean_interval_days) * 100.0
            if plant.ash_clean_interval_days > 0
            else 0.0
        )
        ash_fill_pct = min(150.0, max(ash_kg_pct, ash_days_pct))

        # Chimney wear: continuously increases with burned fuel and elapsed time
        chimney_burned_kg = max(
            st.fuel_since_chimney_clean_kg,
            st.fuel_consumed_total if st.last_chimney_clean_ts is None else 0.0,
        )
        days_since_chimney = (now - st.last_chimney_clean_ts) / 86400.0 if st.last_chimney_clean_ts else 0.0
        chimney_kg_pct = (
            (chimney_burned_kg / plant.chimney_clean_interval_kg) * 100.0
            if plant.chimney_clean_interval_kg > 0
            else 0.0
        )
        chimney_days_pct = (
            (days_since_chimney / plant.chimney_clean_interval_days) * 100.0
            if plant.chimney_clean_interval_days > 0
            else 0.0
        )
        chimney_wear_pct = min(150.0, max(chimney_kg_pct, chimney_days_pct))

        refill_needed = bool(
            (plant.refill_alert_kg > 0 and fuel_remaining_kg <= plant.refill_alert_kg)
            or (plant.refill_alert_pct > 0 and hopper_pct <= plant.refill_alert_pct)
        )
        ash_clean_needed = bool(
            (plant.ash_clean_interval_kg > 0 and st.fuel_since_ash_clean_kg >= plant.ash_clean_interval_kg)
            or (plant.ash_clean_interval_days > 0 and days_since_ash >= plant.ash_clean_interval_days)
        )
        chimney_clean_needed = bool(
            (
                plant.chimney_clean_interval_kg > 0
                and st.fuel_since_chimney_clean_kg >= plant.chimney_clean_interval_kg
            )
            or (plant.chimney_clean_interval_days > 0 and days_since_chimney >= plant.chimney_clean_interval_days)
        )

        alerts: list[str] = []
        if refill_needed:
            alerts.append("refill")
        if ash_clean_needed:
            alerts.append("ash")
        if chimney_clean_needed:
            alerts.append("chimney")

        # Send throttled HA notifications when enabled
        global_notify = settings.get("heat_plant_notifications_enabled", True)
        targets = settings.get("heat_plant_notification_targets") or settings.get("mold_notification_targets", [])
        cooldown_s = (
            float(
                settings.get(
                    "heat_plant_notification_cooldown",
                    DEFAULT_HEAT_PLANT_NOTIFICATION_COOLDOWN_MINUTES,
                )
            )
            * 60.0
        )

        if global_notify:
            plant_label = plant.name or plant.id
            await self._dispatch_maintenance_alert(
                key=f"refill_{plant.id}",
                notif_id=f"{NOTIF_PLANT_PREFIX}{plant.id}_refill",
                active=refill_needed and plant.notify_refill_enabled,
                cooldown_s=cooldown_s,
                targets=targets,
                title=f"RoomMind: Dołóż opału — {plant_label}",
                message=(
                    f"{plant_label}: niski poziom opału — pozostało ok. {fuel_remaining_kg:.1f} kg "
                    f"({hopper_pct:.0f}%). Spalono od ostatniego zasypu: {st.fuel_since_refill_kg:.1f} kg."
                ),
            )
            await self._dispatch_maintenance_alert(
                key=f"ash_{plant.id}",
                notif_id=f"{NOTIF_PLANT_PREFIX}{plant.id}_ash",
                active=ash_clean_needed and plant.notify_ash_enabled,
                cooldown_s=cooldown_s,
                targets=targets,
                title=f"RoomMind: Opróżnij popielnik — {plant_label}",
                message=(
                    f"{plant_label}: czas posprzątać zbiornik na popiół. Spalono {st.fuel_since_ash_clean_kg:.1f} kg "
                    f"opału (~{estimated_ash_kg:.1f} kg popiołu, {days_since_ash:.0f} dni od ostatniego czyszczenia)."
                ),
            )
            await self._dispatch_maintenance_alert(
                key=f"chimney_{plant.id}",
                notif_id=f"{NOTIF_PLANT_PREFIX}{plant.id}_chimney",
                active=chimney_clean_needed and plant.notify_chimney_enabled,
                cooldown_s=cooldown_s,
                targets=targets,
                title=f"RoomMind: Czyszczenie komina — {plant_label}",
                message=(
                    f"{plant_label}: zalecane czyszczenie komina. Spalono {st.fuel_since_chimney_clean_kg:.0f} kg "
                    f"opału ({days_since_chimney:.0f} dni od ostatniego czyszczenia)."
                ),
            )

        return {
            "fuel_remaining_kg": round(fuel_remaining_kg, 1),
            "hopper_pct": round(hopper_pct, 1),
            "hours_until_refill": hours_until_refill,
            "fuel_since_refill_kg": round(st.fuel_since_refill_kg, 2),
            "fuel_since_ash_clean_kg": round(st.fuel_since_ash_clean_kg, 2),
            "estimated_ash_kg": round(estimated_ash_kg, 2),
            "ash_fill_pct": round(min(100.0, ash_fill_pct), 1),
            "days_since_ash_clean": round(days_since_ash, 1),
            "fuel_since_chimney_clean_kg": round(st.fuel_since_chimney_clean_kg, 1),
            "chimney_wear_pct": round(min(100.0, chimney_wear_pct), 1),
            "days_since_chimney_clean": round(days_since_chimney, 1),
            "refill_needed": refill_needed,
            "ash_clean_needed": ash_clean_needed,
            "chimney_clean_needed": chimney_clean_needed,
            "maintenance_alerts": alerts,
        }

    async def _dispatch_maintenance_alert(
        self,
        *,
        key: str,
        notif_id: str,
        active: bool,
        cooldown_s: float,
        targets: list[dict],
        title: str,
        message: str,
    ) -> None:
        if active:
            if self._throttler.should_send(key, cooldown_s):
                await async_send_notification(
                    self.hass,
                    notification_id=notif_id,
                    targets=targets,
                    message=message,
                    title=title,
                    tag=notif_id,
                )
                self._throttler.record_sent(key)
        else:
            if key in self._throttler._last_sent:
                self._throttler.clear(key)
                dismiss_notification(self.hass, notif_id)

    async def async_process(
        self,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
        settings: dict[str, Any],
        dynamic_elec_price: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Evaluate all configured heat plants, coordinate multi-source priority, command sources/pumps."""
        self.load_configs(settings.get("heat_plants", []))
        climate_active = bool(settings.get("climate_control_active", True))
        now = time.time()
        live_out: dict[str, dict[str, Any]] = {}

        # Sort plants by priority (1 = highest priority, e.g. fireplace before backup boiler)
        ordered_plants = sorted(self._plants.values(), key=lambda p: (p.priority, p.id))

        # Pre-pass: detect child loops (e.g. underfloor manifold) demanding heat from a parent plant
        parent_extra_demand: dict[str, list[str]] = {}
        for plant in ordered_plants:
            if not plant.enabled or not plant.parent_plant_id or plant.parent_plant_id not in self._plants:
                continue
            d_rooms, a_devs, _, _ = self._collect_demand(plant, rooms, room_states)
            if len(d_rooms) >= plant.min_rooms_demand or (
                not plant.assigned_rooms and len(a_devs) >= plant.min_rooms_demand
            ):
                parent_extra_demand.setdefault(plant.parent_plant_id, []).append(plant.name or plant.id)

        # Track rooms already actively warmed by a higher-priority heat source (e.g. fireplace)
        covered_rooms_by_higher_priority: dict[str, str] = {}

        for plant in ordered_plants:
            pid = plant.id
            st = self._states.setdefault(pid, HeatPlantRuntimeState())
            supply_temp = self._read_temp_celsius(plant.supply_temp_sensor, "supply temperature")
            return_temp = self._read_temp_celsius(plant.return_temp_sensor, "return temperature")
            dhw_temp = self._read_temp_celsius(plant.dhw_temp_sensor, "DHW temperature")
            flue_temp = self._read_temp_celsius(plant.flue_temp_sensor, "flue temperature")
            ufh_supply_temp = (
                self._read_temp_celsius(plant.ufh_supply_temp_sensor, "underfloor supply temperature")
                if plant.ufh_supply_temp_sensor
                else supply_temp
            )

            delta_t = (
                round(supply_temp - return_temp, 1)
                if supply_temp is not None and return_temp is not None
                else None
            )

            # Check if higher-priority sources (with strictly smaller priority number) already cover rooms
            suppressed_rooms = {
                aid
                for aid, src_pid in covered_rooms_by_higher_priority.items()
                if self._plants[src_pid].priority < plant.priority
            }
            assisted_by = sorted(
                {
                    self._plants[covered_rooms_by_higher_priority[aid]].name or covered_rooms_by_higher_priority[aid]
                    for aid in suppressed_rooms
                    if aid in plant.assigned_rooms
                    or any(
                        d.get("entity_id") in plant.assigned_devices
                        for d in (rooms.get(aid) or {}).get("devices", [])
                    )
                }
            )

            demanding_rooms, active_devices, mean_pf, max_pf = self._collect_demand(
                plant, rooms, room_states, suppressed_rooms=suppressed_rooms
            )
            child_demands = parent_extra_demand.get(pid, [])
            heating_demand = (
                len(demanding_rooms) >= plant.min_rooms_demand
                or (not plant.assigned_rooms and len(active_devices) >= plant.min_rooms_demand)
                or bool(child_demands)
            )
            if child_demands and mean_pf <= 0:
                mean_pf = 0.6
                max_pf = max(max_pf, 0.6)

            # Determine if any demanding room or active device on this heat plant is an underfloor receiver
            ufh_demand = False
            if heating_demand:
                active_dev_set = set(active_devices)
                for aid in demanding_rooms:
                    rm = rooms.get(aid) or {}
                    if rm.get("heating_system_type") == "underfloor":
                        ufh_demand = True
                        break
                    for dev in rm.get("devices", []):
                        if dev.get("entity_id") in active_dev_set and dev.get("heating_system_type") == "underfloor":
                            ufh_demand = True
                            break
                if not ufh_demand and plant.ufh_pump_entity:
                    # If a dedicated UFH pump is configured on this heat plant, run it on heating demand
                    ufh_demand = True

            # Evaluate DHW (CWU) demand with hysteresis
            if plant.dhw_temp_sensor and dhw_temp is not None and math.isfinite(dhw_temp):
                if dhw_temp < plant.dhw_target_temp - plant.dhw_hysteresis:
                    st.dhw_charging = True
                elif dhw_temp >= plant.dhw_target_temp:
                    st.dhw_charging = False
            else:
                st.dhw_charging = False

            dhw_demand = st.dhw_charging and bool(plant.dhw_pump_entity or plant.dhw_temp_sensor)

            # Overheat protection:
            # - Boiler / fireplace overheat: supply >= ch_pump_overrun_temp (default 80°C) -> force C.O. & DHW dump pumps ON
            # - Underfloor receiver circuit overheat: ufh_supply_temp >= ufh_max_supply_temp (default 48°C) -> STOP UFH pump to protect floor!
            overheat_protect = (
                supply_temp is not None
                and plant.ch_pump_overrun_temp > 0
                and supply_temp >= plant.ch_pump_overrun_temp
            )
            ufh_overheat_protect = bool(
                (plant.ufh_pump_entity or plant.ufh_supply_temp_sensor)
                and ufh_supply_temp is not None
                and plant.ufh_max_supply_temp > 0
                and ufh_supply_temp >= plant.ufh_max_supply_temp
            )

            # C.O. radiator pump logic
            supply_warm_for_ch = (
                supply_temp is None
                or plant.ch_pump_min_supply_temp <= 0
                or supply_temp >= plant.ch_pump_min_supply_temp
            )
            ch_pump_wanted = overheat_protect or (
                plant.enabled and heating_demand and supply_warm_for_ch
            )

            # Underfloor heating receiver circuit pump logic (stops immediately if UFH supply exceeds max!)
            supply_warm_for_ufh = (
                ufh_supply_temp is None
                or plant.ufh_min_supply_temp <= 0
                or ufh_supply_temp >= plant.ufh_min_supply_temp
            )
            ufh_pump_wanted = (
                bool(plant.ufh_pump_entity)
                and not ufh_overheat_protect
                and plant.enabled
                and ufh_demand
                and supply_warm_for_ufh
            )

            # CWU pump logic: run when (dhw_demand and supply warmer than DHW + delta) OR emergency heat dump
            supply_warm_for_dhw = (
                supply_temp is None
                or dhw_temp is None
                or supply_temp >= dhw_temp + plant.dhw_min_supply_delta
            )
            dhw_overheat_dump = (
                overheat_protect
                and (dhw_temp is None or dhw_temp < 70.0)
            )
            dhw_pump_wanted = (plant.enabled and dhw_demand and supply_warm_for_dhw) or dhw_overheat_dump

            # Low return temperature warning for solid-fuel boilers (corrosion / creosote risk)
            low_return_warning = bool(
                plant.plant_type in (PLANT_TYPE_COAL_BOILER, PLANT_TYPE_PELLET_BOILER, PLANT_TYPE_WOOD_BOILER)
                and supply_temp is not None
                and supply_temp >= 50.0
                and return_temp is not None
                and return_temp < 45.0
            )

            source_wanted = plant.enabled and (heating_demand or dhw_demand) and not overheat_protect

            if climate_active and plant.enabled:
                await self._async_control_source(
                    plant, source_wanted, overheat_protect=overheat_protect
                )
                if plant.ch_pump_entity:
                    await self._async_set_switch_like(plant.ch_pump_entity, ch_pump_wanted)
                if plant.ufh_pump_entity:
                    await self._async_set_switch_like(plant.ufh_pump_entity, ufh_pump_wanted)
                if plant.dhw_pump_entity:
                    await self._async_set_switch_like(plant.dhw_pump_entity, dhw_pump_wanted)

            # Immediate HA notification on boiler overheat or underfloor circuit overheat (10-min safety cooldown)
            if settings.get("heat_plant_notifications_enabled", True):
                overheat_targets = settings.get("heat_plant_notification_targets") or settings.get(
                    "mold_notification_targets", []
                )
                plant_label = plant.name or plant.id
                overheat_msg = (
                    f"{plant_label}: przegrzanie kotła/źródła ({supply_temp:.1f}°C >= "
                    f"{plant.ch_pump_overrun_temp:.0f}°C)! Wymuszono zrzut ciepła pompami C.O."
                    if supply_temp is not None
                    else f"{plant_label}: alarm przegrzania kotła!"
                )
                await self._dispatch_maintenance_alert(
                    key=f"overheat_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_overheat",
                    active=overheat_protect,
                    cooldown_s=600.0,
                    targets=overheat_targets,
                    title=f"RoomMind: ALARM PRZEGRZANIA — {plant_label}",
                    message=overheat_msg,
                )
                ufh_overheat_msg = (
                    f"{plant_label}: zbyt wysoka temperatura zasilania obiegu podłogówki "
                    f"({ufh_supply_temp:.1f}°C >= {plant.ufh_max_supply_temp:.0f}°C)! "
                    "Pompa podłogówki została awaryjnie zatrzymana."
                    if ufh_supply_temp is not None
                    else f"{plant_label}: alarm przegrzania obiegu podłogówki!"
                )
                await self._dispatch_maintenance_alert(
                    key=f"ufh_overheat_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_ufh_overheat",
                    active=ufh_overheat_protect,
                    cooldown_s=600.0,
                    targets=overheat_targets,
                    title=f"RoomMind: OCHRONA PODŁOGÓWKI — {plant_label}",
                    message=ufh_overheat_msg,
                )

            # Read actual states of source and pumps
            ch_pump_state = self.hass.states.get(plant.ch_pump_entity) if plant.ch_pump_entity else None
            ch_pump_on = (
                ch_pump_state.state == "on"
                if ch_pump_state is not None
                else bool(ch_pump_wanted and plant.ch_pump_entity)
            )
            ufh_pump_state = self.hass.states.get(plant.ufh_pump_entity) if plant.ufh_pump_entity else None
            ufh_pump_on = (
                ufh_pump_state.state == "on"
                if ufh_pump_state is not None
                else bool(ufh_pump_wanted and plant.ufh_pump_entity)
            )
            dhw_pump_state = self.hass.states.get(plant.dhw_pump_entity) if plant.dhw_pump_entity else None
            dhw_pump_on = (
                dhw_pump_state.state == "on"
                if dhw_pump_state is not None
                else bool(dhw_pump_wanted and plant.dhw_pump_entity)
            )

            source_state_obj = self.hass.states.get(plant.source_entity) if plant.source_entity else None
            if source_state_obj is not None:
                s_st = source_state_obj.state
                s_act = source_state_obj.attributes.get("hvac_action")
                if s_act in ("heating", "preheating"):
                    source_active = True
                elif s_act in ("idle", "off"):
                    source_active = False
                else:
                    source_active = s_st not in ("off", "unavailable", "unknown", "idle")
            else:
                # Without a controllable source entity (e.g. manual coal boiler or fireplace),
                # infer active from heating/DHW demand, warm supply temp, or hot flue temp
                source_active = (
                    source_wanted
                    or (
                        supply_temp is not None
                        and plant.ch_pump_min_supply_temp > 0
                        and supply_temp >= plant.ch_pump_min_supply_temp
                    )
                    or (flue_temp is not None and flue_temp >= 80.0)
                )

            # Determine if a non-extinguishable plant is currently in fire-hold (podtrzymanie ognia).
            # A coal/wood boiler with cannot_extinguish=True burns continuously 24/7 unless explicitly disabled.
            fire_alive = (
                plant.cannot_extinguish
                or source_active
                or (
                    supply_temp is not None
                    and plant.ch_pump_min_supply_temp > 0
                    and supply_temp >= max(30.0, plant.ch_pump_min_supply_temp - 5.0)
                )
                or (flue_temp is not None and flue_temp >= 55.0)
            )
            if plant.plant_type == PLANT_TYPE_FIREPLACE and not plant.source_entity:
                # A manual fireplace without a control entity is in fire-hold only when warm/lit or demanding
                fire_alive = (
                    source_active
                    or (supply_temp is not None and supply_temp >= 35.0)
                    or (flue_temp is not None and flue_temp >= 55.0)
                )
            in_fire_hold = (
                plant.cannot_extinguish
                and plant.enabled
                and not overheat_protect
                and not heating_demand
                and not dhw_demand
                and fire_alive
            )

            if overheat_protect or ufh_overheat_protect:
                state_label = "overheat_protect"
            elif heating_demand and dhw_demand:
                state_label = "heating_and_dhw"
            elif heating_demand:
                state_label = "heating"
            elif dhw_demand:
                state_label = "dhw"
            elif in_fire_hold:
                state_label = "hold"
            elif source_active:
                state_label = "active"
            else:
                state_label = "idle"

            # If this plant is actively heating (e.g. a fireplace burning hot), register covered rooms
            # so lower-priority backup boilers can smoothly drop to fire-hold instead of fighting it
            if (
                plant.enabled
                and (source_active or heating_demand)
                and (supply_temp is None or supply_temp >= plant.ch_pump_min_supply_temp or (flue_temp is not None and flue_temp >= 80.0))
            ):
                for aid in demanding_rooms:
                    covered_rooms_by_higher_priority.setdefault(aid, pid)

            eff_pf = self._compute_thermal_power_factor(
                plant=plant,
                supply_temp=supply_temp,
                return_temp=return_temp,
                flue_temp=flue_temp,
                delta_t=delta_t,
                heating_demand=heating_demand,
                dhw_demand=dhw_demand,
                mean_pf=mean_pf,
                source_active=source_active,
                in_fire_hold=in_fire_hold,
            )
            metrics = self._compute_rates_and_accumulate(
                plant=plant,
                st=st,
                is_running=source_active and not in_fire_hold,
                in_fire_hold=in_fire_hold,
                effective_pf=eff_pf,
                now=now,
                dynamic_elec_price=dynamic_elec_price,
            )
            maintenance = await self._evaluate_maintenance_and_notify(
                plant=plant,
                st=st,
                burn_rate_per_h=float(metrics["burn_rate_per_h"]),
                now=now,
                settings=settings,
            )

            live_out[pid] = {
                "id": pid,
                "name": plant.name,
                "plant_type": plant.plant_type,
                "cannot_extinguish": plant.cannot_extinguish,
                "in_fire_hold": in_fire_hold,
                "priority": plant.priority,
                "parent_plant_id": plant.parent_plant_id,
                "child_demands": child_demands,
                "assisted_by": assisted_by,
                "state": state_label,
                "source_active": source_active,
                "heating_demand": heating_demand,
                "dhw_demand": dhw_demand,
                "overheat_protect": overheat_protect or ufh_overheat_protect,
                "ufh_overheat_protect": ufh_overheat_protect,
                "low_return_warning": low_return_warning,
                "supply_temp": round(supply_temp, 1) if supply_temp is not None else None,
                "return_temp": round(return_temp, 1) if return_temp is not None else None,
                "ufh_supply_temp": round(ufh_supply_temp, 1) if (plant.ufh_supply_temp_sensor and ufh_supply_temp is not None) else None,
                "delta_t": delta_t,
                "dhw_temp": round(dhw_temp, 1) if dhw_temp is not None else None,
                "flue_temp": round(flue_temp, 1) if flue_temp is not None else None,
                "ch_pump_active": ch_pump_on,
                "ch_pump_blocked_cold": bool(heating_demand and not supply_warm_for_ch),
                "ufh_pump_active": ufh_pump_on,
                "ufh_pump_blocked_cold": bool(ufh_demand and plant.ufh_pump_entity and not supply_warm_for_ufh),
                "dhw_pump_active": dhw_pump_on,
                "dhw_pump_blocked_cold": bool(dhw_demand and not supply_warm_for_dhw),
                "demanding_rooms": demanding_rooms,
                "active_devices": active_devices,
                "mean_power_pct": round(eff_pf * 100) if (source_active or in_fire_hold) else 0,
                "max_power_pct": round(max_pf * 100),
                **metrics,
                **maintenance,
            }

        self._live = live_out
        return live_out
