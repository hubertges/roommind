"""MPC optimizer for humidity predictive control."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..const import MODE_DEHUMIDIFYING, MODE_HUMIDIFYING, MODE_IDLE, TargetHumidities
from .humidity_model import HumidityRCModel
from .mpc_optimizer import MIN_POWER_FRACTION

DEFAULT_HORIZON_HOURS = 2.0
DEFAULT_DT_MINUTES = 5.0
MAX_PREHUMIDIFY_MINUTES = 120.0
MAX_HORIZON_HOURS = 12.0


@dataclass
class HumidityMPCPlan:
    """Result of an MPC humidity optimization over a time horizon."""

    actions: list[str] = field(default_factory=list)
    humidities: list[float] = field(default_factory=list)
    dt_minutes: float = DEFAULT_DT_MINUTES
    power_fractions: list[float] = field(default_factory=list)
    lookahead_blocks: int = 0
    prehumidify_blocks: int = 0


def _prehumidify_deadline(
    humidify_target_series: list[float | None],
    model: HumidityRCModel,
    H_room: float,
    outdoor_rh_series: list[float],
    dt_minutes: float,
    max_prehumidify_minutes: float = MAX_PREHUMIDIFY_MINUTES,
    q_occupancy: float = 0.0,
) -> int | None:
    """Block index at which pre-humidifying must start for the next humidify-target jump."""
    first_h = next((h for h in humidify_target_series if h is not None), None)
    if first_h is None:
        return None
    jump_block = None
    jump_target = first_h
    for i, h in enumerate(humidify_target_series):
        if h is not None and h > first_h + 1.0:
            jump_block = i
            jump_target = h
            break
    if jump_block is None or H_room >= jump_target:
        return None

    h = H_room
    blocks_needed = len(humidify_target_series)
    for k in range(jump_block, len(humidify_target_series)):
        h = model.predict(
            h,
            outdoor_rh_series[k],
            Q_active=model.Q_humidify,
            dt_minutes=dt_minutes,
            q_occupancy=q_occupancy,
        )
        if h >= jump_target - 0.5:
            blocks_needed = k - jump_block + 1
            break

    max_prehumidify_blocks = max(1, int(max_prehumidify_minutes / dt_minutes))
    capped = min(blocks_needed, max_prehumidify_blocks)
    return max(0, jump_block - capped)


def _predehumidify_deadline(
    dehumidify_target_series: list[float | None],
    model: HumidityRCModel,
    H_room: float,
    outdoor_rh_series: list[float],
    dt_minutes: float,
    max_prehumidify_minutes: float = MAX_PREHUMIDIFY_MINUTES,
    q_occupancy: float = 0.0,
) -> int | None:
    """Block index at which pre-dehumidifying must start for the next dehumidify-target drop."""
    first_d = next((d for d in dehumidify_target_series if d is not None), None)
    if first_d is None:
        return None
    drop_block = None
    drop_target = first_d
    for i, d in enumerate(dehumidify_target_series):
        if d is not None and d < first_d - 1.0:
            drop_block = i
            drop_target = d
            break
    if drop_block is None or H_room <= drop_target:
        return None

    h = H_room
    blocks_needed = len(dehumidify_target_series)
    for k in range(drop_block, len(dehumidify_target_series)):
        h = model.predict(
            h,
            outdoor_rh_series[k],
            Q_active=-model.Q_dehumidify,
            dt_minutes=dt_minutes,
            q_occupancy=q_occupancy,
        )
        if h <= drop_target + 0.5:
            blocks_needed = k - drop_block + 1
            break

    max_predehumidify_blocks = max(1, int(max_prehumidify_minutes / dt_minutes))
    capped = min(blocks_needed, max_predehumidify_blocks)
    return max(0, drop_block - capped)


class HumidityMPCOptimizer:
    """Finite-horizon MPC optimizer for single-room humidity control.

    Minimizes over horizon N blocks of dt_minutes:
      sum_{k=0}^{N-1} [ w_comfort * comfort_error(H_{k+1}, target_k)^2
                       + w_energy * |u_k| / 100 ]
    """

    def __init__(
        self,
        model: HumidityRCModel,
        w_comfort: float = 10.0,
        w_energy: float = 1.0,
        dt_minutes: float = DEFAULT_DT_MINUTES,
        horizon_hours: float = DEFAULT_HORIZON_HOURS,
        can_humidify: bool = True,
        can_dehumidify: bool = False,
        q_occupancy: float = 0.0,
        prehumidify_max_minutes: float = MAX_PREHUMIDIFY_MINUTES,
    ) -> None:
        self.model = model
        self.w_comfort = w_comfort
        self.w_energy = w_energy
        self.dt_minutes = dt_minutes
        self.can_humidify = can_humidify
        self.can_dehumidify = can_dehumidify
        self.q_occupancy = q_occupancy
        self.prehumidify_max_minutes = prehumidify_max_minutes

        base_blocks = max(1, int(horizon_hours * 60.0 / dt_minutes))
        tau_hours = (model.C / model.U) / 60.0 if model.U > 0.005 else horizon_hours
        adaptive_hours = min(max(horizon_hours, 2 * tau_hours), MAX_HORIZON_HOURS)
        self.n_blocks = max(base_blocks, int(adaptive_hours * 60.0 / dt_minutes))

    def _available_actions(self) -> list[str]:
        actions = [MODE_IDLE]
        if self.can_humidify:
            actions.append(MODE_HUMIDIFYING)
        if self.can_dehumidify:
            actions.append(MODE_DEHUMIDIFYING)
        return actions

    def _action_to_Q(self, action: str) -> float:
        if action == MODE_HUMIDIFYING:
            return self.model.Q_humidify
        if action == MODE_DEHUMIDIFYING:
            return -self.model.Q_dehumidify
        return 0.0

    def _evaluate_candidate(
        self,
        actions: list[str],
        H_start: float,
        outdoor_series: list[float],
        target_series: list[TargetHumidities],
    ) -> tuple[float, list[float]]:
        """Evaluate total cost and trajectory for a candidate action sequence."""
        Qs = [self._action_to_Q(a) for a in actions]
        q_occ = [self.q_occupancy] * len(actions)
        humidities = self.model.predict_trajectory(
            H_start,
            outdoor_series,
            Qs,
            self.dt_minutes,
            q_occupancy_series=q_occ,
        )

        total_cost = 0.0
        for k, action in enumerate(actions):
            H_next = humidities[k + 1]
            t = target_series[k]

            if t.humidify is not None and H_next < t.humidify:
                comfort_cost = self.w_comfort * (H_next - t.humidify) ** 2
            elif t.dehumidify is not None and H_next > t.dehumidify:
                comfort_cost = self.w_comfort * (H_next - t.dehumidify) ** 2
            else:
                comfort_cost = 0.0

            Q = abs(self._action_to_Q(action))
            energy_cost = self.w_energy * (Q / 100.0) if Q > 0 else 0.0
            total_cost += comfort_cost + energy_cost

        return total_cost, humidities

    def compute_optimal_power(
        self,
        H_room: float,
        H_outdoor: float,
        target: TargetHumidities,
        dt_minutes: float | None = None,
        q_occupancy: float = 0.0,
    ) -> tuple[float, str]:
        """Compute analytical continuous power fraction for one timestep."""
        dt = dt_minutes if dt_minutes is not None else self.dt_minutes
        H_idle = self.model.predict(
            H_room,
            H_outdoor,
            0.0,
            dt,
            q_occupancy=q_occupancy,
        )

        h_target = target.humidify
        d_target = target.dehumidify

        if self.can_humidify and h_target is not None:
            H_full_hum = self.model.predict(
                H_room,
                H_outdoor,
                self.model.Q_humidify,
                dt,
                q_occupancy=q_occupancy,
            )
            delta_hum = H_full_hum - H_idle
        else:
            delta_hum = 0.0

        if self.can_dehumidify and d_target is not None:
            H_full_dehum = self.model.predict(
                H_room,
                H_outdoor,
                -self.model.Q_dehumidify,
                dt,
                q_occupancy=q_occupancy,
            )
            delta_dehum = H_idle - H_full_dehum
        else:
            delta_dehum = 0.0

        need_humidify = (
            self.can_humidify
            and h_target is not None
            and delta_hum > 1e-6
            and H_idle < h_target
        )
        need_dehumidify = (
            self.can_dehumidify
            and d_target is not None
            and delta_dehum > 1e-6
            and H_idle > d_target
        )

        if need_humidify and h_target is not None:
            energy_bias = (self.w_energy * self.model.Q_humidify) / (
                200.0 * self.w_comfort * delta_hum
            )
            p_star = (h_target - H_idle) / delta_hum - energy_bias
            if p_star <= 0.0:
                return 0.0, MODE_IDLE
            p_clamped = min(max(p_star, MIN_POWER_FRACTION), 1.0)
            return p_clamped, MODE_HUMIDIFYING

        if need_dehumidify and d_target is not None:
            energy_bias = (self.w_energy * self.model.Q_dehumidify) / (
                200.0 * self.w_comfort * delta_dehum
            )
            p_star = (H_idle - d_target) / delta_dehum - energy_bias
            if p_star <= 0.0:
                return 0.0, MODE_IDLE
            p_clamped = min(max(p_star, MIN_POWER_FRACTION), 1.0)
            return p_clamped, MODE_DEHUMIDIFYING

        return 0.0, MODE_IDLE

    def optimize(
        self,
        H_room: float,
        outdoor_series: list[float],
        target_series: list[TargetHumidities],
    ) -> HumidityMPCPlan:
        """Find optimal action sequence over the horizon."""
        N = self.n_blocks
        if not outdoor_series:
            outdoor_series = [50.0] * N
        elif len(outdoor_series) < N:
            outdoor_series = list(outdoor_series) + [outdoor_series[-1]] * (
                N - len(outdoor_series)
            )
        else:
            outdoor_series = list(outdoor_series[:N])

        if not target_series:
            target_series = [TargetHumidities()] * N
        elif len(target_series) < N:
            target_series = list(target_series) + [target_series[-1]] * (
                N - len(target_series)
            )
        else:
            target_series = list(target_series[:N])

        available = self._available_actions()
        if len(available) == 1:
            actions = [MODE_IDLE] * N
            _, humidities = self._evaluate_candidate(
                actions, H_room, outdoor_series, target_series
            )
            return HumidityMPCPlan(
                actions=actions,
                humidities=humidities,
                dt_minutes=self.dt_minutes,
                power_fractions=[0.0] * N,
                lookahead_blocks=1,
            )

        humidify_series = [t.humidify for t in target_series]
        dehumidify_series = [t.dehumidify for t in target_series]

        effective_targets = list(target_series)
        prehumidify_blocks = 0

        if self.can_humidify:
            ph_start = _prehumidify_deadline(
                humidify_series,
                self.model,
                H_room,
                outdoor_series,
                self.dt_minutes,
                max_prehumidify_minutes=self.prehumidify_max_minutes,
                q_occupancy=self.q_occupancy,
            )
            if ph_start is not None:
                first_h = next((h for h in humidify_series if h is not None), None)
                jump_block = next(
                    (
                        i
                        for i, h in enumerate(humidify_series)
                        if h is not None and first_h is not None and h > first_h + 1.0
                    ),
                    N,
                )
                jump_target = humidify_series[jump_block] if jump_block < N else first_h
                for i in range(N):
                    t = effective_targets[i]
                    if i < ph_start and first_h is not None:
                        effective_targets[i] = TargetHumidities(
                            humidify=first_h,
                            dehumidify=t.dehumidify,
                        )
                    elif ph_start <= i < jump_block and jump_target is not None:
                        effective_targets[i] = TargetHumidities(
                            humidify=jump_target,
                            dehumidify=t.dehumidify,
                        )
                        prehumidify_blocks += 1

        if self.can_dehumidify:
            pd_start = _predehumidify_deadline(
                dehumidify_series,
                self.model,
                H_room,
                outdoor_series,
                self.dt_minutes,
                max_prehumidify_minutes=self.prehumidify_max_minutes,
                q_occupancy=self.q_occupancy,
            )
            if pd_start is not None:
                first_d = next((d for d in dehumidify_series if d is not None), None)
                drop_block = next(
                    (
                        i
                        for i, d in enumerate(dehumidify_series)
                        if d is not None and first_d is not None and d < first_d - 1.0
                    ),
                    N,
                )
                drop_target = (
                    dehumidify_series[drop_block] if drop_block < N else first_d
                )
                for i in range(N):
                    t = effective_targets[i]
                    if i < pd_start and first_d is not None:
                        effective_targets[i] = TargetHumidities(
                            humidify=t.humidify,
                            dehumidify=first_d,
                        )
                    elif pd_start <= i < drop_block and drop_target is not None:
                        effective_targets[i] = TargetHumidities(
                            humidify=t.humidify,
                            dehumidify=drop_target,
                        )
                        prehumidify_blocks += 1

        actions = []
        power_fractions = []
        humidities = [H_room]
        h_curr = H_room

        for k in range(N):
            pf, mode = self.compute_optimal_power(
                h_curr,
                outdoor_series[k],
                effective_targets[k],
                dt_minutes=self.dt_minutes,
                q_occupancy=self.q_occupancy,
            )
            actions.append(mode)
            power_fractions.append(round(pf, 2))
            q_eff = self._action_to_Q(mode) * pf
            h_curr = self.model.predict(
                h_curr,
                outdoor_series[k],
                q_eff,
                self.dt_minutes,
                q_occupancy=self.q_occupancy,
            )
            humidities.append(h_curr)

        return HumidityMPCPlan(
            actions=actions,
            humidities=humidities,
            dt_minutes=self.dt_minutes,
            power_fractions=power_fractions,
            lookahead_blocks=N,
            prehumidify_blocks=prehumidify_blocks,
        )
