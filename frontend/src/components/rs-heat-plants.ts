/**
 * rs-heat-plants – Dedicated tab for multiple heat sources:
 * boilers (ekogroszek/coal/pellet/wood/gas), fireplaces (kominek),
 * air/water heaters, and heat pumps — which drive room heat emitters/receivers
 * such as radiators (kaloryfery) and underfloor heating (podłogówka).
 *
 * Features:
 * - Multi-source priority & parent/child source linking.
 * - Non-extinguishable solid-fuel safety ("cannot_extinguish"): fire-hold / podtrzymanie ognia mode.
 * - Assigned heat receivers (radiators & underfloor heating loops) + optional dedicated underfloor
 *   receiver circuit control (pump, supply thermometer, max-temperature floor safety cutoff).
 * - Fuel kg tracking via HA kg/g sensor, auger/feeder screw (podajnik), manual kg logging, or calorific estimation.
 * - Maintenance gauges, one-click confirmations, and HA notifications for:
 *   refueling (dołożenie opału), ash tray emptying (popielnik), and chimney cleaning (czyszczenie komina).
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
  ashPct: number;
}

const COAL_AND_FUEL_PRESETS: CalorificPreset[] = [
  {
    id: "anthracite",
    labelPl: "Węgiel kamienny wysokiej jakości (28 MJ/kg)",
    labelEn: "High-grade hard coal (28 MJ/kg)",
    fuelType: "coal",
    mjKg: 28.0,
    efficiency: 84,
    ashPct: 6.0,
  },
  {
    id: "ekogroszek",
    labelPl: "Ekogroszek (26 MJ/kg)",
    labelEn: "Ekogroszek pea coal (26 MJ/kg)",
    fuelType: "coal",
    mjKg: 26.0,
    efficiency: 86,
    ashPct: 7.0,
  },
  {
    id: "coal_standard",
    labelPl: "Węgiel kamienny standard (24 MJ/kg)",
    labelEn: "Standard hard coal (24 MJ/kg)",
    fuelType: "coal",
    mjKg: 24.0,
    efficiency: 80,
    ashPct: 9.0,
  },
  {
    id: "coal_fine",
    labelPl: "Miał węglowy (21 MJ/kg)",
    labelEn: "Coal fines (21 MJ/kg)",
    fuelType: "coal",
    mjKg: 21.0,
    efficiency: 76,
    ashPct: 12.0,
  },
  {
    id: "pellet",
    labelPl: "Pellet drzewny A1 (18 MJ/kg)",
    labelEn: "Wood pellet A1 (18 MJ/kg)",
    fuelType: "pellet",
    mjKg: 18.0,
    efficiency: 90,
    ashPct: 0.7,
  },
  {
    id: "wood",
    labelPl: "Drewno opałowe sezonowane (14.5 MJ/kg)",
    labelEn: "Seasoned firewood (14.5 MJ/kg)",
    fuelType: "wood",
    mjKg: 14.5,
    efficiency: 78,
    ashPct: 1.5,
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
  @state() private _fuelInputKg: Record<string, number> = {};

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
        align-items: flex-start;
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

      .quick-add-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .quick-add-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 7px 12px;
        border-radius: 10px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        --mdc-icon-size: 17px;
      }

      .quick-add-btn:hover {
        border-color: var(--primary-color);
        background: var(--rs-fill-primary);
      }

      .quick-add-btn.primary {
        border-color: var(--primary-color);
        color: var(--primary-color);
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

      .plant-icon.hold {
        background: color-mix(in srgb, var(--rs-warn) 18%, transparent);
        color: var(--rs-warn);
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

      .status-pill.hold {
        background: color-mix(in srgb, var(--rs-warn) 18%, transparent);
        color: var(--rs-warn-text);
      }

      .status-pill.overheat {
        background: color-mix(in srgb, var(--rs-err) 18%, transparent);
        color: var(--rs-err-text);
      }

      .status-pill.tag {
        font-size: 11px;
        padding: 2px 8px;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
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
        margin: 0 0 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }

      .maint-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--rs-space-3);
      }

      .maint-card {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: var(--card-background-color, var(--primary-background-color));
      }

      .maint-card.alert {
        border-color: var(--rs-err);
        background: color-mix(in srgb, var(--rs-err) 8%, var(--card-background-color));
      }

      .maint-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        --mdc-icon-size: 17px;
      }

      .maint-head-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .maint-bar {
        height: 7px;
        border-radius: 4px;
        background: var(--rs-fill-strong);
        overflow: hidden;
      }

      .maint-bar > i {
        display: block;
        height: 100%;
        border-radius: 4px;
        background: var(--rs-ok);
        transition: width 0.25s ease;
      }

      .maint-bar > i.warn {
        background: var(--rs-warn);
      }

      .maint-bar > i.err {
        background: var(--rs-err);
      }

      .maint-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 2px;
      }

      .fuel-log-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--rs-fill);
        font-size: 12px;
      }

      .fuel-log-input {
        width: 72px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        font: inherit;
        font-variant-numeric: tabular-nums;
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
        padding: 4px 9px;
        font-size: 12px;
        color: var(--primary-text-color);
        cursor: pointer;
        font-family: inherit;
      }

      .preset-btn:hover {
        border-color: var(--primary-color);
      }

      .preset-btn.accent {
        border-color: color-mix(in srgb, var(--primary-color) 50%, var(--divider-color));
        color: var(--primary-color);
        font-weight: 500;
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

      select.parent-select {
        width: 100%;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        font: inherit;
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
      fireplace: ["Kominek / Płaszcz wodny", "Fireplace / Water jacket"],
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
        return "mdi:fire";
      case "fireplace":
        return "mdi:fireplace";
      case "gas_boiler":
        return "mdi:water-boiler";
      case "air_heater":
        return "mdi:fan-chevron-up";
      case "heat_pump":
        return "mdi:heat-pump-outline";
      case "electric_heater":
        return "mdi:heating-coil";
      default:
        return "mdi:fire";
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
      case "hold":
        return this._t("Podtrzymanie ognia (nie wygaszać)", "Fire hold (cannot extinguish)");
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
          <h2>${this._t("Źródła ciepła i kotłownia", "Heat Sources & Boiler Room")}</h2>
          <p>
            ${this._t(
              "Obsługa źródeł zasilania cieplnego (piec na ekogroszek, kominek, kocioł gazowy, pompa ciepła) napędzających odbiorniki w pokojach (kaloryfery i ogrzewanie podłogowe), trybu podtrzymania ognia, spalania w kg oraz powiadomień konserwacyjnych.",
              "Manage heat sources (coal boiler, fireplace, gas boiler, heat pump) driving room heat receivers (radiators and underfloor heating), fire-hold mode, kg fuel consumption, and maintenance notifications.",
            )}
          </p>
        </div>
        <div class="quick-add-bar">
          <button
            type="button"
            class="quick-add-btn primary"
            @click=${() => this._onAddPlant("coal_boiler")}
          >
            <ha-icon icon="mdi:fire"></ha-icon>
            + ${this._t("Piec ekogroszek", "Coal boiler")}
          </button>
          <button
            type="button"
            class="quick-add-btn"
            @click=${() => this._onAddPlant("fireplace")}
          >
            <ha-icon icon="mdi:fireplace"></ha-icon>
            + ${this._t("Kominek", "Fireplace")}
          </button>
          <button
            type="button"
            class="quick-add-btn"
            @click=${() => this._onAddPlant("gas_boiler")}
          >
            <ha-icon icon="mdi:water-boiler"></ha-icon>
            + ${this._t("Kocioł gazowy", "Gas boiler")}
          </button>
          <button
            type="button"
            class="quick-add-btn"
            @click=${() => this._onAddPlant("heat_pump")}
          >
            <ha-icon icon="mdi:plus"></ha-icon>
            ${this._t("Inne źródło", "Other source")}
          </button>
        </div>
      </div>

      ${
        this.heatPlants.length === 0
          ? html`<ha-card class="empty-state">
              <ha-icon icon="mdi:water-boiler"></ha-icon>
              <h3>${this._t("Brak skonfigurowanych źródeł ciepła", "No heat sources configured")}</h3>
              <p>
                ${this._t(
                  "Dodaj piec na ekogroszek, kominek, kocioł na pellet/drewno/gaz lub pompę ciepła, które zasilają Twoje odbiorniki ciepła (kaloryfery oraz ogrzewanie podłogowe).",
                  "Add a coal boiler, fireplace, pellet/wood/gas boiler, or heat pump that powers your heat receivers (radiators and underfloor heating).",
                )}
              </p>
              <div class="quick-add-bar" style="justify-content: center; margin-top: 14px">
                <button
                  type="button"
                  class="quick-add-btn primary"
                  @click=${() => this._onAddPlant("coal_boiler")}
                >
                  <ha-icon icon="mdi:fire"></ha-icon>
                  + ${this._t("Dodaj piec ekogroszek", "Add coal boiler")}
                </button>
                <button
                  type="button"
                  class="quick-add-btn"
                  @click=${() => this._onAddPlant("fireplace")}
                >
                  <ha-icon icon="mdi:fireplace"></ha-icon>
                  + ${this._t("Dodaj kominek", "Add fireplace")}
                </button>
                <button
                  type="button"
                  class="quick-add-btn"
                  @click=${() => this._onAddPlant("gas_boiler")}
                >
                  <ha-icon icon="mdi:water-boiler"></ha-icon>
                  + ${this._t("Dodaj kocioł gazowy", "Add gas boiler")}
                </button>
              </div>
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
    const isOverheat = live?.overheat_protect ?? false;
    const isHold = live?.state === "hold" || !!live?.in_fire_hold;
    const isActive =
      !isHold &&
      (live?.source_active ||
        live?.state === "heating" ||
        live?.state === "dhw" ||
        live?.state === "heating_and_dhw");
    const statusCls = isOverheat ? "overheat" : isHold ? "hold" : isActive ? "active" : "";
    const isSolidFuel =
      plant.fuel_type === "coal" || plant.fuel_type === "pellet" || plant.fuel_type === "wood";
    const chemKwhKg = plant.calorific_value_mj_kg / 3.6;
    const usableKwhKg = chemKwhKg * (plant.efficiency_pct / 100);
    const fuelUnit =
      live?.fuel_unit ?? (isSolidFuel ? "kg" : plant.fuel_type === "gas" ? "m³" : "kWh");
    const parentPlant = plant.parent_plant_id
      ? this.heatPlants.find((p) => p.id === plant.parent_plant_id)
      : null;

    return html`<ha-card class="plant-card">
      <div class="plant-top">
        <div class="plant-icon ${statusCls}">
          <ha-icon .icon=${this._plantIcon(plant.plant_type)}></ha-icon>
        </div>
        <div class="plant-heading">
          <h3>
            <span>${plant.name || this._plantTypeLabel(plant.plant_type)}</span>
            <span class="status-pill ${statusCls}">
              ${this._stateLabel(live?.state, plant.enabled)}
              ${(isActive || isHold) && live?.mean_power_pct ? ` · ${live.mean_power_pct}%` : ""}
            </span>
            ${
              plant.cannot_extinguish
                ? html`<span class="status-pill tag"
                    >${this._t("Stały żar / Podtrzymanie", "Fire-hold safe")}</span
                  >`
                : nothing
            }
            ${
              (plant.priority ?? 1) > 1
                ? html`<span class="status-pill tag"
                    >${this._t("Priorytet", "Priority")} ${plant.priority}</span
                  >`
                : nothing
            }
          </h3>
          <div class="plant-sub">
            ${this._plantTypeLabel(plant.plant_type)}
            ${parentPlant ? ` · ${this._t("Zasilane z", "Fed by")}: ${parentPlant.name}` : ""}
            ${
              live?.assisted_by?.length
                ? ` · ${this._t("Wspomagane przez", "Assisted by")}: ${live.assisted_by.join(", ")}`
                : ""
            }
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

      <!-- Thermometers & Pumps -->
      <div class="metrics-grid">
        <div class="metric-tile">
          <span class="metric-label">
            <ha-icon icon="mdi:thermometer-chevron-up"></ha-icon>
            ${this._t("Zasilanie C.O.", "Supply Temp")}
          </span>
          <span class="metric-val">${fmtTemp(live?.supply_temp)}</span>
          <span class="metric-sub">
            ${this._t("Zadana", "Target")}: ${fmtTemp(plant.target_supply_temp)}
            ${
              plant.cannot_extinguish
                ? ` · ${this._t("Podtrzym.", "Hold")}: ${fmtTemp(plant.idle_supply_temp)}`
                : ""
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
                ? `ΔT: ${formatNumber(live.delta_t, this.hass, 1)} K`
                : this._t("ΔT niedostępne", "ΔT unavailable")
            }
          </span>
        </div>

        ${
          plant.dhw_temp_sensor || plant.dhw_pump_entity
            ? html`<div class="metric-tile">
                <span class="metric-label">
                  <ha-icon icon="mdi:water-thermometer"></ha-icon>
                  ${this._t("Ciepła woda (CWU)", "DHW (CWU)")}
                </span>
                <span class="metric-val">${fmtTemp(live?.dhw_temp)}</span>
                <span class="metric-sub">
                  ${this._t("Zadana CWU", "DHW Target")}: ${fmtTemp(plant.dhw_target_temp)}
                  (±${plant.dhw_hysteresis} K)
                </span>
              </div>`
            : nothing
        }

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
                    `Czeka > ${plant.ch_pump_min_supply_temp}°C`,
                    `Waiting > ${plant.ch_pump_min_supply_temp}°C`,
                  )
                : `${this._t("Start od", "Start >")} ${plant.ch_pump_min_supply_temp}°C`
            }
          </span>
        </div>

        ${
          plant.ufh_pump_entity || plant.ufh_supply_temp_sensor
            ? html`<div class="metric-tile">
                <span class="metric-label">
                  <ha-icon icon="mdi:waves"></ha-icon>
                  ${this._t("Obieg podłogówki (odbiornik)", "Underfloor Receiver Circuit")}
                </span>
                <span class="metric-val">
                  ${
                    live?.ufh_overheat_protect
                      ? this._t("Zatrzymana (przegrzanie!)", "Stopped (overheat!)")
                      : plant.ufh_pump_entity
                        ? live?.ufh_pump_active
                          ? this._t("Pompa włączona", "Pump running")
                          : this._t("Pompa wyłączona", "Pump off")
                        : fmtTemp(live?.ufh_supply_temp)
                  }
                </span>
                <span class="metric-sub">
                  ${
                    live?.ufh_supply_temp != null
                      ? `${this._t("Zasilanie podłogówki", "UFH supply")}: ${fmtTemp(live.ufh_supply_temp)} · `
                      : ""
                  }${this._t("Maks.", "Max")} ${plant.ufh_max_supply_temp ?? 48}°C
                </span>
              </div>`
            : nothing
        }

        ${
          plant.dhw_pump_entity
            ? html`<div class="metric-tile">
                <span class="metric-label">
                  <ha-icon icon="mdi:pump"></ha-icon>
                  ${this._t("Pompa CWU", "DHW Pump")}
                </span>
                <span class="metric-val">
                  ${live?.dhw_pump_active ? this._t("Włączona", "Running") : this._t("Wyłączona", "Off")}
                </span>
                <span class="metric-sub">
                  ${
                    live?.dhw_pump_blocked_cold
                      ? this._t("Zasilanie zimniejsze niż CWU", "Supply colder than DHW")
                      : this._entityFriendlyName(plant.dhw_pump_entity)
                  }
                </span>
              </div>`
            : nothing
        }
      </div>

      <!-- Energy, Fuel kg Counting & Cost Telemetry -->
      <div class="section-box">
        <div class="section-title">
          <span>
            ${this._t(
              "Spalony opał (kg), kaloryczność i koszty energii",
              "Fuel Burned (kg), Calorific Value & Energy Costs",
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
                    ${formatNumber(chemKwhKg, this.hass, 2)} kWh/kg (${this._t("użyt.", "usable")}:
                    ${formatNumber(usableKwhKg, this.hass, 2)} kWh/kg)
                  </span>
                </div>`
              : plant.plant_type === "heat_pump"
                ? html`<div class="metric-tile">
                    <span class="metric-label">
                      <ha-icon icon="mdi:lightning-bolt"></ha-icon>
                      ${this._t("Sprawność (COP)", "Efficiency (COP)")}
                    </span>
                    <span class="metric-val">COP ${formatNumber(plant.cop, this.hass, 2)}</span>
                    <span class="metric-sub">${plant.nominal_power_kw} kW</span>
                  </div>`
                : html`<div class="metric-tile">
                    <span class="metric-label">
                      <ha-icon icon="mdi:gauge"></ha-icon>
                      ${this._t("Sprawność źródła", "Source Efficiency")}
                    </span>
                    <span class="metric-val">${plant.efficiency_pct}%</span>
                    <span class="metric-sub">${plant.nominal_power_kw} kW</span>
                  </div>`
          }

          <div class="metric-tile">
            <span class="metric-label">
              <ha-icon icon="mdi:flash"></ha-icon>
              ${this._t("Moc i spalanie chwilowe", "Power & Burn Rate")}
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
              ${this._t("Spalony opał (Dziś / Łącznie)", "Fuel Burned (Today / Total)")}
            </span>
            <span class="metric-val">
              ${formatNumber(live?.fuel_consumed_today ?? 0, this.hass, 2)} ${fuelUnit}
            </span>
            <span class="metric-sub">
              ${this._t("Łącznie", "Total")}:
              ${formatNumber(live?.fuel_consumed_total ?? 0, this.hass, 1)} ${fuelUnit} ·
              ${formatNumber(live?.thermal_kwh_today ?? 0, this.hass, 1)} kWh
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

        ${isSolidFuel ? this._renderFuelLogAndMaintenance(plant, live) : nothing}
      </div>

      <!-- Assigned Heat Receivers: Radiators & Underfloor Heating -->
      <div class="section-box">
        <div class="section-title">
          <span>
            ${this._t(
              "Zasilane odbiorniki ciepła (kaloryfery, podłogówka i pokoje)",
              "Driven Heat Receivers (Radiators, Underfloor & Rooms)",
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

  private _renderFuelLogAndMaintenance(plant: HeatPlantConfig, live?: HeatPlantLive) {
    const hopperPct = live?.hopper_pct ?? 100;
    const remKg = live?.fuel_remaining_kg ?? plant.hopper_capacity_kg ?? 100;
    const ashPct = live?.ash_fill_pct ?? 0;
    const chimneyPct = live?.chimney_wear_pct ?? 0;
    const kgInput = this._fuelInputKg[plant.id] ?? (plant.plant_type === "fireplace" ? 5 : 25);

    return html`
      <div class="fuel-log-row">
        <span>
          <b
            >${this._t(
              "Auto-kalkulacja 24/7 aktywna (czas + temp. + moc pieca) · Ręczny zasyp:",
              "24/7 auto-calculation active (time + temp + power) · Manual refill:",
            )}</b
          >
        </span>
        <input
          class="fuel-log-input"
          type="number"
          min="0.5"
          max="1000"
          step="0.5"
          .value=${String(kgInput)}
          @input=${(e: Event) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (Number.isFinite(val) && val > 0) {
              this._fuelInputKg = { ...this._fuelInputKg, [plant.id]: val };
            }
          }}
        />
        <span>kg</span>
        <button
          type="button"
          class="preset-btn accent"
          @click=${() => this._onLogFuel(plant.id, kgInput, "refill")}
        >
          + ${this._t("Zasypano / Dołożono do zasobnika", "Refilled hopper")}
        </button>
        <button
          type="button"
          class="preset-btn"
          @click=${() => this._onLogFuel(plant.id, kgInput, "burned")}
        >
          + ${this._t("Korekta spalonego (+kg)", "Adjust burned (+kg)")}
        </button>
      </div>

      <div class="maint-grid" style="margin-top: 10px">
        <!-- 1. Hopper / Refill -->
        <div class="maint-card ${live?.refill_needed ? "alert" : ""}">
          <div class="maint-head">
            <span class="maint-head-left">
              <ha-icon icon="mdi:silo"></ha-icon>
              ${this._t("Zasobnik (ubywa automatycznie w czasie)", "Hopper (auto-depletes over time)")}
            </span>
            <b>${formatNumber(remKg, this.hass, 1)} kg (${Math.round(hopperPct)}%)</b>
          </div>
          <div class="maint-bar">
            <i
              class=${live?.refill_needed ? "err" : hopperPct < 35 ? "warn" : ""}
              style="width: ${Math.max(4, Math.min(100, hopperPct))}%"
            ></i>
          </div>
          <div class="metric-sub">
            ${this._t("Auto-spalono od zasypu", "Auto-burned since refill")}:
            ${formatNumber(live?.fuel_since_refill_kg ?? 0, this.hass, 2)} kg
            ${
              live?.hours_until_refill != null
                ? ` · ~${formatNumber(live.hours_until_refill, this.hass, 1)} h`
                : ""
            }
          </div>
          <div class="maint-actions">
            <button
              type="button"
              class="preset-btn accent"
              @click=${() => this._onMaintenance(plant.id, "refill")}
            >
              ${this._t("Zasypano zasobnik do pełna", "Hopper refilled to full")}
            </button>
          </div>
        </div>

        <!-- 2. Ash Container -->
        <div class="maint-card ${live?.ash_clean_needed ? "alert" : ""}">
          <div class="maint-head">
            <span class="maint-head-left">
              <ha-icon icon="mdi:delete-variant"></ha-icon>
              ${this._t("Popielnik (zbiera się ciągle podczas palenia)", "Ash Tray (accumulates continuously)")}
            </span>
            <b>${Math.round(ashPct)}% (~${formatNumber(live?.estimated_ash_kg ?? 0, this.hass, 2)} kg)</b>
          </div>
          <div class="maint-bar">
            <i
              class=${live?.ash_clean_needed ? "err" : ashPct >= 75 ? "warn" : ""}
              style="width: ${Math.max(2, Math.min(100, ashPct))}%"
            ></i>
          </div>
          <div class="metric-sub">
            ${this._t("Spalono od czyszczenia", "Burned since cleaning")}:
            ${formatNumber(live?.fuel_since_ash_clean_kg ?? 0, this.hass, 2)} /
            ${plant.ash_clean_interval_kg ?? 150} kg ·
            ${formatNumber(live?.days_since_ash_clean ?? 0, this.hass, 1)}
            ${this._t("dni", "days")}
          </div>
          <div class="maint-actions">
            <button
              type="button"
              class="preset-btn accent"
              @click=${() => this._onMaintenance(plant.id, "ash_cleaned")}
            >
              ${this._t("Popielnik opróżniony", "Ash tray emptied")}
            </button>
          </div>
        </div>

        <!-- 3. Chimney Cleaning -->
        <div class="maint-card ${live?.chimney_clean_needed ? "alert" : ""}">
          <div class="maint-head">
            <span class="maint-head-left">
              <ha-icon icon="mdi:chimney"></ha-icon>
              ${this._t("Czyszczenie komina", "Chimney Cleaning")}
            </span>
            <b>${Math.round(chimneyPct)}%</b>
          </div>
          <div class="maint-bar">
            <i
              class=${live?.chimney_clean_needed ? "err" : chimneyPct >= 80 ? "warn" : ""}
              style="width: ${Math.max(2, Math.min(100, chimneyPct))}%"
            ></i>
          </div>
          <div class="metric-sub">
            ${this._t("Spalono", "Burned")}:
            ${formatNumber(live?.fuel_since_chimney_clean_kg ?? 0, this.hass, 0)} /
            ${plant.chimney_clean_interval_kg ?? 1000} kg ·
            ${formatNumber(live?.days_since_chimney_clean ?? 0, this.hass, 0)} /
            ${plant.chimney_clean_interval_days ?? 90} ${this._t("dni", "days")}
          </div>
          <div class="maint-actions">
            <button
              type="button"
              class="preset-btn accent"
              @click=${() => this._onMaintenance(plant.id, "chimney_cleaned")}
            >
              ${this._t("Komin wyczyszczony", "Chimney cleaned")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderAssignedRadiators(plant: HeatPlantConfig, live?: HeatPlantLive) {
    const activeDevs = new Set(live?.active_devices ?? []);
    const demandingRooms = new Set(live?.demanding_rooms ?? []);
    const chips: unknown[] = [];

    for (const eid of plant.assigned_devices) {
      const heating = activeDevs.has(eid);
      const roomName = this._findRoomNameForDevice(eid);
      const isUfh = this._isDeviceUnderfloor(eid);
      chips.push(html`
        <span
          class="dev-chip ${heating ? "heating" : ""}"
          @click=${() => openEntityInfo(this, eid)}
          style="cursor: pointer"
        >
          <ha-icon
            icon=${isUfh ? "mdi:waves" : heating ? "mdi:radiator" : "mdi:radiator-disabled"}
          ></ha-icon>
          <span>${this._entityFriendlyName(eid)}</span>
          ${roomName ? html`<small>(${roomName} · ${isUfh ? this._t("Podłogówka", "Underfloor") : this._t("Kaloryfer", "Radiator")})</small>` : nothing}
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
          "Nie przypisano jeszcze żadnych kaloryferów ani pokoi. Kliknij ikonę edycji, aby wybrać obsługiwane grzejniki, podłogówkę i pokoje.",
          "No radiators or rooms assigned yet. Click the edit button to choose served radiators, underfloor loops, and rooms.",
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
    const otherPlants = this.heatPlants.filter((p) => p.id !== draft.id);

    return html`<rs-edit-dialog
      open
      icon=${this._plantIcon(draft.plant_type)}
      .heading=${draft.name || this._t("Konfiguracja źródła ciepła", "Heat Source Configuration")}
      @rs-dialog-closed=${this._closeDialog}
    >
      <div class="dialog-body">
        <!-- Basic identity, type, priority & non-extinguishable protection -->
        <section class="group">
          <h4 class="group-title">${this._t("Podstawowe informacje i współpraca źródeł", "General & Multi-Source Priority")}</h4>
          <div class="pair">
            <ha-textfield
              .label=${this._t("Nazwa źródła ciepła", "Heat source name")}
              .value=${draft.name}
              @input=${(e: Event) =>
                this._updateDraft({ name: (e.target as HTMLInputElement).value })}
            ></ha-textfield>

            <rs-number-field
              .label=${this._t("Priorytet źródła (1 = najwyższy, np. kominek)", "Source priority (1 = highest, e.g. fireplace)")}
              .min=${1}
              .max=${20}
              .step=${1}
              .value=${draft.priority ?? 1}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ priority: e.detail.value })}
            ></rs-number-field>
          </div>

          <rs-field .label=${this._t("Typ urządzenia", "Plant type")}>
            <rs-segmented
              wrap
              .label=${this._t("Typ urządzenia", "Plant type")}
              .options=${[
                { value: "coal_boiler", label: this._t("Piec ekogroszek", "Coal boiler") },
                { value: "fireplace", label: this._t("Kominek", "Fireplace") },
                { value: "pellet_boiler", label: this._t("Pellet", "Pellet") },
                { value: "wood_boiler", label: this._t("Kocioł drzewny", "Wood boiler") },
                { value: "gas_boiler", label: this._t("Gazowy", "Gas") },
                { value: "heat_pump", label: this._t("Pompa ciepła", "Heat pump") },
                { value: "electric_heater", label: this._t("Elektr.", "Electric") },
                { value: "air_heater", label: this._t("Nagrzewnica", "Air heater") },
              ]}
              .value=${draft.plant_type}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._onPlantTypeChanged(e.detail.value as HeatPlantType)}
            ></rs-segmented>
          </rs-field>

          ${
            otherPlants.length > 0
              ? html`<rs-field
                  .label=${this._t(
                    "Źródło nadrzędne (np. podłogówka zasilana z pieca na ekogroszek)",
                    "Parent heat source (e.g. underfloor fed by main boiler)",
                  )}
                >
                  <select
                    class="parent-select"
                    .value=${draft.parent_plant_id ?? ""}
                    @change=${(e: Event) =>
                      this._updateDraft({ parent_plant_id: (e.target as HTMLSelectElement).value })}
                  >
                    <option value="">${this._t("Brak (niezależne źródło)", "None (independent)")}</option>
                    ${otherPlants.map(
                      (p) => html`<option value=${p.id} ?selected=${draft.parent_plant_id === p.id}>
                        ${p.name}
                      </option>`,
                    )}
                  </select>
                </rs-field>`
              : nothing
          }

          <rs-list-row
            switch
            .heading=${this._t("Aktywne sterowanie tym źródłem", "Enable active control")}
            .checked=${draft.enabled}
            @toggle-changed=${(e: CustomEvent<boolean>) =>
              this._updateDraft({ enabled: e.detail })}
          ></rs-list-row>

          <rs-list-row
            switch
            .heading=${this._t(
              "Nie można całkowicie wygasić (tryb podtrzymania ognia)",
              "Cannot be fully extinguished (fire-hold mode)",
            )}
            .secondary=${this._t(
              "Dla pieca na ekogroszek, kominka i kotłów stałopalnych — RoomMind nigdy nie wyłączy źródła na postoju, lecz przejdzie w bezpieczne podtrzymanie.",
              "For coal boilers, fireplaces, and wood boilers — RoomMind never sends OFF on idle, keeping a safe fire-hold temperature instead.",
            )}
            .checked=${draft.cannot_extinguish ?? false}
            @toggle-changed=${(e: CustomEvent<boolean>) =>
              this._updateDraft({
                cannot_extinguish: e.detail,
                off_mode: e.detail ? "temperature" : draft.off_mode,
              })}
          ></rs-list-row>

          <div class="pair">
            <rs-number-field
              .label=${this._t("Min. liczba pokoi do startu", "Min demanding rooms to start")}
              .min=${1}
              .max=${50}
              .step=${1}
              .value=${draft.min_rooms_demand}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ min_rooms_demand: e.detail.value })}
            ></rs-number-field>
            ${
              draft.cannot_extinguish
                ? html`<rs-number-field
                    .label=${this._t("Moc podtrzymania ognia (%)", "Fire-hold standby power (%)")}
                    suffix="%"
                    .min=${0}
                    .max=${50}
                    .step=${1}
                    .value=${draft.min_power_pct ?? 12}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ min_power_pct: e.detail.value })}
                  ></rs-number-field>`
                : nothing
            }
          </div>
        </section>

        <!-- Assigned heat receivers: radiators & underfloor heating -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Odbiorniki ciepła napędzane tym źródłem (kaloryfery, podłogówka i pokoje)",
              "Heat Receivers Driven by This Source (Radiators, Underfloor & Rooms)",
            )}
          </h4>
          <p class="note">
            ${this._t(
              "Kaloryfery (TRV) i ogrzewanie podłogowe to odbiorniki ciepła napędzane przez piec/źródło. Wybierz, które grzejniki, pętle podłogówki lub całe pokoje są zasilane z tego źródła.",
              "Radiators (TRVs) and underfloor heating are heat receivers powered by this heat source. Select which radiators, underfloor loops, or rooms are fed by this source.",
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
                  icon=${
                    item.isUnderfloor
                      ? "mdi:waves"
                      : item.type === "ac"
                        ? "mdi:heat-pump-outline"
                        : "mdi:radiator"
                  }
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
              "Dodaj inny odbiornik ciepła: kaloryfer / termostat podłogówki (climate.*)",
              "Add another heat receiver: radiator / underfloor thermostat (climate.*)",
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
              "Sterowanie źródłem ciepła (piec / kocioł / kominek / pompa ciepła)",
              "Heat Source Control Entity (Boiler / Fireplace / Heat Pump)",
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
              .label=${this._t(
                draft.cannot_extinguish
                  ? "Temp. zasilania w podtrzymaniu ognia"
                  : "Temp. zasilania w czuwaniu",
                draft.cannot_extinguish ? "Fire-hold supply temp" : "Idle supply temp",
              )}
              suffix="°C"
              .min=${15}
              .max=${75}
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

        <!-- Circulation Pumps: C.O. (radiators), Underfloor receiver circuit & CWU -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Pompy obiegowe odbiorników (C.O. kaloryfery, obieg podłogówki) oraz CWU",
              "Receiver Circulation Pumps (C.O. Radiators, Underfloor Circuit) & DHW",
            )}
          </h4>
          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["switch", "input_boolean", "fan"]}
              .label=${this._t("Encja pompy obiegowej C.O. (kaloryfery)", "C.O. circulation pump entity (radiators)")}
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
              .label=${this._t("Awaryjny start pompy C.O. (przegrzanie kotła)", "Overheat emergency C.O. pump temp")}
              suffix="°C"
              .min=${45}
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

          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["switch", "input_boolean", "fan"]}
              .label=${this._t(
                "Pompa obiegu podłogówki (opcjonalny odbiornik tego pieca)",
                "Underfloor circuit pump (optional receiver driven by this boiler)",
              )}
              .value=${draft.ufh_pump_entity ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ ufh_pump_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t(
                "Termometr zasilania za mieszaczem podłogówki (opcjonalnie)",
                "Underfloor mixer supply temp sensor (optional)",
              )}
              .value=${draft.ufh_supply_temp_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ ufh_supply_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
          ${
            draft.ufh_pump_entity || draft.ufh_supply_temp_sensor
              ? html`<div class="pair">
                  <rs-number-field
                    .label=${this._t(
                      "Start pompy podłogówki powyżej temp.",
                      "Start UFH pump above supply temp",
                    )}
                    suffix="°C"
                    .min=${15}
                    .max=${50}
                    .step=${1}
                    .value=${draft.ufh_min_supply_temp ?? 25}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ ufh_min_supply_temp: e.detail.value })}
                  ></rs-number-field>
                  <rs-number-field
                    .label=${this._t(
                      "Maks. bezpieczna temp. podłogówki (wyłącza pompę!)",
                      "Max safe UFH supply temp (stops UFH pump!)",
                    )}
                    suffix="°C"
                    .min=${35}
                    .max=${65}
                    .step=${1}
                    .value=${draft.ufh_max_supply_temp ?? 48}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ ufh_max_supply_temp: e.detail.value })}
                  ></rs-number-field>
                </div>`
              : nothing
          }
        </section>

        <!-- Fuel, kg Counting, Feeder Screw & Costs -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Paliwo, liczenie spalonego opału (kg) i koszty energii",
              "Fuel, Burned Fuel Counting (kg) & Energy Costs",
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
                      ${this._t("Szybki wybór kaloryczności opału:", "Quick fuel calorific presets:")}
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
                                ash_content_pct: p.ashPct,
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
                      .label=${this._t("Kaloryczność opału", "Fuel calorific value")}
                      suffix="MJ/kg"
                      .min=${5}
                      .max=${40}
                      .step=${0.5}
                      .value=${draft.calorific_value_mj_kg}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ calorific_value_mj_kg: e.detail.value })}
                    ></rs-number-field>
                    <rs-number-field
                      .label=${this._t("Sprawność kotła / kominka", "Boiler / fireplace efficiency")}
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
                      `1 kg opału (${draft.calorific_value_mj_kg} MJ/kg) = ${chemKwh} kWh energii chemicznej → ${usableKwh} kWh ciepła użytecznego.`,
                      `1 kg of fuel (${draft.calorific_value_mj_kg} MJ/kg) = ${chemKwh} kWh chemical → ${usableKwh} kWh usable heat.`,
                    )}
                  </p>
                  <div class="pair">
                    <ha-entity-picker
                      .hass=${this.hass}
                      .includeDomains=${["switch", "binary_sensor", "input_boolean"]}
                      .label=${this._t("Podajnik ślimakowy (opcjonalnie — dokładne kg)", "Feeder / auger entity (exact kg)")}
                      .value=${draft.feeder_entity ?? ""}
                      @value-changed=${(e: CustomEvent) =>
                        this._updateDraft({ feeder_entity: (e.detail?.value as string) ?? "" })}
                    ></ha-entity-picker>
                    <rs-number-field
                      .label=${this._t("Wydajność podajnika", "Feeder throughput")}
                      suffix="kg/h"
                      .min=${0.5}
                      .max=${100}
                      .step=${0.5}
                      .value=${draft.feeder_kg_per_hour ?? 12}
                      @value-changed=${(e: CustomEvent<{ value: number }>) =>
                        this._updateDraft({ feeder_kg_per_hour: e.detail.value })}
                    ></rs-number-field>
                  </div>
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
              .label=${this._t("Sensor mocy (W/kW) lub energii (kWh)", "HA power (W/kW) or energy (kWh) sensor")}
              .value=${draft.energy_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ energy_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Sensor spalonego opału z HA (kg / g / m³)", "HA burned fuel sensor (kg / g / m³)")}
              .value=${draft.fuel_consumption_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ fuel_consumption_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
        </section>

        <!-- Maintenance & Notifications (Refill, Ash Tray, Chimney Cleaning) -->
        ${
          isSolidFuel
            ? html`<section class="group">
                <h4 class="group-title">
                  ${this._t(
                    "Powiadomienia: Dołożenie opału, Popielnik i Czyszczenie komina",
                    "Maintenance Notifications: Refill, Ash Tray & Chimney Cleaning",
                  )}
                </h4>
                <div class="pair">
                  <rs-number-field
                    .label=${this._t("Pojemność zasobnika / załadunku", "Hopper / load capacity")}
                    suffix="kg"
                    .min=${1}
                    .max=${5000}
                    .step=${5}
                    .value=${draft.hopper_capacity_kg ?? 100}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ hopper_capacity_kg: e.detail.value })}
                  ></rs-number-field>
                  <rs-number-field
                    .label=${this._t("Zawartość popiołu w opale", "Fuel ash content")}
                    suffix="%"
                    .min=${0}
                    .max=${40}
                    .step=${0.5}
                    .value=${draft.ash_content_pct ?? 7}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ ash_content_pct: e.detail.value })}
                  ></rs-number-field>
                </div>
                <ha-entity-picker
                  .hass=${this.hass}
                  .includeDomains=${["sensor", "input_number"]}
                  .label=${this._t("Opcjonalny czujnik poziomu opału w zasobniku (% lub kg)", "Optional hopper level sensor (% or kg)")}
                  .value=${draft.hopper_level_sensor ?? ""}
                  @value-changed=${(e: CustomEvent) =>
                    this._updateDraft({ hopper_level_sensor: (e.detail?.value as string) ?? "" })}
                ></ha-entity-picker>

                <rs-list-row
                  switch
                  .heading=${this._t("Powiadomienie o dołożeniu opału do pieca", "Refuel / top-up notification")}
                  .checked=${draft.notify_refill_enabled ?? false}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._updateDraft({ notify_refill_enabled: e.detail })}
                ></rs-list-row>
                <div class="pair">
                  <rs-number-field
                    .label=${this._t("Alert gdy pozostało mniej niż (kg)", "Alert below remaining (kg)")}
                    suffix="kg"
                    .min=${0}
                    .max=${1000}
                    .step=${1}
                    .value=${draft.refill_alert_kg ?? 20}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ refill_alert_kg: e.detail.value })}
                  ></rs-number-field>
                  <rs-number-field
                    .label=${this._t("Alert gdy poziom zasobnika ≤ (%)", "Alert below hopper level (%)")}
                    suffix="%"
                    .min=${0}
                    .max=${100}
                    .step=${5}
                    .value=${draft.refill_alert_pct ?? 20}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ refill_alert_pct: e.detail.value })}
                  ></rs-number-field>
                </div>

                <rs-list-row
                  switch
                  .heading=${this._t("Powiadomienie o posprzątaniu zbiornika na popiół", "Ash container emptying notification")}
                  .checked=${draft.notify_ash_enabled ?? false}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._updateDraft({ notify_ash_enabled: e.detail })}
                ></rs-list-row>
                <div class="pair">
                  <rs-number-field
                    .label=${this._t("Interwał popielnika (kg spalonego opału)", "Ash interval (kg burned)")}
                    suffix="kg"
                    .min=${0}
                    .max=${5000}
                    .step=${10}
                    .value=${draft.ash_clean_interval_kg ?? 150}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ ash_clean_interval_kg: e.detail.value })}
                  ></rs-number-field>
                  <rs-number-field
                    .label=${this._t("Interwał popielnika (dni, 0 = wył.)", "Ash interval (days, 0 = off)")}
                    .suffix=${this._t("dni", "d")}
                    .min=${0}
                    .max=${365}
                    .step=${1}
                    .value=${draft.ash_clean_interval_days ?? 7}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ ash_clean_interval_days: e.detail.value })}
                  ></rs-number-field>
                </div>

                <rs-list-row
                  switch
                  .heading=${this._t("Powiadomienie o czyszczeniu komina", "Chimney cleaning notification")}
                  .checked=${draft.notify_chimney_enabled ?? false}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._updateDraft({ notify_chimney_enabled: e.detail })}
                ></rs-list-row>
                <div class="pair">
                  <rs-number-field
                    .label=${this._t("Interwał komina (kg spalonego opału)", "Chimney interval (kg burned)")}
                    suffix="kg"
                    .min=${0}
                    .max=${20000}
                    .step=${50}
                    .value=${draft.chimney_clean_interval_kg ?? 1000}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ chimney_clean_interval_kg: e.detail.value })}
                  ></rs-number-field>
                  <rs-number-field
                    .label=${this._t("Interwał komina (dni, np. 90)", "Chimney interval (days, e.g. 90)")}
                    .suffix=${this._t("dni", "d")}
                    .min=${0}
                    .max=${365}
                    .step=${5}
                    .value=${draft.chimney_clean_interval_days ?? 90}
                    @value-changed=${(e: CustomEvent<{ value: number }>) =>
                      this._updateDraft({ chimney_clean_interval_days: e.detail.value })}
                  ></rs-number-field>
                </div>
              </section>`
            : nothing
        }

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
    isUnderfloor: boolean;
    systemLabel: string;
  }[] {
    const list: {
      entityId: string;
      name: string;
      roomName: string;
      type: string;
      isUnderfloor: boolean;
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
        const isUfh =
          d.heating_system_type === "underfloor" || room.heating_system_type === "underfloor";
        const sys = isUfh
          ? this._t("Odbiornik: Podłogówka", "Receiver: Underfloor")
          : d.type === "ac"
            ? this._t("Klimatyzator / PC", "AC / Heat pump")
            : this._t("Odbiornik: Kaloryfer (TRV)", "Receiver: Radiator (TRV)");
        list.push({
          entityId: d.entity_id,
          name: this._entityFriendlyName(d.entity_id),
          roomName,
          type: d.type,
          isUnderfloor: isUfh,
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

  private _isDeviceUnderfloor(entityId: string): boolean {
    for (const room of Object.values(this.rooms)) {
      for (const d of room.devices ?? []) {
        if (d.entity_id === entityId) {
          return (
            d.heating_system_type === "underfloor" || room.heating_system_type === "underfloor"
          );
        }
      }
      if ((room.thermostats ?? []).includes(entityId) && room.heating_system_type === "underfloor") {
        return true;
      }
    }
    return false;
  }

  private _entityFriendlyName(entityId: string): string {
    return (
      (this.hass.states[entityId]?.attributes?.friendly_name as string | undefined) || entityId
    );
  }

  private _onAddPlant(presetType: HeatPlantType = "coal_boiler") {
    const id = `plant_${Date.now().toString(36)}`;
    const allDevs = this._collectAllRoomHeatingDevices();
    const trvs = allDevs.filter((d) => d.type === "trv").map((d) => d.entityId);
    const isFireplace = presetType === "fireplace";
    const isGas = presetType === "gas_boiler";
    const isCoal = presetType === "coal_boiler";
    const cannotExtinguish = isCoal || isFireplace || presetType === "wood_boiler";

    const newPlant: HeatPlantConfig = {
      id,
      name: isFireplace
        ? this._t("Kominek", "Fireplace")
        : isGas
          ? this._t("Kocioł gazowy", "Gas Boiler")
          : isCoal
            ? this._t("Piec Ekogroszek", "Coal Boiler")
            : this._t("Źródło ciepła", "Heat Source"),
      plant_type: presetType,
      enabled: true,
      priority: isFireplace ? 1 : this.heatPlants.length + 1,
      parent_plant_id: "",
      cannot_extinguish: cannotExtinguish,
      min_power_pct: cannotExtinguish ? 12 : 0,
      assigned_devices: isCoal || isGas ? trvs : [],
      assigned_rooms: [],
      source_entity: "",
      target_supply_temp: isFireplace ? 60 : isGas ? 50 : 55,
      idle_supply_temp: cannotExtinguish ? 42 : 30,
      off_mode: cannotExtinguish ? "temperature" : "off",
      min_rooms_demand: 1,
      supply_temp_sensor: "",
      return_temp_sensor: "",
      dhw_temp_sensor: "",
      flue_temp_sensor: "",
      ch_pump_entity: "",
      ch_pump_min_supply_temp: presetType === "heat_pump" ? 20 : isGas ? 30 : 40,
      ch_pump_overrun_temp: 80,
      ufh_pump_entity: "",
      ufh_supply_temp_sensor: "",
      ufh_min_supply_temp: 25,
      ufh_max_supply_temp: 48,
      dhw_pump_entity: "",
      dhw_target_temp: 50,
      dhw_hysteresis: 3,
      dhw_min_supply_delta: 3,
      fuel_type: isFireplace
        ? "wood"
        : isGas
          ? "gas"
          : presetType === "heat_pump"
            ? "electricity"
            : "coal",
      calorific_value_mj_kg: isFireplace ? 14.5 : 26.0,
      calorific_value_kwh_m3: 10.5,
      efficiency_pct: isFireplace ? 75 : isGas ? 96 : 85,
      cop: 3.5,
      nominal_power_kw: isFireplace ? 12.0 : 15.0,
      fuel_price: isFireplace ? 600 : isGas ? 3.5 : presetType === "heat_pump" ? 1.1 : 1500,
      currency: "PLN",
      energy_sensor: "",
      fuel_consumption_sensor: "",
      feeder_entity: "",
      feeder_kg_per_hour: 12.0,
      hopper_capacity_kg: isFireplace ? 20 : 100,
      hopper_level_sensor: "",
      ash_content_pct: isFireplace ? 1.5 : 7.0,
      notify_refill_enabled: isCoal || isFireplace,
      refill_alert_kg: isFireplace ? 5 : 20,
      refill_alert_pct: 20,
      notify_ash_enabled: isCoal || isFireplace,
      ash_clean_interval_kg: isFireplace ? 50 : 150,
      ash_clean_interval_days: 7,
      notify_chimney_enabled: isCoal || isFireplace,
      chimney_clean_interval_kg: isFireplace ? 500 : 1000,
      chimney_clean_interval_days: 90,
    };
    const next = [...this.heatPlants, newPlant];
    this._editingId = id;
    this._draft = { ...newPlant };
    void this._savePlants(next);
  }

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
    const fuelDefaults: Record<
      HeatPlantType,
      {
        fuel: FuelType;
        mj: number;
        eff: number;
        price: number;
        cannotExt: boolean;
        ashPct: number;
        supply: number;
        idle: number;
        pumpMin: number;
        overrun: number;
      }
    > = {
      coal_boiler: {
        fuel: "coal",
        mj: 26.0,
        eff: 85,
        price: 1500,
        cannotExt: true,
        ashPct: 7.0,
        supply: 55,
        idle: 42,
        pumpMin: 40,
        overrun: 80,
      },
      pellet_boiler: {
        fuel: "pellet",
        mj: 18.0,
        eff: 90,
        price: 1400,
        cannotExt: false,
        ashPct: 0.7,
        supply: 55,
        idle: 38,
        pumpMin: 40,
        overrun: 80,
      },
      wood_boiler: {
        fuel: "wood",
        mj: 14.5,
        eff: 78,
        price: 600,
        cannotExt: true,
        ashPct: 1.5,
        supply: 60,
        idle: 45,
        pumpMin: 45,
        overrun: 85,
      },
      fireplace: {
        fuel: "wood",
        mj: 14.5,
        eff: 75,
        price: 600,
        cannotExt: true,
        ashPct: 1.5,
        supply: 60,
        idle: 45,
        pumpMin: 40,
        overrun: 85,
      },
      gas_boiler: {
        fuel: "gas",
        mj: 26.0,
        eff: 96,
        price: 3.5,
        cannotExt: false,
        ashPct: 0.0,
        supply: 50,
        idle: 30,
        pumpMin: 30,
        overrun: 80,
      },
      electric_heater: {
        fuel: "electricity",
        mj: 26.0,
        eff: 99,
        price: 1.1,
        cannotExt: false,
        ashPct: 0.0,
        supply: 50,
        idle: 30,
        pumpMin: 25,
        overrun: 80,
      },
      air_heater: {
        fuel: "electricity",
        mj: 26.0,
        eff: 95,
        price: 1.1,
        cannotExt: false,
        ashPct: 0.0,
        supply: 45,
        idle: 25,
        pumpMin: 20,
        overrun: 80,
      },
      heat_pump: {
        fuel: "electricity",
        mj: 26.0,
        eff: 100,
        price: 1.1,
        cannotExt: false,
        ashPct: 0.0,
        supply: 40,
        idle: 25,
        pumpMin: 20,
        overrun: 65,
      },
    };
    const d = fuelDefaults[plantType];
    this._updateDraft({
      plant_type: plantType,
      fuel_type: d.fuel,
      calorific_value_mj_kg: d.mj,
      efficiency_pct: d.eff,
      fuel_price: d.price,
      cannot_extinguish: d.cannotExt,
      off_mode: d.cannotExt ? "temperature" : "off",
      ash_content_pct: d.ashPct,
      target_supply_temp: d.supply,
      idle_supply_temp: d.idle,
      ch_pump_min_supply_temp: d.pumpMin,
      ch_pump_overrun_temp: d.overrun,
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

  private async _onLogFuel(plantId: string, kg: number, mode: "burned" | "refill") {
    fireSaveStatus(this, "saving");
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/log_fuel",
        plant_id: plantId,
        kg,
        mode,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
  }

  private async _onMaintenance(
    plantId: string,
    action: "refill" | "ash_cleaned" | "chimney_cleaned",
  ) {
    fireSaveStatus(this, "saving");
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/maintenance",
        plant_id: plantId,
        action,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
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
