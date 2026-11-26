"""Online thermal & combustion predictive model (Boiler MPC) for RoomMind heat plants.

Learns per-boiler dynamics from real temperature, feeder, flue, radiator, and refill observations:
- Heat-up rate (dT/dt during active firing, °C/h)
- Standby / cooling loss rate (dT/dt during hold/idle, °C/h)
- Effective combustion efficiency (%, via Siegert stack loss + hydraulic balance)
- Learned burn rate (kg/h and kg/24h) and weather-dependent load slope (kg/24h per K outdoor ΔT)
- Distribution heat loss factor (% of heat lost between boiler supply and radiator sensors)
- Refill calibration factor (actual refilled kg vs. integrated sensor/estimated kg)
- Weather-compensated optimal supply temperature recommendation (heating curve)
- One-step supply temperature prediction MAE & model confidence (0.0 – 1.0)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# Minimum samples for stage milestones (mirrors room MPC UX)
BOILER_MIN_OBSERVATIONS = 20
BOILER_MIN_HEATING_SAMPLES = 8
BOILER_MIN_HOLD_SAMPLES = 6
BOILER_MAX_TEMP_MAE = 2.5  # °C threshold for full accuracy confidence


@dataclass
class BoilerThermalModel:
    """Online exponential-moving-average + EKF-style estimator for a single boiler/heat plant."""

    n_observations: int = 0
    n_heating: int = 0
    n_hold: int = 0
    n_idle: int = 0
    last_update_at: float | None = None

    # Learned thermal rates
    heat_up_rate_c_per_h: float = 18.0  # °C/h supply rise under firing
    cool_down_rate_c_per_h: float = 4.5  # °C/h supply drop when idle/hold
    n_heat_up: int = 0
    n_cool_down: int = 0

    # Learned combustion & efficiency
    learned_efficiency_pct: float = 85.0
    n_efficiency: int = 0
    learned_burn_rate_kg_h: float = 0.0
    learned_burn_rate_kg_24h: float = 0.0
    learned_thermal_kw: float = 0.0
    learned_delta_t_k: float = 0.0
    n_delta_t: int = 0

    # Weather-load sensitivity: kg/24h per K of (20°C - T_outdoor)
    kg_per_day_per_k: float = 0.8
    n_weather: int = 0

    # Distribution pipe heat loss (boiler -> radiators)
    learned_pipe_loss_pct: float = 0.0
    learned_pipe_drop_k: float = 0.0
    n_pipe_loss: int = 0

    # Self-calibration from user-reported refills (actual_kg / estimated_kg)
    fuel_calibration_factor: float = 1.0
    refill_avg_kg_24h: float | None = None
    n_refills: int = 0

    # Prediction accuracy tracking (supply temp 1-step error)
    temp_mae_c: float | None = None
    temp_bias_c: float | None = None
    n_pred_errors: int = 0

    # Last observation for finite-difference dT/dt and 1-step prediction verification
    last_supply_temp: float | None = None
    last_obs_ts: float | None = None
    last_predicted_supply: float | None = None

    # Recent refill calibration records (capped at 20)
    refill_history: list[dict[str, Any]] = field(default_factory=list)

    @property
    def confidence(self) -> float:
        """Return model reliability in [0.0, 1.0] based on data coverage and prediction error."""
        if self.n_observations < 3:
            return 0.0

        obs_frac = min(1.0, self.n_observations / 60.0)
        heat_frac = min(1.0, self.n_heating / 15.0)
        hold_frac = min(1.0, (self.n_hold + self.n_idle) / 15.0)
        data_factor = 0.4 * obs_frac + 0.35 * heat_frac + 0.25 * hold_frac

        if self.temp_mae_c is not None and self.n_pred_errors >= 3:
            noise_floor = 0.4
            if self.temp_mae_c <= noise_floor:
                acc = 1.0
            elif self.temp_mae_c >= BOILER_MAX_TEMP_MAE:
                acc = 0.1
            else:
                acc = 1.0 - 0.9 * (self.temp_mae_c - noise_floor) / (BOILER_MAX_TEMP_MAE - noise_floor)
        else:
            acc = 0.45

        return round(max(0.0, min(1.0, data_factor * (0.3 + 0.7 * acc))), 3)

    @property
    def mpc_ready(self) -> bool:
        """True once the boiler model has enough observations and accuracy for active MPC advice."""
        return (
            self.n_observations >= BOILER_MIN_OBSERVATIONS
            and self.n_heating >= BOILER_MIN_HEATING_SAMPLES
            and (self.temp_mae_c is None or self.temp_mae_c < BOILER_MAX_TEMP_MAE)
        )

    def predict_next_supply_temp(
        self,
        supply_temp: float,
        target_supply_temp: float,
        dt_hours: float,
        is_heating: bool,
        in_fire_hold: bool,
    ) -> float:
        """Predict boiler supply temperature after *dt_hours* using learned heat-up/cool-down rates."""
        if dt_hours <= 0:
            return supply_temp
        if is_heating:
            diff = target_supply_temp - supply_temp
            if diff > 0:
                step = min(diff, self.heat_up_rate_c_per_h * dt_hours)
                return supply_temp + step
            # Slight relaxation back toward target if above target
            step = min(-diff, self.cool_down_rate_c_per_h * 0.5 * dt_hours)
            return supply_temp - step
        if in_fire_hold:
            diff = target_supply_temp - supply_temp
            rate = self.cool_down_rate_c_per_h * 0.6 if diff < 0 else self.heat_up_rate_c_per_h * 0.2
            step = math.copysign(min(abs(diff), rate * dt_hours), diff)
            return supply_temp + step
        # Idle cooling toward ambient 20°C
        cool = min(max(0.0, supply_temp - 20.0), self.cool_down_rate_c_per_h * dt_hours)
        return supply_temp - cool

    def recommend_supply_temp(
        self,
        outdoor_temp: float | None,
        configured_target: float,
        idle_temp: float,
        min_temp: float = 42.0,
        max_temp: float = 75.0,
        demanding_rooms_count: int = 0,
        max_room_power_pct: float = 0.0,
    ) -> float:
        """Compute weather-compensated recommended boiler supply temperature (heating curve).

        Uses outdoor temperature + active room load + learned pipe heat loss compensation.
        """
        if demanding_rooms_count <= 0:
            return round(max(min_temp, idle_temp), 1)

        if outdoor_temp is None or not math.isfinite(outdoor_temp):
            base = configured_target
        else:
            # Classic heating curve: at +15°C -> ~42°C, at 0°C -> ~55°C, at -15°C -> ~68°C
            # Anchored around configured_target at 0°C outdoor
            slope = 0.85  # K supply per K drop in outdoor temp
            base = configured_target + (0.0 - outdoor_temp) * slope

        # Load trim from room MPC demand intensity
        if max_room_power_pct > 75:
            base += 2.0
        elif max_room_power_pct < 30:
            base -= 2.0

        # Compensate slightly if significant pipe heat loss was measured (up to +4°C)
        if self.n_pipe_loss >= 3 and self.learned_pipe_drop_k > 2.0:
            base += min(4.0, (self.learned_pipe_drop_k - 2.0) * 0.5)

        return round(max(min_temp, min(max_temp, base)), 1)

    def update(
        self,
        *,
        now: float,
        supply_temp: float | None,
        target_supply_temp: float,
        return_temp: float | None,
        delta_t: float | None,
        thermal_kw: float,
        burn_rate_kg_h: float,
        real_efficiency_pct: float | None,
        is_heating: bool,
        in_fire_hold: bool,
        outdoor_temp: float | None = None,
        pipe_loss_pct: float | None = None,
        pipe_drop_k: float | None = None,
    ) -> None:
        """Ingest one telemetry cycle and update learned boiler dynamics."""
        self.n_observations += 1
        self.last_update_at = now
        if is_heating:
            self.n_heating += 1
        elif in_fire_hold:
            self.n_hold += 1
        else:
            self.n_idle += 1

        ema_fast = 0.12
        ema_slow = 0.06

        # 1. Update 1-step temperature prediction accuracy and thermal inertia rates
        if supply_temp is not None and math.isfinite(supply_temp):
            if self.last_supply_temp is not None and self.last_obs_ts is not None:
                dt_s = now - self.last_obs_ts
                if 30.0 <= dt_s <= 1800.0:
                    dt_h = dt_s / 3600.0
                    d_temp = supply_temp - self.last_supply_temp
                    rate_c_h = d_temp / dt_h

                    if self.last_predicted_supply is not None:
                        err = supply_temp - self.last_predicted_supply
                        abs_err = abs(err)
                        if abs_err < 25.0:  # ignore sensor glitches
                            if self.temp_mae_c is None:
                                self.temp_mae_c = abs_err
                                self.temp_bias_c = err
                            else:
                                a = 0.08
                                self.temp_mae_c = (1.0 - a) * self.temp_mae_c + a * abs_err
                                self.temp_bias_c = (1.0 - a) * (self.temp_bias_c or 0.0) + a * err
                            self.n_pred_errors += 1

                    # Learn heat-up rate when actively warming significantly
                    if is_heating and rate_c_h > 1.5 and rate_c_h < 120.0:
                        if self.n_heat_up == 0:
                            self.heat_up_rate_c_per_h = rate_c_h
                        else:
                            self.heat_up_rate_c_per_h = (
                                (1.0 - ema_fast) * self.heat_up_rate_c_per_h + ema_fast * rate_c_h
                            )
                        self.n_heat_up += 1
                    # Learn cool-down rate when cooling in hold/idle
                    elif not is_heating and rate_c_h < -0.5 and rate_c_h > -60.0:
                        cool_rate = -rate_c_h
                        if self.n_cool_down == 0:
                            self.cool_down_rate_c_per_h = cool_rate
                        else:
                            self.cool_down_rate_c_per_h = (
                                (1.0 - ema_fast) * self.cool_down_rate_c_per_h + ema_fast * cool_rate
                            )
                        self.n_cool_down += 1

            # Store prediction for next cycle
            self.last_predicted_supply = self.predict_next_supply_temp(
                supply_temp,
                target_supply_temp,
                dt_hours=3.0 / 60.0,
                is_heating=is_heating,
                in_fire_hold=in_fire_hold,
            )
            self.last_supply_temp = supply_temp
            self.last_obs_ts = now

        # 2. Learned real efficiency
        if real_efficiency_pct is not None and 25.0 <= real_efficiency_pct <= 105.0:
            if self.n_efficiency == 0:
                self.learned_efficiency_pct = real_efficiency_pct
            else:
                self.learned_efficiency_pct = (
                    (1.0 - ema_slow) * self.learned_efficiency_pct + ema_slow * real_efficiency_pct
                )
            self.n_efficiency += 1

        # 3. Learned ΔT
        if delta_t is not None and delta_t > 0.5 and delta_t < 40.0:
            if self.n_delta_t == 0:
                self.learned_delta_t_k = delta_t
            else:
                self.learned_delta_t_k = (1.0 - ema_slow) * self.learned_delta_t_k + ema_slow * delta_t
            self.n_delta_t += 1

        # 4. Learned burn rate & thermal power (EMA over active/hold operation)
        if burn_rate_kg_h >= 0:
            if self.n_observations <= 1:
                self.learned_burn_rate_kg_h = burn_rate_kg_h
                self.learned_thermal_kw = thermal_kw
            else:
                a = 0.05
                self.learned_burn_rate_kg_h = (1.0 - a) * self.learned_burn_rate_kg_h + a * burn_rate_kg_h
                self.learned_thermal_kw = (1.0 - a) * self.learned_thermal_kw + a * thermal_kw
            self.learned_burn_rate_kg_24h = self.learned_burn_rate_kg_h * 24.0

        # 5. Weather sensitivity (kg/24h per K below 20°C)
        if outdoor_temp is not None and math.isfinite(outdoor_temp) and burn_rate_kg_h > 0.02:
            hdd_k = max(2.0, 20.0 - outdoor_temp)
            obs_slope = (burn_rate_kg_h * 24.0) / hdd_k
            if 0.05 <= obs_slope <= 10.0:
                if self.n_weather == 0:
                    self.kg_per_day_per_k = obs_slope
                else:
                    self.kg_per_day_per_k = (1.0 - ema_slow) * self.kg_per_day_per_k + ema_slow * obs_slope
                self.n_weather += 1

        # 6. Distribution pipe heat loss (boiler -> radiators)
        if pipe_loss_pct is not None and pipe_drop_k is not None and pipe_drop_k >= 0:
            if self.n_pipe_loss == 0:
                self.learned_pipe_loss_pct = pipe_loss_pct
                self.learned_pipe_drop_k = pipe_drop_k
            else:
                self.learned_pipe_loss_pct = (
                    (1.0 - ema_slow) * self.learned_pipe_loss_pct + ema_slow * pipe_loss_pct
                )
                self.learned_pipe_drop_k = (
                    (1.0 - ema_slow) * self.learned_pipe_drop_k + ema_slow * pipe_drop_k
                )
            self.n_pipe_loss += 1

    def record_refill(
        self,
        *,
        now: float,
        kg: float,
        bags: float | None,
        estimated_burned_since_last_kg: float,
        last_refill_ts: float | None,
        filled_to_full: bool = False,
    ) -> None:
        """Record a user-reported refill (bags/kg) and calibrate the burn model."""
        if kg <= 0:
            return
        self.n_refills += 1

        # Calculate real daily burn rate from interval between refills when >= 4 hours elapsed
        real_kg_24h: float | None = None
        if last_refill_ts is not None and now > last_refill_ts:
            elapsed_h = (now - last_refill_ts) / 3600.0
            if 4.0 <= elapsed_h <= 24.0 * 60.0:
                real_kg_24h = (kg / elapsed_h) * 24.0
                if self.refill_avg_kg_24h is None:
                    self.refill_avg_kg_24h = real_kg_24h
                else:
                    self.refill_avg_kg_24h = 0.65 * self.refill_avg_kg_24h + 0.35 * real_kg_24h

        # Self-calibrate fuel factor when user topped up to full and we have an estimate > 2 kg
        if filled_to_full and estimated_burned_since_last_kg >= 2.0:
            ratio = kg / estimated_burned_since_last_kg
            # Clamp to plausible adjustment range per refill
            clamped = max(0.5, min(2.0, ratio))
            self.fuel_calibration_factor = max(
                0.4,
                min(2.5, 0.7 * self.fuel_calibration_factor + 0.3 * (self.fuel_calibration_factor * clamped)),
            )

        self.refill_history.append(
            {
                "ts": round(now, 1),
                "kg": round(kg, 2),
                "bags": round(bags, 2) if bags is not None else None,
                "estimated_burned_kg": round(estimated_burned_since_last_kg, 2),
                "real_kg_24h": round(real_kg_24h, 2) if real_kg_24h is not None else None,
                "filled_to_full": filled_to_full,
            }
        )
        if len(self.refill_history) > 20:
            self.refill_history = self.refill_history[-20:]

    def summary_dict(
        self,
        *,
        recommended_supply_temp: float | None = None,
        calorific_value_mj_kg: float = 26.0,
        usable_kwh_per_kg: float = 6.1,
        cost_per_kwh_thermal: float = 0.0,
        hours_until_refill: float | None = None,
        fuel_remaining_kg: float | None = None,
    ) -> dict[str, Any]:
        """Build analytics payload mirroring room MPC model_info."""
        return {
            "confidence": self.confidence,
            "mpc_active": self.mpc_ready,
            "n_observations": self.n_observations,
            "n_heating": self.n_heating,
            "n_hold": self.n_hold,
            "n_idle": self.n_idle,
            "last_update_at": self.last_update_at,
            "heat_up_rate_c_per_h": round(self.heat_up_rate_c_per_h, 1),
            "cool_down_rate_c_per_h": round(self.cool_down_rate_c_per_h, 1),
            "n_heat_up": self.n_heat_up,
            "n_cool_down": self.n_cool_down,
            "learned_efficiency_pct": round(self.learned_efficiency_pct, 1),
            "n_efficiency": self.n_efficiency,
            "learned_burn_rate_kg_h": round(self.learned_burn_rate_kg_h, 3),
            "learned_burn_rate_kg_24h": round(self.learned_burn_rate_kg_24h, 1),
            "learned_thermal_kw": round(self.learned_thermal_kw, 2),
            "learned_delta_t_k": round(self.learned_delta_t_k, 1),
            "n_delta_t": self.n_delta_t,
            "kg_per_day_per_k": round(self.kg_per_day_per_k, 2),
            "n_weather": self.n_weather,
            "learned_pipe_loss_pct": round(self.learned_pipe_loss_pct, 1),
            "learned_pipe_drop_k": round(self.learned_pipe_drop_k, 1),
            "n_pipe_loss": self.n_pipe_loss,
            "fuel_calibration_factor": round(self.fuel_calibration_factor, 3),
            "refill_avg_kg_24h": round(self.refill_avg_kg_24h, 1) if self.refill_avg_kg_24h is not None else None,
            "n_refills": self.n_refills,
            "temp_mae_c": round(self.temp_mae_c, 2) if self.temp_mae_c is not None else None,
            "temp_bias_c": round(self.temp_bias_c, 2) if self.temp_bias_c is not None else None,
            "n_pred_errors": self.n_pred_errors,
            "recommended_supply_temp": recommended_supply_temp,
            "calorific_value_mj_kg": round(calorific_value_mj_kg, 1),
            "usable_kwh_per_kg": round(usable_kwh_per_kg, 2),
            "cost_per_kwh_thermal": round(cost_per_kwh_thermal, 3),
            "hours_until_refill": hours_until_refill,
            "fuel_remaining_kg": fuel_remaining_kg,
            "refill_history": list(self.refill_history[-10:]),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_observations": self.n_observations,
            "n_heating": self.n_heating,
            "n_hold": self.n_hold,
            "n_idle": self.n_idle,
            "last_update_at": self.last_update_at,
            "heat_up_rate_c_per_h": round(self.heat_up_rate_c_per_h, 3),
            "cool_down_rate_c_per_h": round(self.cool_down_rate_c_per_h, 3),
            "n_heat_up": self.n_heat_up,
            "n_cool_down": self.n_cool_down,
            "learned_efficiency_pct": round(self.learned_efficiency_pct, 2),
            "n_efficiency": self.n_efficiency,
            "learned_burn_rate_kg_h": round(self.learned_burn_rate_kg_h, 4),
            "learned_burn_rate_kg_24h": round(self.learned_burn_rate_kg_24h, 3),
            "learned_thermal_kw": round(self.learned_thermal_kw, 3),
            "learned_delta_t_k": round(self.learned_delta_t_k, 3),
            "n_delta_t": self.n_delta_t,
            "kg_per_day_per_k": round(self.kg_per_day_per_k, 3),
            "n_weather": self.n_weather,
            "learned_pipe_loss_pct": round(self.learned_pipe_loss_pct, 2),
            "learned_pipe_drop_k": round(self.learned_pipe_drop_k, 2),
            "n_pipe_loss": self.n_pipe_loss,
            "fuel_calibration_factor": round(self.fuel_calibration_factor, 4),
            "refill_avg_kg_24h": round(self.refill_avg_kg_24h, 2) if self.refill_avg_kg_24h is not None else None,
            "n_refills": self.n_refills,
            "temp_mae_c": round(self.temp_mae_c, 3) if self.temp_mae_c is not None else None,
            "temp_bias_c": round(self.temp_bias_c, 3) if self.temp_bias_c is not None else None,
            "n_pred_errors": self.n_pred_errors,
            "refill_history": list(self.refill_history[-20:]),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> BoilerThermalModel:
        if not isinstance(data, dict):
            return cls()

        def _opt_float(k: str) -> float | None:
            v = data.get(k)
            return float(v) if isinstance(v, (int, float)) else None

        hist = data.get("refill_history")
        return cls(
            n_observations=int(data.get("n_observations", 0) or 0),
            n_heating=int(data.get("n_heating", 0) or 0),
            n_hold=int(data.get("n_hold", 0) or 0),
            n_idle=int(data.get("n_idle", 0) or 0),
            last_update_at=_opt_float("last_update_at"),
            heat_up_rate_c_per_h=float(data.get("heat_up_rate_c_per_h", 18.0) or 18.0),
            cool_down_rate_c_per_h=float(data.get("cool_down_rate_c_per_h", 4.5) or 4.5),
            n_heat_up=int(data.get("n_heat_up", 0) or 0),
            n_cool_down=int(data.get("n_cool_down", 0) or 0),
            learned_efficiency_pct=float(data.get("learned_efficiency_pct", 85.0) or 85.0),
            n_efficiency=int(data.get("n_efficiency", 0) or 0),
            learned_burn_rate_kg_h=float(data.get("learned_burn_rate_kg_h", 0.0) or 0.0),
            learned_burn_rate_kg_24h=float(data.get("learned_burn_rate_kg_24h", 0.0) or 0.0),
            learned_thermal_kw=float(data.get("learned_thermal_kw", 0.0) or 0.0),
            learned_delta_t_k=float(data.get("learned_delta_t_k", 0.0) or 0.0),
            n_delta_t=int(data.get("n_delta_t", 0) or 0),
            kg_per_day_per_k=float(data.get("kg_per_day_per_k", 0.8) or 0.8),
            n_weather=int(data.get("n_weather", 0) or 0),
            learned_pipe_loss_pct=float(data.get("learned_pipe_loss_pct", 0.0) or 0.0),
            learned_pipe_drop_k=float(data.get("learned_pipe_drop_k", 0.0) or 0.0),
            n_pipe_loss=int(data.get("n_pipe_loss", 0) or 0),
            fuel_calibration_factor=max(0.4, min(2.5, float(data.get("fuel_calibration_factor", 1.0) or 1.0))),
            refill_avg_kg_24h=_opt_float("refill_avg_kg_24h"),
            n_refills=int(data.get("n_refills", 0) or 0),
            temp_mae_c=_opt_float("temp_mae_c"),
            temp_bias_c=_opt_float("temp_bias_c"),
            n_pred_errors=int(data.get("n_pred_errors", 0) or 0),
            refill_history=[dict(x) for x in hist if isinstance(x, dict)][-20:] if isinstance(hist, list) else [],
        )
