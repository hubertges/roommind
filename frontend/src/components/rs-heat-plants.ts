/**
 * rs-heat-plants – Dedicated tab for boilers (coal/pellet/wood/gas), air/water heaters, and heat pumps.
 * Monitors supply/return/DHW/flue temperatures, circulation pumps (C.O. & CWU),
 * fuel calorific value (MJ/kg -> kWh/kg), burn rate & energy costs, and allows editing
 * which radiators (TRVs), underfloor systems, and rooms each heat plant serves.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  RoomConfig,
  HeatPlantConfig,
  HeatPlantLive,
  HeatPlantType,
  FuelType,
} from "../types";
import { tokens, alertStyles } from "../styles/tokens";
import { inputStyles } from "../styles/input-styles";
import { formStyles } from "../styles/form-styles";
import { formatTempLocale, tempUnit } from "../utils/temperature";
import { formatNumber } from "../utils/format";
import { fireSaveStatus, openEntityInfo } from "../utils/events";
import "./shared/rs-list-card";
import "./shared/rs-list-row";
import "./shared/rs-edit-dialog";
import "./shared/rs-icon-button";
import "./shared/rs-confirm-button";
import "./shared/rs-number-field";
import "./shared/rs-field";
import "./shared/rs-segmented";
import "./shared/rs-badge";

interface CalorificPreset {
  id: string;
  labelPl: string;
  labelEn: string;
  fuelType: FuelType;
  mjKg: number;
  efficiency: number;
}

const COAL_AND_FUEL_PRESETS: CalorificPreset[] = [
  {
    id: "anthracite",
    labelPl: "Węgiel kamienny wysokiej jakości (28 MJ/kg)",
    labelEn: "High-grade hard coal (28 MJ/kg)",
    fuelType: "coal",
    mjKg: 28.0,
    efficiency: 84,
  },
  {
    id: "ekogroszek",
    labelPl: "Ekogroszek (26 MJ/kg)",
    labelEn: "Ekogroszek pea coal (26 MJ/kg)",
    fuelType: "coal",
    mjKg: 26.0,
    efficiency: 86,
  },
  {
    id: "coal_standard",
    labelPl: "Węgiel kamienny standard (24 MJ/kg)",
    labelEn: "Standard hard coal (24 MJ/kg)",
    fuelType: "coal",
    mjKg: 24.0,
    efficiency: 80,
  },
  {
    id: "coal_fine",
    labelPl: "Miał węglowy (21 MJ/kg)",
    labelEn: "Coal fines (21 MJ/kg)",
    fuelType: "coal",
    mjKg: 21.0,
    efficiency: 76,
  },
  {
    id: "pellet",
    labelPl: "Pellet drzewny A1 (18 MJ/kg)",
    labelEn: "Wood pellet A1 (18 MJ/kg)",
    fuelType: "pellet",
    mjKg: 18.0,
    efficiency: 90,
  },
  {
    id: "wood",
    labelPl: "Drewno opałowe sezonowane (14.5 MJ/kg)",
    labelEn: "Seasoned firewood (14.5 MJ/kg)",
    fuelType: "wood",
    mjKg: 14.5,
    efficiency: 78,
  },
];

@customElement("rs-heat-plants")
export class RsHeatPlants extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};

  @state() private _editingId: string | null = null;
  @state() private _draft: HeatPlantConfig | null = null;

  static styles = [
    tokens,
    alertStyles,
    inputStyles,
    formStyles,
    css`
      :host {
        display: block;
      }

      .header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--rs-space-3);
        margin-bottom: var(--rs-space-4);
      }

      .header-title h2 {
        margin: 0;
        font-size: var(--rs-font-lg);
        font-weight: 500;
      }

      .header-title p {
        margin: 4px 0 0;
        font-size: var(--rs-font-sm);
        color: var(--secondary-text-color);
      }

      .plants-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--rs-space-4);
      }

      .plant-card {
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-4);
      }

      .plant-top {
        display: flex;
        align-items: center;
        gap: var(--rs-space-3);
      }

      .plant-icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
        flex: none;
        --mdc-icon-size: 24px;
      }

      .plant-icon.active {
        background: color-mix(in srgb, var(--rs-heat) 18%, transparent);
        color: var(--rs-heat);
      }

      .plant-icon.overheat {
        background: color-mix(in srgb, var(--rs-err) 20%, transparent);
        color: var(--rs-err);
      }

      .plant-heading {
        flex: 1;
        min-width: 0;
      }

      .plant-heading h3 {
        margin: 0;
        font-size: var(--rs-font-md);
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .plant-sub {
        font-size: var(--rs-font-sm);
        color: var(--secondary-text-color);
        margin-top: 2px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
      }

      .status-pill.active {
        background: color-mix(in srgb, var(--rs-heat) 16%, transparent);
        color: var(--rs-heat-text);
      }

      .status-pill.overheat {
        background: color-mix(in srgb, var(--rs-err) 18%, transparent);
        color: var(--rs-err-text);
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--rs-space-3);
      }

      .metric-tile {
        background: var(--rs-fill);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .metric-label {
        font-size: 12px;
        color: var(--secondary-text-color);
        display: flex;
        align-items: center;
        gap: 4px;
        --mdc-icon-size: 15px;
      }

      .metric-val {
        font-size: 18px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }

      .metric-sub {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .section-box {
        border-top: 1px solid var(--divider-color);
        padding-top: 12px;
      }

      .section-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--secondary-text-color);
        margin: 0 0 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .chips-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .dev-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 8px;
        font-size: 12px;
        background: var(--rs-fill);
        color: var(--primary-text-color);
        border: 1px solid transparent;
        --mdc-icon-size: 15px;
      }

      .dev-chip.heating {
        background: color-mix(in srgb, var(--rs-heat) 14%, transparent);
        border-color: color-mix(in srgb, var(--rs-heat) 40%, transparent);
        color: var(--rs-heat-text);
        font-weight: 500;
      }

      .dialog-body {
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-4);
      }

      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--rs-space-3);
      }

      @media (max-width: 600px) {
        .pair {
          grid-template-columns: 1fr;
        }
      }

      .preset-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      .preset-btn {
        background: var(--rs-fill);
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        color: var(--primary-text-color);
        cursor: pointer;
      }

      .preset-btn:hover {
        border-color: var(--primary-color);
      }

      .radiator-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 280px;
        overflow-y: auto;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 6px;
      }

      .radiator-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
      }

      .radiator-item:hover {
        background: var(--rs-fill);
      }

      .radiator-item input {
        cursor: pointer;
      }

      .radiator-room {
        color: var(--secondary-text-color);
        font-size: 12px;
        margin-left: auto;
      }

      .empty-state {
        text-align: center;
        padding: 48px 20px;
        color: var(--secondary-text-color);
      }

      .empty-state ha-icon {
        --mdc-icon-size: 48px;
        opacity: 0.5;
        margin-bottom: 12px;
      }

      .footer-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: var(--rs-space-4);
        padding-top: var(--rs-space-3);
        border-top: 1px solid var(--divider-color);
      }
    `,
  ];

  private get _isPl(): boolean {
    return (this.hass?.language ?? "pl").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  private _plantTypeLabel(type: HeatPlantType): string {
    const map: Record<HeatPlantType, [string, string]> = {
      coal_boiler: ["Piec węglowy / Ekogroszek", "Coal / Pea-coal boiler"],
      pellet_boiler: ["Kocioł na pellet", "Pellet boiler"],
      wood_boiler: ["Kocioł drzewny / zgazowujący", "Wood boiler"],
      gas_boiler: ["Kocioł gazowy", "Gas boiler"],
      electric_heater: ["Kocioł / grzałka elektryczna", "Electric boiler"],
      air_heater: ["Nagrzewnica powietrzna / wodna", "Air / water heater"],
      heat_pump: ["Pompa ciepła", "Heat pump"],
    };
    const pair = map[type] ?? map.coal_boiler;
    return this._t(pair[0], pair[1]);
  }

  private _plantIcon(type: HeatPlantType): string {
    switch (type) {
      case "coal_boiler":
      case "pellet_boiler":
      case "wood_boiler":
        return "mdi:fireplace";
      case "gas_boiler":
        return "mdi:water-boiler";
      case "air_heater":
        return "mdi:fan-chevron-up";
      case "heat_pump":
        return "mdi:heat-pump-outline";
      case "electric_heater":
        return "mdi:heating-coil";
    }
  }

  private _stateLabel(state?: HeatPlantLive["state"], enabled = true): string {
    if (!enabled) return this._t("Wyłączony", "Disabled");
    switch (state) {
      case "heating":
        return this._t("Grzanie C.O.", "Heating C.O.");
      case "dhw":
        return this._t("Ładowanie CWU", "Charging DHW");
      case "heating_and_dhw":
        return this._t("Grzanie C.O. + CWU", "Heating C.O. + DHW");
      case "overheat_protect":
        return this._t("Chłodzenie awaryjne kotła!", "Emergency overheat cooling!");
      case "active":
        return this._t("Praca", "Active");
      default:
        return this._t("Czuwanie", "Standby");
    }
  }

  render() {
    if (!this.hass) return nothing;
    return html`
      <div class="header-bar">
        <div class="header-title">
          <h2>${this._t("Źródła ciepła i kotłownia", "Heat Plants & Boiler Room")}</h2>
          <p>
            ${this._t(
              "Obsługa pieców, nagrzewnic i pomp ciepła, pomp obiegowych C.O./CWU, termometrów zasilania/powrotu oraz kosztów i kaloryczności opału.",
              "Manage boilers, heaters, heat pumps, circulation pumps, supply/return/DHW thermometers, fuel calorific value, and energy costs.",
            )}
          </p>
        </div>
        <ha-button @click=${this._onAddPlant}>
          <ha-icon icon="mdi:plus" slot="icon"></ha-icon>
          ${this._t("Dodaj źródło ciepła", "Add heat source")}
        </ha-button>
      </div>

      ${
        this.heatPlants.length === 0
          ? html`<ha-card class="empty-state">
              <ha-icon icon="mdi:water-boiler"></ha-icon>
              <h3>${this._t("Brak skonfigurowanych źródeł ciepła", "No heat sources configured")}</h3>
              <p>
                ${this._t(
                  "Dodaj piec węglowy, kocioł na pellet/gaz, nagrzewnicę lub pompę ciepła, przypisz obsługiwane kaloryfery i termometry zasilania/powrotu/CWU.",
                  "Add a coal/pellet/gas boiler, air heater, or heat pump, and assign radiators and supply/return/DHW sensors.",
                )}
              </p>
              <ha-button @click=${this._onAddPlant}>
                ${this._t("Dodaj pierwsze źródło ciepła", "Add first heat source")}
              </ha-button>
            </ha-card>`
          : html`<div class="plants-grid">
              ${this.heatPlants.map((plant) =>
                this._renderPlantCard(plant, this.heatPlantsLive[plant.id]),
              )}
            </div>`
      }

      ${this._draft ? this._renderEditDialog(this._draft) : nothing}
    `;
  }

  private _renderPlantCard(plant: HeatPlantConfig, live?: HeatPlantLive) {
    const unit = tempUnit(this.hass);
    const fmtTemp = (v: number | null | undefined) =>
      v != null ? `${formatTempLocale(v, this.hass, 1, 1)}\u00a0${unit}` : "--";
    const isActive =
      live?.source_active ||
      live?.state === "heating" ||
      live?.state === "dhw" ||
      live?.state === "heating_and_dhw";
    const isOverheat = live?.overheat_protect ?? false;
    const isSolidFuel =
      plant.fuel_type === "coal" || plant.fuel_type === "pellet" || plant.fuel_type === "wood";
    const chemKwhKg = plant.calorific_value_mj_kg / 3.6;
    const usableKwhKg = chemKwhKg * (plant.efficiency_pct / 100);
    const fuelUnit =
      live?.fuel_unit ??
      (isSolidFuel ? "kg" : plant.fuel_type === "gas" ? "m³" : "kWh");

    return html`<ha-card class="plant-card">
      <div class="plant-top">
        <div class="plant-icon ${isOverheat ? "overheat" : isActive ? "active" : ""}">
          <ha-icon .icon=${this._plantIcon(plant.plant_type)}></ha-icon>
        </div>
        <div class="plant-heading">
          <h3>
            <span>${plant.name || this._plantTypeLabel(plant.plant_type)}</span>
            <span class="status-pill ${isOverheat ? "overheat" : isActive ? "active" : ""}">
              ${this._stateLabel(live?.state, plant.enabled)}
              ${
                isActive && live?.mean_power_pct
                  ? ` · ${live.mean_power_pct}%`
                  : ""
              }
            </span>
          </h3>
          <div class="plant-sub">
            ${this._plantTypeLabel(plant.plant_type)}
            ${
              plant.source_entity
                ? ` · ${this._entityFriendlyName(plant.source_entity)}`
                : ""
            }
          </div>
        </div>
        <rs-icon-button
          icon="mdi:pencil-outline"
          .label=${this._t("Edytuj źródło ciepła", "Edit heat source")}
          @click=${() => this._onEditPlant(plant)}
        ></rs-icon-button>
      </div>

      <!-- Thermometers: Supply, Return, Delta-T, DHW (CWU), Flue -->
      <div class="metrics-grid">
        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:thermometer-chevron-up"></ha-icon>
            ${this._t("Zasilanie C.O.", "Supply Temp")}
          </span>
          <span class="metric-val">${fmtTemp(live?.supply_temp)}</span>
          <span class="metric-sub">
            ${
              plant.target_supply_temp
                ? `${this._t("Zadana", "Target")}: ${fmtTemp(plant.target_supply_temp)}`
                : this._t("Brak czujnika", "No sensor")
            }
          </span>
        </div>

        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:thermometer-chevron-down"></ha-icon>
            ${this._t("Powrót C.O.", "Return Temp")}
          </span>
          <span class="metric-val">${fmtTemp(live?.return_temp)}</span>
          <span class="metric-sub">
            ${
              live?.delta_t != null
                ? `ΔT (Zasilanie−Powrót): ${formatNumber(live.delta_t, this.hass, 1)} K`
                : this._t("ΔT niedostępne", "ΔT unavailable")
            }
          </span>
        </div>

        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:water-thermometer"></ha-icon>
            ${this._t("Ciepła woda (CWU)", "DHW (CWU)")}
          </span>
          <span class="metric-val">${fmtTemp(live?.dhw_temp)}</span>
          <span class="metric-sub">
            ${this._t("Zadana CWU", "DHW Target")}: ${fmtTemp(plant.dhw_target_temp)}
            (±${plant.dhw_hysteresis} K)
          </span>
        </div>

        ${
          plant.flue_temp_sensor
            ? html`<div class="metric-tile">
                <span class="metric-label">
                  <ha-icon icon="mdi:smoke"></ha-icon>
                  ${this._t("Spaliny / Bufor", "Flue / Buffer")}
                </span>
                <span class="metric-val">${fmtTemp(live?.flue_temp)}</span>
                <span class="metric-sub">${this._entityFriendlyName(plant.flue_temp_sensor)}</span>
              </div>`
            : nothing
        }

        <!-- Circulation Pumps: C.O. & CWU -->
        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:pump"></ha-icon>
            ${this._t("Pompa obiegowa C.O.", "C.O. Pump")}
          </span>
          <span class="metric-val">
            ${
              !plant.ch_pump_entity
                ? "--"
                : live?.ch_pump_active
                  ? this._t("Włączona", "Running")
                  : this._t("Wyłączona", "Off")
            }
          </span>
          <span class="metric-sub">
            ${
              live?.ch_pump_blocked_cold
                ? this._t(
                    `Czeka na nagrzanie (> ${plant.ch_pump_min_supply_temp}°C)`,
                    `Waiting for supply > ${plant.ch_pump_min_supply_temp}°C`,
                  )
                : `${this._t("Start od", "Start >")} ${plant.ch_pump_min_supply_temp}°C`
            }
          </span>
        </div>

        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:pump"></ha-icon>
            ${this._t("Pompa CWU", "DHW Pump")}
          </span>
          <span class="metric-val">
            ${
              !plant.dhw_pump_entity
                ? "--"
                : live?.dhw_pump_active
                  ? this._t("Włączona", "Running")
                  : this._t("Wyłączona", "Off")
            }
          </span>
          <span class="metric-sub">
            ${
              live?.dhw_pump_blocked_cold
                ? this._t("Zasilanie zimniejsze niż CWU", "Supply colder than DHW")
                : plant.dhw_pump_entity
                  ? this._entityFriendlyName(plant.dhw_pump_entity)
                  : this._t("Nie przypisano", "Not assigned")
            }
          </span>
        </div>
      </div>

      <!-- Energy, Coal Calorific Value & Cost Telemetry -->
      <div class="section-box">
        <div class="section-title">
          <span>
            ${this._t(
              "Obserwacja kosztów spalania energii i kaloryczności",
              "Fuel Calorific Value & Energy Cost Telemetry",
            )}
          </span>
          <button
            type="button"
            class="preset-btn"
            @click=${() => this._onResetStats(plant.id)}
          >
            ${this._t("Zeruj liczniki", "Reset counters")}
          </button>
        </div>

        <div class="metrics-grid">
          ${
            isSolidFuel
              ? html`<div class="metric-tile">
                  <span class="metric-label">
                    <ha-icon icon="mdi:fire-circle"></ha-icon>
                    ${this._t("Kaloryczność opału", "Fuel Calorific Value")}
                  </span>
                  <span class="metric-val">
                    ${formatNumber(plant.calorific_value_mj_kg, this.hass, 1)} MJ/kg
                  </span>
                  <span class="metric-sub">
                    ${formatNumber(chemKwhKg, this.hass, 2)} kWh/kg
                    (${this._t("użyteczne", "usable")}:
                    ${formatNumber(usableKwhKg, this.hass, 2)} kWh/kg @ ${plant.efficiency_pct}%)
                  </span>
                </div>`
              : plant.plant_type === "heat_pump"
                ? html`<div class="metric-tile">
                    <span class="metric-label">
                      <ha-icon icon="mdi:lightning-bolt"></ha-icon>
                      ${this._t("Sprawność (COP)", "Efficiency (COP)")}
                    </span>
                    <span class="metric-val">COP ${formatNumber(plant.cop, this.hass, 2)}</span>
                    <span class="metric-sub">
                      ${this._t("Moc grzewcza", "Nominal")}: ${plant.nominal_power_kw} kW
                    </span>
                  </div>`
                : html`<div class="metric-tile">
                    <span class="metric-label">
                      <ha-icon icon="mdi:gauge"></ha-icon>
                      ${this._t("Sprawność źródła", "Source Efficiency")}
                    </span>
                    <span class="metric-val">${plant.efficiency_pct}%</span>
                    <span class="metric-sub">
                      ${
                        plant.fuel_type === "gas"
                          ? `${formatNumber(plant.calorific_value_kwh_m3, this.hass, 1)} kWh/m³`
                          : `${plant.nominal_power_kw} kW`
                      }
                    </span>
                  </div>`
          }

          <div class="metric-tile">
            <span class="metric-label">
              <ha-icon icon="mdi:flash"></ha-icon>
              ${this._t("Moc i spalanie chwilowe", "Current Power & Burn Rate")}
            </span>
            <span class="metric-val">
              ${formatNumber(live?.current_thermal_kw ?? 0, this.hass, 2)} kW
            </span>
            <span class="metric-sub">
              ${formatNumber(live?.burn_rate_per_h ?? 0, this.hass, 2)} ${fuelUnit}/h ·
              ${formatNumber(live?.cost_per_hour ?? 0, this.hass, 2)} ${plant.currency}/h
            </span>
          </div>

          <div class="metric-tile">
            <span class="metric-label">
              <ha-icon icon="mdi:scale-balance"></ha-icon>
              ${this._t("Zużycie (Dzisiaj / Łącznie)", "Consumption (Today / Total)")}
            </span>
            <span class="metric-val">
              ${formatNumber(live?.fuel_consumed_today ?? 0, this.hass, 2)} ${fuelUnit}
            </span>
            <span class="metric-sub">
              ${this._t("Łącznie", "Total")}:
              ${formatNumber(live?.fuel_consumed_total ?? 0, this.hass, 1)} ${fuelUnit}
              (${formatNumber(live?.thermal_kwh_today ?? 0, this.hass, 1)} kWh
              ${this._t("ciepła dziś", "heat today")})
            </span>
          </div>

          <div class="metric-tile">
            <span class="metric-label">
              <ha-icon icon="mdi:cash-multiple"></ha-icon>
              ${this._t("Koszt (Dzisiaj / Łącznie)", "Cost (Today / Total)")}
            </span>
            <span class="metric-val">
              ${formatNumber(live?.cost_today ?? 0, this.hass, 2)} ${plant.currency}
            </span>
            <span class="metric-sub">
              ${this._t("Łącznie", "Total")}:
              ${formatNumber(live?.cost_total ?? 0, this.hass, 2)} ${plant.currency} ·
              ${formatNumber(live?.cost_per_kwh_thermal ?? 0, this.hass, 2)}
              ${plant.currency}/kWh
            </span>
          </div>
        </div>
      </div>

      <!-- Assigned Radiators & Heating Systems -->
      <div class="section-box">
        <div class="section-title">
          <span>
            ${this._t(
              "Obsługiwane kaloryfery i ogrzewania",
              "Served Radiators & Heating Systems",
            )}
          </span>
          <span>
            ${
              live?.demanding_rooms?.length
                ? this._t(
                    `Aktywne pokoje: ${live.demanding_rooms.length}`,
                    `Active rooms: ${live.demanding_rooms.length}`,
                  )
                : this._t("Brak żądania grzania", "No heating demand")
            }
          </span>
        </div>
        ${this._renderAssignedRadiators(plant, live)}
      </div>
    </ha-card>`;
  }

  private _renderAssignedRadiators(plant: HeatPlantConfig, live?: HeatPlantLive) {
    const activeDevs = new Set(live?.active_devices ?? []);
    const demandingRooms = new Set(live?.demanding_rooms ?? []);
    const chips: unknown[] = [];

    for (const eid of plant.assigned_devices) {
      const heating = activeDevs.has(eid);
      const roomName = this._findRoomNameForDevice(eid);
      chips.push(html`
        <span
          class="dev-chip ${heating ? "heating" : ""}"
          @click=${() => openEntityInfo(this, eid)}
          style="cursor: pointer"
        >
          <ha-icon icon=${heating ? "mdi:radiator" : "mdi:radiator-Disabled"}></ha-icon>
          <span>${this._entityFriendlyName(eid)}</span>
          ${roomName ? html`<small>(${roomName})</small>` : nothing}
        </span>
      `);
    }

    for (const areaId of plant.assigned_rooms) {
      const heating = demandingRooms.has(areaId);
      const room = this.rooms[areaId];
      const name = room?.display_name || this.hass.areas?.[areaId]?.name || areaId;
      const pwr = room?.live?.heating_power;
      chips.push(html`
        <span class="dev-chip ${heating ? "heating" : ""}">
          <ha-icon icon="mdi:home-thermometer-outline"></ha-icon>
          <span>${name}</span>
          ${heating && pwr ? html`<small>${pwr}%</small>` : nothing}
        </span>
      `);
    }

    if (chips.length === 0) {
      return html`<p class="plant-sub">
        ${this._t(
          "Nie przypisano jeszcze żadnych kaloryferów ani pokoi. Kliknij ikonę edycji, aby wybrać obsługiwane grzejniki i ogrzewania.",
          "No radiators or rooms assigned yet. Click the edit button to choose served radiators and heating systems.",
        )}
      </p>`;
    }

    return html`<div class="chips-row">${chips}</div>`;
  }

  private _renderEditDialog(draft: HeatPlantConfig) {
    const isSolidFuel =
      draft.fuel_type === "coal" || draft.fuel_type === "pellet" || draft.fuel_type === "wood";
    const chemKwh = (draft.calorific_value_mj_kg / 3.6).toFixed(2);
    const usableKwh = ((draft.calorific_value_mj_kg / 3.6) * (draft.efficiency_pct / 100)).toFixed(
      2,
    );

    const allRoomDevices = this._collectAllRoomHeatingDevices();

    return html`<rs-edit-dialog
      open
      icon=${this._plantIcon(draft.plant_type)}
      .heading=${draft.name || this._t("Konfiguracja źródła ciepła", "Heat Source Configuration")}
      @rs-dialog-closed=${this._closeDialog}
    >
      <div class="dialog-body">
        <!-- Basic identity & type -->
        <section class="group">
          <h4 class="group-title">${this._t("Podstawowe informacje", "General")}</h4>
          <div class="pair">
            <ha-textfield
              .label=${this._t("Nazwa źródła ciepła", "Heat source name")}
              .value=${draft.name}
              @input=${(e: Event) =>
                this._updateDraft({ name: (e.target as HTMLInputElement).value })}
            ></ha-textfield>

            <rs-number-field
              .label=${this._t("Min. liczba pokoi do startu", "Min demanding rooms to start")}
              .min=${1}
              .max=${50}
              .step=${1}
              .value=${draft.min_rooms_demand}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ min_rooms_demand: e.detail.value })}
            ></rs-number-field>
          </div>

          <rs-field .label=${this._t("Typ urządzenia", "Plant type")}>
            <rs-segmented
              wrap
              .label=${this._t("Typ urządzenia", "Plant type")}
              .options=${[
                { value: "coal_boiler", label: this._t("Piec węglowy", "Coal boiler") },
                { value: "pellet_boiler", label: this._t("Kocioł na pellet", "Pellet boiler") },
                { value: "wood_boiler", label: this._t("Kocioł drzewny", "Wood boiler") },
                { value: "gas_boiler", label: this._t("Kocioł gazowy", "Gas boiler") },
                { value: "air_heater", label: this._t("Nagrzewnica", "Air heater") },
                { value: "electric_heater", label: this._t("Kocioł elektr.", "Electric") },
                { value: "heat_pump", label: this._t("Pompa ciepła", "Heat pump") },
              ]}
              .value=${draft.plant_type}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._onPlantTypeChanged(e.detail.value as HeatPlantType)}
            ></rs-segmented>
          </rs-field>

          <rs-list-row
            switch
            .heading=${this._t("Aktywne sterowanie tym źródłem", "Enable active control")}
            .checked=${draft.enabled}
            @toggle-changed=${(e: CustomEvent<boolean>) =>
              this._updateDraft({ enabled: e.detail })}
          ></rs-list-row>
        </section>

        <!-- Assigned radiators & heating systems -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Obsługiwane kaloryfery, ogrzewania podłogowe i pokoje",
              "Served Radiators, Underfloor Heating & Rooms",
            )}
          </h4>
          <p class="note">
            ${this._t(
              "Zaznacz grzejniki (głowice TRV), ogrzewania podłogowe, nagrzewnice lub całe pokoje zasilane przez to źródło ciepła.",
              "Select radiators (TRVs), underfloor heating, heaters, or entire rooms supplied by this heat source.",
            )}
          </p>
          <div class="radiator-list">
            ${allRoomDevices.map((item) => {
              const checked = draft.assigned_devices.includes(item.entityId);
              return html`<label class="radiator-item">
                <input
                  type="checkbox"
                  .checked=${checked}
                  @change=${(e: Event) =>
                    this._toggleAssignedDevice(
                      item.entityId,
                      (e.target as HTMLInputElement).checked,
                    )}
                />
                <ha-icon
                  icon=${item.type === "ac" ? "mdi:heat-pump-outline" : "mdi:radiator"}
                ></ha-icon>
                <span>${item.name}</span>
                <span class="radiator-room">${item.roomName} · ${item.systemLabel}</span>
              </label>`;
            })}
            ${Object.entries(this.rooms)
              .filter(([, r]) => !r.is_outdoor)
              .map(([areaId, r]) => {
                const roomName = r.display_name || this.hass.areas?.[areaId]?.name || areaId;
                const checked = draft.assigned_rooms.includes(areaId);
                return html`<label class="radiator-item">
                  <input
                    type="checkbox"
                    .checked=${checked}
                    @change=${(e: Event) =>
                      this._toggleAssignedRoom(
                        areaId,
                        (e.target as HTMLInputElement).checked,
                      )}
                  />
                  <ha-icon icon="mdi:home-thermometer-outline"></ha-icon>
                  <span>${this._t("Cały pokój", "Whole room")}: ${roomName}</span>
                  <span class="radiator-room">${areaId}</span>
                </label>`;
              })}
          </div>
          <ha-entity-picker
            .hass=${this.hass}
            .includeDomains=${["climate"]}
            .label=${this._t(
              "Dodaj inny grzejnik / termostat (climate.*)",
              "Add another radiator / thermostat (climate.*)",
            )}
            .value=${""}
            @value-changed=${(e: CustomEvent) => {
              const id = e.detail?.value as string;
              (e.target as HTMLElement & { value: string }).value = "";
              if (id && !draft.assigned_devices.includes(id)) {
                this._updateDraft({ assigned_devices: [...draft.assigned_devices, id] });
              }
            }}
          ></ha-entity-picker>
        </section>

        <!-- Main Heat Source Entity & Supply Target -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Sterowanie piecem / pompą ciepła / nagrzewnicą",
              "Boiler / Heat Pump / Heater Control Entity",
            )}
          </h4>
          <ha-entity-picker
            .hass=${this.hass}
            .includeDomains=${["climate", "water_heater", "switch", "input_boolean", "fan"]}
            .label=${this._t(
              "Encja sterująca źródłem (climate, water_heater, switch, fan)",
              "Source control entity (climate, water_heater, switch, fan)",
            )}
            .value=${draft.source_entity}
            @value-changed=${(e: CustomEvent) =>
              this._updateDraft({ source_entity: (e.detail?.value as string) ?? "" })}
          ></ha-entity-picker>
          <div class="pair">
            <rs-number-field
              .label=${this._t("Zadana temp. zasilania (grzanie)", "Target supply temp (heating)")}
              suffix="°C"
              .min=${20}
              .max=${90}
              .step=${1}
              .value=${draft.target_supply_temp}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ target_supply_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Temp. zasilania w czuwaniu", "Idle supply temp")}
              suffix="°C"
              .min=${10}
              .max=${70}
              .step=${1}
              .value=${draft.idle_supply_temp}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ idle_supply_temp: e.detail.value })}
            ></rs-number-field>
          </div>
        </section>

        <!-- Thermometers: Supply, Return, DHW (CWU), Flue -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Termometry: Zasilanie, Powrót, CWU i Spaliny/Bufor",
              "Thermometers: Supply, Return, DHW (CWU) & Flue/Buffer",
            )}
          </h4>
          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr zasilania C.O.", "Supply temperature sensor")}
              .value=${draft.supply_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ supply_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr powrotu C.O.", "Return temperature sensor")}
              .value=${draft.return_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ return_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr CWU (bojler)", "DHW (CWU) temperature sensor")}
              .value=${draft.dhw_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr spalin / bufora (opcjonalnie)", "Flue / buffer temp sensor")}
              .value=${draft.flue_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ flue_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
        </section>

        <!-- Circulation Pumps: C.O. & CWU -->
        <section class="group">
          <h4 class="group-title">
            ${this._t("Obsługa pomp obiegowych C.O. oraz CWU", "C.O. & DHW Circulation Pumps")}
          </h4>
          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["switch", "input_boolean", "fan"]}
              .label=${this._t("Encja pompy obiegowej C.O.", "C.O. circulation pump entity")}
              .value=${draft.ch_pump_entity}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ ch_pump_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["switch", "input_boolean", "fan"]}
              .label=${this._t("Encja pompy ładującej CWU", "DHW (CWU) loading pump entity")}
              .value=${draft.dhw_pump_entity}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_pump_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
          <div class="pair">
            <rs-number-field
              .label=${this._t("Start pompy C.O. powyżej temp. zasilania", "Start C.O. pump above supply temp")}
              suffix="°C"
              .min=${0}
              .max=${80}
              .step=${1}
              .value=${draft.ch_pump_min_supply_temp}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ ch_pump_min_supply_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Awaryjny start pompy C.O. (przegrzanie)", "Overheat emergency C.O. pump temp")}
              suffix="°C"
              .min=${50}
              .max=${99}
              .step=${1}
              .value=${draft.ch_pump_overrun_temp}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ ch_pump_overrun_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Zadana temperatura CWU", "Target DHW (CWU) temperature")}
              suffix="°C"
              .min=${30}
              .max=${75}
              .step=${1}
              .value=${draft.dhw_target_temp}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ dhw_target_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Histereza CWU", "DHW hysteresis")}
              suffix="K"
              .min=${1}
              .max=${15}
              .step=${0.5}
              .value=${draft.dhw_hysteresis}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ dhw_hysteresis: e.detail.value })}
            ></rs-number-field>
          </div>
        </section>

        <!-- Fuel Calorific Value & Energy Cost Settings -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Paliwo, kaloryczność węgla/opału i koszty energii",
              "Fuel, Coal Calorific Value & Energy Costs",
            )}
          </h4>
          <rs-field .label=${this._t("Rodzaj paliwa / energii", "Fuel / energy type")}>
            <rs-segmented
              wrap
              .label=${this._t("Rodzaj paliwa", "Fuel type")}
              .options=${[
                { value: "coal", label: this._t("Węgiel / Ekogroszek", "Coal / Pea coal") },
                { value: "pellet", label: this._t("Pellet", "Pellet") },
                { value: "wood", label: this._t("Drewno", "Firewood") },
                { value: "gas", label: this._t("Gaz", "Natural Gas") },
                { value: "electricity", label: this._t("Energia elektr.", "Electricity") },
              ]}
              .value=${draft.fuel_type}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._updateDraft({ fuel_type: e.detail.value as FuelType })}
            ></rs-segmented>
          </rs-field>

          ${
            isSolidFuel
              ? html`
                  <div>
                    <div class="metric-label">
                      ${this._t(
                        "Szybki wybór kaloryczności opału:",
                        "Quick fuel calorific presets:",
                      )}
                    </div>
                    <div class="preset-bar">
                      ${COAL_AND_FUEL_PRESETS.map(
                        (p) => html`
                          <button
                            type="button"
                            class="preset-btn"
                            @click=${() =>
                              this._updateDraft({
                                fuel_type: p.fuelType,
                                calorific_value_mj_kg: p.mjKg,
                                efficiency_pct: p.efficiency,
                              })}
                          >
                            ${this._isPl ? p.labelPl : p.labelEn}
                          </button>
                        `,
                      )}
                    </div>
                  </div>
                  <div class="pair">
                    <rs-number-field
                      .label=${this._t("Kaloryczność węgla / paliwa", "Fuel calorific value")}
                      suffix="MJ/kg"
                      .min=${5}
                      .max=${40}
                      .step=${0.5}
                      .value=${draft.calorific_value_mj_kg}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ calorific_value_mj_kg: e.detail.value })}
                    ></rs-number-field>
                    <rs-number-field
                      .label=${this._t("Sprawność kotła", "Boiler efficiency")}
                      suffix="%"
                      .min=${30}
                      .max=${105}
                      .step=${1}
                      .value=${draft.efficiency_pct}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ efficiency_pct: e.detail.value })}
                    ></rs-number-field>
                  </div>
                  <p class="note">
                    ${this._t(
                      `1 kg paliwa (${draft.calorific_value_mj_kg} MJ/kg) = ${chemKwh} kWh energii chemicznej → ${usableKwh} kWh użytecznego ciepła przy sprawności ${draft.efficiency_pct}%.`,
                      `1 kg of fuel (${draft.calorific_value_mj_kg} MJ/kg) = ${chemKwh} kWh chemical energy → ${usableKwh} kWh usable heat at ${draft.efficiency_pct}% efficiency.`,
                    )}
                  </p>
                `
              : draft.fuel_type === "gas"
                ? html`<div class="pair">
                    <rs-number-field
                      .label=${this._t("Kaloryczność gazu", "Gas calorific value")}
                      suffix="kWh/m³"
                      .min=${5}
                      .max=${15}
                      .step=${0.1}
                      .value=${draft.calorific_value_kwh_m3}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ calorific_value_kwh_m3: e.detail.value })}
                    ></rs-number-field>
                    <rs-number-field
                      .label=${this._t("Sprawność kotła gazowego", "Gas boiler efficiency")}
                      suffix="%"
                      .min=${50}
                      .max=${109}
                      .step=${1}
                      .value=${draft.efficiency_pct}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ efficiency_pct: e.detail.value })}
                    ></rs-number-field>
                  </div>`
                : draft.plant_type === "heat_pump"
                  ? html`<rs-number-field
                      .label=${this._t("Średni współczynnik COP pompy ciepła", "Average Heat Pump COP")}
                      .min=${1.0}
                      .max=${8.0}
                      .step=${0.1}
                      .value=${draft.cop}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ cop: e.detail.value })}
                    ></rs-number-field>`
                  : nothing
          }

          <div class="pair">
            <rs-number-field
              .label=${this._t("Moc nominalna grzewcza", "Nominal heating power")}
              suffix="kW"
              .min=${0.5}
              .max=${200}
              .step=${0.5}
              .value=${draft.nominal_power_kw}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ nominal_power_kw: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${
                isSolidFuel
                  ? this._t("Cena za tonę (lub za 1 kg gdy ≤ 20)", "Price per ton (or per kg if ≤ 20)")
                  : draft.fuel_type === "gas"
                    ? this._t("Cena za 1 m³ gazu", "Price per 1 m³ of gas")
                    : this._t("Cena za 1 kWh energii", "Price per 1 kWh")
              }
              .suffix=${draft.currency}
              .min=${0}
              .max=${10000}
              .step=${isSolidFuel ? 10 : 0.05}
              .value=${draft.fuel_price}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ fuel_price: e.detail.value })}
            ></rs-number-field>
          </div>

          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t(
                "Sensor mocy (W/kW) lub energii (kWh) z HA",
                "HA power (W/kW) or energy (kWh) sensor",
              )}
              .value=${draft.energy_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ energy_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t(
                "Sensor zużycia paliwa z HA (kg węgla/pelletu lub m³)",
                "HA fuel consumption sensor (kg coal/pellet or m³)",
              )}
              .value=${draft.fuel_consumption_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ fuel_consumption_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
        </section>

        <div class="footer-actions">
          <rs-confirm-button
            destructive
            icon="mdi:delete-outline"
            .label=${this._t("Usuń źródło ciepła", "Delete heat source")}
            .confirmMessage=${this._t(
              `Czy na pewno usunąć "${draft.name}"?`,
              `Delete "${draft.name}"?`,
            )}
            @confirmed=${() => this._onDeletePlant(draft.id)}
          ></rs-confirm-button>
          <ha-button @click=${this._closeDialog}>
            ${this._t("Gotowe", "Done")}
          </ha-button>
        </div>
      </div>
    </rs-edit-dialog>`;
  }

  private _collectAllRoomHeatingDevices(): {
    entityId: string;
    name: string;
    roomName: string;
    type: string;
    systemLabel: string;
  }[] {
    const list: {
      entityId: string;
      name: string;
      roomName: string;
      type: string;
      systemLabel: string;
    }[] = [];
    const seen = new Set<string>();

    for (const [areaId, room] of Object.entries(this.rooms)) {
      if (room.is_outdoor) continue;
      const roomName = room.display_name || this.hass.areas?.[areaId]?.name || areaId;
      const devs = room.devices?.length
        ? room.devices
        : [
            ...(room.thermostats ?? []).map((eid) => ({
              entity_id: eid,
              type: "trv" as const,
              role: "auto" as const,
              heating_system_type: room.heating_system_type ?? "",
            })),
            ...(room.acs ?? []).map((eid) => ({
              entity_id: eid,
              type: "ac" as const,
              role: "auto" as const,
              heating_system_type: "",
            })),
          ];

      for (const d of devs) {
        if (!d.entity_id || seen.has(d.entity_id)) continue;
        seen.add(d.entity_id);
        const sys =
          d.heating_system_type === "underfloor"
            ? this._t("Podłogówka", "Underfloor")
            : d.type === "ac"
              ? this._t("Klimatyzator / PC", "AC / Heat pump")
              : this._t("Kaloryfer (TRV)", "Radiator (TRV)");
        list.push({
          entityId: d.entity_id,
          name: this._entityFriendlyName(d.entity_id),
          roomName,
          type: d.type,
          systemLabel: sys,
        });
      }
    }
    return list;
  }

  private _findRoomNameForDevice(entityId: string): string {
    for (const [areaId, room] of Object.entries(this.rooms)) {
      const eids = room.devices?.map((d) => d.entity_id) ?? [
        ...(room.thermostats ?? []),
        ...(room.acs ?? []),
      ];
      if (eids.includes(entityId)) {
        return room.display_name || this.hass.areas?.[areaId]?.name || areaId;
      }
    }
    return "";
  }

  private _entityFriendlyName(entityId: string): string {
    return (
      (this.hass.states[entityId]?.attributes?.friendly_name as string | undefined) || entityId
    );
  }

  private _onAddPlant = () => {
    const id = `plant_${Date.now().toString(36)}`;
    const allTrvs = this._collectAllRoomHeatingDevices()
      .filter((d) => d.type === "trv")
      .map((d) => d.entityId);
    const newPlant: HeatPlantConfig = {
      id,
      name: this._t("Piec C.O.", "Central Boiler"),
      plant_type: "coal_boiler",
      enabled: true,
      assigned_devices: allTrvs,
      assigned_rooms: [],
      source_entity: "",
      target_supply_temp: 55,
      idle_supply_temp: 35,
      off_mode: "off",
      min_rooms_demand: 1,
      supply_temp_sensor: "",
      return_temp_sensor: "",
      dhw_temp_sensor: "",
      flue_temp_sensor: "",
      ch_pump_entity: "",
      ch_pump_min_supply_temp: 40,
      ch_pump_overrun_temp: 80,
      dhw_pump_entity: "",
      dhw_target_temp: 50,
      dhw_hysteresis: 3,
      dhw_min_supply_delta: 3,
      fuel_type: "coal",
      calorific_value_mj_kg: 26.0,
      calorific_value_kwh_m3: 10.5,
      efficiency_pct: 85,
      cop: 3.5,
      nominal_power_kw: 15.0,
      fuel_price: 1500,
      currency: "PLN",
      energy_sensor: "",
      fuel_consumption_sensor: "",
    };
    const next = [...this.heatPlants, newPlant];
    this._editingId = id;
    this._draft = { ...newPlant };
    void this._savePlants(next);
  };

  private _onEditPlant(plant: HeatPlantConfig) {
    this._editingId = plant.id;
    this._draft = {
      ...plant,
      assigned_devices: [...(plant.assigned_devices ?? [])],
      assigned_rooms: [...(plant.assigned_rooms ?? [])],
    };
  }

  private _closeDialog = () => {
    this._editingId = null;
    this._draft = null;
  };

  private _onPlantTypeChanged(plantType: HeatPlantType) {
    if (!this._draft) return;
    const fuelDefaults: Record<HeatPlantType, { fuel: FuelType; mj: number; eff: number; price: number }> = {
      coal_boiler: { fuel: "coal", mj: 26.0, eff: 85, price: 1500 },
      pellet_boiler: { fuel: "pellet", mj: 18.0, eff: 90, price: 1400 },
      wood_boiler: { fuel: "wood", mj: 14.5, eff: 78, price: 600 },
      gas_boiler: { fuel: "gas", mj: 26.0, eff: 96, price: 3.5 },
      electric_heater: { fuel: "electricity", mj: 26.0, eff: 99, price: 1.1 },
      air_heater: { fuel: "electricity", mj: 26.0, eff: 95, price: 1.1 },
      heat_pump: { fuel: "electricity", mj: 26.0, eff: 100, price: 1.1 },
    };
    const d = fuelDefaults[plantType];
    this._updateDraft({
      plant_type: plantType,
      fuel_type: d.fuel,
      calorific_value_mj_kg: d.mj,
      efficiency_pct: d.eff,
      fuel_price: d.price,
      ch_pump_min_supply_temp:
        plantType === "heat_pump" || plantType === "air_heater" ? 20 : 40,
    });
  }

  private _toggleAssignedDevice(entityId: string, checked: boolean) {
    if (!this._draft) return;
    const set = new Set(this._draft.assigned_devices);
    if (checked) set.add(entityId);
    else set.delete(entityId);
    this._updateDraft({ assigned_devices: [...set] });
  }

  private _toggleAssignedRoom(areaId: string, checked: boolean) {
    if (!this._draft) return;
    const set = new Set(this._draft.assigned_rooms);
    if (checked) set.add(areaId);
    else set.delete(areaId);
    this._updateDraft({ assigned_rooms: [...set] });
  }

  private _updateDraft(changes: Partial<HeatPlantConfig>) {
    if (!this._draft) return;
    this._draft = { ...this._draft, ...changes };
    const next = this.heatPlants.map((p) => (p.id === this._draft!.id ? this._draft! : p));
    void this._savePlants(next);
  }

  private _onDeletePlant(plantId: string) {
    const next = this.heatPlants.filter((p) => p.id !== plantId);
    this._closeDialog();
    void this._savePlants(next);
  }

  private async _onResetStats(plantId: string) {
    fireSaveStatus(this, "saving");
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/reset_stats",
        plant_id: plantId,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
  }

  private async _savePlants(next: HeatPlantConfig[]) {
    this.heatPlants = next;
    fireSaveStatus(this, "saving");
    try {
      await this.hass.callWS({
        type: "roommind/settings/save",
        heat_plants: next,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-heat-plants": RsHeatPlants;
  }
}
