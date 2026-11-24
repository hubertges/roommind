/**
 * rs-analytics-heat-plants – Heat sources & boiler analytics section on the Analytics dashboard.
 *
 * Displays:
 * - Multi-source fuel (kg), thermal energy (kWh), cost, and maintenance alerts overview
 * - Live sensors of each heat source (supply/return/DHW/flue temps, ΔT, power, kg burned, hopper, pumps)
 * - Maintenance progress & 1-click confirmations (refill / ash tray / chimney cleaning)
 * - Quick manual fuel logging (kg burned or hopper refill)
 * - Time-series chart of temperatures, thermal power, and burn rate over the selected analytics range
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
import { fireSaveStatus, openEntityInfo } from "../../utils/events";
import "../shared/rs-list-card";

@customElement("rs-analytics-heat-plants")
export class RsAnalyticsHeatPlants extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};
  @property({ attribute: false }) public heatPlantsHistory: Record<
    string,
    HeatPlantHistoryPoint[]
  > = {};
  @property({ type: Number }) public rangeStart = 0;
  @property({ type: Number }) public rangeEnd = 0;

  @state() private _selectedPlantId = "";
  @state() private _fuelInputKg = 25;
  @state() private _busyAction = "";
  @state() private _hiddenSeries = new Set<string>();

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

  private async _confirmMaintenance(
    plantId: string,
    action: "refill" | "ash_cleaned" | "chimney_cleaned",
  ) {
    this._busyAction = `${plantId}:${action}`;
    try {
      const payload: Record<string, unknown> = {
        type: "roommind/heat_plants/maintenance",
        plant_id: plantId,
        action,
      };
      if (action === "refill") {
        const plant = this.heatPlants.find((p) => p.id === plantId);
        const cap = plant?.hopper_capacity_kg ?? 0;
        if (cap > 0) payload.kg = cap;
      }
      await this.hass.callWS(payload);
      fireSaveStatus(this, "saved");
      this.dispatchEvent(
        new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }),
      );
    } catch {
      fireSaveStatus(this, "error");
    } finally {
      this._busyAction = "";
    }
  }

  private async _logFuel(plantId: string, mode: "burned" | "refill") {
    const kg = Number(this._fuelInputKg);
    if (!Number.isFinite(kg) || kg <= 0) return;
    this._busyAction = `${plantId}:${mode}`;
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/log_fuel",
        plant_id: plantId,
        kg,
        mode,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(
        new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }),
      );
    } catch {
      fireSaveStatus(this, "error");
    } finally {
      this._busyAction = "";
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
    let totalKwhToday = 0;
    let totalKwhAll = 0;
    let totalCostToday = 0;
    let totalCostAll = 0;
    let totalAlerts = 0;

    for (const p of this.heatPlants) {
      const lv = this.heatPlantsLive[p.id];
      if (!lv) continue;
      totalFuelToday += lv.fuel_consumed_today ?? 0;
      totalFuelAll += lv.fuel_consumed_total ?? 0;
      totalKwhToday += lv.thermal_kwh_today ?? 0;
      totalKwhAll += lv.thermal_kwh_total ?? 0;
      totalCostToday += lv.cost_today ?? 0;
      totalCostAll += lv.cost_total ?? 0;
      if (lv.refill_needed) totalAlerts++;
      if (lv.ash_clean_needed) totalAlerts++;
      if (lv.chimney_clean_needed) totalAlerts++;
      if (lv.overheat_protect) totalAlerts++;
    }

    const selected =
      this.heatPlants.find((p) => p.id === this._selectedPlantId) ?? this.heatPlants[0];
    const live = this.heatPlantsLive[selected.id];
    const history = this.heatPlantsHistory[selected.id] ?? [];

    return html`
      <rs-list-card
        unclipped
        .heading=${this._t(
          "Kotłownia, kominek i źródła ciepła — analiza i obsługa",
          "Heat Plants, Fireplace & Heating Sources — Analytics & Maintenance",
        )}
      >
        <div class="wrap">
          <div class="summary-strip">
            <div class="summary-tile fuel">
              <div class="tile-label">
                <ha-icon icon="mdi:scale"></ha-icon>
                ${this._t("Spalony opał (dziś)", "Fuel burned (today)")}
              </div>
              <div class="tile-val">
                ${formatNumber(totalFuelToday, this.hass, 1)} kg
              </div>
              <div class="tile-sub">
                ${this._t("Łącznie", "Total")}: ${formatNumber(totalFuelAll, this.hass, 1)} kg
              </div>
            </div>

            <div class="summary-tile energy">
              <div class="tile-label">
                <ha-icon icon="mdi:fire"></ha-icon>
                ${this._t("Energia cieplna (dziś)", "Thermal energy (today)")}
              </div>
              <div class="tile-val">
                ${formatNumber(totalKwhToday, this.hass, 1)} kWh
              </div>
              <div class="tile-sub">
                ${this._t("Łącznie", "Total")}: ${formatNumber(totalKwhAll, this.hass, 1)} kWh
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
              </div>
            </div>

            <div class="summary-tile ${totalAlerts > 0 ? "alert" : "ok"}">
              <div class="tile-label">
                <ha-icon icon=${totalAlerts > 0 ? "mdi:bell-alert" : "mdi:check-circle-outline"}></ha-icon>
                ${this._t("Alerty obsługi", "Maintenance alerts")}
              </div>
              <div class="tile-val">${totalAlerts}</div>
              <div class="tile-sub">
                ${
                  totalAlerts > 0
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

          ${this._renderSelectedSensors(selected, live)}
          ${this._renderMaintenanceSection(selected, live)}
          ${this._renderFuelLogBar(selected)}
          ${this._renderPeriodStats(selected, history)}
          ${this._renderHistoryChart(selected, history)}
        </div>
      </rs-list-card>
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
      icon: string;
      entity?: string;
      tone?: string;
    }> = [];

    if (live?.supply_temp != null || plant.supply_temp_sensor) {
      const targetTemp =
        live?.state === "hold" ? plant.idle_supply_temp : plant.target_supply_temp;
      const targetStr =
        targetTemp > 0 ? ` → ${formatTempLocale(targetTemp, this.hass, 0, 1)}${unit}` : "";
      cells.push({
        label: this._t("Zasilanie", "Supply"),
        val: `${fmtTemp(live?.supply_temp)}${targetStr}`,
        icon: "mdi:thermometer-chevron-up",
        entity: plant.supply_temp_sensor,
        tone: live?.overheat_protect ? "err" : undefined,
      });
    }
    if (live?.return_temp != null || plant.return_temp_sensor) {
      cells.push({
        label: this._t("Powrót", "Return"),
        val: fmtTemp(live?.return_temp),
        icon: "mdi:thermometer-chevron-down",
        entity: plant.return_temp_sensor,
        tone: live?.low_return_warning ? "warn" : undefined,
      });
    }
    if (live?.delta_t != null) {
      cells.push({
        label: "ΔT",
        val: `${formatNumber(live.delta_t, this.hass, 1)} K`,
        icon: "mdi:delta",
      });
    }
    if (live?.dhw_temp != null || plant.dhw_temp_sensor) {
      cells.push({
        label: this._t("CWU (bojler)", "DHW tank"),
        val: fmtTemp(live?.dhw_temp),
        icon: "mdi:water-boiler",
        entity: plant.dhw_temp_sensor,
      });
    }
    if (live?.flue_temp != null || plant.flue_temp_sensor) {
      cells.push({
        label: this._t("Spaliny", "Flue gas"),
        val: fmtTemp(live?.flue_temp),
        icon: "mdi:smoke",
        entity: plant.flue_temp_sensor,
      });
    }
    if (live?.current_thermal_kw != null) {
      cells.push({
        label: this._t("Moc cieplna", "Thermal power"),
        val: `${formatNumber(live.current_thermal_kw, this.hass, 2)} kW`,
        icon: "mdi:flash",
        entity: plant.energy_sensor,
      });
    }
    if (live?.burn_rate_per_h != null) {
      cells.push({
        label: this._t("Spalanie chwilowe", "Burn rate"),
        val: `${formatNumber(live.burn_rate_per_h, this.hass, 2)} ${fuelUnit}/h`,
        icon: "mdi:fire-circle",
        entity: plant.feeder_entity || plant.fuel_consumption_sensor,
      });
    }
    cells.push({
      label: this._t("Spalono dziś", "Burned today"),
      val: `${formatNumber(live?.fuel_consumed_today ?? 0, this.hass, 2)} ${fuelUnit}`,
      icon: "mdi:scale",
      entity: plant.fuel_consumption_sensor,
    });
    if (live?.fuel_remaining_kg != null) {
      const pct = live.hopper_pct != null ? ` (${Math.round(live.hopper_pct)}%)` : "";
      cells.push({
        label: this._t("W zasobniku", "Hopper left"),
        val: `${formatNumber(live.fuel_remaining_kg, this.hass, 1)} kg${pct}`,
        icon: "mdi:silo",
        entity: plant.hopper_level_sensor,
        tone: live.refill_needed ? "warn" : undefined,
      });
    }
    if (live?.estimated_ash_kg != null && live.estimated_ash_kg > 0) {
      cells.push({
        label: this._t("Szac. popiół", "Est. ash"),
        val: `${formatNumber(live.estimated_ash_kg, this.hass, 2)} kg`,
        icon: "mdi:delete-sweep",
        tone: live.ash_clean_needed ? "warn" : undefined,
      });
    }

    const badges: Array<{ text: string; warn?: boolean }> = [];
    if (live?.low_return_warning) {
      badges.push({
        text: this._t("Uwaga: zimny powrót (<45°C — ryzyko kondensacji)", "Warning: cold return (<45°C)"),
        warn: true,
      });
    }
    if (live?.cannot_extinguish || plant.cannot_extinguish) {
      badges.push({
        text: this._t("Podtrzymanie ognia (bez wygaszania)", "Non-extinguishable fire-hold"),
      });
    }
    if (live?.feeder_active) {
      badges.push({ text: this._t("Podajnik AKTYWNY", "Feeder ON") });
    }
    if (live?.ch_pump_active) {
      badges.push({
        text: this._t("Pompa C.O. ON", "C.O. Pump ON"),
      });
    }
    if (live?.ufh_pump_active) {
      badges.push({
        text: this._t("Pompa podłogówki ON", "UFH Pump ON"),
      });
    }
    if (live?.ufh_overheat_protect) {
      badges.push({
        text: this._t("Ochrona podłogówki: pompa zatrzymana!", "UFH overheat cutoff!"),
        warn: true,
      });
    }
    if (live?.dhw_pump_active) {
      badges.push({ text: this._t("Pompa CWU ON", "DHW Pump ON") });
    }
    if (plant.parent_plant_id) {
      const parent = this.heatPlants.find((p) => p.id === plant.parent_plant_id);
      if (parent) {
        badges.push({ text: `${this._t("Zasilane z", "Fed by")}: ${parent.name}` });
      }
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
            </div>
          `,
        )}
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
            <span>${this._t("Dołożenie opału / Zasobnik", "Refuel / Hopper")}</span>
            ${
              live?.refill_needed
                ? html`<span class="maint-badge">${this._t("DOŁÓŻ!", "REFILL!")}</span>`
                : nothing
            }
          </div>
          <div class="maint-info">
            ${
              live?.fuel_remaining_kg != null
                ? `${formatNumber(live.fuel_remaining_kg, this.hass, 1)} kg`
                : this._t("Brak danych zasobnika", "No hopper data")
            }${hopperPct != null ? ` (${Math.round(hopperPct)}%)` : ""}
            · ${this._t("Od zasypu", "Since refill")}:
            ${formatNumber(live?.fuel_since_refill_kg ?? 0, this.hass, 1)} kg
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
          <button
            type="button"
            class="maint-btn"
            ?disabled=${this._busyAction === `${plant.id}:refill`}
            @click=${() => this._confirmMaintenance(plant.id, "refill")}
          >
            <ha-icon icon="mdi:check"></ha-icon>
            ${this._t("Potwierdź dołożenie / zasyp", "Confirm refuel")}
          </button>
        </div>

        <div class="maint-card ${live?.ash_clean_needed ? "warn" : ""}">
          <div class="maint-head">
            <ha-icon icon="mdi:delete-sweep"></ha-icon>
            <span>${this._t("Zbiornik na popiół", "Ash container")}</span>
            ${
              live?.ash_clean_needed
                ? html`<span class="maint-badge">${this._t("OPRÓŻNIJ!", "EMPTY!")}</span>`
                : nothing
            }
          </div>
          <div class="maint-info">
            ${formatNumber(ashKg, this.hass, 1)} / ${ashIntKg || "—"} kg ·
            ${formatNumber(ashDays, this.hass, 1)} / ${ashIntDays || "—"} d
            ${
              live?.estimated_ash_kg != null
                ? ` · ~${formatNumber(live.estimated_ash_kg, this.hass, 1)} kg ${this._t("popiołu", "ash")}`
                : ""
            }
          </div>
          <div class="progress">
            <div
              class="progress-fill ${live?.ash_clean_needed ? "warn" : ""}"
              style="width: ${Math.max(2, ashPct)}%"
            ></div>
          </div>
          <button
            type="button"
            class="maint-btn"
            ?disabled=${this._busyAction === `${plant.id}:ash_cleaned`}
            @click=${() => this._confirmMaintenance(plant.id, "ash_cleaned")}
          >
            <ha-icon icon="mdi:broom"></ha-icon>
            ${this._t("Opróżniono popielnik", "Ash tray emptied")}
          </button>
        </div>

        <div class="maint-card ${live?.chimney_clean_needed ? "warn" : ""}">
          <div class="maint-head">
            <ha-icon icon="mdi:chimney"></ha-icon>
            <span>${this._t("Czyszczenie komina", "Chimney cleaning")}</span>
            ${
              live?.chimney_clean_needed
                ? html`<span class="maint-badge">${this._t("WYCZYŚĆ!", "CLEAN!")}</span>`
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
          <button
            type="button"
            class="maint-btn"
            ?disabled=${this._busyAction === `${plant.id}:chimney_cleaned`}
            @click=${() => this._confirmMaintenance(plant.id, "chimney_cleaned")}
          >
            <ha-icon icon="mdi:brush"></ha-icon>
            ${this._t("Wyczyszczono komin", "Chimney cleaned")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderFuelLogBar(plant: HeatPlantConfig) {
    if (
      plant.fuel_type !== "coal" &&
      plant.fuel_type !== "pellet" &&
      plant.fuel_type !== "wood"
    )
      return nothing;
    return html`
      <div class="fuel-log-bar">
        <span class="fuel-log-label">
          <ha-icon icon="mdi:weight-kilogram"></ha-icon>
          ${this._t("Szybki wpis opału (kg):", "Quick fuel log (kg):")}
        </span>
        <input
          type="number"
          min="0.5"
          max="5000"
          step="1"
          .value=${String(this._fuelInputKg)}
          @input=${(e: Event) => {
            this._fuelInputKg = Number((e.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          class="fuel-btn primary"
          ?disabled=${!!this._busyAction}
          @click=${() => this._logFuel(plant.id, "refill")}
        >
          ${this._t("+ Dosyp do zasobnika", "+ Refill hopper")}
        </button>
        <button
          type="button"
          class="fuel-btn"
          ?disabled=${!!this._busyAction}
          @click=${() => this._logFuel(plant.id, "burned")}
        >
          ${this._t("+ Zapisz spalone (kg)", "+ Log burned (kg)")}
        </button>
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

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.supply_temp != null) supplyVals.push(p.supply_temp);
      if (p.return_temp != null) returnVals.push(p.return_temp);
      if (p.flue_temp != null) flueVals.push(p.flue_temp);
      if (p.thermal_kw != null) kwVals.push(p.thermal_kw);

      if (p.fuel_consumed_today != null) {
        if (prevFuelToday != null) {
          if (p.fuel_consumed_today >= prevFuelToday) {
            fuelPeriod += p.fuel_consumed_today - prevFuelToday;
          } else {
            // Midnight rollover: new day's cumulative counter started from 0
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
    const heatH = heatSec / 3600;
    const holdH = holdSec / 3600;
    const idleH = idleSec / 3600;
    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : null);

    const avgSup = avg(supplyVals);
    const maxSup = max(supplyVals);
    const avgRet = avg(returnVals);
    const maxFlue = max(flueVals);
    const avgKw = avg(kwVals);
    const maxKw = max(kwVals);

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
                    ${this._t("Grzanie", "Heating")}: <b>${formatNumber(heatH, this.hass, 1)} h</b>
                  </span>
                  ${
                    holdSec > 0 || plant.cannot_extinguish
                      ? html`<span>
                          <i class="dot bar-hold"></i>
                          ${this._t("Podtrzymanie", "Fire-hold")}:
                          <b>${formatNumber(holdH, this.hass, 1)} h</b>
                        </span>`
                      : nothing
                  }
                  <span>
                    <i class="dot bar-idle"></i>
                    ${this._t("Czuwanie", "Idle")}: <b>${formatNumber(idleH, this.hass, 1)} h</b>
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
                  <b>${formatNumber(avgKw, this.hass, 1)} / ${formatNumber(maxKw!, this.hass, 1)} kW</b>
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
    const mk = (fn: (p: HeatPlantHistoryPoint) => number | null) =>
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
        name: `${this._t("Zasilanie", "Supply")} (${unit})`,
        color: "#ff5722",
        yAxisIndex: 0,
        data: mk((p) => p.supply_temp),
        lineStyle: { width: 2 },
      },
      {
        id: "return_temp",
        name: `${this._t("Powrót", "Return")} (${unit})`,
        color: "#2196f3",
        yAxisIndex: 0,
        data: mk((p) => p.return_temp),
        lineStyle: { width: 1.8 },
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
        id: "flue_temp",
        name: `${this._t("Spaliny", "Flue")} (${unit})`,
        color: "#9e9e9e",
        yAxisIndex: 0,
        data: mk((p) => p.flue_temp),
        lineStyle: { width: 1.3, type: "dotted" },
      },
      {
        id: "thermal_kw",
        name: `${this._t("Moc", "Power")} (kW)`,
        color: "#ff9800",
        yAxisIndex: 1,
        data: mk((p) => p.thermal_kw),
        lineStyle: { width: 1.8 },
        areaStyle: { color: "#ff9800", opacity: 0.12 },
      },
      {
        id: "burn_rate_per_h",
        name: `${this._t("Spalanie", "Burn rate")} (${fuelUnit}/h)`,
        color: "#8d6e63",
        yAxisIndex: 1,
        data: mk((p) => p.burn_rate_per_h),
        lineStyle: { width: 1.5, type: "dashed" },
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
            "Wykres temperatur, mocy i spalania",
            "Temperatures, thermal power & burn rate",
          )}
          — ${plant.name}
        </div>
        <ha-chart-base
          .hass=${this.hass}
          .data=${plotted}
          .options=${options}
          height="240px"
          style="height: 240px; --chart-max-height: 240px"
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

      .sensor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
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
        border-color: color-mix(in srgb, var(--rs-warn) 50%, transparent);
      }

      .sensor-cell.err {
        border-color: color-mix(in srgb, var(--rs-err) 60%, transparent);
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

      .maint-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, transparent);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        --mdc-icon-size: 15px;
      }

      .maint-btn:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .fuel-log-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: var(--rs-radius-sm);
        background: var(--rs-fill);
      }

      .fuel-log-label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 13px;
        font-weight: 500;
        --mdc-icon-size: 16px;
      }

      .fuel-log-bar input {
        width: 82px;
        padding: 5px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        font-size: 13px;
        font-family: inherit;
      }

      .fuel-btn {
        padding: 6px 11px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }

      .fuel-btn.primary {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .fuel-btn:hover:not(:disabled) {
        background: var(--rs-fill-primary);
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

      .meta-badge.warn {
        background: color-mix(in srgb, var(--rs-warn) 18%, transparent);
        color: var(--rs-warn-text);
        font-weight: 500;
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
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-heat-plants": RsAnalyticsHeatPlants;
  }
}
