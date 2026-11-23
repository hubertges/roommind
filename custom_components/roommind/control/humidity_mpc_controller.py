"""MPC controller and device command translator for room humidity control."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..const import (
    BANGBANG_DEHUMIDIFY_HYSTERESIS,
    BANGBANG_HUMIDIFY_HYSTERESIS,
    DEHUMIDIFYING_BOOST_TARGET,
    HUMIDIFYING_BOOST_TARGET,
    HUMIDITY_HYSTERESIS,
    HUMIDITY_MODE_DEHUMIDIFY_ONLY,
    HUMIDITY_MODE_HUMIDIFY_ONLY,
    MAX_TARGET_HUMIDITY,
    MIN_TARGET_HUMIDITY,
    MODE_DEHUMIDIFYING,
    MODE_HUMIDIFYING,
    MODE_IDLE,
    TargetHumidities,
)
from ..managers.humidity_manager import outdoor_air_dries
from .humidity_model import RoomHumidityModelManager, equivalent_indoor_rh
from .humidity_mpc_optimizer import (
    DEFAULT_DT_MINUTES,
    DEFAULT_HORIZON_HOURS,
    MAX_PREHUMIDIFY_MINUTES,
    HumidityMPCOptimizer,
    HumidityMPCPlan,
)
from .mpc_controller import MIN_ACTIVE_UPDATES, MIN_IDLE_UPDATES, is_mpc_enabled

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Maximum acceptable prediction standard deviation (% RH) at a 15-minute
# horizon before MPC activates for humidity.
HUMIDITY_MPC_MAX_PREDICTION_STD = 2.0


def is_humidity_mpc_active(
    model_manager: RoomHumidityModelManager,
    area_id: str,
    can_humidify: bool,
    can_dehumidify: bool,
    current_humidity: float | None = None,
    outdoor_rh_eq: float = 50.0,
    settings: dict | None = None,
    room_sides: tuple[bool, bool] | None = None,
) -> bool:
    """Check whether the humidity model for a room is trained enough for MPC."""
    if not is_mpc_enabled(settings):
        return False

    est = model_manager.get_estimator(area_id)
    h_probe = current_humidity if current_humidity is not None else 50.0
    if can_humidify and not can_dehumidify:
        q_test = est.get_model().Q_humidify
    elif can_dehumidify and not can_humidify:
        q_test = -est.get_model().Q_dehumidify
    else:
        q_test = est.get_model().Q_humidify

    pred_std = model_manager.get_prediction_std(
        area_id,
        q_test,
        h_probe,
        outdoor_rh_eq,
        DEFAULT_DT_MINUTES * 3,
    )
    if pred_std >= HUMIDITY_MPC_MAX_PREDICTION_STD:
        return False
    if est._n_idle < MIN_IDLE_UPDATES:
        return False

    req_humidify, req_dehumidify = (
        room_sides if room_sides is not None else (can_humidify, can_dehumidify)
    )
    if req_humidify and est._n_humidifying < MIN_ACTIVE_UPDATES:
        return False
    if req_dehumidify and est._n_dehumidifying < MIN_ACTIVE_UPDATES:
        return False
    if not (req_humidify or req_dehumidify):
        return False
    return True


def get_can_humidify_dehumidify(
    room_config: dict,
    indoor_temp: float | None = None,
    indoor_rh: float | None = None,
    outdoor_temp: float | None = None,
    outdoor_rh: float | None = None,
    has_ac_dry: bool = False,
    override_active: bool = False,
) -> tuple[bool, bool]:
    """Determine if a room can humidify and/or dehumidify based on config and devices."""
    humidity_mode = room_config.get("humidity_mode", "auto")
    has_humidifier = bool((room_config.get("humidifier_entity") or "").strip())
    has_dehumidifier = bool((room_config.get("dehumidifier_entity") or "").strip())
    has_ventilation = bool((room_config.get("ventilation_entity") or "").strip())
    vent_can_dry = has_ventilation and outdoor_air_dries(
        indoor_temp,
        indoor_rh,
        outdoor_temp,
        outdoor_rh,
        running=False,
    )

    if override_active:
        can_humidify = has_humidifier
        can_dehumidify = has_dehumidifier or has_ac_dry or vent_can_dry
    else:
        can_humidify = (
            humidity_mode != HUMIDITY_MODE_DEHUMIDIFY_ONLY and has_humidifier
        )
        can_dehumidify = humidity_mode != HUMIDITY_MODE_HUMIDIFY_ONLY and (
            has_dehumidifier or has_ac_dry or vent_can_dry
        )
    return can_humidify, can_dehumidify


def compute_humidifier_target_setpoint(
    mode: str,
    power_fraction: float,
    current_humidity: float | None,
    targets: TargetHumidities,
    setpoint_mode: str = "proportional",
    setpoint_offset: float = 0.0,
    min_humidity: float = MIN_TARGET_HUMIDITY,
    max_humidity: float = MAX_TARGET_HUMIDITY,
    boost_target: float = HUMIDIFYING_BOOST_TARGET,
) -> int | None:
    """Compute target humidity setpoint (% RH) for a `humidifier.*` device."""
    h_target = targets.humidify
    if h_target is None:
        return None

    low_bound = max(MIN_TARGET_HUMIDITY, float(min_humidity))
    high_bound = min(MAX_TARGET_HUMIDITY, float(max_humidity))

    if mode != MODE_HUMIDIFYING:
        # When idle, keep device target at or below target so internal humidistat stays satisfied
        idle_sp = min(high_bound, max(low_bound, h_target + setpoint_offset))
        return int(round(idle_sp))

    effective_target = min(high_bound, max(low_bound, h_target + setpoint_offset))
    if setpoint_mode == "direct" or current_humidity is None:
        return int(round(effective_target))

    # Proportional modulation: interpolate between current_humidity (or effective_target)
    # and boost_target based on MPC power_fraction
    eff_boost = min(high_bound, max(effective_target, float(boost_target)))
    base_rh = max(current_humidity, effective_target)
    raw_sp = base_rh + power_fraction * (eff_boost - base_rh)
    clamped = min(high_bound, max(effective_target, raw_sp))
    return int(round(clamped))


def compute_dehumidifier_target_setpoint(
    mode: str,
    power_fraction: float,
    current_humidity: float | None,
    targets: TargetHumidities,
    setpoint_mode: str = "proportional",
    setpoint_offset: float = 0.0,
    min_humidity: float = MIN_TARGET_HUMIDITY,
    max_humidity: float = MAX_TARGET_HUMIDITY,
    boost_target: float = DEHUMIDIFYING_BOOST_TARGET,
) -> int | None:
    """Compute target humidity setpoint (% RH) for a `humidifier.*` dehumidifier device."""
    d_target = targets.dehumidify
    if d_target is None:
        return None

    low_bound = max(MIN_TARGET_HUMIDITY, float(min_humidity))
    high_bound = min(MAX_TARGET_HUMIDITY, float(max_humidity))

    if mode != MODE_DEHUMIDIFYING:
        idle_sp = min(high_bound, max(low_bound, d_target + setpoint_offset))
        return int(round(idle_sp))

    effective_target = min(high_bound, max(low_bound, d_target + setpoint_offset))
    if setpoint_mode == "direct" or current_humidity is None:
        return int(round(effective_target))

    eff_boost = max(low_bound, min(effective_target, float(boost_target)))
    base_rh = min(current_humidity, effective_target)
    raw_sp = base_rh - power_fraction * (base_rh - eff_boost)
    clamped = max(low_bound, min(effective_target, raw_sp))
    return int(round(clamped))


@dataclass
class HumidityMPCControlResult:
    """Result of a single HumidityMPCController evaluation cycle."""

    mode: str = MODE_IDLE
    power_fraction: float = 1.0
    mpc_active: bool = False
    prehumidify: bool = False
    humidifier_setpoint: int | None = None
    dehumidifier_setpoint: int | None = None
    plan: HumidityMPCPlan | None = None
    outdoor_rh_eq: float = 50.0
    forecast_rh_eq_series: list[float] = field(default_factory=list)


class HumidityMPCController:
    """Orchestrates humidity EKF model lookup, MPC optimization, and Bang-Bang fallback."""

    def __init__(
        self,
        hass: HomeAssistant,
        room_config: dict,
        model_manager: RoomHumidityModelManager,
        current_humidity: float | None,
        targets: TargetHumidities,
        indoor_temp: float | None,
        outdoor_temp: float | None,
        outdoor_humidity: float | None,
        outdoor_forecast: list[dict] | None = None,
        window_open: bool = False,
        target_resolver: Callable[[float], TargetHumidities] | None = None,
        previous_mode: str = MODE_IDLE,
        settings: dict | None = None,
        has_external_sensor: bool = True,
        q_occupancy: float = 0.0,
        override_active: bool = False,
        has_ac_dry: bool = False,
    ) -> None:
        self.hass = hass
        self.room_config = room_config
        self.model_manager = model_manager
        self.current_humidity = current_humidity
        self.targets = targets
        self.indoor_temp = indoor_temp
        self.outdoor_temp = outdoor_temp
        self.outdoor_humidity = outdoor_humidity
        self.outdoor_forecast = outdoor_forecast or []
        self.window_open = window_open
        self.target_resolver = target_resolver
        self.previous_mode = previous_mode
        self.settings = settings or {}
        self.has_external_sensor = has_external_sensor
        self.q_occupancy = q_occupancy
        self.override_active = override_active
        self.has_ac_dry = has_ac_dry
        self.last_plan: HumidityMPCPlan | None = None

        self.can_humidify, self.can_dehumidify = get_can_humidify_dehumidify(
            room_config,
            indoor_temp=indoor_temp,
            indoor_rh=current_humidity,
            outdoor_temp=outdoor_temp,
            outdoor_rh=outdoor_humidity,
            has_ac_dry=has_ac_dry,
            override_active=override_active,
        )

    def _build_outdoor_rh_eq_series(self, n_blocks: int, dt_minutes: float) -> list[float]:
        """Build equivalent indoor RH series from current weather and forecast."""
        base_eq = equivalent_indoor_rh(
            self.indoor_temp,
            self.outdoor_temp,
            self.outdoor_humidity,
        )
        if not self.outdoor_forecast:
            return [base_eq] * n_blocks

        series: list[float] = []
        blocks_per_hour = max(1, int(60.0 / dt_minutes))
        for k in range(n_blocks):
            hour_idx = min(k // blocks_per_hour, len(self.outdoor_forecast) - 1)
            entry = self.outdoor_forecast[hour_idx]
            f_temp = entry.get("temperature", self.outdoor_temp)
            f_rh = entry.get("humidity", self.outdoor_humidity)
            if f_rh is None:
                series.append(base_eq)
            else:
                series.append(
                    equivalent_indoor_rh(
                        self.indoor_temp,
                        f_temp,
                        f_rh,
                        fallback_rh=base_eq,
                    )
                )
        return series

    def _build_target_series(
        self, n_blocks: int, dt_minutes: float
    ) -> list[TargetHumidities]:
        """Build target humidity series over the horizon."""
        if self.target_resolver is None:
            return [self.targets] * n_blocks

        now = time.time()
        series: list[TargetHumidities] = []
        for k in range(n_blocks):
            ts = now + k * dt_minutes * 60.0
            try:
                series.append(self.target_resolver(ts))
            except Exception:  # noqa: BLE001
                series.append(self.targets)
        return series

    def _bang_bang_evaluate(self) -> tuple[str, float]:
        """Simple threshold + hysteresis fallback when MPC model is still learning."""
        if self.current_humidity is None:
            return MODE_IDLE, 0.0

        h_curr = self.current_humidity
        h_target = self.targets.humidify
        d_target = self.targets.dehumidify

        # Preserve hysteresis behavior:
        # - For humidifying: start when h_curr < h_target; stay active until
        #   h_curr >= min(h_target + HUMIDITY_HYSTERESIS, d_target - 1 if d_target else 100)
        # - For dehumidifying: start when h_curr > d_target; stay active until
        #   h_curr <= max(d_target - HUMIDITY_HYSTERESIS, h_target + 1 if h_target else 0)
        if self.can_humidify and h_target is not None:
            stop_hum = h_target + HUMIDITY_HYSTERESIS
            if d_target is not None:
                stop_hum = min(stop_hum, d_target - BANGBANG_HUMIDIFY_HYSTERESIS)
                stop_hum = max(stop_hum, h_target)
            if h_curr < h_target:
                return MODE_HUMIDIFYING, 1.0
            if self.previous_mode == MODE_HUMIDIFYING and h_curr < stop_hum:
                return MODE_HUMIDIFYING, 1.0

        if self.can_dehumidify and d_target is not None:
            stop_dehum = d_target - HUMIDITY_HYSTERESIS
            if h_target is not None:
                stop_dehum = max(stop_dehum, h_target + BANGBANG_DEHUMIDIFY_HYSTERESIS)
                stop_dehum = min(stop_dehum, d_target)
            if h_curr > d_target:
                return MODE_DEHUMIDIFYING, 1.0
            if self.previous_mode == MODE_DEHUMIDIFYING and h_curr > stop_dehum:
                return MODE_DEHUMIDIFYING, 1.0

        return MODE_IDLE, 0.0

    def evaluate(self) -> HumidityMPCControlResult:
        """Evaluate current state and return control mode, power fraction, and setpoints."""
        area_id = self.room_config.get("area_id", "")
        outdoor_rh_eq = equivalent_indoor_rh(
            self.indoor_temp,
            self.outdoor_temp,
            self.outdoor_humidity,
        )

        if self.window_open:
            return HumidityMPCControlResult(
                mode=MODE_IDLE,
                power_fraction=0.0,
                mpc_active=False,
                prehumidify=False,
                outdoor_rh_eq=outdoor_rh_eq,
            )

        if self.targets.humidify is None and self.targets.dehumidify is None:
            return HumidityMPCControlResult(
                mode=MODE_IDLE,
                power_fraction=0.0,
                mpc_active=False,
                prehumidify=False,
                outdoor_rh_eq=outdoor_rh_eq,
            )

        req_sides = (
            self.can_humidify and self.targets.humidify is not None,
            self.can_dehumidify and self.targets.dehumidify is not None,
        )
        mpc_ready = (
            self.has_external_sensor
            and self.current_humidity is not None
            and is_humidity_mpc_active(
                self.model_manager,
                area_id,
                self.can_humidify,
                self.can_dehumidify,
                current_humidity=self.current_humidity,
                outdoor_rh_eq=outdoor_rh_eq,
                settings=self.settings,
                room_sides=req_sides,
            )
        )

        mode = MODE_IDLE
        power_fraction = 0.0
        prehumidify = False
        plan: HumidityMPCPlan | None = None
        forecast_series: list[float] = []

        if mpc_ready and self.current_humidity is not None:
            model = self.model_manager.get_model(area_id)
            w_comfort = float(self.settings.get("comfort_weight", 70)) / 7.0
            w_comfort = max(1.0, w_comfort)
            prehumidify_enabled = self.room_config.get("prehumidify_enabled", True)
            max_ph = MAX_PREHUMIDIFY_MINUTES if prehumidify_enabled else 0.0

            optimizer = HumidityMPCOptimizer(
                model=model,
                w_comfort=w_comfort,
                w_energy=1.0,
                dt_minutes=DEFAULT_DT_MINUTES,
                horizon_hours=DEFAULT_HORIZON_HOURS,
                can_humidify=self.can_humidify,
                can_dehumidify=self.can_dehumidify,
                q_occupancy=self.q_occupancy,
                prehumidify_max_minutes=max_ph,
            )
            forecast_series = self._build_outdoor_rh_eq_series(
                optimizer.n_blocks,
                optimizer.dt_minutes,
            )
            target_series = self._build_target_series(
                optimizer.n_blocks,
                optimizer.dt_minutes,
            )
            plan = optimizer.optimize(
                self.current_humidity,
                forecast_series,
                target_series,
            )
            self.last_plan = plan
            if plan.actions:
                mode = plan.actions[0]
                power_fraction = plan.power_fractions[0] if plan.power_fractions else 1.0
                prehumidify = plan.prehumidify_blocks > 0 and mode != MODE_IDLE
        elif self.current_humidity is not None:
            mode, power_fraction = self._bang_bang_evaluate()
        else:
            # Managed mode (no external room humidity sensor, but humidifier.* entity has its own humidistat)
            if self.can_humidify and self.targets.humidify is not None:
                mode = MODE_HUMIDIFYING
                power_fraction = 1.0
            elif self.can_dehumidify and self.targets.dehumidify is not None:
                mode = MODE_DEHUMIDIFYING
                power_fraction = 1.0

        # Compute setpoints for humidifier.* / dehumidifier.* entities
        hum_eid = (self.room_config.get("humidifier_entity") or "").strip()
        dehum_eid = (self.room_config.get("dehumidifier_entity") or "").strip()

        hum_sp: int | None = None
        if hum_eid.startswith("humidifier.") and self.targets.humidify is not None:
            st = self.hass.states.get(hum_eid) if self.hass else None
            attrs = st.attributes if st else {}
            min_h = attrs.get("min_humidity", MIN_TARGET_HUMIDITY)
            max_h = attrs.get("max_humidity", MAX_TARGET_HUMIDITY)
            sp_mode = self.room_config.get("humidifier_setpoint_mode", "proportional")
            if not self.has_external_sensor:
                sp_mode = "direct"
            sp_offset = float(self.room_config.get("humidifier_setpoint_offset", 0.0) or 0.0)
            hum_sp = compute_humidifier_target_setpoint(
                mode=mode,
                power_fraction=power_fraction if mode == MODE_HUMIDIFYING else 0.0,
                current_humidity=self.current_humidity,
                targets=self.targets,
                setpoint_mode=sp_mode,
                setpoint_offset=sp_offset,
                min_humidity=min_h,
                max_humidity=max_h,
            )

        dehum_sp: int | None = None
        if dehum_eid.startswith("humidifier.") and self.targets.dehumidify is not None:
            st = self.hass.states.get(dehum_eid) if self.hass else None
            attrs = st.attributes if st else {}
            min_h = attrs.get("min_humidity", MIN_TARGET_HUMIDITY)
            max_h = attrs.get("max_humidity", MAX_TARGET_HUMIDITY)
            sp_mode = self.room_config.get("dehumidifier_setpoint_mode", "proportional")
            if not self.has_external_sensor:
                sp_mode = "direct"
            sp_offset = float(
                self.room_config.get("dehumidifier_setpoint_offset", 0.0) or 0.0
            )
            dehum_sp = compute_dehumidifier_target_setpoint(
                mode=mode,
                power_fraction=power_fraction if mode == MODE_DEHUMIDIFYING else 0.0,
                current_humidity=self.current_humidity,
                targets=self.targets,
                setpoint_mode=sp_mode,
                setpoint_offset=sp_offset,
                min_humidity=min_h,
                max_humidity=max_h,
            )

        return HumidityMPCControlResult(
            mode=mode,
            power_fraction=power_fraction,
            mpc_active=mpc_ready,
            prehumidify=prehumidify,
            humidifier_setpoint=hum_sp,
            dehumidifier_setpoint=dehum_sp,
            plan=plan,
            outdoor_rh_eq=outdoor_rh_eq,
            forecast_rh_eq_series=forecast_series,
        )
