"""First-order RC moisture/humidity model with EKF parameter learning for RoomMind.

Physics: dH/dt = (Q_active - alpha * (H_room - H_outdoor_eq) + beta_o * q_occupancy)

where H_room is room relative humidity [% RH], H_outdoor_eq is the outdoor air's
equivalent relative humidity at the room's temperature (via absolute humidity conversion,
or outdoor_rh when temperatures are unavailable), and:
  alpha = moisture exchange / natural air change rate [1/h]
  beta_h = Q_humidify / C [% RH / h]  humidifying rate
  beta_d = Q_dehumidify / C [% RH / h]  dehumidifying rate (dehumidifier, AC dry, or drying ventilation)
  beta_o = Q_occupancy / C [% RH / h]  occupancy moisture gain rate

HumidityRCModel solves the ODE analytically over a time step.
HumidityEKF learns alpha, beta_h, beta_d, beta_o online from humidity measurements
using an Extended Kalman Filter with augmented state [H, alpha, beta_h, beta_d, beta_o].
RoomHumidityModelManager provides per-room model access for the coordinator and MPC controller.
"""

from __future__ import annotations

import logging
import math
import time

from ..utils.mold_utils import _A, _B, absolute_humidity
from .thermal_model import CONFIDENCE_HISTORY_DAYS, _load_history_entry

_LOGGER = logging.getLogger(__name__)


def equivalent_indoor_rh(
    indoor_temp: float | None,
    outdoor_temp: float | None,
    outdoor_rh: float | None,
    fallback_rh: float = 50.0,
) -> float:
    """Convert outdoor (T_out, RH_out) to equivalent % RH when warmed/cooled to indoor_temp.

    Natural infiltration and ventilation exchange air mass (absolute humidity g/m³).
    At indoor temperature T_in, outdoor air with absolute humidity AH_out has an
    equivalent relative humidity RH_eq = AH_out / AH_sat(T_in) * 100.
    Falls back to outdoor_rh if temperatures are unknown, or fallback_rh if outdoor_rh is unknown.
    """
    if outdoor_rh is None or not math.isfinite(outdoor_rh):
        return fallback_rh
    if indoor_temp is None or outdoor_temp is None or not (math.isfinite(indoor_temp) and math.isfinite(outdoor_temp)):
        return max(0.0, min(100.0, outdoor_rh))
    ah_out = absolute_humidity(outdoor_temp, outdoor_rh)
    e_sat_in = 6.112 * math.exp((_A * indoor_temp) / (_B + indoor_temp))
    ah_sat_in = 216.7 * e_sat_in / (273.15 + indoor_temp)
    if ah_sat_in <= 0:
        return max(0.0, min(100.0, outdoor_rh))
    return max(0.0, min(100.0, 100.0 * ah_out / ah_sat_in))


class HumidityRCModel:
    """First-order RC humidity model with analytical solution.

    Models a room's relative humidity H [% RH] relaxing towards an outdoor
    equivalent relative humidity H_out with rate U/C, driven by active
    humidifying (+Q) or dehumidifying (-Q) and occupancy moisture gain.
    """

    DEFAULT_C: float = 1.0
    DEFAULT_U: float = 0.25  # 1/h (~4 h moisture time constant)
    DEFAULT_Q_HUMIDIFY: float = 6.0  # % RH / h
    DEFAULT_Q_DEHUMIDIFY: float = 8.0  # % RH / h
    DEFAULT_Q_OCCUPANCY: float = 0.5  # % RH / h

    def __init__(
        self,
        C: float = DEFAULT_C,
        U: float = DEFAULT_U,
        Q_humidify: float = DEFAULT_Q_HUMIDIFY,
        Q_dehumidify: float = DEFAULT_Q_DEHUMIDIFY,
        Q_occupancy: float = DEFAULT_Q_OCCUPANCY,
    ) -> None:
        self.C = C
        self.U = U
        self.Q_humidify = Q_humidify
        self.Q_dehumidify = Q_dehumidify
        self.Q_occupancy = Q_occupancy

    # Compatibility aliases so generic optimizer/helpers can inspect Q_heat / Q_cool / Q_fast / Q_solar
    @property
    def Q_heat(self) -> float:
        return self.Q_humidify

    @property
    def Q_cool(self) -> float:
        return self.Q_dehumidify

    @property
    def Q_solar(self) -> float:
        return 0.0

    @property
    def Q_fast(self) -> float:
        return 0.0

    def predict(
        self,
        H_room: float,
        H_outdoor: float,
        Q_active: float,
        dt_minutes: float,
        *,
        q_occupancy: float = 0.0,
        q_solar: float = 0.0,
        q_residual: float = 0.0,
        q_rebound: float | None = None,
    ) -> float:
        """Predict room relative humidity [% RH] after *dt_minutes*."""
        if dt_minutes <= 0:
            return H_room
        dt_hours = dt_minutes / 60.0
        Q_total = Q_active + self.Q_occupancy * q_occupancy
        H_eq = H_outdoor + Q_total / self.U
        decay = math.exp(-self.U * dt_hours / self.C)
        result = H_eq + (H_room - H_eq) * decay
        return max(5.0, min(100.0, result))

    def predict_window_open(
        self,
        H_room: float,
        H_outdoor: float,
        k_window: float,
        dt_minutes: float,
    ) -> float:
        """Predict relative humidity with window open (amplified air exchange, Q=0)."""
        if dt_minutes <= 0:
            return H_room
        dt_hours = dt_minutes / 60.0
        U_eff = self.U * k_window
        H_eq = max(5.0, min(100.0, H_outdoor))
        decay = math.exp(-U_eff * dt_hours / self.C)
        result = H_eq + (H_room - H_eq) * decay
        return max(5.0, min(100.0, result))

    def predict_trajectory(
        self,
        H_room: float,
        H_outdoor_series: list[float],
        Q_active_series: list[float],
        dt_minutes: float,
        *,
        q_occupancy_series: list[float] | None = None,
    ) -> list[float]:
        """Predict a humidity trajectory over multiple time steps."""
        if len(H_outdoor_series) != len(Q_active_series):
            raise ValueError("H_outdoor_series and Q_active_series must have the same length")
        occupancy = q_occupancy_series or [0.0] * len(H_outdoor_series)
        trajectory = [H_room]
        H = H_room
        for i, (H_out, Q) in enumerate(zip(H_outdoor_series, Q_active_series, strict=False)):
            qo = occupancy[i] if i < len(occupancy) else 0.0
            H = self.predict(H, H_out, Q, dt_minutes, q_occupancy=qo)
            trajectory.append(H)
        return trajectory

    def to_dict(self) -> dict:
        return {
            "C": self.C,
            "U": self.U,
            "Q_humidify": self.Q_humidify,
            "Q_dehumidify": self.Q_dehumidify,
            "Q_occupancy": self.Q_occupancy,
        }

    @classmethod
    def from_dict(cls, data: dict) -> HumidityRCModel:
        return cls(
            C=max(0.1, data.get("C", cls.DEFAULT_C)),
            U=max(0.01, data.get("U", cls.DEFAULT_U)),
            Q_humidify=max(0.0, data.get("Q_humidify", cls.DEFAULT_Q_HUMIDIFY)),
            Q_dehumidify=max(0.0, data.get("Q_dehumidify", cls.DEFAULT_Q_DEHUMIDIFY)),
            Q_occupancy=max(0.0, data.get("Q_occupancy", cls.DEFAULT_Q_OCCUPANCY)),
        )

    def __repr__(self) -> str:
        return (
            f"HumidityRCModel(C={self.C:.2f}, U={self.U:.2f}, "
            f"Q_humidify={self.Q_humidify:.1f}, Q_dehumidify={self.Q_dehumidify:.1f}, "
            f"Q_occupancy={self.Q_occupancy:.1f})"
        )

    __hash__ = None  # type: ignore[assignment]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, HumidityRCModel):
            return NotImplemented
        return self.to_dict() == other.to_dict()


class HumidityEKF:
    """Extended Kalman Filter for 1R1C room humidity model.

    Augmented state vector x = [H, alpha, beta_h, beta_d, beta_o] where:
      H       = room relative humidity [% RH] (directly measured)
      alpha   = U/C  moisture exchange rate [1/h]
      beta_h  = Q_humidify/C  humidifying rate [% RH / h]
      beta_d  = Q_dehumidify/C  dehumidifying rate [% RH / h]
      beta_o  = Q_occupancy/C  occupancy moisture gain rate [% RH / h]
    """

    _ALPHA_SMALL: float = 0.01
    _ANOMALY_SIGMA: float = 4.0
    _ANOMALY_R_INFLATE: float = 100.0

    # Parameter bounds
    _ALPHA_MIN: float = 0.01
    _ALPHA_MAX: float = 3.0
    _BETA_H_MIN: float = 0.2
    _BETA_H_MAX: float = 150.0
    _BETA_D_MIN: float = 0.2
    _BETA_D_MAX: float = 150.0
    _BETA_O_MIN: float = 0.0
    _BETA_O_MAX: float = 30.0

    # Default initial parameter values
    _DEFAULT_ALPHA: float = 0.25
    _DEFAULT_BETA_H: float = 6.0
    _DEFAULT_BETA_D: float = 8.0
    _DEFAULT_BETA_O: float = 0.5

    # Process noise
    _Q_H: float = 0.25  # (~0.5 % RH / step)
    _Q_ALPHA: float = 0.001
    _Q_BETA_H: float = 0.02
    _Q_BETA_D: float = 0.02
    _Q_BETA_O: float = 0.005

    # Measurement noise (1.0 % RH std -> R = 1.0)
    _R: float = 1.0

    # Initial covariance diagonal
    _P_INIT_H: float = 4.0
    _P_INIT_ALPHA: float = 0.5
    _P_INIT_BETA: float = 100.0
    _P_INIT_BETA_O: float = 20.0

    # Window-open moisture exchange multiplier
    _K_WINDOW_DEFAULT: float = 5.0
    _K_WINDOW_MIN: float = 1.5
    _K_WINDOW_MAX: float = 50.0
    _K_WINDOW_EMA_ALPHA: float = 0.05
    _K_WINDOW_MIN_DT: float = 0.25
    _K_WINDOW_MIN_DELTA_H: float = 1.0

    _N: int = 5

    def __init__(self, H_init: float = 50.0) -> None:
        self._x: list[float] = [
            H_init,
            self._DEFAULT_ALPHA,
            self._DEFAULT_BETA_H,
            self._DEFAULT_BETA_D,
            self._DEFAULT_BETA_O,
        ]
        diag = self._p_init_diag()
        self._P: list[list[float]] = [[diag[i] if i == j else 0.0 for j in range(self._N)] for i in range(self._N)]
        self._n_updates: int = 0
        self._last_update_at: float | None = None
        self._n_humidifying: int = 0
        self._n_dehumidifying: int = 0
        self._n_idle: int = 0
        self._applicable_modes: set[str] = {"humidifying", "dehumidifying", "idle"}
        self._last_mode: str | None = None
        self._initialized: bool = False
        self._k_window: float = self._K_WINDOW_DEFAULT
        self._k_window_n: int = 0
        self._confidence_history: list[list] = []
        self._err_day: str | None = None
        self._err_sum: float = 0.0
        self._err_n: int = 0
        self._excited: list[bool] = [True] * self._N

    @classmethod
    def _p_init_diag(cls) -> list[float]:
        return [
            cls._P_INIT_H,
            cls._P_INIT_ALPHA,
            cls._P_INIT_BETA,
            cls._P_INIT_BETA,
            cls._P_INIT_BETA_O,
        ]

    @property
    def confidence(self) -> float:
        """Model reliability, 0.0 to 1.0."""
        if self._n_updates < 3:
            return 0.0

        idle_frac = min(self._n_idle / 60.0, 1.0)
        active_fracs: list[float] = []
        if self._n_humidifying >= 2:
            active_fracs.append(min(self._n_humidifying / 20.0, 1.0))
        if self._n_dehumidifying >= 2:
            active_fracs.append(min(self._n_dehumidifying / 20.0, 1.0))
        active_frac = sum(active_fracs) / len(active_fracs) if active_fracs else 0.0

        data_factor = 0.5 * idle_frac + 0.5 * active_frac

        noise_floor = 0.8
        mpc_threshold = 2.0  # % RH MPC activation threshold

        std_weights: list[tuple[int, float]] = [
            (max(self._n_idle, 1), self.prediction_std(0.0, 50.0, 40.0, 5.0)),
        ]
        if self._n_humidifying >= 2:
            std_weights.append((self._n_humidifying, self.prediction_std(self._x[2], 40.0, 30.0, 5.0)))
        if self._n_dehumidifying >= 2:
            std_weights.append((self._n_dehumidifying, self.prediction_std(-self._x[3], 65.0, 55.0, 5.0)))
        total_w = sum(w for w, _ in std_weights)
        weighted_std = sum(w / total_w * s for w, s in std_weights)

        if weighted_std <= noise_floor:
            accuracy_factor = 1.0
        elif weighted_std >= mpc_threshold:
            accuracy_factor = 0.0
        else:
            accuracy_factor = 1.0 - (weighted_std - noise_floor) / (mpc_threshold - noise_floor)

        return data_factor * (0.3 + 0.7 * accuracy_factor)

    def prediction_std(
        self,
        Q_active: float,
        H_room: float,
        H_outdoor: float,
        dt_minutes: float,
        *,
        q_occupancy: float = 0.0,
    ) -> float:
        """Prediction uncertainty in % RH for a given operating point."""
        if dt_minutes <= 0:
            return math.sqrt(max(self._P[0][0], 0.0))

        mode = "idle"
        if Q_active > 0:
            mode = "humidifying"
        elif Q_active < 0:
            mode = "dehumidifying"

        dt_h = dt_minutes / 60.0
        alpha = self._x[1]
        u = self._mode_to_u(mode)
        F = self._compute_jacobian(
            H_room,
            alpha,
            u,
            H_outdoor,
            dt_h,
            mode,
            q_occupancy=q_occupancy,
        )

        FP_row = [sum(F[0][k] * self._P[k][j] for k in range(self._N)) for j in range(self._N)]
        var = sum(FP_row[j] * F[0][j] for j in range(self._N))
        var += self._Q_H
        return math.sqrt(max(var, 0.0))

    @property
    def k_window(self) -> float:
        return self._k_window

    def update_window_open(
        self,
        H_measured: float,
        H_outdoor: float,
        dt_minutes: float,
        *,
        learn_k_window: bool = True,
    ) -> None:
        if dt_minutes < self._K_WINDOW_MIN_DT:
            return
        if not self._initialized:
            self._x[0] = H_measured
            self._initialized = True
            return

        H_prev = self._x[0]
        delta_H = H_prev - H_outdoor

        if not learn_k_window or abs(delta_H) < self._K_WINDOW_MIN_DELTA_H:
            self._x[0] = H_measured
            return

        dt_h = dt_minutes / 60.0
        ratio = (H_measured - H_outdoor) / delta_H
        if ratio <= 0.01 or ratio >= 1.0:
            self._x[0] = H_measured
            return

        alpha_obs = -math.log(ratio) / dt_h
        alpha_normal = max(self._x[1], self._ALPHA_SMALL)
        k_obs = max(self._K_WINDOW_MIN, min(self._K_WINDOW_MAX, alpha_obs / alpha_normal))

        if self._k_window_n == 0:
            self._k_window = k_obs
        else:
            ema = self._K_WINDOW_EMA_ALPHA
            self._k_window = ema * k_obs + (1.0 - ema) * self._k_window

        self._k_window_n += 1
        self._k_window = max(self._K_WINDOW_MIN, min(self._K_WINDOW_MAX, self._k_window))
        self._x[0] = H_measured

    def set_applicable_modes(self, can_humidify: bool, can_dehumidify: bool) -> None:
        modes = {"idle"}
        if can_humidify:
            modes.add("humidifying")
        if can_dehumidify:
            modes.add("dehumidifying")
        self._applicable_modes = modes

    def update(
        self,
        H_measured: float,
        H_outdoor: float,
        mode: str,
        dt_minutes: float,
        *,
        power_fraction: float = 1.0,
        q_occupancy: float = 0.0,
    ) -> None:
        """Run one full EKF cycle: predict then update with measurement."""
        if dt_minutes <= 0:
            return

        if not self._initialized:
            self._x[0] = H_measured
            self._initialized = True
            self._last_mode = mode
            return

        predict_mode = mode
        dt_h = dt_minutes / 60.0

        self._predict_step(
            H_outdoor,
            predict_mode,
            dt_h,
            power_fraction=power_fraction,
            q_occupancy=q_occupancy,
        )
        self._update_step(H_measured)
        self._clamp_parameters()
        self._enforce_psd()

        self._last_mode = mode
        self._n_updates += 1
        self._last_update_at = time.time()
        if predict_mode == "humidifying":
            self._n_humidifying += 1
        elif predict_mode == "dehumidifying":
            self._n_dehumidifying += 1
        else:
            self._n_idle += 1

    def sync_humidity(self, H_measured: float) -> None:
        """Set the humidity state to a measurement without learning from the jump."""
        self._x[0] = H_measured
        self._initialized = True

    def get_model(self) -> HumidityRCModel:
        return HumidityRCModel(
            C=1.0,
            U=max(self._x[1], self._ALPHA_MIN),
            Q_humidify=max(self._x[2], 0.0),
            Q_dehumidify=max(self._x[3], 0.0),
            Q_occupancy=max(self._x[4], 0.0),
        )

    def _mode_to_u(self, mode: str) -> float:
        if mode == "humidifying":
            return self._x[2]
        if mode == "dehumidifying":
            return -self._x[3]
        return 0.0

    def _state_transition(self, H: float, alpha: float, u: float, H_out: float, dt_h: float) -> float:
        if abs(alpha) < self._ALPHA_SMALL:
            return H + dt_h * (u - alpha * (H - H_out))
        H_eq = H_out + u / alpha
        decay = math.exp(-alpha * dt_h)
        return H_eq + (H - H_eq) * decay

    def _compute_jacobian(
        self,
        H: float,
        alpha: float,
        u: float,
        H_out: float,
        dt_h: float,
        mode: str,
        *,
        power_fraction: float = 1.0,
        q_occupancy: float = 0.0,
    ) -> list[list[float]]:
        N = self._N
        F: list[list[float]] = [[0.0] * N for _ in range(N)]
        for i in range(1, N):
            F[i][i] = 1.0

        if abs(alpha) < self._ALPHA_SMALL:
            F[0][0] = 1.0 - alpha * dt_h
            F[0][1] = -(H - H_out) * dt_h
            if mode == "humidifying":
                F[0][2] = power_fraction * dt_h
            elif mode == "dehumidifying":
                F[0][3] = -power_fraction * dt_h
            F[0][4] = q_occupancy * dt_h
        else:
            decay = math.exp(-alpha * dt_h)
            one_minus_decay = 1.0 - decay
            F[0][0] = decay
            F[0][1] = -(u / (alpha * alpha)) * one_minus_decay - (H - H_out - u / alpha) * dt_h * decay
            if mode == "humidifying":
                F[0][2] = power_fraction * (1.0 / alpha) * one_minus_decay
            elif mode == "dehumidifying":
                F[0][3] = -power_fraction * (1.0 / alpha) * one_minus_decay
            F[0][4] = q_occupancy * (1.0 / alpha) * one_minus_decay
        return F

    def _predict_step(
        self,
        H_outdoor: float,
        mode: str,
        dt_h: float,
        *,
        power_fraction: float = 1.0,
        q_occupancy: float = 0.0,
    ) -> None:
        H, alpha, beta_h, beta_d, beta_o = self._x
        u_active = self._mode_to_u(mode) * power_fraction
        u = u_active + beta_o * q_occupancy

        H_new = self._state_transition(H, alpha, u, H_outdoor, dt_h)
        self._x = [H_new, alpha, beta_h, beta_d, beta_o]

        F = self._compute_jacobian(
            H,
            alpha,
            u,
            H_outdoor,
            dt_h,
            mode,
            power_fraction=power_fraction,
            q_occupancy=q_occupancy,
        )
        self._excited = [True, True] + [F[0][i] != 0.0 for i in range(2, self._N)]

        N = self._N
        P = self._P
        alpha_ratio = max(alpha, self._ALPHA_MIN) / self._DEFAULT_ALPHA
        q_alpha = self._Q_ALPHA * min(1.0, alpha_ratio * alpha_ratio)
        Q = [
            self._Q_H,
            q_alpha,
            self._Q_BETA_H if mode == "humidifying" else 0.0,
            self._Q_BETA_D if mode == "dehumidifying" else 0.0,
            self._Q_BETA_O if q_occupancy > 0 else 0.0,
        ]

        FP = [[sum(F[i][k] * P[k][j] for k in range(N)) for j in range(N)] for i in range(N)]
        P_new = [[0.0] * N for _ in range(N)]
        for i in range(N):
            for j in range(N):
                P_new[i][j] = sum(FP[i][k] * F[j][k] for k in range(N))
                if i == j:
                    P_new[i][j] += Q[i]

        self._P = P_new

    def _update_step(self, H_measured: float) -> None:
        N = self._N
        P = self._P

        y_pred = self._x[0]
        innovation = H_measured - y_pred
        S = P[0][0] + self._R

        R_eff = self._R
        outlier = False
        if S > 0:
            norm_innov = abs(innovation) / math.sqrt(S)
            if norm_innov > self._ANOMALY_SIGMA:
                outlier = True
                R_eff = self._R * self._ANOMALY_R_INFLATE
                S = P[0][0] + R_eff
        if not outlier:
            self._err_sum += abs(innovation)
            self._err_n += 1

        if S < 1e-12:
            return

        K = [P[i][0] / S if self._excited[i] else 0.0 for i in range(N)]
        for i in range(N):
            self._x[i] += K[i] * innovation

        P_new = [
            [P[i][j] - K[i] * P[0][j] - P[i][0] * K[j] + K[i] * (P[0][0] + 2.0 * R_eff) * K[j] for j in range(N)]
            for i in range(N)
        ]
        self._P = P_new

    def _clamp_parameters(self) -> None:
        self._x[1] = max(self._ALPHA_MIN, min(self._ALPHA_MAX, self._x[1]))
        self._x[2] = max(self._BETA_H_MIN, min(self._BETA_H_MAX, self._x[2]))
        self._x[3] = max(self._BETA_D_MIN, min(self._BETA_D_MAX, self._x[3]))
        self._x[4] = max(self._BETA_O_MIN, min(self._BETA_O_MAX, self._x[4]))

    def _enforce_psd(self) -> None:
        N = self._N
        P = self._P
        for i in range(N):
            for j in range(i + 1, N):
                avg = (P[i][j] + P[j][i]) / 2.0
                P[i][j] = avg
                P[j][i] = avg
        for i in range(N):
            if P[i][i] < 1e-10:
                P[i][i] = 1e-10

    @property
    def confidence_history(self) -> list[list]:
        return [list(entry) for entry in self._confidence_history]

    def _day_error(self) -> tuple[float | None, int]:
        if self._err_n == 0:
            return None, 0
        return round(self._err_sum / self._err_n, 4), self._err_n

    def note_confidence_day(self, day: str, mpc_active: bool) -> None:
        history = self._confidence_history
        if self._err_day is not None and self._err_day != day:
            if history and history[-1][0] == self._err_day:
                history[-1][4:6] = self._day_error()
            self._err_sum = 0.0
            self._err_n = 0
        self._err_day = day
        entry = [day, round(self.confidence, 3), self._n_updates, bool(mpc_active), *self._day_error()]
        if history and history[-1][0] == day:
            history[-1] = entry
        elif not history or history[-1][0] < day:
            history.append(entry)
            del history[: max(0, len(history) - CONFIDENCE_HISTORY_DAYS)]

    def boost_covariance(self, factor: float = 2.5) -> None:
        p_init = self._p_init_diag()
        scale = [1.0]
        for i in range(1, self._N):
            var = self._P[i][i]
            target = min(var * factor, p_init[i])
            scale.append(math.sqrt(target / var) if var > 0 and target > var else 1.0)
        self._P = [[self._P[i][j] * scale[i] * scale[j] for j in range(self._N)] for i in range(self._N)]
        self._enforce_psd()

    def to_dict(self) -> dict:
        return {
            "ekf_version": 1,
            "x": list(self._x),
            "P": [list(row) for row in self._P],
            "n_updates": self._n_updates,
            "last_update_at": self._last_update_at,
            "n_humidifying": self._n_humidifying,
            "n_dehumidifying": self._n_dehumidifying,
            "n_idle": self._n_idle,
            "applicable_modes": sorted(self._applicable_modes),
            "last_mode": self._last_mode,
            "initialized": self._initialized,
            "k_window": self._k_window,
            "k_window_n": self._k_window_n,
            "confidence_history": self.confidence_history,
            "forecast_error": {"day": self._err_day, "sum": self._err_sum, "n": self._err_n},
        }

    @classmethod
    def from_dict(cls, data: dict) -> HumidityEKF:
        ekf = cls()
        x = data.get("x")
        if isinstance(x, list) and len(x) == cls._N:
            ekf._x = [float(v) for v in x]
        P = data.get("P")
        if isinstance(P, list) and len(P) == cls._N and all(len(row) == cls._N for row in P):
            ekf._P = [[float(v) for v in row] for row in P]
        ekf._n_updates = data.get("n_updates", 0)
        last_update_at = data.get("last_update_at")
        ekf._last_update_at = float(last_update_at) if isinstance(last_update_at, (int, float)) else None
        ekf._n_humidifying = data.get("n_humidifying", 0)
        ekf._n_dehumidifying = data.get("n_dehumidifying", 0)
        ekf._n_idle = data.get("n_idle", 0)
        if "applicable_modes" in data:
            ekf._applicable_modes = set(data["applicable_modes"])
        ekf._last_mode = data.get("last_mode")
        ekf._initialized = data.get("initialized", ekf._n_updates > 0)
        ekf._k_window = data.get("k_window", cls._K_WINDOW_DEFAULT)
        ekf._k_window_n = data.get("k_window_n", 0)
        history = data.get("confidence_history")
        if isinstance(history, list):
            ekf._confidence_history = [
                _load_history_entry(e)
                for e in history
                if isinstance(e, list) and len(e) >= 4 and isinstance(e[0], str) and isinstance(e[1], (int, float))
            ][-CONFIDENCE_HISTORY_DAYS:]
        err = data.get("forecast_error")
        if (
            isinstance(err, dict)
            and isinstance(err.get("day"), str)
            and isinstance(err.get("sum"), (int, float))
            and isinstance(err.get("n"), int)
        ):
            ekf._err_day = err["day"]
            ekf._err_sum = float(err["sum"])
            ekf._err_n = err["n"]
        ekf._clamp_parameters()
        return ekf

    def __repr__(self) -> str:
        return (
            f"HumidityEKF(H={self._x[0]:.1f}, alpha={self._x[1]:.2f}, "
            f"beta_h={self._x[2]:.1f}, beta_d={self._x[3]:.1f}, beta_o={self._x[4]:.1f}, "
            f"confidence={self.confidence:.2f}, n={self._n_updates})"
        )


class RoomHumidityModelManager:
    """Manages per-room HumidityEKF instances."""

    def __init__(self) -> None:
        self._estimators: dict[str, HumidityEKF] = {}

    def get_room_ids(self) -> list[str]:
        return list(self._estimators.keys())

    def get_estimator(self, area_id: str) -> HumidityEKF:
        if area_id not in self._estimators:
            self._estimators[area_id] = HumidityEKF()
        return self._estimators[area_id]

    def update(
        self,
        area_id: str,
        H_new: float,
        H_outdoor: float,
        mode: str,
        dt_minutes: float,
        *,
        can_humidify: bool = True,
        can_dehumidify: bool = True,
        power_fraction: float = 1.0,
        q_occupancy: float = 0.0,
    ) -> None:
        est = self.get_estimator(area_id)
        est.set_applicable_modes(can_humidify, can_dehumidify)
        est.update(
            H_new,
            H_outdoor,
            mode,
            dt_minutes,
            power_fraction=power_fraction,
            q_occupancy=q_occupancy,
        )

    def predict(
        self,
        area_id: str,
        H_room: float,
        H_outdoor: float,
        Q_active: float,
        dt_minutes: float,
    ) -> float:
        return self.get_estimator(area_id).get_model().predict(H_room, H_outdoor, Q_active, dt_minutes)

    def get_model(self, area_id: str) -> HumidityRCModel:
        return self.get_estimator(area_id).get_model()

    def get_confidence(self, area_id: str) -> float:
        if area_id not in self._estimators:
            return 0.0
        return self._estimators[area_id].confidence

    def get_prediction_std(
        self,
        area_id: str,
        Q_active: float,
        H_room: float,
        H_outdoor: float,
        dt_minutes: float,
        *,
        q_occupancy: float = 0.0,
    ) -> float:
        if area_id not in self._estimators:
            return float("inf")
        return self._estimators[area_id].prediction_std(
            Q_active,
            H_room,
            H_outdoor,
            dt_minutes,
            q_occupancy=q_occupancy,
        )

    def get_mode_counts(self, area_id: str) -> tuple[int, int, int]:
        """Return (n_idle, n_humidifying, n_dehumidifying) for *area_id*."""
        if area_id not in self._estimators:
            return (0, 0, 0)
        est = self._estimators[area_id]
        return (est._n_idle, est._n_humidifying, est._n_dehumidifying)

    def get_n_observations(self, area_id: str) -> int:
        est = self._estimators.get(area_id)
        return est._n_updates if est else 0

    def sync_humidity(self, area_id: str, H_measured: float) -> None:
        self.get_estimator(area_id).sync_humidity(H_measured)

    def update_window_open(
        self,
        area_id: str,
        H_new: float,
        H_outdoor: float,
        dt_minutes: float,
        *,
        learn_k_window: bool = True,
    ) -> None:
        est = self.get_estimator(area_id)
        est.update_window_open(H_new, H_outdoor, dt_minutes, learn_k_window=learn_k_window)

    def predict_window_open(
        self,
        area_id: str,
        H_room: float,
        H_outdoor: float,
        dt_minutes: float,
    ) -> float:
        est = self.get_estimator(area_id)
        return est.get_model().predict_window_open(H_room, H_outdoor, est.k_window, dt_minutes)

    def get_k_window(self, area_id: str) -> float:
        if area_id not in self._estimators:
            return HumidityEKF._K_WINDOW_DEFAULT
        return self._estimators[area_id].k_window

    def boost_learning(self, area_id: str) -> int | None:
        est = self._estimators.get(area_id)
        if est is None:
            return None
        est.boost_covariance()
        return est._n_updates

    def remove_room(self, area_id: str) -> None:
        self._estimators.pop(area_id, None)

    def to_dict(self) -> dict:
        return {area_id: est.to_dict() for area_id, est in self._estimators.items()}

    @classmethod
    def from_dict(cls, data: dict) -> RoomHumidityModelManager:
        mgr = cls()
        for area_id, est_data in data.items():
            if isinstance(est_data, dict):
                mgr._estimators[area_id] = HumidityEKF.from_dict(est_data)
        return mgr

    def __repr__(self) -> str:
        rooms = ", ".join(f"{aid}({e.confidence:.0%})" for aid, e in self._estimators.items())
        return f"RoomHumidityModelManager([{rooms}])"
