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
  BoilerMode,
  RadiatorSensorConfig,
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
  @state() private _fuelInputBags: Record<string, number> = {};
  @state() private _fuelFilledFull: Record<string, boolean> = {};
  @state() private _newRadSensor = "";
  @state() private _newRadReturnSensor = "";
  @state() private _newRadName = "";
  @state() private _newRadPipeLen = 10;

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

      .warnings-banner {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .warning-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid var(--rs-warn);
        background: color-mix(in srgb, var(--rs-warn) 12%, transparent);
        font-size: 12px;
        --mdc-icon-size: 18px;
      }

      .warning-item.critical {
        border-color: var(--rs-err);
        background: color-mix(in srgb, var(--rs-err) 14%, transparent);
      }

      .warning-item.critical ha-icon {
        color: var(--rs-err);
      }

      .warning-item.warning ha-icon {
        color: var(--rs-warn);
      }

      .warning-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .metric-tile.warn {
        border: 1px solid color-mix(in srgb, var(--rs-warn) 55%, transparent);
      }

      .metric-tile.err {
        border: 1px solid color-mix(in srgb, var(--rs-err) 65%, transparent);
        background: color-mix(in srgb, var(--rs-err) 9%, var(--rs-fill));
      }

      .metric-tile.clickable {
        cursor: pointer;
      }

      .metric-tile.clickable:hover {
        outline: 1px solid var(--primary-color);
      }

      .temp-control-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 16px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--rs-fill);
      }

      .temp-ctrl-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
      }

      .temp-ctrl-label {
        color: var(--secondary-text-color);
        font-weight: 500;
      }

      .step-btn {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: grid;
        place-items: center;
      }

      .step-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .step-val {
        min-width: 44px;
        text-align: center;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      .mode-pills {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .mode-pill {
        padding: 4px 9px;
        border-radius: 999px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, transparent);
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
      }

      .mode-pill.active {
        border-color: var(--primary-color);
        background: var(--rs-fill-primary);
        color: var(--primary-color);
      }

      .refill-check {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: var(--secondary-text-color);
        cursor: pointer;
      }

      .rad-sensor-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .rad-sensor-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 8px;
        background: var(--rs-fill);
        font-size: 12px;
      }

      .rad-sensor-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .rad-sensor-meta small {
        color: var(--secondary-text-color);
      }

      .rad-add-box {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 8px;
        border: 1px dashed var(--divider-color);
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
    const effUsed = live?.real_efficiency_pct ?? plant.efficiency_pct;
    const usableKwhKg = chemKwhKg * (effUsed / 100);
    const fuelUnit =
      live?.fuel_unit ?? (isSolidFuel ? "kg" : plant.fuel_type === "gas" ? "m³" : "kWh");
    const parentPlant = plant.parent_plant_id
      ? this.heatPlants.find((p) => p.id === plant.parent_plant_id)
      : null;
    const warnings = live?.warnings ?? [];
    const curMode: BoilerMode = (plant.boiler_mode ?? live?.boiler_mode ?? "auto") as BoilerMode;
    const burn24h = live?.burn_rate_per_24h ?? (live?.burn_rate_per_h ?? 0) * 24;

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
              curMode === "summer_dhw_only"
                ? html`<span class="status-pill tag">☀ ${this._t("Tryb LATO (CWU)", "SUMMER (DHW)")}</span>`
                : curMode === "heating"
                  ? html`<span class="status-pill tag">❄ ${this._t("Tryb ZIMA", "WINTER")}</span>`
                  : nothing
            }
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

      ${
        warnings.length > 0
          ? html`<div class="warnings-banner">
              ${warnings.map(
                (w) => html`
                  <div class="warning-item ${w.severity}">
                    <ha-icon
                      icon=${w.severity === "critical" ? "mdi:alert-octagon" : "mdi:alert-outline"}
                    ></ha-icon>
                    <div class="warning-body">
                      <strong>${w.title}</strong>
                      <span>${w.detail}</span>
                    </div>
                  </div>
                `,
              )}
            </div>`
          : nothing
      }

      <!-- Quick Boiler Temperature & Mode Control Bar -->
      <div class="temp-control-bar">
        <div class="temp-ctrl-group">
          <span class="temp-ctrl-label">${this._t("Tryb:", "Mode:")}</span>
          <div class="mode-pills">
            ${(
              [
                ["auto", this._t("Auto", "Auto")],
                ["heating", this._t("Zima / Grzanie", "Winter")],
                ["summer_dhw_only", this._t("Lato (CWU)", "Summer")],
                ["hold", this._t("Podtrzymanie", "Hold")],
              ] as Array<[BoilerMode, string]>
            ).map(
              ([m, lbl]) => html`
                <button
                  type="button"
                  class="mode-pill ${curMode === m ? "active" : ""}"
                  @click=${() => this._onSetTemperatures(plant.id, { boiler_mode: m })}
                >
                  ${lbl}
                </button>
              `,
            )}
          </div>
        </div>

        <div class="temp-ctrl-group">
          <span class="temp-ctrl-label">${this._t("Kocioł:", "Boiler:")}</span>
          <button
            type="button"
            class="step-btn"
            @click=${() =>
              this._onSetTemperatures(plant.id, {
                target_supply_temp: Math.max(20, plant.target_supply_temp - 1),
              })}
          >
            −
          </button>
          <span class="step-val">${formatTempLocale(plant.target_supply_temp, this.hass, 0, 1)}${unit}</span>
          <button
            type="button"
            class="step-btn"
            @click=${() =>
              this._onSetTemperatures(plant.id, {
                target_supply_temp: Math.min(88, plant.target_supply_temp + 1),
              })}
          >
            +
          </button>
        </div>

        <div class="temp-ctrl-group">
          <span class="temp-ctrl-label">${this._t("Podtrzym.:", "Hold:")}</span>
          <button
            type="button"
            class="step-btn"
            @click=${() =>
              this._onSetTemperatures(plant.id, {
                idle_supply_temp: Math.max(15, plant.idle_supply_temp - 1),
              })}
          >
            −
          </button>
          <span class="step-val">${formatTempLocale(plant.idle_supply_temp, this.hass, 0, 1)}${unit}</span>
          <button
            type="button"
            class="step-btn"
            @click=${() =>
              this._onSetTemperatures(plant.id, {
                idle_supply_temp: Math.min(75, plant.idle_supply_temp + 1),
              })}
          >
            +
          </button>
        </div>

        ${
          plant.dhw_temp_sensor || plant.dhw_pump_entity || plant.dhw_target_temp_entity
            ? html`<div class="temp-ctrl-group">
                <span class="temp-ctrl-label">${this._t("CWU:", "DHW:")}</span>
                <button
                  type="button"
                  class="step-btn"
                  @click=${() =>
                    this._onSetTemperatures(plant.id, {
                      dhw_target_temp: Math.max(30, plant.dhw_target_temp - 1),
                    })}
                >
                  −
                </button>
                <span class="step-val">${formatTempLocale(plant.dhw_target_temp, this.hass, 0, 1)}${unit}</span>
                <button
                  type="button"
                  class="step-btn"
                  @click=${() =>
                    this._onSetTemperatures(plant.id, {
                      dhw_target_temp: Math.min(75, plant.dhw_target_temp + 1),
                    })}
                >
                  +
                </button>
              </div>`
            : nothing
        }

        ${
          live?.recommended_supply_temp != null &&
          Math.abs(live.recommended_supply_temp - plant.target_supply_temp) >= 1
            ? html`<button
                type="button"
                class="preset-btn accent"
                @click=${() =>
                  this._onSetTemperatures(plant.id, {
                    target_supply_temp: Math.round(live.recommended_supply_temp!),
                  })}
              >
                MPC: ${formatTempLocale(live.recommended_supply_temp, this.hass, 0, 1)}${unit}
              </button>`
            : nothing
        }
      </div>

      <!-- Info Kocioł (Galmet eLider / Boiler Telemetry) -->
      <div class="metrics-grid">
        <div
          class="metric-tile ${plant.supply_temp_sensor ? "clickable" : ""} ${live?.overheat_protect ? "err" : live?.fire_out_warning ? "warn" : ""}"
          @click=${() => plant.supply_temp_sensor && openEntityInfo(this, plant.supply_temp_sensor)}
        >
          <span class="metric-label">
            <ha-icon icon="mdi:thermometer-chevron-up"></ha-icon>
            ${this._t("Kocioł (Zasilanie C.O.)", "Boiler (Supply Temp)")}
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

        <div
          class="metric-tile ${plant.return_temp_sensor ? "clickable" : ""} ${live?.low_return_warning ? "warn" : ""}"
          @click=${() => plant.return_temp_sensor && openEntityInfo(this, plant.return_temp_sensor)}
        >
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
            ${live?.low_return_warning ? ` · ${this._t("Zimny powrót!", "Cold return!")}` : ""}
          </span>
        </div>

        ${
          isSolidFuel || plant.feeder_temp_sensor || live?.feeder_temp != null
            ? html`<div
                class="metric-tile ${plant.feeder_temp_sensor ? "clickable" : ""} ${live?.feeder_overheat_warning ? "err" : ""}"
                @click=${() => plant.feeder_temp_sensor && openEntityInfo(this, plant.feeder_temp_sensor)}
              >
                <span class="metric-label">
                  <ha-icon icon="mdi:screw-machine-flat-top"></ha-icon>
                  ${this._t("Temp. podajnika", "Feeder Temp")}
                </span>
                <span class="metric-val">${fmtTemp(live?.feeder_temp)}</span>
                <span class="metric-sub">
                  ${
                    live?.feeder_overheat_warning
                      ? this._t("ALARM: COFNIĘCIE ŻARU!", "ALARM: BURN-BACK!")
                      : `${this._t("Limit bezp.", "Safety limit")}: ${plant.feeder_max_temp ?? 60}${unit}`
                  }
                </span>
              </div>`
            : nothing
        }

        ${
          isSolidFuel ||
          live?.feeder_work_time_s != null ||
          live?.feeder_pause_time_s != null ||
          plant.feeder_work_time_sensor ||
          plant.feeder_pause_time_sensor
            ? html`<div class="metric-tile">
                <span class="metric-label">
                  <ha-icon icon="mdi:cog-transfer-outline"></ha-icon>
                  ${this._t("Podajnik (praca / przerwa)", "Feeder (work / pause)")}
                </span>
                <span class="metric-val">
                  ${
                    live?.feeder_work_time_s != null || live?.feeder_pause_time_s != null
                      ? `${formatNumber(live?.feeder_work_time_s ?? 0, this.hass, 1)}s / ${formatNumber(live?.feeder_pause_time_s ?? 0, this.hass, 1)}s`
                      : live?.feeder_active
                        ? this._t("Podaje opał", "Feeding")
                        : "--"
                  }
                </span>
                <span class="metric-sub">
                  ${
                    live?.feeder_duty_pct != null
                      ? `${this._t("Wypełnienie", "Duty")}: ${formatNumber(live.feeder_duty_pct, this.hass, 2)}%`
                      : `${this._t("Wydajność", "Rate")}: ${plant.feeder_kg_per_hour ?? 12} kg/h`
                  }
                </span>
              </div>`
            : nothing
        }

        ${
          isSolidFuel || plant.blower_sensor || live?.blower_pct != null
            ? html`<div
                class="metric-tile ${plant.blower_sensor ? "clickable" : ""}"
                @click=${() => plant.blower_sensor && openEntityInfo(this, plant.blower_sensor)}
              >
                <span class="metric-label">
                  <ha-icon icon="mdi:fan"></ha-icon>
                  ${this._t("Nadmuch / dmuchawa", "Blower / Fan")}
                </span>
                <span class="metric-val">
                  ${
                    live?.blower_pct != null
                      ? `${live.blower_mode ? `${live.blower_mode} ` : ""}${formatNumber(live.blower_pct, this.hass, 0)}%`
                      : "--"
                  }
                </span>
                <span class="metric-sub">
                  ${
                    live?.blower_mode
                      ? `${this._t("Tryb", "Mode")}: ${live.blower_mode}`
                      : plant.blower_sensor
                        ? this._entityFriendlyName(plant.blower_sensor)
                        : this._t("Dodaj czujnik nadmuchu", "Add blower sensor")
                  }
                </span>
              </div>`
            : nothing
        }

        ${
          plant.flue_temp_sensor || live?.flue_temp != null
            ? html`<div
                class="metric-tile ${plant.flue_temp_sensor ? "clickable" : ""} ${live?.flue_high_warning ? "warn" : ""}"
                @click=${() => plant.flue_temp_sensor && openEntityInfo(this, plant.flue_temp_sensor)}
              >
                <span class="metric-label">
                  <ha-icon icon="mdi:smoke"></ha-icon>
                  ${this._t("Spaliny / Sprawność", "Flue / Efficiency")}
                </span>
                <span class="metric-val">${fmtTemp(live?.flue_temp)}</span>
                <span class="metric-sub">
                  ${this._t("Sprawność", "Eff.")}: ${formatNumber(effUsed, this.hass, 1)}%
                  ${
                    live?.flue_loss_pct != null
                      ? ` · ${this._t("strata", "loss")} ${formatNumber(live.flue_loss_pct, this.hass, 1)}%`
                      : ""
                  }
                </span>
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
            ? html`<div class="metric-tile ${live?.ufh_overheat_protect ? "err" : ""}">
                <span class="metric-label">
                  <ha-icon icon="mdi:waves"></ha-icon>
                  ${this._t("Obieg podłogówki", "Underfloor Circuit")}
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
                      ? `${this._t("Zasilanie", "Supply")}: ${fmtTemp(live.ufh_supply_temp)} · `
                      : ""
                  }${this._t("Maks.", "Max")} ${plant.ufh_max_supply_temp ?? 48}°C
                </span>
              </div>`
            : nothing
        }
      </div>

      <!-- Info CWU (DHW Tank, DHW Supply, Charging & Circulation Pumps) -->
      ${
        plant.dhw_temp_sensor ||
        plant.dhw_supply_temp_sensor ||
        plant.dhw_pump_entity ||
        plant.dhw_circulation_pump_entity
          ? html`<div class="section-box">
              <div class="section-title">
                <span>${this._t("Info CWU — Ciepła woda użytkowa i cyrkulacja", "DHW Info — Domestic Hot Water & Circulation")}</span>
                <span>
                  ${
                    curMode === "summer_dhw_only"
                      ? this._t("Tryb LATO (tylko CWU)", "SUMMER (DHW only)")
                      : this._t("Tryb ZIMA (C.O. + CWU)", "WINTER (CH + DHW)")
                  }
                </span>
              </div>
              <div class="metrics-grid">
                <div
                  class="metric-tile ${plant.dhw_temp_sensor ? "clickable" : ""}"
                  @click=${() => plant.dhw_temp_sensor && openEntityInfo(this, plant.dhw_temp_sensor)}
                >
                  <span class="metric-label">
                    <ha-icon icon="mdi:water-boiler"></ha-icon>
                    ${this._t("Zasobnik CWU", "DHW Tank")}
                  </span>
                  <span class="metric-val">${fmtTemp(live?.dhw_temp)}</span>
                  <span class="metric-sub">
                    ${this._t("Zadana", "Target")}: ${fmtTemp(plant.dhw_target_temp)} (±${plant.dhw_hysteresis} K)
                  </span>
                </div>

                ${
                  plant.dhw_supply_temp_sensor || live?.dhw_supply_temp != null
                    ? html`<div
                        class="metric-tile ${plant.dhw_supply_temp_sensor ? "clickable" : ""}"
                        @click=${() =>
                          plant.dhw_supply_temp_sensor &&
                          openEntityInfo(this, plant.dhw_supply_temp_sensor)}
                      >
                        <span class="metric-label">
                          <ha-icon icon="mdi:thermometer-water"></ha-icon>
                          ${this._t("Zasilanie wężownicy CWU", "DHW Supply / Coil")}
                        </span>
                        <span class="metric-val">${fmtTemp(live?.dhw_supply_temp)}</span>
                        <span class="metric-sub">
                          ${this._t("Min. przewyższenie", "Min delta")}: +${plant.dhw_min_supply_delta} K
                        </span>
                      </div>`
                    : nothing
                }

                ${
                  plant.dhw_pump_entity
                    ? html`<div class="metric-tile">
                        <span class="metric-label">
                          <ha-icon icon="mdi:pump"></ha-icon>
                          ${this._t("Pompa ładująca CWU", "DHW Charging Pump")}
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

                ${
                  plant.dhw_circulation_pump_entity
                    ? html`<div
                        class="metric-tile clickable"
                        @click=${() => openEntityInfo(this, plant.dhw_circulation_pump_entity!)}
                      >
                        <span class="metric-label">
                          <ha-icon icon="mdi:water-sync"></ha-icon>
                          ${this._t("Pompa cyrkulacji CWU", "DHW Circulation Pump")}
                        </span>
                        <span class="metric-val">
                          ${live?.dhw_circulation_pump_active ? this._t("Aktywna", "Running") : this._t("Wyłączona", "Off")}
                        </span>
                        <span class="metric-sub">
                          ${this._entityFriendlyName(plant.dhw_circulation_pump_entity)}
                        </span>
                      </div>`
                    : nothing
                }
              </div>
            </div>`
          : nothing
      }

      <!-- Energy, Auto-calculated Fuel & Distribution Losses -->
      <div class="section-box">
        <div class="section-title">
          <span>
            ${this._t(
              "Spalanie (auto-wyliczane), kaloryczność, straty przesyłu i koszty",
              "Auto-Calculated Burn, Calorific Value, Pipe Losses & Costs",
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
                    ${this._t("Kaloryczność i sprawność", "Calorific & Efficiency")}
                  </span>
                  <span class="metric-val">
                    ${formatNumber(plant.calorific_value_mj_kg, this.hass, 1)} MJ/kg
                  </span>
                  <span class="metric-sub">
                    ${formatNumber(usableKwhKg, this.hass, 2)} kWh/kg · η ${formatNumber(effUsed, this.hass, 1)}%
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
                    <span class="metric-val">${formatNumber(effUsed, this.hass, 1)}%</span>
                    <span class="metric-sub">${plant.nominal_power_kw} kW</span>
                  </div>`
          }

          <div class="metric-tile">
            <span class="metric-label">
              <ha-icon icon="mdi:flash"></ha-icon>
              ${this._t("Moc chwilowa i spalanie / 24h", "Power & 24h Burn Rate")}
            </span>
            <span class="metric-val">
              ${formatNumber(live?.current_thermal_kw ?? 0, this.hass, 2)} kW ·
              ${formatNumber(burn24h, this.hass, 1)} ${fuelUnit}/24h
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

          ${
            (plant.radiator_sensors?.length ?? 0) > 0 || live?.distribution_loss_pct != null
              ? html`<div class="metric-tile ${live?.high_pipe_loss_warning ? "warn" : ""}">
                  <span class="metric-label">
                    <ha-icon icon="mdi:pipe-leak"></ha-icon>
                    ${this._t("Straty piec → kaloryfery", "Pipe Heat Loss")}
                  </span>
                  <span class="metric-val">
                    ${
                      live?.distribution_loss_pct != null
                        ? `${formatNumber(live.distribution_loss_pct, this.hass, 1)}%`
                        : "--"
                    }
                    ${
                      live?.distribution_temp_drop_k != null
                        ? ` (−${formatNumber(live.distribution_temp_drop_k, this.hass, 1)} K)`
                        : ""
                    }
                  </span>
                  <span class="metric-sub">
                    ${this._t("Kaloryfery śr.", "Rads avg")}: ${fmtTemp(live?.avg_radiator_temp)} ·
                    ${formatNumber(live?.distribution_loss_kwh_today ?? 0, this.hass, 1)} kWh
                    ${this._t("dziś", "today")}
                  </span>
                </div>`
              : nothing
          }
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
    const bagWeight = plant.bag_weight_kg && plant.bag_weight_kg > 0 ? plant.bag_weight_kg : 25;
    const bagsInput = this._fuelInputBags[plant.id] ?? 1;
    const kgInput = this._fuelInputKg[plant.id] ?? Math.round(bagsInput * bagWeight * 10) / 10;
    const filledFull = this._fuelFilledFull[plant.id] ?? true;

    return html`
      <div class="fuel-log-row">
        <span>
          <b
            >${this._t(
              "Zgłoś zasyp opału (spalanie liczy i kalibruje się automatycznie):",
              "Report fuel refill (burn rate auto-calculates & calibrates):",
            )}</b
          >
        </span>
        <input
          class="fuel-log-input"
          type="number"
          min="0.5"
          max="50"
          step="0.5"
          style="width: 58px"
          .value=${String(bagsInput)}
          @input=${(e: Event) => {
            const b = parseFloat((e.target as HTMLInputElement).value);
            if (Number.isFinite(b) && b > 0) {
              this._fuelInputBags = { ...this._fuelInputBags, [plant.id]: b };
              this._fuelInputKg = {
                ...this._fuelInputKg,
                [plant.id]: Math.round(b * bagWeight * 10) / 10,
              };
            }
          }}
        />
        <span>${this._t(`worków (×${bagWeight} kg) =`, `bags (×${bagWeight} kg) =`)}</span>
        <input
          class="fuel-log-input"
          type="number"
          min="0.5"
          max="2000"
          step="0.5"
          .value=${String(kgInput)}
          @input=${(e: Event) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (Number.isFinite(val) && val > 0) {
              this._fuelInputKg = { ...this._fuelInputKg, [plant.id]: val };
              this._fuelInputBags = {
                ...this._fuelInputBags,
                [plant.id]: Math.round((val / bagWeight) * 10) / 10,
              };
            }
          }}
        />
        <span>kg</span>
        <button
          type="button"
          class="preset-btn"
          @click=${() => this._onLogRefill(plant.id, bagWeight, 1, filledFull)}
        >
          +1 ${this._t("worek", "bag")}
        </button>
        <button
          type="button"
          class="preset-btn"
          @click=${() => this._onLogRefill(plant.id, bagWeight * 2, 2, filledFull)}
        >
          +2 ${this._t("worki", "bags")}
        </button>
        <label class="refill-check">
          <input
            type="checkbox"
            .checked=${filledFull}
            @change=${(e: Event) => {
              this._fuelFilledFull = {
                ...this._fuelFilledFull,
                [plant.id]: (e.target as HTMLInputElement).checked,
              };
            }}
          />
          <span>${this._t("Do pełna (kalibruj)", "Full hopper (calibrate)")}</span>
        </label>
        <button
          type="button"
          class="preset-btn accent"
          @click=${() => this._onLogRefill(plant.id, kgInput, bagsInput, filledFull)}
        >
          + ${this._t("Zasypano opał", "Log refill")}
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
            ${
              live?.total_refilled_bags
                ? ` · ${this._t("Wsypano łącznie", "Refilled total")}: ${formatNumber(live.total_refilled_bags, this.hass, 1)} ${this._t("wor.", "bags")}`
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
        <!-- Main Heat Source Entity & Supply Target -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Sterowanie źródłem ciepła i nastawy temperatur",
              "Heat Source Control & Temperature Setpoints",
            )}
          </h4>
          <rs-field .label=${this._t("Tryb pracy pieca (Zima / Lato / Auto)", "Boiler operating mode")}>
            <rs-segmented
              wrap
              .label=${this._t("Tryb pracy", "Boiler mode")}
              .options=${[
                { value: "auto", label: this._t("Auto", "Auto") },
                { value: "heating", label: this._t("Zima / Grzanie", "Winter / Heating") },
                { value: "summer_dhw_only", label: this._t("Lato (tylko CWU)", "Summer (DHW only)") },
                { value: "hold", label: this._t("Podtrzymanie", "Hold") },
              ]}
              .value=${draft.boiler_mode ?? "auto"}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._updateDraft({ boiler_mode: e.detail.value as BoilerMode })}
            ></rs-segmented>
          </rs-field>
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
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["number", "input_number", "climate", "water_heater"]}
              .label=${this._t("Encja zadanej temp. kotła (zapis do pieca)", "Boiler target temp entity (writable)")}
              .value=${draft.boiler_target_temp_entity ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ boiler_target_temp_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["number", "input_number", "water_heater", "climate"]}
              .label=${this._t("Encja zadanej temp. CWU (zapis do pieca)", "DHW target temp entity (writable)")}
              .value=${draft.dhw_target_temp_entity ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_target_temp_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
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

        <!-- Thermometers & Controller Telemetry (Galmet eLider, CWU, Feeder, Blower, Flow) -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Czujniki sterownika kotła (Zasilanie, Powrót, CWU, Podajnik, Nadmuch, Spaliny)",
              "Boiler Controller Sensors (Supply, Return, DHW, Feeder, Blower, Flue)",
            )}
          </h4>
          <div class="pair">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr zasilania C.O. (kocioł)", "Supply temperature sensor")}
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
              .label=${this._t("Termometr CWU (zasobnik)", "DHW (CWU) tank sensor")}
              .value=${draft.dhw_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr zasilania CWU (wężownica)", "DHW supply / coil temp sensor")}
              .value=${draft.dhw_supply_temp_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_supply_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr spalin / bufora", "Flue / buffer temp sensor")}
              .value=${draft.flue_temp_sensor}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ flue_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Termometr podajnika (ochrona cofnięcia żaru)", "Feeder tube temp sensor (burn-back)")}
              .value=${draft.feeder_temp_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ feeder_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number", "fan"]}
              .label=${this._t("Nadmuch / dmuchawa (%)", "Blower / fan speed (%)")}
              .value=${draft.blower_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ blower_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_text", "select"]}
              .label=${this._t("Tryb dmuchawy (np. CNF / PID)", "Blower mode entity (e.g. CNF)")}
              .value=${draft.blower_mode_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ blower_mode_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number", "number"]}
              .label=${this._t("Czas pracy podajnika (s)", "Feeder work time sensor (s)")}
              .value=${draft.feeder_work_time_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ feeder_work_time_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number", "number"]}
              .label=${this._t("Czas przerwy podajnika (s)", "Feeder pause time sensor (s)")}
              .value=${draft.feeder_pause_time_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ feeder_pause_time_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Czujnik spalania dobowego (kg/24h)", "Daily fuel burn sensor (kg/24h)")}
              .value=${draft.daily_fuel_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ daily_fuel_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["switch", "binary_sensor", "input_boolean", "fan"]}
              .label=${this._t("Pompa cyrkulacji CWU (pętla do kranów)", "DHW circulation pump entity")}
              .value=${draft.dhw_circulation_pump_entity ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ dhw_circulation_pump_entity: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Czujnik temp. kotłowni (do Siegerta)", "Boiler room temp sensor")}
              .value=${draft.boiler_room_temp_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ boiler_room_temp_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["sensor", "input_number"]}
              .label=${this._t("Czujnik przepływu C.O. (L/min, opcjonalnie)", "Hydraulic flow sensor (L/min, optional)")}
              .value=${draft.flow_rate_sensor ?? ""}
              @value-changed=${(e: CustomEvent) =>
                this._updateDraft({ flow_rate_sensor: (e.detail?.value as string) ?? "" })}
            ></ha-entity-picker>
          </div>
          <div class="pair">
            <rs-number-field
              .label=${this._t("Ręczny czas pracy podajnika (gdy brak sensora)", "Manual feeder work time (s)")}
              suffix="s"
              .min=${0}
              .max=${300}
              .step=${1}
              .value=${draft.feeder_work_time_s ?? 0}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ feeder_work_time_s: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Ręczny czas przerwy podajnika (gdy brak sensora)", "Manual feeder pause time (s)")}
              suffix="s"
              .min=${0}
              .max=${3600}
              .step=${5}
              .value=${draft.feeder_pause_time_s ?? 0}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ feeder_pause_time_s: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Przepływ pompy C.O. (L/min — dokładne ΔT → kW)", "C.O. hydraulic flow rate (L/min)")}
              suffix="L/min"
              .min=${0}
              .max=${120}
              .step=${0.5}
              .value=${draft.flow_rate_l_min ?? 0}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ flow_rate_l_min: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Waga 1 worka opału (do szybkich zasypów)", "Weight per fuel bag")}
              suffix="kg"
              .min=${5}
              .max=${100}
              .step=${1}
              .value=${draft.bag_weight_kg ?? 25}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ bag_weight_kg: e.detail.value })}
            ></rs-number-field>
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

        <!-- Radiator Temperature Sensors (Pipe / Distribution Heat Loss) -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Czujniki na kaloryferach — pomiar strat ciepła (piec → odbiór)",
              "Radiator Temperature Sensors — Pipe Heat Loss (Boiler → Delivery)",
            )}
          </h4>
          <p class="note">
            ${this._t(
              "Dodaj czujniki temperatury zamontowane na grzejnikach/kaloryferach, aby obliczać spadek temperatury ΔT po drodze, stratę w % i kW oraz koszt ciepła traconego na rurach (widoczne w zakładce Analityka → Piec / Kotłownia).",
              "Attach temperature sensors placed on radiators to measure pipe ΔT drop, % and kW heat loss, and wasted fuel cost between boiler and emitters (displayed in Analytics → Boiler).",
            )}
          </p>
          ${
            (draft.radiator_sensors?.length ?? 0) > 0
              ? html`<div class="rad-sensor-list">
                  ${(draft.radiator_sensors ?? []).map(
                    (rs, idx) => html`
                      <div class="rad-sensor-row">
                        <div class="rad-sensor-meta">
                          <strong>${rs.name || this._entityFriendlyName(rs.entity_id)}</strong>
                          <small>
                            ${rs.entity_id}
                            ${rs.return_entity_id ? ` · ${this._t("powrót", "return")}: ${rs.return_entity_id}` : ""}
                            ${rs.pipe_length_m ? ` · ${rs.pipe_length_m} m` : ""}
                          </small>
                        </div>
                        <rs-icon-button
                          icon="mdi:close"
                          .label=${this._t("Usuń czujnik", "Remove sensor")}
                          @click=${() => this._removeRadiatorSensor(idx)}
                        ></rs-icon-button>
                      </div>
                    `,
                  )}
                </div>`
              : nothing
          }
          <div class="rad-add-box">
            <div class="pair">
              <ha-entity-picker
                .hass=${this.hass}
                .includeDomains=${["sensor", "input_number"]}
                .label=${this._t("Czujnik zasilania na kaloryferze", "Radiator supply temp sensor")}
                .value=${this._newRadSensor}
                @value-changed=${(e: CustomEvent) => {
                  this._newRadSensor = (e.detail?.value as string) ?? "";
                }}
              ></ha-entity-picker>
              <ha-entity-picker
                .hass=${this.hass}
                .includeDomains=${["sensor", "input_number"]}
                .label=${this._t("Czujnik powrotu grzejnika (opcjonalnie)", "Radiator return sensor (optional)")}
                .value=${this._newRadReturnSensor}
                @value-changed=${(e: CustomEvent) => {
                  this._newRadReturnSensor = (e.detail?.value as string) ?? "";
                }}
              ></ha-entity-picker>
            </div>
            <div class="pair">
              <ha-textfield
                .label=${this._t("Nazwa kaloryfera (np. Salon okno)", "Radiator name (e.g. Living room)")}
                .value=${this._newRadName}
                @input=${(e: Event) => {
                  this._newRadName = (e.target as HTMLInputElement).value;
                }}
              ></ha-textfield>
              <rs-number-field
                .label=${this._t("Długość rur od pieca (m)", "Pipe run length from boiler (m)")}
                suffix="m"
                .min=${0}
                .max=${200}
                .step=${1}
                .value=${this._newRadPipeLen}
                @value-changed=${(e: CustomEvent<{ value: number }>) => {
                  this._newRadPipeLen = e.detail.value;
                }}
              ></rs-number-field>
            </div>
            <div>
              <button
                type="button"
                class="preset-btn accent"
                ?disabled=${!this._newRadSensor}
                @click=${() => this._addRadiatorSensor()}
              >
                + ${this._t("Dodaj czujnik na kaloryferze", "Add radiator sensor")}
              </button>
            </div>
          </div>
        </section>

        <!-- Safety Warnings & Notifications -->
        <section class="group">
          <h4 class="group-title">
            ${this._t(
              "Ostrzeżenia bezpieczeństwa i powiadomienia pieca",
              "Boiler Safety Warnings & Notifications",
            )}
          </h4>
          <rs-list-row
            switch
            .heading=${this._t(
              "Wysyłaj powiadomienia HA przy ostrzeżeniach (przegrzanie, podajnik, spaliny, wygaszenie, straty)",
              "Send HA notifications on warnings (overheat, burn-back, flue, fire-out, pipe loss)",
            )}
            .checked=${draft.notify_warnings_enabled ?? true}
            @toggle-changed=${(e: CustomEvent<boolean>) =>
              this._updateDraft({ notify_warnings_enabled: e.detail })}
          ></rs-list-row>
          <div class="pair">
            <rs-number-field
              .label=${this._t("Alarm temp. podajnika (cofnięcie żaru)", "Feeder burn-back alarm temp")}
              suffix="°C"
              .min=${35}
              .max=${95}
              .step=${1}
              .value=${draft.feeder_max_temp ?? 60}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ feeder_max_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Alarm wysokiej temp. spalin", "High flue temp alarm")}
              suffix="°C"
              .min=${100}
              .max=${450}
              .step=${5}
              .value=${draft.flue_max_temp ?? 220}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ flue_max_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Ostrzeżenie zimnego powrotu (ochrona korozji)", "Cold return warning threshold")}
              suffix="°C"
              .min=${20}
              .max=${65}
              .step=${1}
              .value=${draft.return_min_temp ?? 45}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ return_min_temp: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Alarm wygaszenia / niskiej temp. kotła", "Fire-out / low boiler temp alert")}
              suffix="°C"
              .min=${15}
              .max=${55}
              .step=${1}
              .value=${draft.min_boiler_temp_alert ?? 35}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ min_boiler_temp_alert: e.detail.value })}
            ></rs-number-field>
            <rs-number-field
              .label=${this._t("Ostrzeżenie wysokich strat przesyłu (%)", "High pipe heat loss warning (%)")}
              suffix="%"
              .min=${5}
              .max=${60}
              .step=${1}
              .value=${draft.distribution_loss_alert_pct ?? 20}
              @value-changed=${(e: CustomEvent<{ value: number }>) =>
                this._updateDraft({ distribution_loss_alert_pct: e.detail.value })}
            ></rs-number-field>
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
      boiler_mode: "auto",
      bag_weight_kg: 25,
      radiator_sensors: [],
      notify_warnings_enabled: true,
      feeder_max_temp: 60,
      flue_max_temp: 220,
      return_min_temp: 45,
      min_boiler_temp_alert: 35,
      distribution_loss_alert_pct: 20,
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
      radiator_sensors: (plant.radiator_sensors ?? []).map((rs) => ({ ...rs })),
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

  private _addRadiatorSensor() {
    if (!this._draft || !this._newRadSensor) return;
    const entry: RadiatorSensorConfig = {
      entity_id: this._newRadSensor,
      name: this._newRadName.trim() || this._entityFriendlyName(this._newRadSensor),
      return_entity_id: this._newRadReturnSensor || undefined,
      pipe_length_m: this._newRadPipeLen > 0 ? this._newRadPipeLen : undefined,
    };
    const nextList = [...(this._draft.radiator_sensors ?? []), entry];
    this._newRadSensor = "";
    this._newRadReturnSensor = "";
    this._newRadName = "";
    this._updateDraft({ radiator_sensors: nextList });
  }

  private _removeRadiatorSensor(index: number) {
    if (!this._draft) return;
    const nextList = (this._draft.radiator_sensors ?? []).filter((_, i) => i !== index);
    this._updateDraft({ radiator_sensors: nextList });
  }

  private async _onSetTemperatures(
    plantId: string,
    payload: {
      target_supply_temp?: number;
      idle_supply_temp?: number;
      dhw_target_temp?: number;
      boiler_mode?: BoilerMode;
    },
  ) {
    fireSaveStatus(this, "saving");
    // Optimistically update local plant list so steppers feel immediate
    this.heatPlants = this.heatPlants.map((p) =>
      p.id === plantId ? { ...p, ...payload } : p,
    );
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/set_temperatures",
        plant_id: plantId,
        ...payload,
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("heat-plants-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
  }

  private async _onLogRefill(
    plantId: string,
    kg: number,
    bags: number,
    filledToFull: boolean,
  ) {
    fireSaveStatus(this, "saving");
    try {
      await this.hass.callWS({
        type: "roommind/heat_plants/log_fuel",
        plant_id: plantId,
        kg,
        bags,
        filled_to_full: filledToFull,
        mode: "refill",
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
