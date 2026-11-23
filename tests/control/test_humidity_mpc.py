"""Tests for HumidityRCModel, HumidityEKF, HumidityMPCOptimizer, HumidityMPCController, and RoomMindRoomHumidifier."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.roommind.const import (
    DOMAIN,
    MODE_DEHUMIDIFYING,
    MODE_HUMIDIFYING,
    MODE_IDLE,
    TargetHumidities,
)
from custom_components.roommind.control.humidity_model import (
    HumidityRCModel,
    RoomHumidityModelManager,
    equivalent_indoor_rh,
)
from custom_components.roommind.control.humidity_mpc_controller import (
    compute_dehumidifier_target_setpoint,
    compute_humidifier_target_setpoint,
    is_humidity_mpc_active,
)
from custom_components.roommind.control.humidity_mpc_optimizer import (
    HumidityMPCOptimizer,
)
from custom_components.roommind.humidifier import RoomMindRoomHumidifier
from tests.coordinator.conftest import (
    SAMPLE_ROOM,
    _create_coordinator,
    _make_store_mock,
    make_mock_states_get,
)

AREA = "living_room_abc12345"
HUMIDIFIER = "humidifier.bedroom"
DEHUMIDIFIER = "humidifier.cellar_dehum"


def test_equivalent_indoor_rh_conversion():
    # Cold winter outdoor air (0°C, 80% RH) warmed to 21°C indoor air is very dry (~21% RH)
    eq_winter = equivalent_indoor_rh(21.0, 0.0, 80.0)
    assert 18.0 <= eq_winter <= 25.0

    # Warm humid summer outdoor air (28°C, 75% RH) cooled to 22°C indoor air is very humid (>90% RH)
    eq_summer = equivalent_indoor_rh(22.0, 28.0, 75.0)
    assert eq_summer > 90.0

    # Missing outdoor_rh reading falls back cleanly; missing indoor_temp falls back to outdoor_rh
    assert equivalent_indoor_rh(21.0, 10.0, None, fallback_rh=48.0) == 48.0
    assert equivalent_indoor_rh(None, 10.0, 52.0, fallback_rh=48.0) == 52.0


def test_humidity_rc_model_predict_and_trajectory():
    model = HumidityRCModel(C=1.0, U=0.1, Q_humidify=12.0, Q_dehumidify=12.0, Q_occupancy=2.0)

    # Idle with drier outdoor air -> humidity drops
    h_idle = model.predict(50.0, 25.0, Q_active=0.0, dt_minutes=15.0)
    assert h_idle < 50.0

    # Humidifying -> humidity rises
    h_hum = model.predict(40.0, 25.0, Q_active=model.Q_humidify, dt_minutes=15.0)
    assert h_hum > 40.0

    # Dehumidifying -> humidity drops faster than idle
    h_dehum = model.predict(65.0, 65.0, Q_active=-model.Q_dehumidify, dt_minutes=15.0)
    assert h_dehum < 65.0

    # Trajectory
    traj = model.predict_trajectory(
        40.0,
        [30.0, 30.0, 30.0],
        [model.Q_humidify, model.Q_humidify, 0.0],
        dt_minutes=5.0,
    )
    assert len(traj) == 4
    assert traj[1] > traj[0]
    assert traj[2] > traj[1]

    # Serialization roundtrip
    restored = HumidityRCModel.from_dict(model.to_dict())
    assert restored == model


def test_humidity_ekf_learning_and_mpc_activation():
    mgr = RoomHumidityModelManager()
    true_model = HumidityRCModel(C=1.0, U=0.12, Q_humidify=15.0, Q_dehumidify=14.0, Q_occupancy=1.5)

    h = 45.0
    h_out = 25.0
    dt = 5.0

    # 70 idle steps
    for _ in range(70):
        h = true_model.predict(h, h_out, 0.0, dt)
        mgr.update(AREA, h, h_out, MODE_IDLE, dt, can_humidify=True, can_dehumidify=True)

    # Not yet active for humidifying (needs active updates)
    assert not is_humidity_mpc_active(
        mgr, AREA, can_humidify=True, can_dehumidify=False, current_humidity=h, outdoor_rh_eq=h_out
    )

    # 25 humidifying steps
    for _ in range(25):
        h = true_model.predict(h, h_out, true_model.Q_humidify, dt)
        mgr.update(
            AREA,
            h,
            h_out,
            MODE_HUMIDIFYING,
            dt,
            can_humidify=True,
            can_dehumidify=True,
            power_fraction=1.0,
        )

    assert is_humidity_mpc_active(
        mgr,
        AREA,
        can_humidify=True,
        can_dehumidify=False,
        current_humidity=h,
        outdoor_rh_eq=h_out,
        room_sides=(True, False),
    )
    assert mgr.get_confidence(AREA) > 0.5

    # Serialization roundtrip
    restored = RoomHumidityModelManager.from_dict(mgr.to_dict())
    assert is_humidity_mpc_active(
        restored,
        AREA,
        can_humidify=True,
        can_dehumidify=False,
        current_humidity=h,
        outdoor_rh_eq=h_out,
        room_sides=(True, False),
    )


def test_humidity_mpc_optimizer_humidifying_and_dehumidifying():
    model = HumidityRCModel(C=1.0, U=0.1, Q_humidify=12.0, Q_dehumidify=12.0)
    optimizer = HumidityMPCOptimizer(
        model=model,
        can_humidify=True,
        can_dehumidify=True,
    )

    # Room too dry (35% vs 45% target) -> humidifying
    plan_hum = optimizer.optimize(
        35.0,
        [25.0] * optimizer.n_blocks,
        [TargetHumidities(humidify=45.0, dehumidify=60.0)] * optimizer.n_blocks,
    )
    assert plan_hum.actions[0] == MODE_HUMIDIFYING
    assert plan_hum.power_fractions[0] > 0.0

    # Room too humid (70% vs 60% target) -> dehumidifying
    plan_dehum = optimizer.optimize(
        70.0,
        [65.0] * optimizer.n_blocks,
        [TargetHumidities(humidify=45.0, dehumidify=60.0)] * optimizer.n_blocks,
    )
    assert plan_dehum.actions[0] == MODE_DEHUMIDIFYING
    assert plan_dehum.power_fractions[0] > 0.0

    # Room within comfort band (50% in [45, 60]) -> idle
    plan_idle = optimizer.optimize(
        50.0,
        [50.0] * optimizer.n_blocks,
        [TargetHumidities(humidify=45.0, dehumidify=60.0)] * optimizer.n_blocks,
    )
    assert plan_idle.actions[0] == MODE_IDLE
    assert plan_idle.power_fractions[0] == 0.0


def test_humidity_mpc_optimizer_prehumidify_before_schedule_jump():
    model = HumidityRCModel(C=1.0, U=0.05, Q_humidify=8.0, Q_dehumidify=8.0)
    optimizer = HumidityMPCOptimizer(
        model=model,
        can_humidify=True,
        can_dehumidify=False,
    )
    # Current humidity 40%, eco target 40% for 2 blocks, then comfort jump to 50%
    targets = [TargetHumidities(humidify=40.0, dehumidify=60.0)] * 2 + [
        TargetHumidities(humidify=50.0, dehumidify=60.0)
    ] * (optimizer.n_blocks - 2)
    plan = optimizer.optimize(40.0, [35.0] * optimizer.n_blocks, targets)
    assert plan.prehumidify_blocks > 0
    assert plan.actions[0] == MODE_HUMIDIFYING


def test_proportional_and_direct_setpoints_for_humidifier_entities():
    targets = TargetHumidities(humidify=45.0, dehumidify=60.0)

    # Proportional humidifying at 50% power from 40% RH toward boost 80% RH
    sp_prop = compute_humidifier_target_setpoint(
        MODE_HUMIDIFYING,
        0.5,
        40.0,
        targets,
        setpoint_mode="proportional",
    )
    assert sp_prop is not None and sp_prop > 45

    # Direct humidifying with +3% offset -> 48%
    sp_dir = compute_humidifier_target_setpoint(
        MODE_HUMIDIFYING,
        0.5,
        40.0,
        targets,
        setpoint_mode="direct",
        setpoint_offset=3.0,
    )
    assert sp_dir == 48

    # Proportional dehumidifying at 50% power from 70% RH toward boost 30% RH
    sp_dehum = compute_dehumidifier_target_setpoint(
        MODE_DEHUMIDIFYING,
        0.5,
        70.0,
        targets,
        setpoint_mode="proportional",
    )
    assert sp_dehum is not None and sp_dehum < 60


@pytest.mark.asyncio
async def test_coordinator_sends_set_humidity_to_humidifier_entity(hass, mock_config_entry):
    room_cfg = {
        **SAMPLE_ROOM,
        "comfort_humidify": 45.0,
        "comfort_dehumidify": 60.0,
        "humidity_min": 45.0,
        "humidity_max": 60.0,
        "humidifier_entity": HUMIDIFIER,
        "humidifier_setpoint_mode": "direct",
        "humidifier_setpoint_offset": 2.0,
    }
    store = _make_store_mock({AREA: room_cfg})
    hass.data = {DOMAIN: {"store": store}}
    base = make_mock_states_get(temp="21.0", humidity="38.0")

    hum_state = SimpleNamespace(
        state="off",
        attributes={"humidity": 40, "min_humidity": 30, "max_humidity": 80},
    )

    def get(eid):
        if eid == HUMIDIFIER:
            return hum_state
        return base(eid)

    hass.states.get = get
    calls = []

    async def _call(domain, service, data, **_kw):
        calls.append((domain, service, data))
        if data.get("entity_id") == HUMIDIFIER:
            if service == "turn_on":
                hum_state.state = "on"
            elif service == "set_humidity":
                hum_state.attributes["humidity"] = data.get("humidity")

    hass.services.async_call = AsyncMock(side_effect=_call)
    coordinator = _create_coordinator(hass, mock_config_entry)

    data = await coordinator._async_update_data()
    rs = data["rooms"][AREA]

    assert rs["humidity_low"] is True
    assert rs["humidifier_active"] is True
    assert rs["humidity_action"] == MODE_HUMIDIFYING
    assert rs["humidifier_setpoint"] == 47
    assert any(
        d == "humidifier" and s == "set_humidity" and payload.get("humidity") == 47
        for d, s, payload in calls
    )


@pytest.mark.asyncio
async def test_room_humidifier_entity_modes_and_set_humidity(hass, mock_config_entry):
    room_cfg = {
        **SAMPLE_ROOM,
        "comfort_humidify": 45.0,
        "comfort_dehumidify": 60.0,
        "eco_humidify": 40.0,
        "eco_dehumidify": 65.0,
        "humidity_min": 45.0,
        "humidity_max": 60.0,
        "humidifier_entity": HUMIDIFIER,
    }
    store = _make_store_mock({AREA: room_cfg})
    store.get_room.return_value = room_cfg

    async def _update_room(area_id, changes):
        room_cfg.update(changes)
        return room_cfg

    store.async_update_room = AsyncMock(side_effect=_update_room)
    hass.data = {DOMAIN: {"store": store}}
    hass.states.get = make_mock_states_get(temp="21.0", humidity="38.0")
    hass.services.async_call = AsyncMock()

    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.async_request_refresh = AsyncMock()
    coordinator.data = {
        "rooms": {
            AREA: {
                "current_humidity": 38.0,
                "humidify_target": 45.0,
                "dehumidify_target": 60.0,
                "humidity_action": MODE_HUMIDIFYING,
                "humidifier_active": True,
                "humidifying_power": 80,
            }
        }
    }

    entity = RoomMindRoomHumidifier(coordinator, AREA)
    entity.hass = hass
    entity.async_write_ha_state = lambda: None

    assert entity.is_on is True
    assert entity.current_humidity == 38.0
    assert entity.target_humidity == 45.0
    assert entity.mode == "normal"

    await entity.async_set_humidity(50)
    assert room_cfg["override_humidify"] == 50.0
    assert entity.mode == "manual"

    await entity.async_set_mode("eco")
    assert room_cfg["override_humidify"] == 40.0
    assert entity.mode == "eco"

    await entity.async_set_mode("normal")
    assert room_cfg["override_humidify"] is None
    assert entity.mode == "normal"
