"""Tests for HeatPlantManager: boilers, heaters, heat pumps, circulation pumps, thermometers, and coal calorific/cost tracking."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.roommind.const import DOMAIN, MODE_HEATING, MODE_IDLE
from custom_components.roommind.managers.heat_plant_manager import (
    FUEL_TYPE_COAL,
    PLANT_TYPE_COAL_BOILER,
    PLANT_TYPE_HEAT_PUMP,
    HeatPlantManager,
    mj_kg_to_kwh_kg,
    usable_kwh_per_kg,
)
from tests.coordinator.conftest import (
    SAMPLE_ROOM,
    _create_coordinator,
    _make_store_mock,
    make_mock_states_get,
)

AREA = "living_room_abc12345"
BOILER_SWITCH = "switch.coal_boiler"
CH_PUMP = "switch.ch_pump"
DHW_PUMP = "switch.dhw_pump"
SUPPLY_SENSOR = "sensor.boiler_supply"
RETURN_SENSOR = "sensor.boiler_return"
DHW_SENSOR = "sensor.boiler_dhw"
FLUE_SENSOR = "sensor.boiler_flue"


def test_coal_calorific_value_conversions():
    # 26 MJ/kg ekogroszek -> 7.222 kWh/kg chemical energy
    chem = mj_kg_to_kwh_kg(26.0)
    assert chem == pytest.approx(26.0 / 3.6, rel=1e-4)

    # At 85% boiler efficiency -> ~6.139 kWh/kg usable thermal energy
    usable = usable_kwh_per_kg(26.0, 85.0)
    assert usable == pytest.approx((26.0 / 3.6) * 0.85, rel=1e-4)
    assert mj_kg_to_kwh_kg(0.0) == 0.0


@pytest.mark.asyncio
async def test_heat_plant_coal_boiler_pumps_thermometers_and_cost(hass):
    states = {
        BOILER_SWITCH: SimpleNamespace(state="off", attributes={}),
        CH_PUMP: SimpleNamespace(state="off", attributes={}),
        DHW_PUMP: SimpleNamespace(state="off", attributes={}),
        SUPPLY_SENSOR: SimpleNamespace(state="35.0", attributes={"unit_of_measurement": "°C"}),
        RETURN_SENSOR: SimpleNamespace(state="28.0", attributes={"unit_of_measurement": "°C"}),
        DHW_SENSOR: SimpleNamespace(state="42.0", attributes={"unit_of_measurement": "°C"}),
        FLUE_SENSOR: SimpleNamespace(state="135.0", attributes={"unit_of_measurement": "°C"}),
    }
    hass.states.get = states.get
    calls = []

    async def _call(domain, service, data, **_kw):
        eid = data.get("entity_id")
        calls.append((domain, service, eid))
        if eid in states and service in ("turn_on", "turn_off"):
            states[eid].state = "on" if service == "turn_on" else "off"

    hass.services.async_call = AsyncMock(side_effect=_call)

    mgr = HeatPlantManager(hass)
    plant_cfg = {
        "id": "coal_1",
        "name": "Piec Ekogroszek",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "enabled": True,
        "assigned_devices": ["climate.living_room"],
        "assigned_rooms": [AREA],
        "source_entity": BOILER_SWITCH,
        "supply_temp_sensor": SUPPLY_SENSOR,
        "return_temp_sensor": RETURN_SENSOR,
        "dhw_temp_sensor": DHW_SENSOR,
        "flue_temp_sensor": FLUE_SENSOR,
        "ch_pump_entity": CH_PUMP,
        "ch_pump_min_supply_temp": 45.0,
        "ch_pump_overrun_temp": 80.0,
        "dhw_pump_entity": DHW_PUMP,
        "dhw_target_temp": 50.0,
        "dhw_hysteresis": 3.0,
        "dhw_min_supply_delta": 3.0,
        "fuel_type": FUEL_TYPE_COAL,
        "calorific_value_mj_kg": 26.0,
        "efficiency_pct": 85.0,
        "nominal_power_kw": 15.0,
        "fuel_price": 1500.0,
        "currency": "PLN",
    }
    rooms = {AREA: SAMPLE_ROOM}
    room_states = {AREA: {"mode": MODE_HEATING, "commanded_mode": MODE_HEATING, "heating_power": 80}}
    settings = {"climate_control_active": True, "heat_plants": [plant_cfg]}

    # Cycle 1: Supply is 35°C (< 45°C min for C.O. pump, and < 42+3=45°C for DHW pump)
    # Boiler turns ON, but both pumps wait for the boiler to warm up!
    live_map = await mgr.async_process(rooms, room_states, settings)
    live = live_map["coal_1"]
    assert live["source_active"] is True
    assert live["heating_demand"] is True
    assert live["dhw_demand"] is True
    assert live["ch_pump_active"] is False
    assert live["ch_pump_blocked_cold"] is True
    assert live["dhw_pump_active"] is False
    assert live["dhw_pump_blocked_cold"] is True
    assert live["supply_temp"] == 35.0
    assert live["return_temp"] == 28.0
    assert live["delta_t"] == 7.0
    assert live["dhw_temp"] == 42.0
    assert live["flue_temp"] == 135.0

    # Cycle 2: Boiler warms up to 58°C, return is 44°C -> both C.O. and DHW pumps turn ON!
    states[SUPPLY_SENSOR].state = "58.0"
    states[RETURN_SENSOR].state = "44.0"
    # Advance last_ts by 30 minutes to test fuel/energy/cost accumulation
    mgr._states["coal_1"].last_ts -= 1800.0

    live_map = await mgr.async_process(rooms, room_states, settings)
    live = live_map["coal_1"]
    assert live["ch_pump_active"] is True
    assert live["ch_pump_blocked_cold"] is False
    assert live["dhw_pump_active"] is True
    assert live["delta_t"] == 14.0
    assert live["current_thermal_kw"] == pytest.approx(15.0 * 0.8, rel=1e-2)
    assert live["burn_rate_per_h"] > 1.5
    assert live["fuel_consumed_today"] > 0.7
    assert live["cost_today"] > 1.0
    assert live["usable_kwh_per_kg"] == pytest.approx(6.14, abs=0.02)

    # Cycle 3: Overheat protection at 82°C even when room demand is IDLE
    states[SUPPLY_SENSOR].state = "82.0"
    states[DHW_SENSOR].state = "52.0"
    room_states_idle = {AREA: {"mode": MODE_IDLE, "commanded_mode": MODE_IDLE, "heating_power": 0}}
    live_map = await mgr.async_process(rooms, room_states_idle, settings)
    live = live_map["coal_1"]
    assert live["overheat_protect"] is True
    assert live["state"] == "overheat_protect"
    assert live["ch_pump_active"] is True  # C.O. pump forced ON to dump excess heat
    assert states[BOILER_SWITCH].state == "off"  # Boiler turned OFF

    # Reset stats
    assert mgr.reset_stats("coal_1") is True
    assert mgr._states["coal_1"].cost_today == 0.0
    assert mgr._states["coal_1"].fuel_consumed_total == 0.0


@pytest.mark.asyncio
async def test_heat_plant_heat_pump_cop_and_coordinator_integration(hass, mock_config_entry):
    plant_cfg = {
        "id": "hp_1",
        "name": "Pompa Ciepła",
        "plant_type": PLANT_TYPE_HEAT_PUMP,
        "enabled": True,
        "assigned_devices": ["climate.living_room"],
        "assigned_rooms": [],
        "cop": 4.0,
        "nominal_power_kw": 8.0,
        "fuel_price": 1.0,
        "currency": "PLN",
    }
    store = _make_store_mock({AREA: SAMPLE_ROOM}, settings={"heat_plants": [plant_cfg]})
    hass.data = {DOMAIN: {"store": store}}
    hass.states.get = make_mock_states_get(temp="18.0", humidity="50.0")
    hass.services.async_call = AsyncMock()

    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    assert "hp_1" in coordinator.heat_plants_live
    hp_live = coordinator.heat_plants_live["hp_1"]
    assert hp_live["heating_demand"] is True
    assert hp_live["active_devices"] == ["climate.living_room"]
    assert hp_live["cost_per_kwh_thermal"] == pytest.approx(0.25, rel=1e-2)
