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
from ..control.boiler_model import BoilerThermalModel
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

BOILER_MODE_AUTO = "auto"
BOILER_MODE_HEATING = "heating"
BOILER_MODE_SUMMER_DHW = "summer_dhw_only"
BOILER_MODE_HOLD = "hold"
BOILER_MODES = (
    BOILER_MODE_AUTO,
    BOILER_MODE_HEATING,
    BOILER_MODE_SUMMER_DHW,
    BOILER_MODE_HOLD,
)

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
# Specific heat capacity factor for water: 4.186 kJ/(kg·K) / 60 s/min = 0.069767 kW per (L/min · K)
WATER_KW_PER_LPM_K = 4.186 / 60.0
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


def siegert_efficiency_pct(
    flue_temp_c: float | None,
    ambient_temp_c: float = 18.0,
    fuel_type: str = FUEL_TYPE_COAL,
    radiation_loss_pct: float = 3.0,
) -> float | None:
    """Estimate real combustion efficiency (%) from flue gas temperature using Siegert's formula.

    For coal/wood/pellet stoker boilers at typical excess air (~9-11% CO2), stack loss
    is approximately 0.062% per Kelvin of (T_flue - T_ambient).
    """
    if flue_temp_c is None or not math.isfinite(flue_temp_c) or flue_temp_c <= ambient_temp_c + 10.0:
        return None
    k_siegert = {
        FUEL_TYPE_COAL: 0.062,
        FUEL_TYPE_PELLET: 0.056,
        FUEL_TYPE_WOOD: 0.068,
        FUEL_TYPE_GAS: 0.045,
    }.get(fuel_type, 0.060)
    stack_loss = max(2.0, min(48.0, k_siegert * (flue_temp_c - ambient_temp_c)))
    return max(30.0, min(98.0, 100.0 - stack_loss - radiation_loss_pct))


def _sanitize_radiator_sensors(raw: Any) -> list[dict[str, Any]]:
    """Normalize radiator sensor entries used for boiler -> radiator distribution heat loss."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, str) and item.strip():
            eid = item.strip()
            if eid not in seen:
                seen.add(eid)
                out.append(
                    {
                        "entity_id": eid,
                        "return_entity_id": "",
                        "room_id": "",
                        "name": "",
                        "pipe_length_m": 0.0,
                    }
                )
        elif isinstance(item, dict):
            eid = str(item.get("entity_id") or "").strip()
            if not eid or eid in seen:
                continue
            seen.add(eid)
            pipe_len = item.get("pipe_length_m", 0.0)
            try:
                pipe_len_f = max(0.0, min(500.0, float(pipe_len or 0.0)))
            except (ValueError, TypeError):
                pipe_len_f = 0.0
            out.append(
                {
                    "entity_id": eid,
                    "return_entity_id": str(item.get("return_entity_id") or "").strip(),
                    "room_id": str(item.get("room_id") or "").strip(),
                    "name": str(item.get("name") or "").strip(),
                    "pipe_length_m": pipe_len_f,
                }
            )
    return out


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
    boiler_mode: str = BOILER_MODE_AUTO  # "auto" | "heating" | "summer_dhw_only" | "hold"
    # Assigned heat receivers/emitters (radiator TRVs, underfloor heating thermostats) and/or room area_ids
    assigned_devices: list[str] = field(default_factory=list)
    assigned_rooms: list[str] = field(default_factory=list)
    # Main heat source entity (climate.*, water_heater.*, switch.*, input_boolean.*, fan.*)
    source_entity: str = ""
    boiler_target_temp_entity: str = ""  # Optional HA number.*/input_number.*/climate.* to write boiler target
    dhw_target_temp_entity: str = ""  # Optional HA number.*/input_number.*/water_heater.* to write CWU target
    target_supply_temp: float = 55.0
    idle_supply_temp: float = 42.0
    off_mode: str = "temperature"  # "off" | "temperature"
    min_rooms_demand: int = 1
    # Thermometers (sensor.* / input_number.*)
    supply_temp_sensor: str = ""
    return_temp_sensor: str = ""
    dhw_temp_sensor: str = ""
    dhw_supply_temp_sensor: str = ""  # DHW charging coil supply temp (e.g. 52°C on Galmet Info CWU)
    flue_temp_sensor: str = ""
    feeder_temp_sensor: str = ""  # Auger/feeder tube temperature (e.g. 31°C — burn-back safety!)
    boiler_room_temp_sensor: str = ""  # Optional boiler room ambient temp for Siegert flue loss
    # Controller telemetry (Galmet eLider / stoker boiler screen)
    feeder_work_time_sensor: str = ""  # Feeder work time sensor [s] (e.g. 12.0 s)
    feeder_pause_time_sensor: str = ""  # Feeder pause time sensor [s] (e.g. 960.0 s)
    feeder_work_time_s: float = 0.0  # Optional manual feeder work time [s]
    feeder_pause_time_s: float = 0.0  # Optional manual feeder pause time [s]
    blower_sensor: str = ""  # Blower/fan speed sensor [%] (e.g. CNF 0%)
    blower_mode_sensor: str = ""  # Optional controller state/mode text sensor (e.g. CNF / Praca)
    daily_fuel_sensor: str = ""  # Optional controller direct daily fuel burn rate sensor [kg/24h]
    # Hydraulics & pipe distribution heat-loss sensors (boiler -> radiators)
    flow_rate_l_min: float = 0.0  # Explicit C.O. water flow [L/min]; 0 = estimate from nominal power
    flow_rate_sensor: str = ""  # Optional HA flow sensor (L/min or m³/h)
    boiler_water_volume_l: float = 50.0  # Boiler water jacket volume [L] for thermal inertia
    radiator_sensors: list[dict[str, Any]] = field(default_factory=list)
    # Central heating (C.O.) circulation pump (radiators / main circuit)
    ch_pump_entity: str = ""
    ch_pump_min_supply_temp: float = 40.0
    ch_pump_overrun_temp: float = 80.0
    # Underfloor heating receiver circuit (obieg odbiornika podłogówki zasilany z tego pieca/źródła)
    ufh_pump_entity: str = ""
    ufh_supply_temp_sensor: str = ""
    ufh_min_supply_temp: float = 25.0
    ufh_max_supply_temp: float = 48.0  # Safety cutoff: stops UFH pump if supply exceeds this temp
    # Domestic hot water (CWU) loading & circulation pumps
    dhw_pump_entity: str = ""
    dhw_circulation_pump_entity: str = ""  # CWU circulation pump (loop to faucets)
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
    bag_weight_kg: float = 25.0  # Standard fuel bag weight [kg] (25 kg ekogroszek, 15 kg pellet)
    hopper_level_sensor: str = ""  # Optional HA sensor (% or kg remaining)
    ash_content_pct: float = 7.0  # Ash percentage in fuel [%] (coal ~7%, pellet ~0.7%, wood ~1.5%)
    # Safety & efficiency warning thresholds
    feeder_max_temp: float = 60.0  # Critical burn-back alarm threshold [°C]
    flue_max_temp: float = 220.0  # High flue temperature warning [°C]
    return_min_temp: float = 45.0  # Cold return dew-point corrosion warning [°C]
    min_boiler_temp_alert: float = 35.0  # Fire-out / low boiler temp alert [°C]
    distribution_loss_alert_pct: float = 25.0  # High pipe heat-loss warning [%]
    notify_warnings_enabled: bool = True  # Send HA notifications for boiler safety/temp warnings
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

        default_bag_weight = 15.0 if fuel_type == FUEL_TYPE_PELLET else 25.0
        default_off_mode = "temperature" if cannot_extinguish else "off"
        boiler_mode = str(data.get("boiler_mode") or BOILER_MODE_AUTO)
        if boiler_mode not in BOILER_MODES:
            boiler_mode = BOILER_MODE_AUTO

        return cls(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or ""),
            plant_type=plant_type,
            enabled=bool(data.get("enabled", True)),
            priority=max(1, min(20, int(data.get("priority", 1) or 1))),
            parent_plant_id=str(data.get("parent_plant_id") or ""),
            cannot_extinguish=cannot_extinguish,
            min_power_pct=max(0.0, min(50.0, float(data.get("min_power_pct", 12.0 if cannot_extinguish else 0.0)))),
            boiler_mode=boiler_mode,
            assigned_devices=[str(x) for x in (data.get("assigned_devices") or []) if x],
            assigned_rooms=[str(x) for x in (data.get("assigned_rooms") or []) if x],
            source_entity=str(data.get("source_entity") or ""),
            boiler_target_temp_entity=str(data.get("boiler_target_temp_entity") or ""),
            dhw_target_temp_entity=str(data.get("dhw_target_temp_entity") or ""),
            target_supply_temp=float(data.get("target_supply_temp", 55.0) or 55.0),
            idle_supply_temp=float(
                data.get("idle_supply_temp", 42.0 if cannot_extinguish else 35.0) or 35.0
            ),
            off_mode=str(data.get("off_mode") or default_off_mode),
            min_rooms_demand=max(1, int(data.get("min_rooms_demand", 1) or 1)),
            supply_temp_sensor=str(data.get("supply_temp_sensor") or ""),
            return_temp_sensor=str(data.get("return_temp_sensor") or ""),
            dhw_temp_sensor=str(data.get("dhw_temp_sensor") or ""),
            dhw_supply_temp_sensor=str(data.get("dhw_supply_temp_sensor") or ""),
            flue_temp_sensor=str(data.get("flue_temp_sensor") or ""),
            feeder_temp_sensor=str(data.get("feeder_temp_sensor") or ""),
            boiler_room_temp_sensor=str(data.get("boiler_room_temp_sensor") or ""),
            feeder_work_time_sensor=str(data.get("feeder_work_time_sensor") or ""),
            feeder_pause_time_sensor=str(data.get("feeder_pause_time_sensor") or ""),
            feeder_work_time_s=max(0.0, float(data.get("feeder_work_time_s", 0.0) or 0.0)),
            feeder_pause_time_s=max(0.0, float(data.get("feeder_pause_time_s", 0.0) or 0.0)),
            blower_sensor=str(data.get("blower_sensor") or ""),
            blower_mode_sensor=str(data.get("blower_mode_sensor") or ""),
            daily_fuel_sensor=str(data.get("daily_fuel_sensor") or ""),
            flow_rate_l_min=max(0.0, float(data.get("flow_rate_l_min", 0.0) or 0.0)),
            flow_rate_sensor=str(data.get("flow_rate_sensor") or ""),
            boiler_water_volume_l=max(5.0, float(data.get("boiler_water_volume_l", 50.0) or 50.0)),
            radiator_sensors=_sanitize_radiator_sensors(data.get("radiator_sensors")),
            ch_pump_entity=str(data.get("ch_pump_entity") or ""),
            ch_pump_min_supply_temp=float(data.get("ch_pump_min_supply_temp", 40.0) or 0.0),
            ch_pump_overrun_temp=float(data.get("ch_pump_overrun_temp", 80.0) or 80.0),
            ufh_pump_entity=str(data.get("ufh_pump_entity") or ""),
            ufh_supply_temp_sensor=str(data.get("ufh_supply_temp_sensor") or ""),
            ufh_min_supply_temp=float(data.get("ufh_min_supply_temp", 25.0) or 0.0),
            ufh_max_supply_temp=float(data.get("ufh_max_supply_temp", 48.0) or 48.0),
            dhw_pump_entity=str(data.get("dhw_pump_entity") or ""),
            dhw_circulation_pump_entity=str(data.get("dhw_circulation_pump_entity") or ""),
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
            bag_weight_kg=max(1.0, min(100.0, float(data.get("bag_weight_kg", default_bag_weight) or default_bag_weight))),
            hopper_level_sensor=str(data.get("hopper_level_sensor") or ""),
            ash_content_pct=max(0.0, min(40.0, float(data.get("ash_content_pct", default_ash_pct)))),
            feeder_max_temp=max(35.0, min(95.0, float(data.get("feeder_max_temp", 60.0) or 60.0))),
            flue_max_temp=max(100.0, min(500.0, float(data.get("flue_max_temp", 220.0) or 220.0))),
            return_min_temp=max(20.0, min(65.0, float(data.get("return_min_temp", 45.0) or 45.0))),
            min_boiler_temp_alert=max(0.0, min(65.0, float(data.get("min_boiler_temp_alert", 35.0) if "min_boiler_temp_alert" in data else 35.0))),
            distribution_loss_alert_pct=max(5.0, min(80.0, float(data.get("distribution_loss_alert_pct", 25.0) or 25.0))),
            notify_warnings_enabled=bool(data.get("notify_warnings_enabled", True)),
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
            "boiler_mode": self.boiler_mode,
            "assigned_devices": list(self.assigned_devices),
            "assigned_rooms": list(self.assigned_rooms),
            "source_entity": self.source_entity,
            "boiler_target_temp_entity": self.boiler_target_temp_entity,
            "dhw_target_temp_entity": self.dhw_target_temp_entity,
            "target_supply_temp": self.target_supply_temp,
            "idle_supply_temp": self.idle_supply_temp,
            "off_mode": self.off_mode,
            "min_rooms_demand": self.min_rooms_demand,
            "supply_temp_sensor": self.supply_temp_sensor,
            "return_temp_sensor": self.return_temp_sensor,
            "dhw_temp_sensor": self.dhw_temp_sensor,
            "dhw_supply_temp_sensor": self.dhw_supply_temp_sensor,
            "flue_temp_sensor": self.flue_temp_sensor,
            "feeder_temp_sensor": self.feeder_temp_sensor,
            "boiler_room_temp_sensor": self.boiler_room_temp_sensor,
            "feeder_work_time_sensor": self.feeder_work_time_sensor,
            "feeder_pause_time_sensor": self.feeder_pause_time_sensor,
            "feeder_work_time_s": self.feeder_work_time_s,
            "feeder_pause_time_s": self.feeder_pause_time_s,
            "blower_sensor": self.blower_sensor,
            "blower_mode_sensor": self.blower_mode_sensor,
            "daily_fuel_sensor": self.daily_fuel_sensor,
            "flow_rate_l_min": self.flow_rate_l_min,
            "flow_rate_sensor": self.flow_rate_sensor,
            "boiler_water_volume_l": self.boiler_water_volume_l,
            "radiator_sensors": [dict(r) for r in self.radiator_sensors],
            "ch_pump_entity": self.ch_pump_entity,
            "ch_pump_min_supply_temp": self.ch_pump_min_supply_temp,
            "ch_pump_overrun_temp": self.ch_pump_overrun_temp,
            "ufh_pump_entity": self.ufh_pump_entity,
            "ufh_supply_temp_sensor": self.ufh_supply_temp_sensor,
            "ufh_min_supply_temp": self.ufh_min_supply_temp,
            "ufh_max_supply_temp": self.ufh_max_supply_temp,
            "dhw_pump_entity": self.dhw_pump_entity,
            "dhw_circulation_pump_entity": self.dhw_circulation_pump_entity,
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
            "bag_weight_kg": self.bag_weight_kg,
            "hopper_level_sensor": self.hopper_level_sensor,
            "ash_content_pct": self.ash_content_pct,
            "feeder_max_temp": self.feeder_max_temp,
            "flue_max_temp": self.flue_max_temp,
            "return_min_temp": self.return_min_temp,
            "min_boiler_temp_alert": self.min_boiler_temp_alert,
            "distribution_loss_alert_pct": self.distribution_loss_alert_pct,
            "notify_warnings_enabled": self.notify_warnings_enabled,
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
    """Persisted and in-memory runtime counters + learned boiler MPC model."""

    day_str: str = ""
    dhw_charging: bool = False
    was_warm: bool = False  # Tracks if solid-fuel boiler was lit so fire-out alert triggers accurately
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
    # Distribution heat-loss counters (boiler -> radiators)
    distribution_loss_kwh_today: float = 0.0
    distribution_loss_kwh_total: float = 0.0
    distribution_loss_cost_today: float = 0.0
    distribution_loss_cost_total: float = 0.0
    distribution_loss_fuel_kg_today: float = 0.0
    distribution_loss_fuel_kg_total: float = 0.0
    # Hopper & maintenance tracking
    fuel_loaded_kg: float | None = None  # Amount loaded at last refill
    total_refilled_kg: float = 0.0
    total_refilled_bags: float = 0.0
    fuel_since_refill_kg: float = 0.0
    fuel_since_ash_clean_kg: float = 0.0
    fuel_since_chimney_clean_kg: float = 0.0
    last_refill_ts: float | None = None
    last_ash_clean_ts: float | None = None
    last_chimney_clean_ts: float | None = None
    # Online Boiler MPC thermal & combustion model
    model: BoilerThermalModel = field(default_factory=BoilerThermalModel)

    def to_dict(self) -> dict[str, Any]:
        return {
            "day_str": self.day_str,
            "dhw_charging": self.dhw_charging,
            "was_warm": self.was_warm,
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
            "distribution_loss_kwh_today": round(self.distribution_loss_kwh_today, 4),
            "distribution_loss_kwh_total": round(self.distribution_loss_kwh_total, 4),
            "distribution_loss_cost_today": round(self.distribution_loss_cost_today, 4),
            "distribution_loss_cost_total": round(self.distribution_loss_cost_total, 4),
            "distribution_loss_fuel_kg_today": round(self.distribution_loss_fuel_kg_today, 4),
            "distribution_loss_fuel_kg_total": round(self.distribution_loss_fuel_kg_total, 4),
            "fuel_loaded_kg": round(self.fuel_loaded_kg, 4) if self.fuel_loaded_kg is not None else None,
            "total_refilled_kg": round(self.total_refilled_kg, 4),
            "total_refilled_bags": round(self.total_refilled_bags, 2),
            "fuel_since_refill_kg": round(self.fuel_since_refill_kg, 4),
            "fuel_since_ash_clean_kg": round(self.fuel_since_ash_clean_kg, 4),
            "fuel_since_chimney_clean_kg": round(self.fuel_since_chimney_clean_kg, 4),
            "last_refill_ts": self.last_refill_ts,
            "last_ash_clean_ts": self.last_ash_clean_ts,
            "last_chimney_clean_ts": self.last_chimney_clean_ts,
            "model": self.model.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HeatPlantRuntimeState:
        def _opt_float(key: str) -> float | None:
            v = data.get(key)
            return float(v) if isinstance(v, (int, float)) else None

        return cls(
            day_str=str(data.get("day_str") or ""),
            dhw_charging=bool(data.get("dhw_charging", False)),
            was_warm=bool(data.get("was_warm", False)),
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
            distribution_loss_kwh_today=float(data.get("distribution_loss_kwh_today", 0.0) or 0.0),
            distribution_loss_kwh_total=float(data.get("distribution_loss_kwh_total", 0.0) or 0.0),
            distribution_loss_cost_today=float(data.get("distribution_loss_cost_today", 0.0) or 0.0),
            distribution_loss_cost_total=float(data.get("distribution_loss_cost_total", 0.0) or 0.0),
            distribution_loss_fuel_kg_today=float(data.get("distribution_loss_fuel_kg_today", 0.0) or 0.0),
            distribution_loss_fuel_kg_total=float(data.get("distribution_loss_fuel_kg_total", 0.0) or 0.0),
            fuel_loaded_kg=_opt_float("fuel_loaded_kg"),
            total_refilled_kg=float(data.get("total_refilled_kg", 0.0) or 0.0),
            total_refilled_bags=float(data.get("total_refilled_bags", 0.0) or 0.0),
            fuel_since_refill_kg=float(data.get("fuel_since_refill_kg", 0.0) or 0.0),
            fuel_since_ash_clean_kg=float(data.get("fuel_since_ash_clean_kg", 0.0) or 0.0),
            fuel_since_chimney_clean_kg=float(data.get("fuel_since_chimney_clean_kg", 0.0) or 0.0),
            last_refill_ts=_opt_float("last_refill_ts"),
            last_ash_clean_ts=_opt_float("last_ash_clean_ts"),
            last_chimney_clean_ts=_opt_float("last_chimney_clean_ts"),
            model=BoilerThermalModel.from_dict(data.get("model")),
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
                    was_warm=st.was_warm,
                    last_ts=st.last_ts,
                    last_energy_reading=st.last_energy_reading,
                    last_fuel_reading=st.last_fuel_reading,
                    fuel_loaded_kg=st.fuel_loaded_kg,
                    total_refilled_kg=st.total_refilled_kg,
                    total_refilled_bags=st.total_refilled_bags,
                    fuel_since_refill_kg=st.fuel_since_refill_kg,
                    fuel_since_ash_clean_kg=st.fuel_since_ash_clean_kg,
                    fuel_since_chimney_clean_kg=st.fuel_since_chimney_clean_kg,
                    last_refill_ts=st.last_refill_ts,
                    last_ash_clean_ts=st.last_ash_clean_ts,
                    last_chimney_clean_ts=st.last_chimney_clean_ts,
                    model=st.model,
                )
                changed = True
        if changed:
            self.state_dirty = True
        return changed

    def log_fuel(
        self,
        plant_id: str,
        kg: float,
        mode: str = "refill",
        *,
        bags: float | None = None,
        filled_to_full: bool = False,
    ) -> bool:
        """Record a fuel refill (bags / kg poured into hopper) and calibrate burn estimation.

        - ``mode == "refill"`` (default): User reports how many bags / kg they poured in.
          Updates hopper remaining fuel, logs refill history, self-calibrates the boiler's
          burn model when topped up, and clears the refill alert.
        - ``mode == "burned"``: Legacy service compatibility — adds kg directly to counters.
        """
        if plant_id not in self._plants:
            return False
        plant = self._plants[plant_id]
        if kg <= 0 and bags is not None and bags > 0:
            kg = bags * max(1.0, plant.bag_weight_kg)
        if kg <= 0:
            return False
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
            st.distribution_loss_kwh_today = 0.0
            st.distribution_loss_cost_today = 0.0
            st.distribution_loss_fuel_kg_today = 0.0

        if mode == "refill":
            est_burned = st.fuel_since_refill_kg
            prev_ts = st.last_refill_ts
            bag_wt = max(1.0, plant.bag_weight_kg)
            bags_val = bags if (bags is not None and bags > 0) else (kg / bag_wt)

            if filled_to_full:
                new_loaded = plant.hopper_capacity_kg
            else:
                current_remaining = max(0.0, (st.fuel_loaded_kg or 0.0) - st.fuel_since_refill_kg)
                new_loaded = min(plant.hopper_capacity_kg * 2.0, current_remaining + kg)

            st.model.record_refill(
                now=now,
                kg=kg,
                bags=bags_val,
                estimated_burned_since_last_kg=est_burned,
                last_refill_ts=prev_ts,
                filled_to_full=filled_to_full,
            )

            st.fuel_loaded_kg = new_loaded
            st.total_refilled_kg += kg
            st.total_refilled_bags += bags_val
            st.fuel_since_refill_kg = 0.0
            st.last_refill_ts = now
            self._throttler.clear(f"refill_{plant_id}")
            dismiss_notification(self.hass, f"{NOTIF_PLANT_PREFIX}{plant_id}_refill")
            self.state_dirty = True
            return True

        # Legacy mode == "burned": calculate energy & cost directly from kg of fuel
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
            est_burned = st.fuel_since_refill_kg
            prev_ts = st.last_refill_ts
            bag_wt = max(1.0, plant.bag_weight_kg)
            if est_burned > 0 or (kg is not None and kg > 0):
                added_kg = kg if (kg is not None and kg > 0) else max(est_burned, amount)
                st.model.record_refill(
                    now=now,
                    kg=added_kg,
                    bags=added_kg / bag_wt,
                    estimated_burned_since_last_kg=est_burned,
                    last_refill_ts=prev_ts,
                    filled_to_full=True,
                )
                st.total_refilled_kg += added_kg
                st.total_refilled_bags += added_kg / bag_wt
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

    async def _async_write_temp_entity(self, entity_id: str, temp_c: float, label: str) -> None:
        """Write a target temperature (°C) to a HA number/input_number/climate/water_heater entity."""
        if not entity_id:
            return
        domain = entity_id.split(".", 1)[0]
        target_ha = celsius_to_ha_temp(self.hass, temp_c)
        try:
            if domain in ("number", "input_number"):
                st = self.hass.states.get(entity_id)
                cur = float(st.state) if (st is not None and st.state not in ("unavailable", "unknown")) else None
                if cur is None or abs(cur - target_ha) > 0.25:
                    await self.hass.services.async_call(
                        domain,
                        "set_value",
                        {"entity_id": entity_id, "value": round(target_ha, 1)},
                        blocking=True,
                        context=make_roommind_context(),
                    )
            elif domain in ("climate", "water_heater"):
                st = self.hass.states.get(entity_id)
                cur = st.attributes.get("temperature") if st is not None else None
                if cur is None or abs(float(cur) - target_ha) > 0.25:
                    await self.hass.services.async_call(
                        domain,
                        "set_temperature",
                        {"entity_id": entity_id, "temperature": round(target_ha, 1)},
                        blocking=True,
                        context=make_roommind_context(),
                    )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Heat plant: failed to set %s on '%s'", label, entity_id, exc_info=True)

    async def async_apply_setpoints(self, plant: HeatPlantConfig) -> None:
        """Immediately push configured boiler & DHW target temperatures to optional HA setpoint entities."""
        if plant.boiler_target_temp_entity:
            t_target = (
                plant.idle_supply_temp
                if plant.boiler_mode == BOILER_MODE_HOLD
                else plant.target_supply_temp
            )
            await self._async_write_temp_entity(
                plant.boiler_target_temp_entity, t_target, "boiler target temp"
            )
        if plant.dhw_target_temp_entity:
            await self._async_write_temp_entity(
                plant.dhw_target_temp_entity, plant.dhw_target_temp, "DHW target temp"
            )

    def _read_temp_celsius(self, entity_id: str, label: str) -> float | None:
        if not entity_id:
            return None
        raw = read_sensor_value(self.hass, entity_id, "heat_plant", label)
        if raw is None:
            return None
        return ha_temp_to_celsius(self.hass, raw, entity_id=entity_id)

    def _read_numeric(self, entity_id: str, label: str) -> float | None:
        if not entity_id:
            return None
        return read_sensor_value(self.hass, entity_id, "heat_plant", label)

    def _read_text(self, entity_id: str) -> str | None:
        if not entity_id:
            return None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in ("unavailable", "unknown", ""):
            return None
        return str(st.state)

    def _compute_distribution_loss(
        self,
        plant: HeatPlantConfig,
        supply_temp: float | None,
        return_temp: float | None,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
    ) -> dict[str, Any]:
        """Compute heat loss along pipes between boiler supply and configured radiator sensors."""
        readings: list[dict[str, Any]] = []
        temps: list[float] = []
        drops: list[float] = []
        loss_pcts: list[float] = []

        for entry in plant.radiator_sensors:
            eid = entry.get("entity_id", "")
            if not eid:
                continue
            rad_temp = self._read_temp_celsius(eid, "radiator temp")
            ret_eid = entry.get("return_entity_id", "")
            rad_ret = self._read_temp_celsius(ret_eid, "radiator return temp") if ret_eid else None
            room_id = entry.get("room_id", "")
            pipe_len = float(entry.get("pipe_length_m", 0.0) or 0.0)
            st_obj = self.hass.states.get(eid)
            friendly = entry.get("name") or (
                str(st_obj.attributes.get("friendly_name") or eid) if st_obj else eid
            )
            room_temp: float | None = None
            if room_id and room_id in room_states:
                rt = room_states[room_id].get("current_temp")
                if isinstance(rt, (int, float)):
                    room_temp = float(rt)

            temp_drop_k: float | None = None
            loss_pct: float | None = None
            loss_k_per_m: float | None = None
            rad_delta_t: float | None = None
            if rad_temp is not None and rad_ret is not None:
                rad_delta_t = round(rad_temp - rad_ret, 1)

            if rad_temp is not None:
                temps.append(rad_temp)
                if supply_temp is not None and supply_temp > 25.0:
                    drop = max(0.0, supply_temp - rad_temp)
                    temp_drop_k = round(drop, 1)
                    drops.append(drop)
                    # Reference thermal span: boiler supply to return (if meaningful) else supply to room ambient
                    if return_temp is not None and (supply_temp - return_temp) >= 2.0:
                        span = max(supply_temp - return_temp, drop + 1.0)
                    else:
                        ambient_ref = room_temp if room_temp is not None else 20.0
                        span = max(3.0, supply_temp - ambient_ref)
                    lp = max(0.0, min(95.0, (drop / span) * 100.0))
                    loss_pct = round(lp, 1)
                    loss_pcts.append(lp)
                    if pipe_len > 0:
                        loss_k_per_m = round(drop / pipe_len, 2)

            readings.append(
                {
                    "entity_id": eid,
                    "return_entity_id": ret_eid,
                    "room_id": room_id,
                    "name": friendly,
                    "pipe_length_m": pipe_len,
                    "temp": round(rad_temp, 1) if rad_temp is not None else None,
                    "return_temp": round(rad_ret, 1) if rad_ret is not None else None,
                    "rad_delta_t": rad_delta_t,
                    "radiator_delta_t": rad_delta_t,
                    "temp_drop_k": temp_drop_k,
                    "loss_pct": loss_pct,
                    "loss_k_per_m": loss_k_per_m,
                }
            )

        avg_rad = round(sum(temps) / len(temps), 1) if temps else None
        min_rad = round(min(temps), 1) if temps else None
        max_rad = round(max(temps), 1) if temps else None
        avg_drop = round(sum(drops) / len(drops), 1) if drops else None
        avg_loss_pct = round(sum(loss_pcts) / len(loss_pcts), 1) if loss_pcts else None

        return {
            "radiator_readings": readings,
            "avg_radiator_temp": avg_rad,
            "min_radiator_temp": min_rad,
            "max_radiator_temp": max_rad,
            "distribution_temp_drop_k": avg_drop,
            "distribution_loss_pct": avg_loss_pct,
        }

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
        blower_pct: float | None,
        heating_demand: bool,
        dhw_demand: bool,
        mean_pf: float,
        source_active: bool,
        in_fire_hold: bool,
    ) -> float:
        """Compute continuous power fraction (0..1) from real boiler temperatures, ΔT, flue, blower, and demand.

        - If the boiler is demonstrably cold (supply < 28°C and flue < 35°C and blower == 0) with no
          active demand, power is 0 (prevents phantom fuel burn on an extinguished boiler).
        - When heating/DHW or in fire-hold, blends measured ΔT (heat extraction), supply temperature,
          flue temperature, blower fan %, and room demand.
        """
        min_hold_pf = (
            max(0.05, plant.min_power_pct / 100.0)
            if (plant.cannot_extinguish and plant.enabled)
            else 0.0
        )

        # If sensors clearly show a cold/extinguished boiler with no active demand -> 0 power
        boiler_cold = (
            not heating_demand
            and not dhw_demand
            and supply_temp is not None
            and supply_temp < 28.0
            and (flue_temp is None or flue_temp < 35.0)
            and (blower_pct is None or blower_pct <= 0.0)
        )
        if boiler_cold:
            return 0.0

        # Temperature-derived power factor from supply, return (ΔT), flue, and blower
        temp_pf = 0.0
        if supply_temp is not None and supply_temp > 25.0:
            target = max(35.0, plant.target_supply_temp)
            idle = max(25.0, min(target - 5.0, plant.idle_supply_temp))
            if supply_temp <= idle:
                temp_pf = min_hold_pf * max(0.35, (supply_temp - 20.0) / max(10.0, idle - 20.0))
            else:
                span = max(5.0, target - idle)
                ratio = min(1.1, max(0.0, (supply_temp - idle) / span))
                temp_pf = min_hold_pf + (0.85 - min_hold_pf) * min(1.0, ratio)

            # Adjust by measured water ΔT (supply - return): typical nominal full-load ΔT ≈ 15 K
            if delta_t is not None and delta_t > 0:
                dt_ratio = min(1.15, max(0.1, delta_t / 15.0))
                temp_pf = 0.55 * temp_pf + 0.45 * min(1.0, dt_ratio)

        if flue_temp is not None and flue_temp > 45.0:
            flue_pf = min(1.0, max(min_hold_pf, (flue_temp - 45.0) / 145.0))
            temp_pf = max(temp_pf, flue_pf)

        if blower_pct is not None and blower_pct > 0:
            blower_pf = min(1.0, max(min_hold_pf, blower_pct / 100.0))
            temp_pf = max(temp_pf, 0.7 * blower_pf + 0.3 * temp_pf)

        if heating_demand and dhw_demand:
            if mean_pf > 0 and supply_temp is not None and delta_t is not None:
                # Blend room demand with real boiler thermal state
                demand_pf = max(0.5 * mean_pf + 0.5 * temp_pf, mean_pf)
            else:
                demand_pf = max(mean_pf, 0.8, temp_pf)
        elif heating_demand:
            base_demand = mean_pf if mean_pf > 0 else 0.65
            demand_pf = max(base_demand, temp_pf * 0.85, min_hold_pf)
        elif dhw_demand:
            demand_pf = max(0.7, temp_pf, min_hold_pf)
        elif in_fire_hold or (plant.cannot_extinguish and plant.enabled):
            if blower_pct is not None and blower_pct == 0.0:
                # Blower explicitly off (e.g. Galmet CNF 0%): pure ember standby
                demand_pf = min_hold_pf
            else:
                extra_hold = 0.0
                if supply_temp is not None and supply_temp > plant.target_supply_temp + 3.0:
                    extra_hold = min(0.20, (supply_temp - plant.target_supply_temp) / 45.0)
                if flue_temp is not None and flue_temp > 115.0:
                    extra_hold = max(extra_hold, min(0.30, (flue_temp - 115.0) / 160.0))
                demand_pf = min(1.0, min_hold_pf + extra_hold)
        elif source_active:
            demand_pf = max(0.45, temp_pf)
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
        *,
        supply_temp: float | None = None,
        return_temp: float | None = None,
        delta_t: float | None = None,
        flue_temp: float | None = None,
        ambient_temp: float = 18.0,
        ch_pump_on: bool = False,
        feeder_work_s: float | None = None,
        feeder_pause_s: float | None = None,
        daily_fuel_sensor_kg_24h: float | None = None,
        flow_l_min: float | None = None,
        distribution_loss_pct: float | None = None,
    ) -> dict[str, Any]:
        """Compute real temperature/feeder/hydraulic burn, efficiency, power, pipe loss, and cost."""
        today = dt_util.now().date().isoformat()
        if st.day_str != today:
            st.day_str = today
            st.runtime_hours_today = 0.0
            st.thermal_kwh_today = 0.0
            st.input_kwh_today = 0.0
            st.fuel_consumed_today = 0.0
            st.cost_today = 0.0
            st.distribution_loss_kwh_today = 0.0
            st.distribution_loss_cost_today = 0.0
            st.distribution_loss_fuel_kg_today = 0.0
            self.state_dirty = True

        dt_hours = 0.0
        if st.last_ts is not None and now > st.last_ts:
            dt_hours = min(24.0, (now - st.last_ts) / 3600.0)
        elif st.last_ts is None and st.last_refill_ts is not None and 0 < (now - st.last_refill_ts) <= 86400:
            dt_hours = min(1.0, (now - st.last_refill_ts) / 3600.0)
        st.last_ts = now

        # 1. Check external energy_sensor (power in W/kW or cumulative energy in kWh)
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
                        sensor_fuel_delta = f_val
                st.last_fuel_reading = f_val

        # 3. Check auger / feeder screw binary entity (podajnik ślimakowy)
        feeder_active = False
        feeder_fuel_delta: float | None = None
        if plant.feeder_entity:
            feeder_st = self.hass.states.get(plant.feeder_entity)
            if feeder_st is not None and feeder_st.state == "on":
                feeder_active = True
                if dt_hours > 0:
                    feeder_fuel_delta = plant.feeder_kg_per_hour * dt_hours

        # 4. Feeder work/pause duty cycle (e.g. Galmet eLider 12.0s / 960.0s)
        feeder_duty_pct: float | None = None
        if feeder_work_s is not None and feeder_pause_s is not None and feeder_work_s > 0 and (feeder_work_s + feeder_pause_s) > 0:
            feeder_duty_pct = round((feeder_work_s / (feeder_work_s + feeder_pause_s)) * 100.0, 2)

        # 5. Real dynamic efficiency via Siegert stack loss from flue gas temperature
        siegert_eff = (
            siegert_efficiency_pct(flue_temp, ambient_temp, plant.fuel_type)
            if plant.fuel_type in (*SOLID_FUEL_TYPES, FUEL_TYPE_GAS)
            else None
        )
        real_efficiency_pct = siegert_eff if siegert_eff is not None else plant.efficiency_pct
        eff = max(0.05, real_efficiency_pct / 100.0)
        cfg_eff = max(0.05, plant.efficiency_pct / 100.0)
        cop = max(1.0, plant.cop)

        # 6. Hydraulic thermal output from measured water ΔT and flow rate (Q = 0.06977 * L/min * ΔT)
        # Ignore small sensor drift when the boiler is cold (< 28 °C) and not actively heating.
        boiler_cold_idle = not is_running and supply_temp is not None and supply_temp < 28.0
        hydraulic_kw: float | None = None
        if (
            not boiler_cold_idle
            and delta_t is not None
            and delta_t > 0
            and flow_l_min is not None
            and flow_l_min > 0
        ):
            if ch_pump_on or not plant.ch_pump_entity:
                hydraulic_kw = WATER_KW_PER_LPM_K * flow_l_min * delta_t

        # Effective power fraction
        if is_running or in_fire_hold or (plant.cannot_extinguish and plant.enabled and effective_pf > 0):
            pf = max(
                effective_pf,
                (plant.min_power_pct / 100.0)
                if (plant.cannot_extinguish and plant.enabled and effective_pf > 0)
                else 0.0,
            )
        else:
            pf = 0.0

        # Calorific conversions
        chem_kwh_per_kg = mj_kg_to_kwh_kg(plant.calorific_value_mj_kg)
        usable_kwh_kg = usable_kwh_per_kg(plant.calorific_value_mj_kg, plant.efficiency_pct)
        real_usable_kwh_kg = usable_kwh_per_kg(plant.calorific_value_mj_kg, real_efficiency_pct)
        cal_factor = st.model.fuel_calibration_factor

        # Determine instantaneous power & fuel burn rate from best available real source
        calc_method = "temperature_model"
        burn_rate_per_h = 0.0
        if (
            daily_fuel_sensor_kg_24h is not None
            and daily_fuel_sensor_kg_24h >= 0
            and plant.fuel_type in SOLID_FUEL_TYPES
            and chem_kwh_per_kg > 0
        ):
            burn_rate_per_h = daily_fuel_sensor_kg_24h / 24.0
            current_input_kw = burn_rate_per_h * chem_kwh_per_kg
            current_thermal_kw = current_input_kw * eff
            calc_method = "daily_fuel_sensor"
        elif (
            feeder_duty_pct is not None
            and plant.fuel_type in SOLID_FUEL_TYPES
            and chem_kwh_per_kg > 0
        ):
            burn_rate_per_h = plant.feeder_kg_per_hour * (feeder_duty_pct / 100.0) * cal_factor
            current_input_kw = burn_rate_per_h * chem_kwh_per_kg
            current_thermal_kw = current_input_kw * eff
            calc_method = "feeder_cycle"
        elif feeder_active and plant.fuel_type in SOLID_FUEL_TYPES and chem_kwh_per_kg > 0:
            burn_rate_per_h = plant.feeder_kg_per_hour
            current_input_kw = burn_rate_per_h * chem_kwh_per_kg
            current_thermal_kw = current_input_kw * cfg_eff
            calc_method = "feeder_switch"
        elif hydraulic_kw is not None and plant.plant_type != PLANT_TYPE_HEAT_PUMP:
            current_thermal_kw = hydraulic_kw
            current_input_kw = current_thermal_kw / eff
            calc_method = "hydraulic_delta_t"
        elif plant.plant_type == PLANT_TYPE_HEAT_PUMP:
            if sensor_power_kw is not None:
                current_input_kw = sensor_power_kw
                current_thermal_kw = current_input_kw * cop
                calc_method = "energy_sensor"
            else:
                current_thermal_kw = plant.nominal_power_kw * pf
                current_input_kw = current_thermal_kw / cop
        else:
            if sensor_power_kw is not None:
                if plant.fuel_type == FUEL_TYPE_ELECTRICITY:
                    current_input_kw = sensor_power_kw
                    current_thermal_kw = current_input_kw * cfg_eff
                else:
                    current_thermal_kw = sensor_power_kw
                    current_input_kw = current_thermal_kw / eff
                calc_method = "energy_sensor"
            else:
                current_thermal_kw = plant.nominal_power_kw * pf
                # Use real efficiency (from flue temp if measured) for chemical input
                current_input_kw = current_thermal_kw / eff

        # If BOTH hydraulic ΔT output and fuel input are measured independently, compute measured real efficiency
        measured_efficiency_pct: float | None = None
        if hydraulic_kw is not None and current_input_kw > 0.2 and calc_method in ("feeder_cycle", "daily_fuel_sensor"):
            measured_efficiency_pct = round(max(15.0, min(100.0, (hydraulic_kw / current_input_kw) * 100.0)), 1)
            real_efficiency_pct = measured_efficiency_pct

        # Fuel burn rate & unit price
        if plant.fuel_type in SOLID_FUEL_TYPES:
            fuel_unit = "kg"
            if calc_method not in ("daily_fuel_sensor", "feeder_cycle", "feeder_switch"):
                base_rate = current_input_kw / chem_kwh_per_kg if chem_kwh_per_kg > 0 else 0.0
                burn_rate_per_h = base_rate * cal_factor
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

        burn_rate_per_24h = burn_rate_per_h * 24.0
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

        # Distribution pipe heat loss power (boiler -> radiators)
        dist_loss_kw: float | None = None
        delivered_kw: float | None = None
        if distribution_loss_pct is not None:
            frac = max(0.0, min(0.95, distribution_loss_pct / 100.0))
            dist_loss_kw = current_thermal_kw * frac
            delivered_kw = max(0.0, current_thermal_kw - dist_loss_kw)

        fuel_source_mode = "estimated"
        if plant.fuel_consumption_sensor:
            fuel_source_mode = "fuel_sensor"
        elif daily_fuel_sensor_kg_24h is not None:
            fuel_source_mode = "daily_fuel_sensor"
        elif feeder_duty_pct is not None:
            fuel_source_mode = "feeder_cycle"
        elif plant.feeder_entity:
            fuel_source_mode = "feeder"
        elif hydraulic_kw is not None:
            fuel_source_mode = "hydraulic_delta_t"
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
            elif feeder_fuel_delta is not None and feeder_duty_pct is None:
                d_fuel = feeder_fuel_delta
                if plant.fuel_type in SOLID_FUEL_TYPES:
                    d_in_kwh = d_fuel * chem_kwh_per_kg
                    d_th_kwh = d_in_kwh * cfg_eff
            elif plant.feeder_entity and feeder_duty_pct is None and daily_fuel_sensor_kg_24h is None:
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
                if distribution_loss_pct is not None and distribution_loss_pct > 0:
                    loss_frac = max(0.0, min(0.95, distribution_loss_pct / 100.0))
                    st.distribution_loss_kwh_today += d_th_kwh * loss_frac
                    st.distribution_loss_kwh_total += d_th_kwh * loss_frac
                    st.distribution_loss_cost_today += d_cost * loss_frac
                    st.distribution_loss_cost_total += d_cost * loss_frac
                    if plant.fuel_type in SOLID_FUEL_TYPES:
                        st.distribution_loss_fuel_kg_today += d_fuel * loss_frac
                        st.distribution_loss_fuel_kg_total += d_fuel * loss_frac
                if plant.fuel_type in SOLID_FUEL_TYPES and d_fuel > 0:
                    st.fuel_since_refill_kg += d_fuel
                    st.fuel_since_ash_clean_kg += d_fuel
                    st.fuel_since_chimney_clean_kg += d_fuel
                self.state_dirty = True

        return {
            "fuel_unit": fuel_unit,
            "fuel_source_mode": fuel_source_mode,
            "calculation_method": calc_method,
            "feeder_active": feeder_active,
            "feeder_duty_pct": feeder_duty_pct,
            "real_efficiency_pct": round(real_efficiency_pct, 1),
            "measured_efficiency_pct": measured_efficiency_pct,
            "hydraulic_kw": round(hydraulic_kw, 2) if hydraulic_kw is not None else None,
            "chemical_kwh_per_kg": round(chem_kwh_per_kg, 2),
            "usable_kwh_per_kg": round(usable_kwh_kg, 2),
            "real_usable_kwh_per_kg": round(real_usable_kwh_kg, 2),
            "current_thermal_kw": round(current_thermal_kw, 2),
            "current_input_kw": round(current_input_kw, 2),
            "delivered_thermal_kw": round(delivered_kw, 2) if delivered_kw is not None else None,
            "distribution_loss_kw": round(dist_loss_kw, 2) if dist_loss_kw is not None else None,
            "distribution_loss_kwh_today": round(st.distribution_loss_kwh_today, 2),
            "distribution_loss_kwh_total": round(st.distribution_loss_kwh_total, 2),
            "distribution_loss_cost_today": round(st.distribution_loss_cost_today, 2),
            "distribution_loss_cost_total": round(st.distribution_loss_cost_total, 2),
            "distribution_loss_fuel_kg_today": round(st.distribution_loss_fuel_kg_today, 2),
            "distribution_loss_fuel_kg_total": round(st.distribution_loss_fuel_kg_total, 2),
            "burn_rate_per_h": round(burn_rate_per_h, 3),
            "burn_rate_per_24h": round(burn_rate_per_24h, 1),
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
            "total_refilled_kg": round(st.total_refilled_kg, 1),
            "total_refilled_bags": round(st.total_refilled_bags, 1),
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

        # Prefer learned burn rate or refill average for stable autonomy estimate
        autonomy_rate = burn_rate_per_h
        if st.model.refill_avg_kg_24h and st.model.refill_avg_kg_24h > 0.5:
            autonomy_rate = (
                0.5 * burn_rate_per_h + 0.5 * (st.model.refill_avg_kg_24h / 24.0)
                if burn_rate_per_h > 0.05
                else (st.model.refill_avg_kg_24h / 24.0)
            )
        elif st.model.learned_burn_rate_kg_h > 0.05 and burn_rate_per_h <= 0.05:
            autonomy_rate = st.model.learned_burn_rate_kg_h

        hours_until_refill: float | None = None
        if autonomy_rate > 0.05:
            hours_until_refill = round(fuel_remaining_kg / autonomy_rate, 1)

        # Ash accumulation: continuously increases with every gram of fuel burned
        ash_burned_kg = max(
            st.fuel_since_ash_clean_kg,
            st.fuel_consumed_total if st.last_ash_clean_ts is None else 0.0,
        )
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
        outdoor_temp: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Evaluate all configured heat plants, coordinate multi-source priority, command sources/pumps."""
        self.load_configs(settings.get("heat_plants", []))
        climate_active = bool(settings.get("climate_control_active", True))
        now = time.time()
        live_out: dict[str, dict[str, Any]] = {}

        # Sort plants by priority (1 = highest priority, e.g. fireplace before backup boiler)
        ordered_plants = sorted(self._plants.values(), key=lambda p: (p.priority, p.id))

        # Pre-pass: detect child loops demanding heat from a parent plant
        parent_extra_demand: dict[str, list[str]] = {}
        for plant in ordered_plants:
            if not plant.enabled or not plant.parent_plant_id or plant.parent_plant_id not in self._plants:
                continue
            d_rooms, a_devs, _, _ = self._collect_demand(plant, rooms, room_states)
            if len(d_rooms) >= plant.min_rooms_demand or (
                not plant.assigned_rooms and len(a_devs) >= plant.min_rooms_demand
            ):
                parent_extra_demand.setdefault(plant.parent_plant_id, []).append(plant.name or plant.id)

        covered_rooms_by_higher_priority: dict[str, str] = {}

        for plant in ordered_plants:
            pid = plant.id
            st = self._states.setdefault(pid, HeatPlantRuntimeState())
            supply_temp = self._read_temp_celsius(plant.supply_temp_sensor, "supply temperature")
            return_temp = self._read_temp_celsius(plant.return_temp_sensor, "return temperature")
            dhw_temp = self._read_temp_celsius(plant.dhw_temp_sensor, "DHW temperature")
            dhw_supply_temp = (
                self._read_temp_celsius(plant.dhw_supply_temp_sensor, "DHW supply temperature")
                if plant.dhw_supply_temp_sensor
                else supply_temp
            )
            flue_temp = self._read_temp_celsius(plant.flue_temp_sensor, "flue temperature")
            feeder_temp = self._read_temp_celsius(plant.feeder_temp_sensor, "feeder temperature")
            boiler_room_temp = self._read_temp_celsius(plant.boiler_room_temp_sensor, "boiler room temperature")
            ambient_temp = boiler_room_temp if boiler_room_temp is not None else 18.0
            ufh_supply_temp = (
                self._read_temp_celsius(plant.ufh_supply_temp_sensor, "underfloor supply temperature")
                if plant.ufh_supply_temp_sensor
                else supply_temp
            )

            # Galmet eLider / stoker controller telemetry
            feeder_work_s = self._read_numeric(plant.feeder_work_time_sensor, "feeder work time")
            if feeder_work_s is None and plant.feeder_work_time_s > 0:
                feeder_work_s = plant.feeder_work_time_s
            feeder_pause_s = self._read_numeric(plant.feeder_pause_time_sensor, "feeder pause time")
            if feeder_pause_s is None and plant.feeder_pause_time_s > 0:
                feeder_pause_s = plant.feeder_pause_time_s

            blower_pct = self._read_numeric(plant.blower_sensor, "blower speed")
            if blower_pct is not None:
                blower_pct = max(0.0, min(100.0, blower_pct))
            blower_mode = self._read_text(plant.blower_mode_sensor)
            daily_fuel_sensor_val = self._read_numeric(plant.daily_fuel_sensor, "daily fuel rate")

            # Water flow rate [L/min]
            flow_l_min: float | None = None
            if plant.flow_rate_sensor:
                fl_val = self._read_numeric(plant.flow_rate_sensor, "flow rate")
                fl_st = self.hass.states.get(plant.flow_rate_sensor)
                fl_unit = str(fl_st.attributes.get("unit_of_measurement") or "").strip().lower() if fl_st else ""
                if fl_val is not None and fl_val >= 0:
                    if "m3" in fl_unit or "m³" in fl_unit:
                        flow_l_min = fl_val * (1000.0 / 60.0)
                    else:
                        flow_l_min = fl_val
            elif plant.flow_rate_l_min > 0:
                flow_l_min = plant.flow_rate_l_min

            delta_t = (
                round(supply_temp - return_temp, 1)
                if supply_temp is not None and return_temp is not None
                else None
            )

            # Track whether solid-fuel boiler was warm (for fire-out detection)
            if supply_temp is not None and supply_temp >= max(42.0, plant.min_boiler_temp_alert + 8.0):
                st.was_warm = True

            # Higher-priority assistance
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
            raw_heating_demand = (
                len(demanding_rooms) >= plant.min_rooms_demand
                or (not plant.assigned_rooms and len(active_devices) >= plant.min_rooms_demand)
                or bool(child_demands)
            )
            if plant.boiler_mode == BOILER_MODE_SUMMER_DHW:
                heating_demand = False
            elif plant.boiler_mode == BOILER_MODE_HOLD:
                heating_demand = False
            elif plant.boiler_mode == BOILER_MODE_HEATING:
                heating_demand = True
            else:
                heating_demand = raw_heating_demand

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
            overheat_protect = (
                supply_temp is not None
                and plant.ch_pump_overrun_temp > 0
                and supply_temp >= plant.ch_pump_overrun_temp
            )
            # UFH overheat triggers only when a dedicated post-mixer UFH supply sensor is configured and exceeds max
            ufh_overheat_protect = bool(
                plant.ufh_supply_temp_sensor
                and ufh_supply_temp is not None
                and plant.ufh_max_supply_temp > 0
                and ufh_supply_temp >= plant.ufh_max_supply_temp
            )
            # Feeder burn-back alarm (cofnięcie żaru do podajnika!)
            feeder_overheat = bool(
                feeder_temp is not None
                and plant.feeder_max_temp > 0
                and feeder_temp >= plant.feeder_max_temp
            )
            feeder_warm_warning = bool(
                feeder_temp is not None
                and not feeder_overheat
                and plant.feeder_max_temp > 10.0
                and feeder_temp >= plant.feeder_max_temp - 10.0
            )
            # High flue gas temp warning
            flue_high_warning = bool(
                flue_temp is not None
                and plant.flue_max_temp > 0
                and flue_temp >= plant.flue_max_temp
            )
            # Fire-out / low boiler temperature alert for solid-fuel boilers
            fire_out_warning = bool(
                plant.cannot_extinguish
                and plant.enabled
                and st.was_warm
                and plant.min_boiler_temp_alert > 0
                and supply_temp is not None
                and supply_temp < plant.min_boiler_temp_alert
                and (flue_temp is None or flue_temp < 45.0)
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

            # Underfloor heating receiver circuit pump logic
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

            # CWU pump logic
            supply_warm_for_dhw = (
                supply_temp is None
                or dhw_temp is None
                or supply_temp >= dhw_temp + plant.dhw_min_supply_delta
            )
            dhw_overheat_dump = overheat_protect and (dhw_temp is None or dhw_temp < 70.0)
            dhw_pump_wanted = (plant.enabled and dhw_demand and supply_warm_for_dhw) or dhw_overheat_dump

            # Low return temperature warning (configurable threshold, default 45°C)
            low_return_warning = bool(
                plant.plant_type in (PLANT_TYPE_COAL_BOILER, PLANT_TYPE_PELLET_BOILER, PLANT_TYPE_WOOD_BOILER)
                and supply_temp is not None
                and supply_temp >= 50.0
                and return_temp is not None
                and return_temp < plant.return_min_temp
            )

            # Radiator sensors distribution heat-loss calculation (boiler -> radiators)
            dist = self._compute_distribution_loss(plant, supply_temp, return_temp, rooms, room_states)
            high_pipe_loss_warning = bool(
                dist["distribution_loss_pct"] is not None
                and dist["distribution_loss_pct"] >= plant.distribution_loss_alert_pct
                and (heating_demand or ch_pump_wanted)
            )

            source_wanted = plant.enabled and (heating_demand or dhw_demand) and not overheat_protect and not feeder_overheat

            if climate_active and plant.enabled:
                await self._async_control_source(
                    plant, source_wanted, overheat_protect=(overheat_protect or feeder_overheat)
                )
                if plant.ch_pump_entity:
                    await self._async_set_switch_like(plant.ch_pump_entity, ch_pump_wanted)
                if plant.ufh_pump_entity:
                    await self._async_set_switch_like(plant.ufh_pump_entity, ufh_pump_wanted)
                if plant.dhw_pump_entity:
                    await self._async_set_switch_like(plant.dhw_pump_entity, dhw_pump_wanted)

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
            dhw_circ_state = (
                self.hass.states.get(plant.dhw_circulation_pump_entity)
                if plant.dhw_circulation_pump_entity
                else None
            )
            dhw_circ_on = bool(dhw_circ_state is not None and dhw_circ_state.state == "on")

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
                source_active = (
                    source_wanted
                    or (
                        supply_temp is not None
                        and plant.ch_pump_min_supply_temp > 0
                        and supply_temp >= plant.ch_pump_min_supply_temp
                    )
                    or (flue_temp is not None and flue_temp >= 80.0)
                )

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
                fire_alive = (
                    source_active
                    or (supply_temp is not None and supply_temp >= 35.0)
                    or (flue_temp is not None and flue_temp >= 55.0)
                )
            if fire_out_warning:
                fire_alive = False

            in_fire_hold = (
                plant.cannot_extinguish
                and plant.enabled
                and not overheat_protect
                and not heating_demand
                and not dhw_demand
                and fire_alive
            )

            if overheat_protect or ufh_overheat_protect or feeder_overheat:
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
                blower_pct=blower_pct,
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
                supply_temp=supply_temp,
                return_temp=return_temp,
                delta_t=delta_t,
                flue_temp=flue_temp,
                ambient_temp=ambient_temp,
                ch_pump_on=ch_pump_on,
                feeder_work_s=feeder_work_s,
                feeder_pause_s=feeder_pause_s,
                daily_fuel_sensor_kg_24h=daily_fuel_sensor_val,
                flow_l_min=flow_l_min,
                distribution_loss_pct=dist["distribution_loss_pct"],
            )
            maintenance = await self._evaluate_maintenance_and_notify(
                plant=plant,
                st=st,
                burn_rate_per_h=float(metrics["burn_rate_per_h"]),
                now=now,
                settings=settings,
            )

            # Update online Boiler MPC thermal & combustion model
            active_target_c = plant.idle_supply_temp if in_fire_hold else plant.target_supply_temp
            st.model.update(
                now=now,
                supply_temp=supply_temp,
                target_supply_temp=active_target_c,
                return_temp=return_temp,
                delta_t=delta_t,
                thermal_kw=float(metrics["current_thermal_kw"]),
                burn_rate_kg_h=float(metrics["burn_rate_per_h"]) if plant.fuel_type in SOLID_FUEL_TYPES else 0.0,
                real_efficiency_pct=float(metrics["real_efficiency_pct"]),
                is_heating=heating_demand or dhw_demand,
                in_fire_hold=in_fire_hold,
                outdoor_temp=outdoor_temp,
                pipe_loss_pct=dist["distribution_loss_pct"],
                pipe_drop_k=dist["distribution_temp_drop_k"],
            )
            recommended_supply = st.model.recommend_supply_temp(
                outdoor_temp=outdoor_temp,
                configured_target=plant.target_supply_temp,
                idle_temp=plant.idle_supply_temp,
                min_temp=max(35.0, plant.ch_pump_min_supply_temp),
                max_temp=min(80.0, plant.ch_pump_overrun_temp - 5.0),
                demanding_rooms_count=len(demanding_rooms),
                max_room_power_pct=max_pf * 100.0,
            )
            model_summary = st.model.summary_dict(
                recommended_supply_temp=recommended_supply,
                calorific_value_mj_kg=plant.calorific_value_mj_kg,
                usable_kwh_per_kg=float(metrics["real_usable_kwh_per_kg"]),
                cost_per_kwh_thermal=float(metrics["cost_per_kwh_thermal"]),
                hours_until_refill=maintenance.get("hours_until_refill"),
                fuel_remaining_kg=maintenance.get("fuel_remaining_kg"),
            )

            # Build structured safety & efficiency warnings list
            warnings: list[dict[str, str]] = []
            if overheat_protect:
                warnings.append(
                    {
                        "code": "overheat",
                        "severity": "critical",
                        "title": "Przegrzanie kotła!",
                        "detail": (
                            f"{supply_temp:.1f}°C ≥ {plant.ch_pump_overrun_temp:.0f}°C — wymuszony zrzut ciepła"
                            if supply_temp is not None
                            else "Alarm przegrzania kotła"
                        ),
                    }
                )
            if feeder_overheat:
                warnings.append(
                    {
                        "code": "feeder_overheat",
                        "severity": "critical",
                        "title": "ALARM: Przegrzanie podajnika (cofnięcie żaru!)",
                        "detail": f"Temp. podajnika {feeder_temp:.1f}°C ≥ {plant.feeder_max_temp:.0f}°C!",
                    }
                )
            elif feeder_warm_warning:
                warnings.append(
                    {
                        "code": "feeder_warm",
                        "severity": "warning",
                        "title": "Podwyższona temperatura podajnika",
                        "detail": f"Temp. podajnika {feeder_temp:.1f}°C (próg alarmu: {plant.feeder_max_temp:.0f}°C)",
                    }
                )
            if ufh_overheat_protect:
                warnings.append(
                    {
                        "code": "ufh_overheat",
                        "severity": "critical",
                        "title": "Ochrona podłogówki: pompa zatrzymana!",
                        "detail": (
                            f"Zasilanie podłogówki {ufh_supply_temp:.1f}°C ≥ {plant.ufh_max_supply_temp:.0f}°C"
                            if ufh_supply_temp is not None
                            else "Zbyt wysoka temperatura podłogówki"
                        ),
                    }
                )
            if flue_high_warning:
                warnings.append(
                    {
                        "code": "flue_high",
                        "severity": "warning",
                        "title": "Wysoka temperatura spalin",
                        "detail": f"Spaliny {flue_temp:.0f}°C ≥ {plant.flue_max_temp:.0f}°C (sprawdź czystość wymiennika / ciąg)",
                    }
                )
            if low_return_warning:
                warnings.append(
                    {
                        "code": "low_return",
                        "severity": "warning",
                        "title": "Zimny powrót (ryzyko korozji)",
                        "detail": f"Powrót {return_temp:.1f}°C < {plant.return_min_temp:.0f}°C",
                    }
                )
            if fire_out_warning:
                warnings.append(
                    {
                        "code": "fire_out",
                        "severity": "warning",
                        "title": "Możliwe wygaszenie pieca",
                        "detail": f"Temp. kotła spadła do {supply_temp:.1f}°C (< {plant.min_boiler_temp_alert:.0f}°C)",
                    }
                )
            if high_pipe_loss_warning:
                warnings.append(
                    {
                        "code": "high_pipe_loss",
                        "severity": "warning",
                        "title": "Wysokie straty ciepła na przesyle",
                        "detail": f"Strata {dist['distribution_loss_pct']:.1f}% (ΔT {dist['distribution_temp_drop_k']:.1f} K piec → kaloryfery)",
                    }
                )

            # Dispatch throttled HA safety/warning notifications
            if settings.get("heat_plant_notifications_enabled", True) and plant.notify_warnings_enabled:
                warn_targets = settings.get("heat_plant_notification_targets") or settings.get(
                    "mold_notification_targets", []
                )
                plant_label = plant.name or plant.id
                warn_cooldown_s = (
                    float(
                        settings.get(
                            "heat_plant_notification_cooldown",
                            DEFAULT_HEAT_PLANT_NOTIFICATION_COOLDOWN_MINUTES,
                        )
                    )
                    * 60.0
                )
                await self._dispatch_maintenance_alert(
                    key=f"overheat_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_overheat",
                    active=overheat_protect,
                    cooldown_s=600.0,
                    targets=warn_targets,
                    title=f"RoomMind: ALARM PRZEGRZANIA — {plant_label}",
                    message=(
                        f"{plant_label}: przegrzanie kotła/źródła ({supply_temp:.1f}°C >= "
                        f"{plant.ch_pump_overrun_temp:.0f}°C)! Wymuszono zrzut ciepła pompami C.O."
                        if supply_temp is not None
                        else f"{plant_label}: alarm przegrzania kotła!"
                    ),
                )
                await self._dispatch_maintenance_alert(
                    key=f"feeder_overheat_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_feeder_overheat",
                    active=feeder_overheat,
                    cooldown_s=300.0,
                    targets=warn_targets,
                    title=f"RoomMind: ALARM PODAJNIKA — {plant_label}",
                    message=(
                        f"{plant_label}: UWAGA! Temperatura podajnika wynosi {feeder_temp:.1f}°C "
                        f"(próg {plant.feeder_max_temp:.0f}°C) — ryzyko cofnięcia żaru do zasobnika!"
                        if feeder_temp is not None
                        else f"{plant_label}: alarm przegrzania podajnika!"
                    ),
                )
                await self._dispatch_maintenance_alert(
                    key=f"ufh_overheat_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_ufh_overheat",
                    active=ufh_overheat_protect,
                    cooldown_s=600.0,
                    targets=warn_targets,
                    title=f"RoomMind: OCHRONA PODŁOGÓWKI — {plant_label}",
                    message=(
                        f"{plant_label}: zbyt wysoka temperatura zasilania obiegu podłogówki "
                        f"({ufh_supply_temp:.1f}°C >= {plant.ufh_max_supply_temp:.0f}°C)! "
                        "Pompa podłogówki została awaryjnie zatrzymana."
                        if ufh_supply_temp is not None
                        else f"{plant_label}: alarm przegrzania obiegu podłogówki!"
                    ),
                )
                await self._dispatch_maintenance_alert(
                    key=f"flue_high_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_flue_high",
                    active=flue_high_warning,
                    cooldown_s=warn_cooldown_s,
                    targets=warn_targets,
                    title=f"RoomMind: Wysoka temp. spalin — {plant_label}",
                    message=(
                        f"{plant_label}: temperatura spalin {flue_temp:.0f}°C przekroczyła {plant.flue_max_temp:.0f}°C."
                        if flue_temp is not None
                        else f"{plant_label}: wysoka temperatura spalin!"
                    ),
                )
                await self._dispatch_maintenance_alert(
                    key=f"fire_out_{pid}",
                    notif_id=f"{NOTIF_PLANT_PREFIX}{pid}_fire_out",
                    active=fire_out_warning,
                    cooldown_s=warn_cooldown_s,
                    targets=warn_targets,
                    title=f"RoomMind: Wygaszenie pieca — {plant_label}",
                    message=(
                        f"{plant_label}: temperatura kotła spadła do {supply_temp:.1f}°C "
                        f"(poniżej {plant.min_boiler_temp_alert:.0f}°C). Sprawdź opał i palenisko."
                        if supply_temp is not None
                        else f"{plant_label}: piec wygasł!"
                    ),
                )

            live_out[pid] = {
                "id": pid,
                "name": plant.name,
                "plant_type": plant.plant_type,
                "boiler_mode": plant.boiler_mode,
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
                "overheat_protect": overheat_protect or ufh_overheat_protect or feeder_overheat,
                "ufh_overheat_protect": ufh_overheat_protect,
                "feeder_overheat": feeder_overheat,
                "feeder_overheat_warning": feeder_overheat or feeder_warm_warning,
                "feeder_warm_warning": feeder_warm_warning,
                "flue_high_warning": flue_high_warning,
                "fire_out_warning": fire_out_warning,
                "low_return_warning": low_return_warning,
                "high_pipe_loss_warning": high_pipe_loss_warning,
                "warnings": warnings,
                "supply_temp": round(supply_temp, 1) if supply_temp is not None else None,
                "target_supply_temp": plant.target_supply_temp,
                "idle_supply_temp": plant.idle_supply_temp,
                "recommended_supply_temp": recommended_supply,
                "return_temp": round(return_temp, 1) if return_temp is not None else None,
                "ufh_supply_temp": (
                    round(ufh_supply_temp, 1)
                    if (plant.ufh_supply_temp_sensor and ufh_supply_temp is not None)
                    else None
                ),
                "delta_t": delta_t,
                "dhw_temp": round(dhw_temp, 1) if dhw_temp is not None else None,
                "dhw_supply_temp": round(dhw_supply_temp, 1) if dhw_supply_temp is not None else None,
                "dhw_target_temp": plant.dhw_target_temp,
                "flue_temp": round(flue_temp, 1) if flue_temp is not None else None,
                "feeder_temp": round(feeder_temp, 1) if feeder_temp is not None else None,
                "boiler_room_temp": round(boiler_room_temp, 1) if boiler_room_temp is not None else None,
                "feeder_work_s": round(feeder_work_s, 1) if feeder_work_s is not None else None,
                "feeder_pause_s": round(feeder_pause_s, 1) if feeder_pause_s is not None else None,
                "feeder_work_time_s": round(feeder_work_s, 1) if feeder_work_s is not None else None,
                "feeder_pause_time_s": round(feeder_pause_s, 1) if feeder_pause_s is not None else None,
                "blower_pct": round(blower_pct, 1) if blower_pct is not None else None,
                "blower_mode": blower_mode,
                "ch_pump_active": ch_pump_on,
                "ch_pump_blocked_cold": bool(heating_demand and not supply_warm_for_ch),
                "ufh_pump_active": ufh_pump_on,
                "ufh_pump_blocked_cold": bool(ufh_demand and plant.ufh_pump_entity and not supply_warm_for_ufh),
                "dhw_pump_active": dhw_pump_on,
                "dhw_pump_blocked_cold": bool(dhw_demand and not supply_warm_for_dhw),
                "dhw_circulation_pump_active": dhw_circ_on,
                "demanding_rooms": demanding_rooms,
                "active_devices": active_devices,
                "mean_power_pct": round(eff_pf * 100) if (source_active or in_fire_hold) else 0,
                "max_power_pct": round(max_pf * 100),
                "model": model_summary,
                **dist,
                **metrics,
                **maintenance,
            }

        self._live = live_out
        return live_out
