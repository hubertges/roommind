/**
 * rs-analytics-heat-plants – Dedicated Boiler / Heat Plants Analytics tab view.
 *
 * Displays comprehensive boiler physics & combustion analytics:
 * - Active safety & efficiency warnings banner (burn-back, overheat, flue, fire-out, pipe loss)
 * - KPI summary strip (fuel burned & kg/24h, thermal energy produced vs delivered, pipe heat loss, fuel cost)
 * - Full Galmet eLider & boiler telemetry grid (supply/target/recommended, return + ΔT, CWU + CWU supply
 *   + circulation pump, flue + real Siegert efficiency, feeder temp, feeder work/pause cycle, blower %)
 * - Dedicated Pipe / Distribution Heat Loss card (boiler → radiators) with per-radiator comparison table
 * - Maintenance gauges (auto-calculated hopper level, continuous ash accumulation, chimney wear)
 * - Selected period statistics & full toggleable multi-series chart
 * - Full Boiler MPC model card (`<rs-analytics-boiler-model>`)
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  HeatPlantConfig,
  HeatPlantLive,
  HeatPlantHistoryPoint,
  HeatPlantType,
} from "../../types";
import { tokens } from "../../styles/tokens";
import { formatTempLocale, tempUnit } from "../../utils/temperature";
import { formatNumber } from "../../utils/format";
import { openEntityInfo } from "../../utils/events";
import "../shared/rs-list-card";
import "./rs-analytics-boiler-model";

@customElement("rs-analytics-heat-plants")
export class RsAnalyticsHeatPlants extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};
  @property({ attribute: false }) public heatPlantsHistory: Record<
    string,
    HeatPlantHistoryPoint[]
  > = {};
  @property({ attribute: false }) public outdoorTemp: number | null = null;
  @property({ type: Number }) public rangeStart = 0;
  @property({ type: Number }) public rangeEnd = 0;

  @state() private _selectedPlantId = "";
  @state() private _hiddenSeries = new Set<string>(["flue_temp", "blower_pct"]);

  private get _isPl(): boolean {
    return (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  protected willUpdate() {
    if (
      this.heatPlants.length > 0 &&
      (!this._selectedPlantId || !this.heatPlants.some((p) => p.id === this._selectedPlantId))
    ) {
      this._selectedPlantId = this.heatPlants[0].id;
    }
  }

  private _plantIcon(type: HeatPlantType): string {
    switch (type) {
      case "coal_boiler":
      case "pellet_boiler":
      case "wood_boiler":
        return "mdi:fireplace-off";
      case "fireplace":
        return "mdi:fireplace";
      case "gas_boiler":
        return "mdi:fire";
      case "heat_pump":
        return "mdi:heat-pump";
      case "electric_heater":
        return "mdi:radiator";
      case "air_heater":
        return "mdi:fan";
      default:
        return "mdi:radiator";
    }
  }

  private _stateLabel(st: string | undefined): string {
    switch (st) {
      case "heating":
        return this._t("Grzanie C.O.", "Heating");
      case "hold":
        return this._t("Podtrzymanie ognia", "Fire-hold");
      case "dhw":
        return this._t("Grzanie CWU", "DHW");
      case "heating_and_dhw":
        return this._t("C.O. + CWU", "Heating + DHW");
      case "overheat_protect":
        return this._t("Ochrona przegrzania!", "Overheat protect!");
      case "idle":
        return this._t("Czuwanie", "Idle");
      default:
        return this._t("Wyłączony", "Off");
    }
  }

  private _stateClass(st: string | undefined): string {
    if (st === "overheat_protect") return "overheat";
    if (st === "hold") return "hold";
    if (st === "heating" || st === "dhw" || st === "heating_and_dhw") return "active";
    return "idle";
  }

  private _fuelSourceLabel(mode: string | undefined): string {
    switch (mode) {
      case "fuel_sensor":
        return this._t("Czujnik opału", "Fuel sensor");
      case "daily_fuel_sensor":
        return this._t("Licznik dobowy (kg/24h)", "Daily fuel sensor");
      case "feeder_cycle":
        return this._t("Cykl podajnika (praca/przerwa)", "Feeder work/pause cycle");
      case "feeder":
        return this._t("Praca podajnika", "Feeder runtime");
      case "hydraulic_delta_t":
        return this._t("Przepływ hydrauliczny ΔT", "Hydraulic ΔT flow");
      case "energy_sensor":
        return this._t("Licznik energii", "Energy meter");
      default:
        return this._t("Fizyka temperatur + spalin", "Temp + flue physics");
    }
  }

  private _toggleSeries(id: string) {
    const next = new Set(this._hiddenSeries);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._hiddenSeries = next;
  }

  render() {
    if (!this.heatPlants || this.heatPlants.length === 0) return nothing;

    const currency = this.heatPlants[0]?.currency || "PLN";
    let totalFuelToday = 0;
    let totalFuelAll = 0;
    let totalBurn24h = 0;
    let totalKwhToday = 0;
    let totalKwhAll = 0;
    let totalLossKwhToday = 0;
    let totalLossCostToday = 0;
    let totalCostToday = 0;
    let totalCostAll = 0;
    let totalWarnings = 0;

    for (const p of this.heatPlants) {
      const lv = this.heatPlantsLive[p.id];
      if (!lv) continue;
      totalFuelToday += lv.fuel_consumed_today ?? 0;
      totalFuelAll += lv.fuel_consumed_total ?? 0;
      totalBurn24h += lv.burn_rate_per_24h ?? (lv.burn_rate_per_h ?? 0) * 24;
      totalKwhToday += lv.thermal_kwh_today ?? 0;
      totalKwhAll += lv.thermal_kwh_total ?? 0;
      totalLossKwhToday += lv.distribution_loss_kwh_today ?? 0;
      totalLossCostToday += lv.distribution_loss_cost_today ?? 0;
      totalCostToday += lv.cost_today ?? 0;
      totalCostAll += lv.cost_total ?? 0;
      totalWarnings += lv.warnings?.length ?? 0;
      if (lv.refill_needed) totalWarnings++;
      if (lv.ash_clean_needed) totalWarnings++;
      if (lv.chimney_clean_needed) totalWarnings++;
    }

    const selected =
      this.heatPlants.find((p) => p.id === this._selectedPlantId) ?? this.heatPlants[0];
    const live = this.heatPlantsLive[selected.id];
    const history = this.heatPlantsHistory[selected.id] ?? [];

    return html`
      <rs-list-card
        unclipped
        .heading=${this._t(
          "Analityka kotłowni, spalania i strat przesyłu",
          "Boiler, Combustion & Heat Distribution Analytics",
        )}
      >
        <div class="wrap">
          <div class="summary-strip">
            <div class="summary-tile fuel">
              <div class="tile-label">
                <ha-icon icon="mdi:scale"></ha-icon>
                ${this._t("Spalony opał (dziś)", "Fuel burned (today)")}
              </div>
              <div class="tile-val">${formatNumber(totalFuelToday, this.hass, 1)} kg</div>
              <div class="tile-sub">
                ${formatNumber(totalBurn24h, this.hass, 1)} kg/24h · ${this._t("Łącznie", "Total")}:
                ${formatNumber(totalFuelAll, this.hass, 1)} kg
              </div>
            </div>

            <div class="summary-tile energy">
              <div class="tile-label">
                <ha-icon icon="mdi:fire"></ha-icon>
                ${this._t("Energia cieplna (dziś)", "Thermal energy (today)")}
              </div>
              <div class="tile-val">${formatNumber(totalKwhToday, this.hass, 1)} kWh</div>
              <div class="tile-sub">
                ${this._t("Łącznie", "Total")}: ${formatNumber(totalKwhAll, this.hass, 1)} kWh
                ${
                  live?.real_efficiency_pct != null
                    ? ` · η ${formatNumber(live.real_efficiency_pct, this.hass, 1)}%`
                    : ""
                }
              </div>
            </div>

            <div class="summary-tile ${live?.high_pipe_loss_warning ? "alert" : "loss"}">
              <div class="tile-label">
                <ha-icon icon="mdi:pipe-leak"></ha-icon>
                ${this._t("Straty na rurach (dziś)", "Pipe heat loss (today)")}
              </div>
              <div class="tile-val">
                ${
                  live?.distribution_loss_pct != null
                    ? `${formatNumber(live.distribution_loss_pct, this.hass, 1)}%`
                    : `${formatNumber(totalLossKwhToday, this.hass, 1)} kWh`
                }
              </div>
              <div class="tile-sub">
                ${formatNumber(totalLossKwhToday, this.hass, 1)} kWh ·
                ${formatNumber(totalLossCostToday, this.hass, 2)} ${currency}
              </div>
            </div>

            <div class="summary-tile cost">
              <div class="tile-label">
                <ha-icon icon="mdi:cash"></ha-icon>
                ${this._t("Koszt opału (dziś)", "Fuel cost (today)")}
              </div>
              <div class="tile-val">
                ${formatNumber(totalCostToday, this.hass, 2)} ${currency}
              </div>
              <div class="tile-sub">
                ${this._t("Łącznie", "Total")}: ${formatNumber(totalCostAll, this.hass, 2)}
                ${currency}
                ${
                  live?.cost_per_kwh_thermal
                    ? ` · ${formatNumber(live.cost_per_kwh_thermal, this.hass, 2)} ${currency}/kWh`
                    : ""
                }
              </div>
            </div>

            <div class="summary-tile ${totalWarnings > 0 ? "alert" : "ok"}">
              <div class="tile-label">
                <ha-icon
                  icon=${totalWarnings > 0 ? "mdi:bell-alert" : "mdi:check-circle-outline"}
                ></ha-icon>
                ${this._t("Ostrzeżenia i alerty", "Warnings & alerts")}
              </div>
              <div class="tile-val">${totalWarnings}</div>
              <div class="tile-sub">
                ${
                  totalWarnings > 0
                    ? this._t("Wymaga uwagi!", "Action needed!")
                    : this._t("Wszystko w normie", "All good")
                }
              </div>
            </div>
          </div>

          <div class="plant-tabs">
            ${this.heatPlants.map((p) => {
              const lv = this.heatPlantsLive[p.id];
              const active = p.id === selected.id;
              const hasAlert = !!(
                (lv?.warnings && lv.warnings.length > 0) ||
                lv?.refill_needed ||
                lv?.ash_clean_needed ||
                lv?.chimney_clean_needed ||
                lv?.overheat_protect
              );
              return html`
                <button
                  type="button"
                  class="plant-tab ${active ? "selected" : ""} ${this._stateClass(lv?.state)}"
                  @click=${() => {
                    this._selectedPlantId = p.id;
                  }}
                >
                  <ha-icon icon=${this._plantIcon(p.plant_type)}></ha-icon>
                  <span class="tab-name">${p.name}</span>
                  <span class="tab-state">${this._stateLabel(lv?.state)}</span>
                  ${hasAlert ? html`<span class="alert-dot" aria-hidden="true"></span>` : nothing}
                </button>
              `;
            })}
          </div>

          ${this._renderWarningsBanner(live)}
          ${this._renderSelectedSensors(selected, live)}
          ${this._renderDistributionLossSection(selected, live)}
          ${this._renderMaintenanceSection(selected, live)}
          ${this._renderPeriodStats(selected, history)}
          ${this._renderHistoryChart(selected, history)}
        </div>
      </rs-list-card>

      <rs-analytics-boiler-model
        .hass=${this.hass}
        .plant=${selected}
        .live=${live}
        .outdoorTemp=${this.outdoorTemp}
        .language=${this.hass?.language ?? "en"}
      ></rs-analytics-boiler-model>
    `;
  }

  private _renderWarningsBanner(live: HeatPlantLive | undefined) {
    const warnings = live?.warnings ?? [];
    if (warnings.length === 0) return nothing;
    return html`
      <div class="warnings-banner">
        ${warnings.map(
          (w) => html`
            <div class="warning-item ${w.severity}">
              <ha-icon
                icon=${w.severity === "critical" ? "mdi:alert-octagon" : "mdi:alert-outline"}
              ></ha-icon>
              <div class="warning-text">
                <strong>${w.title}</strong>
                <span>${w.detail}</span>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderSelectedSensors(plant: HeatPlantConfig, live: HeatPlantLive | undefined) {
    const unit = tempUnit(this.hass);
    const fuelUnit = live?.fuel_unit || "kg";
    const fmtTemp = (v: number | null | undefined) =>
      v != null ? `${formatTempLocale(v, this.hass, 1, 1)} ${unit}` : "—";

    const cells: Array<{
      label: string;
      val: string;
      sub?: string;
      icon: string;
      entity?: string;
      tone?: string;
    }> = [];

    if (live?.supply_temp != null || plant.supply_temp_sensor) {
      const targetTemp =
        live?.state === "hold" ? plant.idle_supply_temp : plant.target_supply_temp;
      const targetStr =
        targetTemp > 0 ? ` / ${formatTempLocale(targetTemp, this.hass, 0, 1)}${unit}` : "";
      cells.push({
        label: this._t("Kocioł (zasilanie / zadana)", "Boiler (supply / target)"),
        val: `${fmtTemp(live?.supply_temp)}${targetStr}`,
        sub:
          live?.recommended_supply_temp != null
            ? `${this._t("MPC zaleca", "MPC recommends")}: ${formatTempLocale(live.recommended_supply_temp, this.hass, 1, 1)}${unit}`
            : undefined,
        icon: "mdi:thermometer-chevron-up",
        entity: plant.supply_temp_sensor,
        tone: live?.overheat_protect ? "err" : live?.fire_out_warning ? "warn" : undefined,
      });
    }
    if (live?.return_temp != null || plant.return_temp_sensor) {
      cells.push({
        label: this._t("Powrót / ΔT", "Return / ΔT"),
        val: `${fmtTemp(live?.return_temp)}${live?.delta_t != null ? ` (Δ${formatNumber(live.delta_t, this.hass, 1)}K)` : ""}`,
        icon: "mdi:thermometer-chevron-down",
        entity: plant.return_temp_sensor,
        tone: live?.low_return_warning ? "warn" : undefined,
      });
    }
    if (live?.dhw_temp != null || plant.dhw_temp_sensor) {
      cells.push({
        label: this._t("CWU (zasobnik)", "DHW tank"),
        val: `${fmtTemp(live?.dhw_temp)} / ${formatTempLocale(plant.dhw_target_temp, this.hass, 0, 1)}${unit}`,
        sub:
          live?.dhw_supply_temp != null
            ? `${this._t("Zasilanie CWU", "DHW supply")}: ${fmtTemp(live.dhw_supply_temp)}`
            : undefined,
        icon: "mdi:water-boiler",
        entity: plant.dhw_temp_sensor,
      });
    }
    if (live?.feeder_temp != null || plant.feeder_temp_sensor) {
      cells.push({
        label: this._t("Temp. podajnika", "Feeder temp"),
        val: fmtTemp(live?.feeder_temp),
        sub: live?.feeder_overheat_warning
          ? this._t("RYZYKO COFNIĘCIA ŻARU!", "BURN-BACK RISK!")
          : `${this._t("Limit", "Limit")}: ${plant.feeder_max_temp ?? 60}${unit}`,
        icon: "mdi:screw-machine-flat-top",
        entity: plant.feeder_temp_sensor,
        tone: live?.feeder_overheat_warning ? "err" : undefined,
      });
    }
    if (
      live?.feeder_work_time_s != null ||
      live?.feeder_pause_time_s != null ||
      live?.feeder_duty_pct != null
    ) {
      const w = live?.feeder_work_time_s ?? plant.feeder_work_time_s ?? 0;
      const p = live?.feeder_pause_time_s ?? plant.feeder_pause_time_s ?? 0;
      cells.push({
        label: this._t("Podajnik (praca / przerwa)", "Feeder (work / pause)"),
        val: `${formatNumber(w, this.hass, 1)}s / ${formatNumber(p, this.hass, 1)}s`,
        sub:
          live?.feeder_duty_pct != null
            ? `${this._t("Wypełnienie", "Duty")}: ${formatNumber(live.feeder_duty_pct, this.hass, 2)}%`
            : undefined,
        icon: "mdi:cog-transfer-outline",
        entity: plant.feeder_work_time_sensor || plant.feeder_entity,
      });
    }
    if (live?.blower_pct != null || plant.blower_sensor) {
      const modePrefix = live?.blower_mode ? `${live.blower_mode} ` : "";
      cells.push({
        label: this._t("Nadmuch / dmuchawa", "Blower / fan"),
        val:
          live?.blower_pct != null
            ? `${modePrefix}${formatNumber(live.blower_pct, this.hass, 0)}%`
            : "—",
        icon: "mdi:fan",
        entity: plant.blower_sensor,
      });
    }
    if (live?.flue_temp != null || plant.flue_temp_sensor) {
      cells.push({
        label: this._t("Spaliny / Sprawność", "Flue / Efficiency"),
        val: `${fmtTemp(live?.flue_temp)}${live?.real_efficiency_pct != null ? ` · ${formatNumber(live.real_efficiency_pct, this.hass, 1)}%` : ""}`,
        sub:
          live?.flue_loss_pct != null
            ? `${this._t("Strata kominowa", "Stack loss")}: ${formatNumber(live.flue_loss_pct, this.hass, 1)}%`
            : undefined,
        icon: "mdi:smoke",
        entity: plant.flue_temp_sensor,
        tone: live?.flue_high_warning ? "warn" : undefined,
      });
    }
    if (live?.current_thermal_kw != null) {
      cells.push({
        label: this._t("Moc cieplna", "Thermal power"),
        val: `${formatNumber(live.current_thermal_kw, this.hass, 2)} kW`,
        sub:
          live.delivered_thermal_kw != null && live.distribution_loss_kw
            ? `${this._t("Do grzejników", "Delivered")}: ${formatNumber(live.delivered_thermal_kw, this.hass, 2)} kW`
            : undefined,
        icon: "mdi:flash",
        entity: plant.energy_sensor,
      });
    }
    if (live?.burn_rate_per_h != null) {
      const rate24 = live.burn_rate_per_24h ?? live.burn_rate_per_h * 24;
      cells.push({
        label: this._t("Spalanie (dobowe / godz.)", "Burn rate (24h / h)"),
        val: `${formatNumber(rate24, this.hass, 1)} ${fuelUnit}/24h`,
        sub: `${formatNumber(live.burn_rate_per_h, this.hass, 2)} ${fuelUnit}/h · ${this._fuelSourceLabel(live.fuel_source_mode)}`,
        icon: "mdi:fire-circle",
        entity: plant.daily_fuel_sensor || plant.feeder_entity || plant.fuel_consumption_sensor,
      });
    }
    if (live?.fuel_remaining_kg != null) {
      const pct = live.hopper_pct != null ? ` (${Math.round(live.hopper_pct)}%)` : "";
      cells.push({
        label: this._t("W zasobniku", "Hopper left"),
        val: `${formatNumber(live.fuel_remaining_kg, this.hass, 1)} kg${pct}`,
        sub:
          live.hours_until_refill != null
            ? `~${formatNumber(live.hours_until_refill / 24, this.hass, 1)} d (${formatNumber(live.hours_until_refill, this.hass, 0)} h)`
            : undefined,
        icon: "mdi:silo",
        entity: plant.hopper_level_sensor,
        tone: live.refill_needed ? "warn" : undefined,
      });
    }

    const badges: Array<{ text: string; warn?: boolean }> = [];
    if (live?.boiler_mode === "summer_dhw_only") {
      badges.push({ text: this._t("Tryb LATO (tylko CWU)", "SUMMER mode (DHW only)") });
    } else if (live?.boiler_mode === "heating") {
      badges.push({ text: this._t("Tryb ZIMA / Grzanie", "WINTER / Heating mode") });
    }
    if (live?.ch_pump_active) badges.push({ text: this._t("Pompa C.O. ON", "C.O. Pump ON") });
    if (live?.dhw_pump_active) badges.push({ text: this._t("Pompa CWU ON", "DHW Pump ON") });
    if (live?.dhw_circulation_pump_active) {
      badges.push({ text: this._t("Cyrkulacja CWU ON", "DHW Circulation ON") });
    }
    if (live?.ufh_pump_active) badges.push({ text: this._t("Pompa podłogówki ON", "UFH Pump ON") });
    if (live?.feeder_active) badges.push({ text: this._t("Podajnik AKTYWNY", "Feeder ON") });
    if (live?.cannot_extinguish || plant.cannot_extinguish) {
      badges.push({ text: this._t("Podtrzymanie ognia", "Fire-hold") });
    }
    if (live?.flow_rate_l_min != null && live.flow_rate_l_min > 0) {
      badges.push({
        text: `${this._t("Przepływ", "Flow")}: ${formatNumber(live.flow_rate_l_min, this.hass, 1)} L/min`,
      });
    }

    return html`
      ${
        badges.length > 0
          ? html`<div class="meta-badges">
              ${badges.map(
                (b) => html`<span class="meta-badge ${b.warn ? "warn" : ""}">${b.text}</span>`,
              )}
            </div>`
          : nothing
      }
      <div class="sensor-grid">
        ${cells.map(
          (c) => html`
            <div
              class="sensor-cell ${c.entity ? "clickable" : ""} ${c.tone ?? ""}"
              @click=${() => c.entity && openEntityInfo(this, c.entity)}
            >
              <div class="sensor-label">
                <ha-icon icon=${c.icon}></ha-icon>
                <span>${c.label}</span>
              </div>
              <div class="sensor-val">${c.val}</div>
              ${c.sub ? html`<div class="sensor-sub">${c.sub}</div>` : nothing}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderDistributionLossSection(
    plant: HeatPlantConfig,
    live: HeatPlantLive | undefined,
  ) {
    const readings = live?.radiator_readings ?? [];
    const configured = plant.radiator_sensors ?? [];
    const unit = tempUnit(this.hass);
    const currency = plant.currency || "PLN";
    const fuelUnit = live?.fuel_unit || "kg";

    if (configured.length === 0 && readings.length === 0) {
      return html`
        <div class="dist-box empty">
          <div class="dist-head">
            <ha-icon icon="mdi:radiator"></ha-icon>
            <span>
              ${this._t(
                "Straty ciepła na drodze piec → kaloryfery (czujniki na grzejnikach)",
                "Pipe distribution heat loss (radiator sensors)",
              )}
            </span>
          </div>
          <p class="dist-hint">
            ${this._t(
              "Dodaj czujniki temperatury na kaloryferach w edycji pieca (zakładka Kotłownia lub Ustawienia → Wspólny system), aby mierzyć spadek temperatury ΔT, % straty na rurach oraz koszt ciepła traconego po drodze.",
              "Add radiator temperature sensors in boiler settings (Heat Plants or Settings → Shared system) to measure ΔT drop, pipe heat loss %, and lost fuel cost along the distribution pipes.",
            )}
          </p>
        </div>
      `;
    }

    return html`
      <div class="dist-box ${live?.high_pipe_loss_warning ? "warn" : ""}">
        <div class="dist-head">
          <ha-icon icon="mdi:pipe-leak"></ha-icon>
          <span>
            ${this._t(
              "Straty ciepła na drodze piec → odbiór (kaloryfery)",
              "Heat lost between boiler & delivery (radiators)",
            )}
          </span>
          ${
            live?.high_pipe_loss_warning
              ? html`<span class="maint-badge">${this._t("WYSOKIE STRATY!", "HIGH LOSS!")}</span>`
              : nothing
          }
        </div>

        <div class="dist-summary">
          <div class="dist-metric">
            <span class="dm-label">${this._t("Śr. temp. kaloryferów", "Avg radiator temp")}</span>
            <span class="dm-val">
              ${
                live?.avg_radiator_temp != null
                  ? `${formatTempLocale(live.avg_radiator_temp, this.hass, 1, 1)} ${unit}`
                  : "—"
              }
            </span>
          </div>
          <div class="dist-metric">
            <span class="dm-label">${this._t("Spadek ΔT po drodze", "Pipe ΔT drop")}</span>
            <span class="dm-val">
              ${
                live?.distribution_temp_drop_k != null
                  ? `−${formatNumber(live.distribution_temp_drop_k, this.hass, 1)} K`
                  : "—"
              }
            </span>
          </div>
          <div class="dist-metric">
            <span class="dm-label">${this._t("Strata przesyłu", "Distribution loss")}</span>
            <span class="dm-val">
              ${
                live?.distribution_loss_pct != null
                  ? `${formatNumber(live.distribution_loss_pct, this.hass, 1)}%`
                  : "—"
              }
              ${
                live?.distribution_loss_kw != null
                  ? html`<small>(${formatNumber(live.distribution_loss_kw, this.hass, 2)} kW)</small>`
                  : nothing
              }
            </span>
          </div>
          <div class="dist-metric">
            <span class="dm-label">${this._t("Stracone dziś", "Lost today")}</span>
            <span class="dm-val">
              ${formatNumber(live?.distribution_loss_kwh_today ?? 0, this.hass, 2)} kWh
              <small>
                (${formatNumber(live?.distribution_loss_fuel_kg_today ?? 0, this.hass, 2)} ${fuelUnit}
                · ${formatNumber(live?.distribution_loss_cost_today ?? 0, this.hass, 2)} ${currency})
              </small>
            </span>
          </div>
          <div class="dist-metric">
            <span class="dm-label">${this._t("Stracone łącznie", "Lost total")}</span>
            <span class="dm-val">
              ${formatNumber(live?.distribution_loss_kwh_total ?? 0, this.hass, 1)} kWh
              <small>
                (${formatNumber(live?.distribution_loss_cost_total ?? 0, this.hass, 2)} ${currency})
              </small>
            </span>
          </div>
        </div>

        ${
          readings.length > 0
            ? html`
                <div class="rad-table-wrap">
                  <table class="rad-table">
                    <thead>
                      <tr>
                        <th>${this._t("Czujnik / Kaloryfer", "Radiator sensor")}</th>
                        <th>${this._t("Temp.", "Temp")}</th>
                        <th>${this._t("Spadek ΔT", "Drop ΔT")}</th>
                        <th>${this._t("Strata %", "Loss %")}</th>
                        <th>${this._t("Długość / K·m⁻¹", "Pipe / K·m⁻¹")}</th>
                        <th>${this._t("Powrót grz.", "Rad return")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${readings.map(
                        (r) => html`
                          <tr @click=${() => openEntityInfo(this, r.entity_id)} class="clickable-row">
                            <td><strong>${r.name}</strong></td>
                            <td>
                              ${
                                r.temp != null
                                  ? `${formatTempLocale(r.temp, this.hass, 1, 1)} ${unit}`
                                  : "—"
                              }
                            </td>
                            <td class=${(r.temp_drop_k ?? 0) >= 6 ? "cell-warn" : ""}>
                              ${
                                r.temp_drop_k != null
                                  ? `−${formatNumber(r.temp_drop_k, this.hass, 1)} K`
                                  : "—"
                              }
                            </td>
                            <td class=${(r.loss_pct ?? 0) >= (plant.distribution_loss_alert_pct ?? 20) ? "cell-warn" : ""}>
                              ${
                                r.loss_pct != null
                                  ? `${formatNumber(r.loss_pct, this.hass, 1)}%`
                                  : "—"
                              }
                            </td>
                            <td>
                              ${
                                r.pipe_length_m != null && r.pipe_length_m > 0
                                  ? `${formatNumber(r.pipe_length_m, this.hass, 1)} m${r.loss_k_per_m != null ? ` (${formatNumber(r.loss_k_per_m, this.hass, 2)} K/m)` : ""}`
                                  : "—"
                              }
                            </td>
                            <td>
                              ${
                                r.return_temp != null
                                  ? `${formatTempLocale(r.return_temp, this.hass, 1, 1)} ${unit}${r.radiator_delta_t != null ? ` (Δ${formatNumber(r.radiator_delta_t, this.hass, 1)}K)` : ""}`
                                  : "—"
                              }
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private _renderMaintenanceSection(plant: HeatPlantConfig, live: HeatPlantLive | undefined) {
    const isSolid =
      plant.plant_type === "coal_boiler" ||
      plant.plant_type === "pellet_boiler" ||
      plant.plant_type === "wood_boiler" ||
      plant.plant_type === "fireplace" ||
      plant.notify_refill_enabled ||
      plant.notify_ash_enabled ||
      plant.notify_chimney_enabled ||
      (plant.hopper_capacity_kg ?? 0) > 0;
    if (!isSolid) return nothing;

    const hopperPct =
      live?.hopper_pct ??
      (plant.hopper_capacity_kg && plant.hopper_capacity_kg > 0 && live?.fuel_remaining_kg != null
        ? Math.min(100, Math.max(0, (live.fuel_remaining_kg / plant.hopper_capacity_kg) * 100))
        : null);

    const ashKg = live?.fuel_since_ash_clean_kg ?? 0;
    const ashIntKg = plant.ash_clean_interval_kg ?? 0;
    const ashDays = live?.days_since_ash_clean ?? 0;
    const ashIntDays = plant.ash_clean_interval_days ?? 0;
    const ashPct = Math.min(
      100,
      Math.max(
        ashIntKg > 0 ? (ashKg / ashIntKg) * 100 : 0,
        ashIntDays > 0 ? (ashDays / ashIntDays) * 100 : 0,
      ),
    );

    const chimKg = live?.fuel_since_chimney_clean_kg ?? 0;
    const chimIntKg = plant.chimney_clean_interval_kg ?? 0;
    const chimDays = live?.days_since_chimney_clean ?? 0;
    const chimIntDays = plant.chimney_clean_interval_days ?? 0;
    const chimPct = Math.min(
      100,
      Math.max(
        chimIntKg > 0 ? (chimKg / chimIntKg) * 100 : 0,
        chimIntDays > 0 ? (chimDays / chimIntDays) * 100 : 0,
      ),
    );

    return html`
      <div class="maint-grid">
        <div class="maint-card ${live?.refill_needed ? "warn" : ""}">
          <div class="maint-head">
            <ha-icon icon="mdi:silo"></ha-icon>
            <span>${this._t("Stan zasobnika (auto-wyliczany)", "Hopper level (auto-calculated)")}</span>
            ${
              live?.refill_needed
                ? html`<span class="maint-badge">${this._t("NISKI POZIOM!", "LOW!")}</span>`
                : nothing
            }
          </div>
          <div class="maint-info">
            ${
              live?.fuel_remaining_kg != null
                ? `${formatNumber(live.fuel_remaining_kg, this.hass, 1)} kg`
                : this._t("Brak danych zasobnika", "No hopper data")
            }${hopperPct != null ? ` (${Math.round(hopperPct)}%)` : ""}
            · ${this._t("Spalono od zasypu", "Burned since refill")}:
            ${formatNumber(live?.fuel_since_refill_kg ?? 0, this.hass, 1)} kg
            ${
              live?.hours_until_refill != null
                ? ` · ~${formatNumber(live.hours_until_refill, this.hass, 1)} h`
                : ""
            }
          </div>
          ${
            hopperPct != null
              ? html`<div class="progress">
                  <div
                    class="progress-fill ${live?.refill_needed ? "warn" : "ok"}"
                    style="width: ${Math.max(4, Math.min(100, hopperPct))}%"
                  ></div>
                </div>`
              : nothing
          }
        </div>

        <div class="maint-card ${live?.ash_clean_needed ? "warn" : ""}">
          <div class="maint-head">
            <ha-icon icon="mdi:delete-sweep"></ha-icon>
            <span>${this._t("Zbierający się popiół (ciągły)", "Ash accumulation (continuous)")}</span>
            ${
              live?.ash_clean_needed
                ? html`<span class="maint-badge">${this._t("PEŁNY!", "FULL!")}</span>`
                : nothing
            }
          </div>
          <div class="maint-info">
            ${formatNumber(ashKg, this.hass, 1)} / ${ashIntKg || "—"} kg ·
            ${formatNumber(ashDays, this.hass, 1)} / ${ashIntDays || "—"} d
            ${
              live?.estimated_ash_kg != null
                ? ` · ~${formatNumber(live.estimated_ash_kg, this.hass, 2)} kg ${this._t("popiołu", "ash")}`
                : ""
            }
          </div>
          <div class="progress">
            <div
              class="progress-fill ${live?.ash_clean_needed ? "warn" : ""}"
              style="width: ${Math.max(2, ashPct)}%"
            ></div>
          </div>
        </div>

        <div class="maint-card ${live?.chimney_clean_needed ? "warn" : ""}">
          <div class="maint-head">
            <ha-icon icon="mdi:chimney"></ha-icon>
            <span>${this._t("Zużycie komina (ciągłe)", "Chimney wear (continuous)")}</span>
            ${
              live?.chimney_clean_needed
                ? html`<span class="maint-badge">${this._t("WYMAGANE!", "DUE!")}</span>`
                : nothing
            }
          </div>
          <div class="maint-info">
            ${formatNumber(chimKg, this.hass, 0)} / ${chimIntKg || "—"} kg ·
            ${formatNumber(chimDays, this.hass, 0)} / ${chimIntDays || "—"} d
          </div>
          <div class="progress">
            <div
              class="progress-fill ${live?.chimney_clean_needed ? "warn" : ""}"
              style="width: ${Math.max(2, chimPct)}%"
            ></div>
          </div>
        </div>
      </div>
    `;
  }

  private _renderPeriodStats(plant: HeatPlantConfig, points: HeatPlantHistoryPoint[]) {
    if (!points || points.length < 2) return nothing;
    const unit = tempUnit(this.hass);
    const fuelUnit = this.heatPlantsLive[plant.id]?.fuel_unit || "kg";
    const MAX_GAP_S = 1800;

    let heatSec = 0;
    let holdSec = 0;
    let idleSec = 0;
    let fuelPeriod = 0;
    let prevFuelToday: number | null = null;

    const supplyVals: number[] = [];
    const returnVals: number[] = [];
    const flueVals: number[] = [];
    const kwVals: number[] = [];
    const lossPctVals: number[] = [];
    const effVals: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.supply_temp != null) supplyVals.push(p.supply_temp);
      if (p.return_temp != null) returnVals.push(p.return_temp);
      if (p.flue_temp != null) flueVals.push(p.flue_temp);
      if (p.thermal_kw != null) kwVals.push(p.thermal_kw);
      if (p.distribution_loss_pct != null) lossPctVals.push(p.distribution_loss_pct);
      if (p.real_efficiency_pct != null) effVals.push(p.real_efficiency_pct);

      if (p.fuel_consumed_today != null) {
        if (prevFuelToday != null) {
          if (p.fuel_consumed_today >= prevFuelToday) {
            fuelPeriod += p.fuel_consumed_today - prevFuelToday;
          } else {
            fuelPeriod += p.fuel_consumed_today;
          }
        }
        prevFuelToday = p.fuel_consumed_today;
      }

      if (i + 1 < points.length) {
        const dt = Math.min(Math.max(0, points[i + 1].ts - p.ts), MAX_GAP_S);
        if (
          p.state === "heating" ||
          p.state === "dhw" ||
          p.state === "heating_and_dhw" ||
          p.state === "active"
        ) {
          heatSec += dt;
        } else if (p.state === "hold") {
          holdSec += dt;
        } else {
          idleSec += dt;
        }
      }
    }

    const totalSec = heatSec + holdSec + idleSec;
    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : null);

    const avgSup = avg(supplyVals);
    const maxSup = max(supplyVals);
    const avgRet = avg(returnVals);
    const maxFlue = max(flueVals);
    const avgKw = avg(kwVals);
    const maxKw = max(kwVals);
    const avgLossPct = avg(lossPctVals);
    const avgEff = avg(effVals);

    return html`
      <div class="period-box">
        <div class="period-head">
          <span>${this._t("Podsumowanie wybranego okresu", "Selected period summary")}</span>
          ${
            fuelPeriod > 0
              ? html`<span class="period-fuel">
                  ${this._t("Opał w okresie", "Period fuel")}:
                  <b>${formatNumber(fuelPeriod, this.hass, 1)} ${fuelUnit}</b>
                </span>`
              : nothing
          }
        </div>
        ${
          totalSec > 0
            ? html`
                <div class="mode-bar" aria-hidden="true">
                  ${heatSec > 0 ? html`<i class="bar-heat" style="flex: ${heatSec}"></i>` : nothing}
                  ${holdSec > 0 ? html`<i class="bar-hold" style="flex: ${holdSec}"></i>` : nothing}
                  ${idleSec > 0 ? html`<i class="bar-idle" style="flex: ${idleSec}"></i>` : nothing}
                </div>
                <div class="mode-legend">
                  <span>
                    <i class="dot bar-heat"></i>
                    ${this._t("Grzanie", "Heating")}:
                    <b>${formatNumber(heatSec / 3600, this.hass, 1)} h</b>
                  </span>
                  ${
                    holdSec > 0 || plant.cannot_extinguish
                      ? html`<span>
                          <i class="dot bar-hold"></i>
                          ${this._t("Podtrzymanie", "Fire-hold")}:
                          <b>${formatNumber(holdSec / 3600, this.hass, 1)} h</b>
                        </span>`
                      : nothing
                  }
                  <span>
                    <i class="dot bar-idle"></i>
                    ${this._t("Czuwanie", "Idle")}:
                    <b>${formatNumber(idleSec / 3600, this.hass, 1)} h</b>
                  </span>
                </div>
              `
            : nothing
        }
        <div class="period-metrics">
          ${
            avgSup != null
              ? html`<span>
                  ${this._t("Zasilanie śr./maks.", "Supply avg/max")}:
                  <b
                    >${formatTempLocale(avgSup, this.hass, 1, 1)} /
                    ${formatTempLocale(maxSup!, this.hass, 1, 1)} ${unit}</b
                  >
                </span>`
              : nothing
          }
          ${
            avgRet != null
              ? html`<span>
                  ${this._t("Powrót śr.", "Return avg")}:
                  <b>${formatTempLocale(avgRet, this.hass, 1, 1)} ${unit}</b>
                </span>`
              : nothing
          }
          ${
            maxFlue != null
              ? html`<span>
                  ${this._t("Spaliny maks.", "Flue max")}:
                  <b>${formatTempLocale(maxFlue, this.hass, 0, 1)} ${unit}</b>
                </span>`
              : nothing
          }
          ${
            avgKw != null
              ? html`<span>
                  ${this._t("Moc śr./szczyt", "Power avg/peak")}:
                  <b
                    >${formatNumber(avgKw, this.hass, 1)} / ${formatNumber(maxKw!, this.hass, 1)}
                    kW</b
                  >
                </span>`
              : nothing
          }
          ${
            avgEff != null
              ? html`<span>
                  ${this._t("Sprawność śr.", "Avg efficiency")}:
                  <b>${formatNumber(avgEff, this.hass, 1)}%</b>
                </span>`
              : nothing
          }
          ${
            avgLossPct != null
              ? html`<span>
                  ${this._t("Strata przesyłu śr.", "Avg pipe loss")}:
                  <b>${formatNumber(avgLossPct, this.hass, 1)}%</b>
                </span>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private _renderHistoryChart(plant: HeatPlantConfig, points: HeatPlantHistoryPoint[]) {
    if (!points || points.length === 0) {
      return html`
        <div class="chart-empty">
          <ha-icon icon="mdi:chart-timeline-variant"></ha-icon>
          <span>
            ${this._t(
              "Historia pracy pieca pojawi się po zebraniu pierwszych pomiarów.",
              "Heat plant history will appear once measurements are recorded.",
            )}
          </span>
        </div>
      `;
    }

    const unit = tempUnit(this.hass);
    const fuelUnit = this.heatPlantsLive[plant.id]?.fuel_unit || "kg";
    const mk = (fn: (p: HeatPlantHistoryPoint) => number | null | undefined) =>
      points.flatMap((p): Array<[number, number]> => {
        const v = fn(p);
        return v != null ? [[p.ts * 1000, v]] : [];
      });

    const rawSeries: Array<{
      id: string;
      name: string;
      color: string;
      yAxisIndex: number;
      data: Array<[number, number]>;
      lineStyle: Record<string, unknown>;
      areaStyle?: Record<string, unknown>;
    }> = [
      {
        id: "supply_temp",
        name: `${this._t("Kocioł (zasilanie)", "Boiler supply")} (${unit})`,
        color: "#ff5722",
        yAxisIndex: 0,
        data: mk((p) => p.supply_temp),
        lineStyle: { width: 2.2 },
      },
      {
        id: "target_supply_temp",
        name: `${this._t("Zadana kotła", "Target supply")} (${unit})`,
        color: "#ff8a65",
        yAxisIndex: 0,
        data: mk((p) => p.target_supply_temp),
        lineStyle: { width: 1.4, type: "dashed" },
      },
      {
        id: "avg_radiator_temp",
        name: `${this._t("Kaloryfery (śr.)", "Radiators (avg)")} (${unit})`,
        color: "#e91e63",
        yAxisIndex: 0,
        data: mk((p) => p.avg_radiator_temp),
        lineStyle: { width: 1.8 },
      },
      {
        id: "return_temp",
        name: `${this._t("Powrót", "Return")} (${unit})`,
        color: "#2196f3",
        yAxisIndex: 0,
        data: mk((p) => p.return_temp),
        lineStyle: { width: 1.7 },
      },
      {
        id: "dhw_temp",
        name: `${this._t("CWU", "DHW")} (${unit})`,
        color: "#00acc1",
        yAxisIndex: 0,
        data: mk((p) => p.dhw_temp),
        lineStyle: { width: 1.5 },
      },
      {
        id: "feeder_temp",
        name: `${this._t("Temp. podajnika", "Feeder temp")} (${unit})`,
        color: "#ab47bc",
        yAxisIndex: 0,
        data: mk((p) => p.feeder_temp),
        lineStyle: { width: 1.4 },
      },
      {
        id: "flue_temp",
        name: `${this._t("Spaliny", "Flue")} (${unit})`,
        color: "#9e9e9e",
        yAxisIndex: 0,
        data: mk((p) => p.flue_temp),
        lineStyle: { width: 1.3, type: "dotted" },
      },
      {
        id: "thermal_kw",
        name: `${this._t("Moc cieplna", "Power")} (kW)`,
        color: "#ff9800",
        yAxisIndex: 1,
        data: mk((p) => p.thermal_kw),
        lineStyle: { width: 1.8 },
        areaStyle: { color: "#ff9800", opacity: 0.12 },
      },
      {
        id: "distribution_loss_kw",
        name: `${this._t("Strata rur", "Pipe loss")} (kW)`,
        color: "#f44336",
        yAxisIndex: 1,
        data: mk((p) => p.distribution_loss_kw),
        lineStyle: { width: 1.5, type: "dashed" },
      },
      {
        id: "burn_rate_per_h",
        name: `${this._t("Spalanie", "Burn rate")} (${fuelUnit}/h)`,
        color: "#8d6e63",
        yAxisIndex: 1,
        data: mk((p) => p.burn_rate_per_h),
        lineStyle: { width: 1.5, type: "dashed" },
      },
      {
        id: "blower_pct",
        name: `${this._t("Nadmuch", "Blower")} (%)`,
        color: "#26a69a",
        yAxisIndex: 1,
        data: mk((p) => p.blower_pct),
        lineStyle: { width: 1.2, type: "dotted" },
      },
    ].filter((s) => s.data.length > 0);

    if (rawSeries.length === 0) return nothing;

    const plotted = rawSeries.map((s) => {
      const hidden = this._hiddenSeries.has(s.id);
      return {
        id: s.id,
        type: "line",
        name: s.name,
        color: s.color,
        yAxisIndex: s.yAxisIndex,
        data: s.data,
        showSymbol: false,
        smooth: true,
        lineStyle: hidden ? { ...s.lineStyle, width: 0, opacity: 0 } : s.lineStyle,
        ...(s.areaStyle
          ? { areaStyle: hidden ? { ...s.areaStyle, opacity: 0 } : s.areaStyle }
          : {}),
      };
    });

    const hasPowerAxis = rawSeries.some((s) => s.yAxisIndex === 1);
    const options: Record<string, unknown> = {
      xAxis: {
        type: "time",
        min: this.rangeStart || undefined,
        max: this.rangeEnd || undefined,
      },
      yAxis: hasPowerAxis
        ? [
            { type: "value", name: unit, splitNumber: 4 },
            { type: "value", name: "kW / kg·h⁻¹", splitNumber: 4, splitLine: { show: false } },
          ]
        : { type: "value", name: unit, splitNumber: 4 },
      grid: { top: 28, left: 48, right: hasPowerAxis ? 52 : 20, bottom: 26 },
      tooltip: { trigger: "axis" },
    };

    return html`
      <div class="chart-section">
        <div class="chart-title">
          ${this._t(
            "Wykres temperatur, kaloryferów, strat przesyłu, mocy i spalania",
            "Boiler temperatures, radiators, pipe losses, power & burn rate",
          )}
          — ${plant.name}
        </div>
        <ha-chart-base
          .hass=${this.hass}
          .data=${plotted}
          .options=${options}
          height="270px"
          style="height: 270px; --chart-max-height: 270px"
        ></ha-chart-base>
        <div class="series-legend">
          ${rawSeries.map((s) => {
            const hidden = this._hiddenSeries.has(s.id);
            return html`
              <button
                type="button"
                class="legend-item ${hidden ? "legend-hidden" : ""}"
                @click=${() => this._toggleSeries(s.id)}
              >
                <span class="legend-dot" style="background: ${s.color}"></span>
                ${s.name}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        margin-bottom: var(--rs-space-4);
      }

      .wrap {
        padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-3);
      }

      .summary-strip {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
        gap: 10px;
      }

      .summary-tile {
        padding: 12px 14px;
        border-radius: var(--rs-radius);
        background: var(--rs-fill);
        border: 1px solid transparent;
      }

      .summary-tile.fuel {
        border-color: color-mix(in srgb, var(--rs-heat) 30%, transparent);
      }

      .summary-tile.loss {
        border-color: color-mix(in srgb, var(--rs-warn) 35%, transparent);
      }

      .summary-tile.alert {
        background: color-mix(in srgb, var(--rs-err) 10%, var(--rs-fill));
        border-color: color-mix(in srgb, var(--rs-err) 40%, transparent);
      }

      .tile-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--secondary-text-color);
        --mdc-icon-size: 16px;
      }

      .summary-tile.alert .tile-label,
      .summary-tile.alert .tile-val {
        color: var(--rs-err);
      }

      .tile-val {
        font-size: 20px;
        font-weight: 500;
        margin-top: 4px;
        font-variant-numeric: tabular-nums;
      }

      .tile-sub {
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-top: 2px;
        font-variant-numeric: tabular-nums;
      }

      .plant-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .plant-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 12px;
        border-radius: 10px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
        --mdc-icon-size: 17px;
      }

      .plant-tab.selected {
        border-color: var(--primary-color);
        background: var(--rs-fill-primary);
        font-weight: 500;
      }

      .plant-tab.active .tab-state {
        color: var(--rs-heat-text);
      }

      .plant-tab.hold .tab-state {
        color: var(--rs-warn);
      }

      .plant-tab.overheat .tab-state {
        color: var(--rs-err);
        font-weight: 600;
      }

      .tab-state {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .alert-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--rs-err);
      }

      .warnings-banner {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .warning-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--rs-radius-sm);
        border: 1px solid var(--rs-warn);
        background: color-mix(in srgb, var(--rs-warn) 12%, transparent);
        --mdc-icon-size: 20px;
      }

      .warning-item.critical {
        border-color: var(--rs-err);
        background: color-mix(in srgb, var(--rs-err) 14%, transparent);
        color: var(--rs-err);
      }

      .warning-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        color: var(--primary-text-color);
      }

      .meta-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .meta-badge {
        font-size: 11px;
        padding: 3px 9px;
        border-radius: 999px;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
      }

      .meta-badge.warn {
        background: color-mix(in srgb, var(--rs-warn) 18%, transparent);
        color: var(--rs-warn-text);
        font-weight: 500;
      }

      .sensor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
        gap: 8px;
      }

      .sensor-cell {
        padding: 10px 12px;
        border-radius: var(--rs-radius-sm);
        background: var(--rs-fill);
        border: 1px solid transparent;
      }

      .sensor-cell.clickable {
        cursor: pointer;
      }

      .sensor-cell.clickable:hover {
        border-color: var(--primary-color);
      }

      .sensor-cell.warn {
        border-color: color-mix(in srgb, var(--rs-warn) 55%, transparent);
      }

      .sensor-cell.err {
        border-color: color-mix(in srgb, var(--rs-err) 65%, transparent);
        background: color-mix(in srgb, var(--rs-err) 8%, var(--rs-fill));
      }

      .sensor-label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--secondary-text-color);
        --mdc-icon-size: 14px;
      }

      .sensor-val {
        margin-top: 4px;
        font-size: 15px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }

      .sensor-sub {
        margin-top: 2px;
        font-size: 11px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .dist-box {
        padding: 12px 14px;
        border-radius: var(--rs-radius);
        background: var(--rs-fill);
        border: 1px solid var(--divider-color);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .dist-box.warn {
        border-color: color-mix(in srgb, var(--rs-warn) 65%, transparent);
        background: color-mix(in srgb, var(--rs-warn) 7%, var(--rs-fill));
      }

      .dist-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        --mdc-icon-size: 18px;
      }

      .dist-hint {
        margin: 0;
        font-size: 12px;
        color: var(--secondary-text-color);
        line-height: 1.45;
      }

      .dist-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
      }

      .dist-metric {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-radius: var(--rs-radius-sm);
        background: var(--card-background-color, var(--primary-background-color));
      }

      .dm-label {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .dm-val {
        font-size: 14px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }

      .dm-val small {
        font-weight: 400;
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .rad-table-wrap {
        overflow-x: auto;
      }

      .rad-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .rad-table th,
      .rad-table td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--divider-color);
      }

      .rad-table th {
        font-size: 11px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }

      .clickable-row {
        cursor: pointer;
      }

      .clickable-row:hover {
        background: color-mix(in srgb, var(--primary-color) 7%, transparent);
      }

      .cell-warn {
        color: var(--rs-warn-text, var(--rs-warn));
        font-weight: 600;
      }

      .maint-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }

      .maint-card {
        padding: 12px 14px;
        border-radius: var(--rs-radius);
        background: var(--rs-fill);
        border: 1px solid var(--divider-color);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .maint-card.warn {
        border-color: color-mix(in srgb, var(--rs-warn) 65%, transparent);
        background: color-mix(in srgb, var(--rs-warn) 9%, var(--rs-fill));
      }

      .maint-head {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        --mdc-icon-size: 17px;
      }

      .maint-badge {
        margin-left: auto;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--rs-warn);
        color: #fff;
      }

      .maint-info {
        font-size: 12px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .progress {
        height: 6px;
        border-radius: 3px;
        background: color-mix(in srgb, var(--divider-color) 60%, transparent);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--primary-color);
        transition: width 0.25s;
      }

      .progress-fill.ok {
        background: var(--rs-ok);
      }

      .progress-fill.warn {
        background: var(--rs-warn);
      }

      .period-box {
        padding: 12px 14px;
        border-radius: var(--rs-radius);
        background: var(--rs-fill);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .period-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
      }

      .period-fuel {
        font-size: 12px;
        color: var(--secondary-text-color);
        font-weight: 400;
      }

      .period-fuel b {
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .mode-bar {
        display: flex;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        gap: 2px;
      }

      .bar-heat {
        background: var(--rs-heat);
      }

      .bar-hold {
        background: var(--rs-warn);
      }

      .bar-idle {
        background: color-mix(in srgb, var(--secondary-text-color) 35%, transparent);
      }

      .mode-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-size: 12px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .mode-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .mode-legend b {
        color: var(--primary-text-color);
      }

      .mode-legend .dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        display: inline-block;
      }

      .period-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        font-size: 12px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .period-metrics b {
        color: var(--primary-text-color);
      }

      .chart-section {
        margin-top: 4px;
      }

      .chart-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }

      .series-legend {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 4px;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border: none;
        border-radius: 12px;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
      }

      .legend-item.legend-hidden {
        opacity: 0.35;
      }

      .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .chart-empty {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        border-radius: var(--rs-radius-sm);
        background: var(--rs-fill);
        color: var(--secondary-text-color);
        font-size: 13px;
        --mdc-icon-size: 20px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-heat-plants": RsAnalyticsHeatPlants;
  }
}
