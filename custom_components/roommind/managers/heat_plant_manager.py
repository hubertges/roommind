"""Heat plant manager: boilers (coal/pellet/wood/gas), air/water heaters, and heat pumps.

Manages:
- Assigned radiators (TRVs), underfloor heating, heaters, and rooms per heat plant.
- Supply, return, DHW (CWU), and flue/buffer temperature monitoring + delta-T calculation.
- Active control of the heat source entity (climate.*, water_heater.*, switch.*, fan.*, input_boolean.*)
  and circulation pumps (C.O. central heating pump and CWU domestic hot water pump) with
  minimum supply temperature protection, boiler overheat protection, and DHW differential hysteresis.
- Fuel calorific value conversion (e.g. coal MJ/kg -> kWh/kg -> usable thermal kWh/kg with efficiency,
  gas kWh/m³, heat pump COP) and real-time + cumulative energy/fuel consumption and cost tracking.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from homeassistant.util import dt as dt_util

from ..const import MODE_HEATING, make_roommind_context
from ..utils.sensor_utils import read_sensor_value
from ..utils.temp_utils import celsius_to_ha_temp, ha_temp_to_celsius

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

PLANT_TYPE_COAL_BOILER = "coal_boiler"
PLANT_TYPE_PELLET_BOILER = "pellet_boiler"
PLANT_TYPE_WOOD_BOILER = "wood_boiler"
PLANT_TYPE_GAS_BOILER = "gas_boiler"
PLANT_TYPE_ELECTRIC_HEATER = "electric_heater"
PLANT_TYPE_AIR_HEATER = "air_heater"
PLANT_TYPE_HEAT_PUMP = "heat_pump"

HEAT_PLANT_TYPES = (
    PLANT_TYPE_COAL_BOILER,
    PLANT_TYPE_PELLET_BOILER,
    PLANT_TYPE_WOOD_BOILER,
    PLANT_TYPE_GAS_BOILER,
    PLANT_TYPE_ELECTRIC_HEATER,
    PLANT_TYPE_AIR_HEATER,
    PLANT_TYPE_HEAT_PUMP,
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
    """Configuration for a single boiler, heater, or heat pump."""

    id: str
    name: str
    plant_type: str = PLANT_TYPE_COAL_BOILER
    enabled: bool = True
    # Assigned radiator/TRV/UFH/AC climate entity IDs and/or room area_ids
    assigned_devices: list[str] = field(default_factory=list)
    assigned_rooms: list[str] = field(default_factory=list)
    # Main heat source entity (climate.*, water_heater.*, switch.*, input_boolean.*, fan.*)
    source_entity: str = ""
    target_supply_temp: float = 55.0
    idle_supply_temp: float = 35.0
    off_mode: str = "off"  # "off" | "temperature"
    min_rooms_demand: int = 1
    # Thermometers (sensor.* / input_number.*)
    supply_temp_sensor: str = ""
    return_temp_sensor: str = ""
    dhw_temp_sensor: str = ""
    flue_temp_sensor: str = ""
    # Central heating (C.O.) circulation pump
    ch_pump_entity: str = ""
    ch_pump_min_supply_temp: float = 40.0
    ch_pump_overrun_temp: float = 80.0
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
    fuel_consumption_sensor: str = ""  # Optional HA sensor (kg or m³)

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
            PLANT_TYPE_GAS_BOILER: FUEL_TYPE_GAS,
            PLANT_TYPE_ELECTRIC_HEATER: FUEL_TYPE_ELECTRICITY,
            PLANT_TYPE_AIR_HEATER: FUEL_TYPE_ELECTRICITY,
            PLANT_TYPE_HEAT_PUMP: FUEL_TYPE_ELECTRICITY,
        }.get(plant_type, FUEL_TYPE_COAL)
        fuel_type = str(data.get("fuel_type") or default_fuel)
        if fuel_type not in FUEL_TYPES:
            fuel_type = default_fuel

        return cls(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or ""),
            plant_type=plant_type,
            enabled=bool(data.get("enabled", True)),
            assigned_devices=[str(x) for x in (data.get("assigned_devices") or []) if x],
            assigned_rooms=[str(x) for x in (data.get("assigned_rooms") or []) if x],
            source_entity=str(data.get("source_entity") or ""),
            target_supply_temp=float(data.get("target_supply_temp", 55.0) or 55.0),
            idle_supply_temp=float(data.get("idle_supply_temp", 35.0) or 35.0),
            off_mode=str(data.get("off_mode") or "off"),
            min_rooms_demand=max(1, int(data.get("min_rooms_demand", 1) or 1)),
            supply_temp_sensor=str(data.get("supply_temp_sensor") or ""),
            return_temp_sensor=str(data.get("return_temp_sensor") or ""),
            dhw_temp_sensor=str(data.get("dhw_temp_sensor") or ""),
            flue_temp_sensor=str(data.get("flue_temp_sensor") or ""),
            ch_pump_entity=str(data.get("ch_pump_entity") or ""),
            ch_pump_min_supply_temp=float(data.get("ch_pump_min_supply_temp", 40.0) or 0.0),
            ch_pump_overrun_temp=float(data.get("ch_pump_overrun_temp", 80.0) or 80.0),
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
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize configuration to a dict."""
        return {
            "id": self.id,
            "name": self.name,
            "plant_type": self.plant_type,
            "enabled": self.enabled,
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
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HeatPlantRuntimeState:
        return cls(
            day_str=str(data.get("day_str") or ""),
            dhw_charging=bool(data.get("dhw_charging", False)),
            last_energy_reading=(
                float(data["last_energy_reading"])
                if isinstance(data.get("last_energy_reading"), (int, float))
                else None
            ),
            last_fuel_reading=(
                float(data["last_fuel_reading"])
                if isinstance(data.get("last_fuel_reading"), (int, float))
                else None
            ),
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
        )


class HeatPlantManager:
    """Evaluates and controls boilers, heaters, heat pumps, circulation pumps, and fuel/cost telemetry."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._plants: dict[str, HeatPlantConfig] = {}
        self._states: dict[str, HeatPlantRuntimeState] = {}
        self._live: dict[str, dict[str, Any]] = {}
        self.state_dirty: bool = False

    def load_configs(self, configs: list[dict[str, Any]]) -> None:
        """Load heat plant configurations from settings."""
        new_plants: dict[str, HeatPlantConfig] = {}
        for raw in configs:
            if not isinstance(raw, dict) or not raw.get("id"):
                continue
            cfg = HeatPlantConfig.from_dict(raw)
            new_plants[cfg.id] = cfg
            if cfg.id not in self._states:
                self._states[cfg.id] = HeatPlantRuntimeState()
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
                )
                changed = True
        if changed:
            self.state_dirty = True
        return changed

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
    ) -> tuple[list[str], list[str], float, float]:
        """Collect demanding rooms and active assigned devices for a heat plant.

        Returns (demanding_rooms, active_devices, mean_pf, max_pf).
        """
        assigned_devs = set(plant.assigned_devices)
        assigned_rms = set(plant.assigned_rooms)

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

        checked_rooms: set[str] = set()
        for area_id, room in rooms.items():
            if room.get("is_outdoor", False):
                continue
            room_devs = {d.get("entity_id", "") for d in room.get("devices", []) if d.get("entity_id")}
            matching_devs = room_devs & assigned_devs
            room_assigned = area_id in assigned_rms or bool(matching_devs)
            if not room_assigned:
                continue
            checked_rooms.add(area_id)
            rs = room_states.get(area_id) or {}
            mode = rs.get("commanded_mode", rs.get("mode", "idle"))
            # Check if heat source orchestration excluded primary/secondary
            active_sources = rs.get("active_heat_sources")
            if mode == MODE_HEATING:
                # Filter devices that actually run
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
    ) -> None:
        eid = plant.source_entity
        if not eid:
            return
        domain = eid.split(".", 1)[0]
        if domain in ("switch", "input_boolean", "fan"):
            await self._async_set_switch_like(eid, active_demand)
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
                    _LOGGER.warning("Heat plant '%s': water_heater.set_temperature failed", plant.name, exc_info=True)
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
                        _LOGGER.warning("Heat plant '%s': climate.set_hvac_mode failed", plant.name, exc_info=True)
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
                        _LOGGER.warning("Heat plant '%s': climate.set_temperature failed", plant.name, exc_info=True)
            else:
                if plant.off_mode == "temperature" and "heat" in modes:
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
                elif "off" in modes and st.state != "off":
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {"entity_id": eid, "hvac_mode": "off"},
                            blocking=True,
                            context=make_roommind_context(),
                        )
                    except Exception:  # noqa: BLE001
                        _LOGGER.warning("Heat plant '%s': climate.set_hvac_mode off failed", plant.name, exc_info=True)

    def _compute_rates_and_accumulate(
        self,
        plant: HeatPlantConfig,
        st: HeatPlantRuntimeState,
        is_running: bool,
        effective_pf: float,
        now: float,
        dynamic_elec_price: float | None,
    ) -> dict[str, Any]:
        """Compute instantaneous burn/power/cost rates and update daily/total counters."""
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
        if st.last_ts is not None and 0 < (now - st.last_ts) <= 3600:
            dt_hours = (now - st.last_ts) / 3600.0
        st.last_ts = now

        # Check external energy_sensor (can be power in W/kW or cumulative energy in kWh)
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
                    if st.last_energy_reading is not None and e_val >= st.last_energy_reading:
                        sensor_energy_delta_kwh = e_val - st.last_energy_reading
                    st.last_energy_reading = e_val

        # Check external fuel_consumption_sensor (cumulative kg or m³)
        sensor_fuel_delta: float | None = None
        if plant.fuel_consumption_sensor:
            f_val = read_sensor_value(self.hass, plant.fuel_consumption_sensor, plant.id, "fuel")
            if f_val is not None:
                if st.last_fuel_reading is not None and f_val >= st.last_fuel_reading:
                    sensor_fuel_delta = f_val - st.last_fuel_reading
                st.last_fuel_reading = f_val

        pf = effective_pf if is_running else 0.0
        eff = max(0.05, plant.efficiency_pct / 100.0)
        cop = max(1.0, plant.cop)

        # Calorific conversions
        chem_kwh_per_kg = mj_kg_to_kwh_kg(plant.calorific_value_mj_kg)
        usable_kwh_kg = usable_kwh_per_kg(plant.calorific_value_mj_kg, plant.efficiency_pct)

        if plant.plant_type == PLANT_TYPE_HEAT_PUMP:
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
        if plant.fuel_type in (FUEL_TYPE_COAL, FUEL_TYPE_PELLET, FUEL_TYPE_WOOD):
            fuel_unit = "kg"
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
        elif plant.fuel_type in (FUEL_TYPE_COAL, FUEL_TYPE_PELLET, FUEL_TYPE_WOOD) and usable_kwh_kg > 0:
            cost_per_kwh_thermal = price_per_unit / usable_kwh_kg
        elif plant.fuel_type == FUEL_TYPE_GAS and plant.calorific_value_kwh_m3 > 0:
            cost_per_kwh_thermal = price_per_unit / (plant.calorific_value_kwh_m3 * eff)
        elif plant.plant_type == PLANT_TYPE_HEAT_PUMP:
            cost_per_kwh_thermal = price_per_unit / cop
        else:
            cost_per_kwh_thermal = price_per_unit / eff

        if dt_hours > 0:
            if is_running:
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
                if plant.fuel_type in (FUEL_TYPE_COAL, FUEL_TYPE_PELLET, FUEL_TYPE_WOOD):
                    d_in_kwh = d_fuel * chem_kwh_per_kg
                    d_th_kwh = d_in_kwh * eff
                elif plant.fuel_type == FUEL_TYPE_GAS:
                    d_in_kwh = d_fuel * plant.calorific_value_kwh_m3
                    d_th_kwh = d_in_kwh * eff
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
                self.state_dirty = True

        return {
            "fuel_unit": fuel_unit,
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

    async def async_process(
        self,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
        settings: dict[str, Any],
        dynamic_elec_price: float | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Evaluate all configured heat plants, command sources/pumps, and update telemetry."""
        self.load_configs(settings.get("heat_plants", []))
        climate_active = bool(settings.get("climate_control_active", True))
        now = time.time()
        live_out: dict[str, dict[str, Any]] = {}

        for pid, plant in self._plants.items():
            st = self._states.setdefault(pid, HeatPlantRuntimeState())
            supply_temp = self._read_temp_celsius(plant.supply_temp_sensor, "supply temperature")
            return_temp = self._read_temp_celsius(plant.return_temp_sensor, "return temperature")
            dhw_temp = self._read_temp_celsius(plant.dhw_temp_sensor, "DHW temperature")
            flue_temp = self._read_temp_celsius(plant.flue_temp_sensor, "flue temperature")

            delta_t = (
                round(supply_temp - return_temp, 1)
                if supply_temp is not None and return_temp is not None
                else None
            )

            demanding_rooms, active_devices, mean_pf, max_pf = self._collect_demand(
                plant, rooms, room_states
            )
            heating_demand = (
                len(demanding_rooms) >= plant.min_rooms_demand
                or (not plant.assigned_rooms and len(active_devices) >= plant.min_rooms_demand)
            )

            # Evaluate DHW (CWU) demand with hysteresis
            if plant.dhw_temp_sensor and dhw_temp is not None and math.isfinite(dhw_temp):
                if dhw_temp < plant.dhw_target_temp - plant.dhw_hysteresis:
                    st.dhw_charging = True
                elif dhw_temp >= plant.dhw_target_temp:
                    st.dhw_charging = False
            else:
                st.dhw_charging = False

            dhw_demand = st.dhw_charging and bool(plant.dhw_pump_entity or plant.dhw_temp_sensor)

            # Overheat protection: boiler supply temp exceeds safety threshold
            overheat_protect = (
                supply_temp is not None
                and plant.ch_pump_overrun_temp > 0
                and supply_temp >= plant.ch_pump_overrun_temp
            )

            # C.O. pump logic: run when overheat_protect OR (heating_demand and supply warm enough)
            supply_warm_for_ch = (
                supply_temp is None
                or plant.ch_pump_min_supply_temp <= 0
                or supply_temp >= plant.ch_pump_min_supply_temp
            )
            ch_pump_wanted = overheat_protect or (plant.enabled and heating_demand and supply_warm_for_ch)

            # CWU pump logic: run when dhw_demand and supply is warmer than DHW tank + delta
            supply_warm_for_dhw = (
                supply_temp is None
                or dhw_temp is None
                or supply_temp >= dhw_temp + plant.dhw_min_supply_delta
            )
            dhw_pump_wanted = plant.enabled and dhw_demand and supply_warm_for_dhw

            source_wanted = plant.enabled and (heating_demand or dhw_demand) and not overheat_protect

            if climate_active and plant.enabled:
                await self._async_control_source(plant, source_wanted)
                if plant.ch_pump_entity:
                    await self._async_set_switch_like(plant.ch_pump_entity, ch_pump_wanted)
                if plant.dhw_pump_entity:
                    await self._async_set_switch_like(plant.dhw_pump_entity, dhw_pump_wanted)

            # Read actual states of source and pumps
            ch_pump_state = self.hass.states.get(plant.ch_pump_entity) if plant.ch_pump_entity else None
            ch_pump_on = (
                ch_pump_state.state == "on"
                if ch_pump_state is not None
                else bool(ch_pump_wanted and plant.ch_pump_entity)
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
                # Without a controllable source entity (e.g. manual coal boiler), infer active
                # from heating/DHW demand or high supply temperature
                source_active = source_wanted or (
                    supply_temp is not None
                    and plant.ch_pump_min_supply_temp > 0
                    and supply_temp >= plant.ch_pump_min_supply_temp
                )

            if overheat_protect:
                state_label = "overheat_protect"
            elif heating_demand and dhw_demand:
                state_label = "heating_and_dhw"
            elif heating_demand:
                state_label = "heating"
            elif dhw_demand:
                state_label = "dhw"
            elif source_active:
                state_label = "active"
            else:
                state_label = "idle"

            eff_pf = mean_pf if heating_demand else (1.0 if (dhw_demand or source_active) else 0.0)
            metrics = self._compute_rates_and_accumulate(
                plant=plant,
                st=st,
                is_running=source_active,
                effective_pf=eff_pf,
                now=now,
                dynamic_elec_price=dynamic_elec_price,
            )

            live_out[pid] = {
                "id": pid,
                "state": state_label,
                "source_active": source_active,
                "heating_demand": heating_demand,
                "dhw_demand": dhw_demand,
                "overheat_protect": overheat_protect,
                "supply_temp": round(supply_temp, 1) if supply_temp is not None else None,
                "return_temp": round(return_temp, 1) if return_temp is not None else None,
                "delta_t": delta_t,
                "dhw_temp": round(dhw_temp, 1) if dhw_temp is not None else None,
                "flue_temp": round(flue_temp, 1) if flue_temp is not None else None,
                "ch_pump_active": ch_pump_on,
                "ch_pump_blocked_cold": bool(heating_demand and not supply_warm_for_ch),
                "dhw_pump_active": dhw_pump_on,
                "dhw_pump_blocked_cold": bool(dhw_demand and not supply_warm_for_dhw),
                "demanding_rooms": demanding_rooms,
                "active_devices": active_devices,
                "mean_power_pct": round(eff_pf * 100) if source_active else 0,
                "max_power_pct": round(max_pf * 100),
                **metrics,
            }

        self._live = live_out
        return live_out
