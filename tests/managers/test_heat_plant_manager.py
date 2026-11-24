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


@pytest.mark.asyncio
async def test_non_extinguishable_coal_boiler_and_fireplace_fire_hold(hass):
    """Solid-fuel boilers & fireplaces never receive hvac_mode='off' on normal idle; they enter fire-hold."""
    from custom_components.roommind.managers.heat_plant_manager import PLANT_TYPE_FIREPLACE

    boiler_climate = "climate.ekogroszek"
    states = {
        boiler_climate: SimpleNamespace(
            state="heat", attributes={"temperature": 60.0, "hvac_modes": ["heat", "off"]}
        ),
        SUPPLY_SENSOR: SimpleNamespace(state="55.0", attributes={"unit_of_measurement": "°C"}),
        CH_PUMP: SimpleNamespace(state="off", attributes={}),
    }
    hass.states.get = states.get
    calls: list[tuple[str, str, dict]] = []

    async def _call(domain, service, data, **_kw):
        calls.append((domain, service, dict(data)))
        eid = data.get("entity_id")
        if eid in states:
            if service == "set_hvac_mode":
                states[eid].state = data.get("hvac_mode", states[eid].state)
            elif service == "set_temperature":
                states[eid].attributes["temperature"] = data.get("temperature")
            elif service in ("turn_on", "turn_off"):
                states[eid].state = "on" if service == "turn_on" else "off"

    hass.services.async_call = AsyncMock(side_effect=_call)

    mgr = HeatPlantManager(hass)
    plant_cfg = {
        "id": "coal_hold",
        "name": "Piec Ekogroszek",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "enabled": True,
        "assigned_rooms": [AREA],
        "source_entity": boiler_climate,
        "target_supply_temp": 60.0,
        "idle_supply_temp": 42.0,
        "min_power_pct": 12.0,
        "supply_temp_sensor": SUPPLY_SENSOR,
        "ch_pump_entity": CH_PUMP,
        "ch_pump_min_supply_temp": 45.0,
        "ch_pump_overrun_temp": 82.0,
        "nominal_power_kw": 15.0,
        "calorific_value_mj_kg": 26.0,
        "efficiency_pct": 85.0,
        "fuel_price": 1500.0,
        "currency": "PLN",
    }
    rooms = {AREA: SAMPLE_ROOM}
    idle_states = {AREA: {"mode": MODE_IDLE, "commanded_mode": MODE_IDLE, "heating_power": 0}}
    settings = {"climate_control_active": True, "heat_plants": [plant_cfg]}

    # Cycle 1: Rooms idle -> must NOT send hvac_mode="off", enters "hold" at idle_supply_temp
    live_map = await mgr.async_process(rooms, idle_states, settings)
    live = live_map["coal_hold"]
    assert live["cannot_extinguish"] is True
    assert live["state"] == "hold"
    assert live["in_fire_hold"] is True
    assert all(
        not (srv == "set_hvac_mode" and data.get("hvac_mode") == "off")
        for _, srv, data in calls
    )
    assert any(
        srv == "set_temperature" and data.get("temperature") == 42.0
        for _, srv, data in calls
    )

    # Advance 30 min in fire-hold -> standby burn should still accumulate at min_power_pct,
    # and hopper/ash/chimney counters automatically advance with elapsed time without clicking refill!
    mgr._states["coal_hold"].last_ts -= 1800.0
    live_map = await mgr.async_process(rooms, idle_states, settings)
    live = live_map["coal_hold"]
    assert live["state"] == "hold"
    assert live["current_thermal_kw"] == pytest.approx(15.0 * 0.12, rel=1e-2)
    assert live["fuel_consumed_today"] > 0.1
    assert live["fuel_since_refill_kg"] == pytest.approx(live["fuel_consumed_today"], rel=1e-2)
    assert live["fuel_since_ash_clean_kg"] == pytest.approx(live["fuel_consumed_today"], rel=1e-2)
    assert live["estimated_ash_kg"] > 0.0
    assert live["fuel_remaining_kg"] < 100.0

    # Fireplace also defaults to cannot_extinguish=True: idle when cold/unlit, fire-hold when lit (warm flue)
    fp_flue = "sensor.fp_flue_test"
    states[fp_flue] = SimpleNamespace(state="95.0", attributes={"unit_of_measurement": "°C"})
    fp_cfg = {
        "id": "fp_1",
        "name": "Kominek",
        "plant_type": PLANT_TYPE_FIREPLACE,
        "enabled": True,
        "assigned_rooms": [AREA],
        "flue_temp_sensor": fp_flue,
    }
    fp_map = await mgr.async_process(rooms, idle_states, {"climate_control_active": True, "heat_plants": [fp_cfg]})
    assert fp_map["fp_1"]["cannot_extinguish"] is True
    assert fp_map["fp_1"]["state"] == "hold"


@pytest.mark.asyncio
async def test_multi_source_fireplace_boiler_and_underfloor_receiver_circuit(hass):
    """Fireplace (priority 1) assists boiler (priority 2); boiler drives both radiators and an underfloor receiver circuit."""
    from custom_components.roommind.managers.heat_plant_manager import (
        PLANT_TYPE_FIREPLACE,
    )

    bath = "bathroom_1"
    fp_flue = "sensor.fireplace_flue"
    ufh_pump = "switch.ufh_pump"
    states = {
        fp_flue: SimpleNamespace(state="185.0", attributes={"unit_of_measurement": "°C"}),
        SUPPLY_SENSOR: SimpleNamespace(state="55.0", attributes={"unit_of_measurement": "°C"}),
        ufh_pump: SimpleNamespace(state="off", attributes={}),
    }
    hass.states.get = states.get

    async def _call(domain, service, data, **_kw):
        eid = data.get("entity_id")
        if eid in states and service in ("turn_on", "turn_off"):
            states[eid].state = "on" if service == "turn_on" else "off"

    hass.services.async_call = AsyncMock(side_effect=_call)

    mgr = HeatPlantManager(hass)
    plants = [
        {
            "id": "fp_1",
            "name": "Kominek",
            "plant_type": PLANT_TYPE_FIREPLACE,
            "enabled": True,
            "priority": 1,
            "assigned_rooms": [AREA],
            "flue_temp_sensor": fp_flue,
            "nominal_power_kw": 8.0,
        },
        {
            "id": "coal_1",
            "name": "Piec Ekogroszek",
            "plant_type": PLANT_TYPE_COAL_BOILER,
            "enabled": True,
            "priority": 2,
            "assigned_rooms": [AREA, bath],
            "supply_temp_sensor": SUPPLY_SENSOR,
            "ufh_pump_entity": ufh_pump,
            "ufh_min_supply_temp": 25.0,
            "ufh_max_supply_temp": 48.0,
            "nominal_power_kw": 15.0,
        },
    ]
    rooms = {
        AREA: SAMPLE_ROOM,
        bath: {
            **SAMPLE_ROOM,
            "area_id": bath,
            "heating_system_type": "underfloor",
            "devices": [
                {
                    "entity_id": "climate.bath_ufh",
                    "type": "trv",
                    "role": "auto",
                    "heating_system_type": "underfloor",
                }
            ],
        },
    }

    # Case 1: Only AREA wants heat, fireplace is hot (185°C flue) -> fireplace handles AREA, boiler stays in fire-hold
    rs_living_only = {
        AREA: {"mode": MODE_HEATING, "commanded_mode": MODE_HEATING, "heating_power": 70},
        bath: {"mode": MODE_IDLE, "commanded_mode": MODE_IDLE, "heating_power": 0},
    }
    live = await mgr.async_process(rooms, rs_living_only, {"climate_control_active": True, "heat_plants": plants})
    assert live["fp_1"]["heating_demand"] is True
    assert "Kominek" in live["coal_1"]["assisted_by"]
    assert live["coal_1"]["heating_demand"] is False
    assert live["coal_1"]["state"] == "hold"

    # Case 2: Bathroom (with underfloor heating receiver) demands heat -> wakes boiler!
    rs_bath = {
        AREA: {"mode": MODE_IDLE, "commanded_mode": MODE_IDLE, "heating_power": 0},
        bath: {"mode": MODE_HEATING, "commanded_mode": MODE_HEATING, "heating_power": 80},
    }
    live = await mgr.async_process(rooms, rs_bath, {"climate_control_active": True, "heat_plants": plants})
    assert live["coal_1"]["heating_demand"] is True
    assert live["coal_1"]["state"] == "heating"


@pytest.mark.asyncio
async def test_counting_from_kg_sensor_feeder_and_manual_log(hass):
    """Fuel kg counting works via HA kg/g sensor, auger feeder runtime, and manual log_fuel()."""
    feeder = "switch.podajnik"
    fuel_sensor = "sensor.coal_burned_kg"
    states = {
        feeder: SimpleNamespace(state="on", attributes={}),
        fuel_sensor: SimpleNamespace(state="10.0", attributes={"unit_of_measurement": "kg"}),
        SUPPLY_SENSOR: SimpleNamespace(state="58.0", attributes={"unit_of_measurement": "°C"}),
    }
    hass.states.get = states.get
    hass.services.async_call = AsyncMock()

    mgr = HeatPlantManager(hass)
    # 1) Direct kg sensor test
    cfg_sensor = {
        "id": "p_sensor",
        "name": "Piec z wagą",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "enabled": True,
        "assigned_rooms": [AREA],
        "fuel_consumption_sensor": fuel_sensor,
        "hopper_capacity_kg": 100.0,
        "calorific_value_mj_kg": 26.0,
        "efficiency_pct": 85.0,
        "fuel_price": 1500.0,
        "ash_content_pct": 8.0,
        "currency": "PLN",
    }
    rooms = {AREA: SAMPLE_ROOM}
    rs = {AREA: {"mode": MODE_HEATING, "commanded_mode": MODE_HEATING, "heating_power": 60}}
    await mgr.async_process(rooms, rs, {"climate_control_active": True, "heat_plants": [cfg_sensor]})

    # Advance 30 min and sensor increases by 4.0 kg (10.0 -> 14.0 kg)
    states[fuel_sensor].state = "14.0"
    mgr._states["p_sensor"].last_ts -= 1800.0
    live = (await mgr.async_process(rooms, rs, {"climate_control_active": True, "heat_plants": [cfg_sensor]}))[
        "p_sensor"
    ]
    assert live["fuel_source_mode"] == "fuel_sensor"
    assert live["fuel_consumed_today"] == pytest.approx(4.0, abs=0.05)
    assert live["cost_today"] == pytest.approx(6.0, abs=0.05)
    assert live["estimated_ash_kg"] == pytest.approx(0.32, abs=0.02)

    # 2) Feeder auger test (12 kg/h running for 0.5h -> 6.0 kg)
    cfg_feeder = {
        "id": "p_feeder",
        "name": "Piec z podajnikiem",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "enabled": True,
        "assigned_rooms": [AREA],
        "feeder_entity": feeder,
        "feeder_kg_per_hour": 12.0,
        "hopper_capacity_kg": 120.0,
        "calorific_value_mj_kg": 26.0,
        "efficiency_pct": 85.0,
        "fuel_price": 1500.0,
        "currency": "PLN",
    }
    await mgr.async_process(rooms, rs, {"climate_control_active": True, "heat_plants": [cfg_feeder]})
    mgr._states["p_feeder"].last_ts -= 1800.0
    live_f = (await mgr.async_process(rooms, rs, {"climate_control_active": True, "heat_plants": [cfg_feeder]}))[
        "p_feeder"
    ]
    assert live_f["fuel_source_mode"] == "feeder"
    assert live_f["feeder_active"] is True
    assert live_f["fuel_consumed_today"] == pytest.approx(6.0, abs=0.05)

    # 3) Manual kg logging (refill & burned)
    assert mgr.log_fuel("p_feeder", 50.0, mode="refill") is True
    assert mgr._states["p_feeder"].fuel_loaded_kg >= 50.0
    assert mgr.log_fuel("p_feeder", 5.0, mode="burned") is True
    assert mgr._states["p_feeder"].fuel_consumed_today == pytest.approx(11.0, abs=0.05)
    assert mgr._states["p_feeder"].fuel_since_ash_clean_kg == pytest.approx(11.0, abs=0.05)


@pytest.mark.asyncio
async def test_maintenance_alerts_notifications_and_confirmations(hass):
    """Refill, ash tray, and chimney alerts trigger throttled notifications and clear on confirmation."""
    from unittest.mock import patch

    hass.states.get = lambda _eid: None
    hass.services.async_call = AsyncMock()
    mgr = HeatPlantManager(hass)

    plant_cfg = {
        "id": "coal_maint",
        "name": "Piec Główny",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "enabled": True,
        "assigned_rooms": [AREA],
        "hopper_capacity_kg": 100.0,
        "notify_refill_enabled": True,
        "refill_alert_kg": 20.0,
        "refill_alert_pct": 20.0,
        "notify_ash_enabled": True,
        "ash_clean_interval_kg": 100.0,
        "ash_clean_interval_days": 7.0,
        "notify_chimney_enabled": True,
        "chimney_clean_interval_kg": 500.0,
        "chimney_clean_interval_days": 30.0,
        "calorific_value_mj_kg": 26.0,
        "efficiency_pct": 85.0,
        "fuel_price": 1500.0,
    }
    rooms = {AREA: SAMPLE_ROOM}
    rs = {AREA: {"mode": MODE_IDLE, "commanded_mode": MODE_IDLE, "heating_power": 0}}
    settings = {
        "climate_control_active": True,
        "heat_plants": [plant_cfg],
        "heat_plant_notifications_enabled": True,
        "heat_plant_notification_targets": [{"entity_id": "notify.mobile_app_phone", "notify_when": "always"}],
        "heat_plant_notification_cooldown": 180,
    }

    # Initialize state and simulate low hopper, full ash, and overdue chimney
    await mgr.async_process(rooms, rs, settings)
    st = mgr._states["coal_maint"]
    st.fuel_loaded_kg = 100.0
    st.fuel_since_refill_kg = 85.0  # 15 kg left (< 20 kg threshold)
    st.fuel_since_ash_clean_kg = 120.0  # > 100 kg interval
    st.fuel_since_chimney_clean_kg = 550.0  # > 500 kg interval

    with (
        patch(
            "custom_components.roommind.managers.heat_plant_manager.async_send_notification",
            new=AsyncMock(),
        ) as mock_send,
        patch(
            "custom_components.roommind.managers.heat_plant_manager.dismiss_notification",
        ) as mock_dismiss,
    ):
        live = (await mgr.async_process(rooms, rs, settings))["coal_maint"]
        assert live["refill_needed"] is True
        assert live["ash_clean_needed"] is True
        assert live["chimney_clean_needed"] is True
        assert set(live["maintenance_alerts"]) == {"refill", "ash", "chimney"}
        assert mock_send.await_count == 3

        # Immediate second cycle is throttled -> no duplicate notifications
        await mgr.async_process(rooms, rs, settings)
        assert mock_send.await_count == 3

        # Confirm each maintenance action
        assert mgr.confirm_maintenance("coal_maint", "refill", kg=100.0) is True
        assert mgr.confirm_maintenance("coal_maint", "ash_cleaned") is True
        assert mgr.confirm_maintenance("coal_maint", "chimney_cleaned") is True
        assert mock_dismiss.call_count == 3

        live_after = (await mgr.async_process(rooms, rs, settings))["coal_maint"]
        assert live_after["refill_needed"] is False
        assert live_after["ash_clean_needed"] is False
        assert live_after["chimney_clean_needed"] is False
        assert live_after["maintenance_alerts"] == []


@pytest.mark.asyncio
async def test_underfloor_receiver_overheat_stops_pump_and_low_return_warning(hass):
    """Boiler's underfloor receiver circuit STOPS its UFH pump on overheat (>=48°C) and sends alert; coal boiler flags cold return (<45°C)."""
    from unittest.mock import patch

    ufh_pump = "switch.ufh_pump"
    ufh_supply = "sensor.ufh_supply"
    states = {
        ufh_pump: SimpleNamespace(state="on", attributes={}),
        ufh_supply: SimpleNamespace(state="51.0", attributes={"unit_of_measurement": "°C"}),
        SUPPLY_SENSOR: SimpleNamespace(state="62.0", attributes={"unit_of_measurement": "°C"}),
        RETURN_SENSOR: SimpleNamespace(state="39.0", attributes={"unit_of_measurement": "°C"}),
    }
    hass.states.get = states.get

    async def _call(domain, service, data, **_kw):
        eid = data.get("entity_id")
        if eid in states and service in ("turn_on", "turn_off"):
            states[eid].state = "on" if service == "turn_on" else "off"

    hass.services.async_call = AsyncMock(side_effect=_call)

    mgr = HeatPlantManager(hass)
    plants = [
        {
            "id": "coal_ret",
            "name": "Piec Ekogroszek",
            "plant_type": PLANT_TYPE_COAL_BOILER,
            "enabled": True,
            "assigned_rooms": [AREA],
            "supply_temp_sensor": SUPPLY_SENSOR,
            "return_temp_sensor": RETURN_SENSOR,
            "ufh_pump_entity": ufh_pump,
            "ufh_supply_temp_sensor": ufh_supply,
            "ufh_min_supply_temp": 25.0,
            "ufh_max_supply_temp": 48.0,
        },
    ]
    rooms = {AREA: SAMPLE_ROOM}
    rs = {AREA: {"mode": MODE_HEATING, "commanded_mode": MODE_HEATING, "heating_power": 80}}
    settings = {
        "climate_control_active": True,
        "heat_plants": plants,
        "heat_plant_notifications_enabled": True,
    }

    with (
        patch(
            "custom_components.roommind.managers.heat_plant_manager.async_send_notification",
            new=AsyncMock(),
        ) as mock_send,
        patch("custom_components.roommind.managers.heat_plant_manager.dismiss_notification"),
    ):
        live = await mgr.async_process(rooms, rs, settings)

    # Underfloor receiver circuit at 51°C (>= 48°C default) must CUT its UFH pump OFF and dispatch overheat alarm
    assert live["coal_ret"]["ufh_overheat_protect"] is True
    assert live["coal_ret"]["overheat_protect"] is True
    assert live["coal_ret"]["ufh_pump_active"] is False
    assert states[ufh_pump].state == "off"
    assert mock_send.await_count == 1
    assert "podłogówki" in mock_send.await_args.kwargs["message"].lower()

    # Coal boiler at 62°C supply / 39°C return flags low_return_warning
    assert live["coal_ret"]["low_return_warning"] is True

    # Raising return to 48°C and cooling UFH supply to 35°C clears both warnings and starts UFH pump
    states[RETURN_SENSOR].state = "48.0"
    states[ufh_supply].state = "35.0"
    with (
        patch("custom_components.roommind.managers.heat_plant_manager.async_send_notification", new=AsyncMock()),
        patch("custom_components.roommind.managers.heat_plant_manager.dismiss_notification"),
    ):
        live2 = await mgr.async_process(rooms, rs, settings)
    assert live2["coal_ret"]["low_return_warning"] is False
    assert live2["coal_ret"]["ufh_overheat_protect"] is False
    assert live2["coal_ret"]["ufh_pump_active"] is True
    assert states[ufh_pump].state == "on"


@pytest.mark.asyncio
async def test_heat_plant_ha_services_log_fuel_and_confirm_maintenance(hass):
    """roommind.log_heat_plant_fuel and confirm_heat_plant_maintenance work with auto plant_id resolution."""
    from unittest.mock import MagicMock

    from custom_components.roommind import (
        SERVICE_CONFIRM_MAINTENANCE,
        SERVICE_LOG_FUEL,
        _async_register_services,
    )

    registered: dict[str, object] = {}

    def _has_service(domain, srv):
        return (domain, srv) in registered

    def _register(domain, srv, handler, schema=None):
        registered[(domain, srv)] = handler

    hass.services.has_service = _has_service
    hass.services.async_register = _register
    _async_register_services(hass)
    assert (DOMAIN, SERVICE_LOG_FUEL) in registered
    assert (DOMAIN, SERVICE_CONFIRM_MAINTENANCE) in registered

    plant_cfg = {
        "id": "boiler_main",
        "name": "Piec",
        "plant_type": PLANT_TYPE_COAL_BOILER,
        "fuel_type": FUEL_TYPE_COAL,
        "hopper_capacity_kg": 100.0,
    }
    mgr = HeatPlantManager(hass)
    mgr.load_configs([plant_cfg])
    coordinator = MagicMock()
    coordinator._heat_plant_manager = mgr
    coordinator.async_request_refresh = AsyncMock()
    store = _make_store_mock({}, settings={"heat_plants": [plant_cfg]})
    hass.data = {DOMAIN: {"coordinator": coordinator, "store": store}}

    log_handler = registered[(DOMAIN, SERVICE_LOG_FUEL)]
    maint_handler = registered[(DOMAIN, SERVICE_CONFIRM_MAINTENANCE)]

    # Omitting plant_id auto-selects first solid-fuel plant
    await log_handler(SimpleNamespace(data={"kg": 25.0, "mode": "burned"}))
    assert mgr._states["boiler_main"].fuel_consumed_today == pytest.approx(25.0)
    assert mgr._states["boiler_main"].fuel_since_ash_clean_kg == pytest.approx(25.0)

    await maint_handler(SimpleNamespace(data={"action": "ash_cleaned"}))
    assert mgr._states["boiler_main"].fuel_since_ash_clean_kg == 0.0
    assert coordinator.async_request_refresh.await_count == 2


