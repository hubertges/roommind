/**
 * rs-settings-mold – Unified Humidification, Mold Protection & Evaporator Drying settings.
 *
 * Combines:
 * 1. Global humidification / dehumidification settings & MPC toggle + room overview
 * 2. Mold risk detection & prevention settings
 * 3. Evaporator drying (AC coil dry) settings
 */
import { html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { RsSettingsBase } from "./rs-settings-base";
import type { HomeAssistant, RoomConfig } from "../../types";
import { localize } from "../../utils/localize";
import { tempUnit, toDisplayDelta } from "../../utils/temperature";
import { formatNumber } from "../../utils/format";
import type { FanModeOption } from "../../utils/device-utils";
import "../shared/rs-segmented";
import "../shared/rs-info-icon";
import "../shared/rs-field";
import { numberRow } from "../shared/number-row";
import "./rs-settings-coil-dry";

// DIN 4108-2 temperature factor f_Rsi of the coldest spot (corner, window reveal) per insulation level.
const INSULATION_LEVELS = [
  { f_rsi: 0.65, key: "mold.insulation_poor" },
  { f_rsi: 0.8, key: "mold.insulation_standard" },
  { f_rsi: 0.9, key: "mold.insulation_good" },
] as const;

@customElement("rs-settings-mold")
export class RsSettingsMold extends RsSettingsBase {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};

  // Global humidification settings
  @property({ type: Boolean }) public humidityControlEnabled = true;
  @property({ type: Boolean }) public humidityMpcEnabled = true;
  @property({ type: Number }) public defaultHumidityMin = 40;
  @property({ type: Number }) public defaultHumidityMax = 60;
  @property({ type: Boolean }) public humidityAlertsEnabled = true;

  // Mold protection settings
  @property({ type: Boolean }) public moldDetectionEnabled = false;
  @property({ type: Number }) public moldHumidityThreshold = 70;
  @property({ type: Number }) public moldFRsi = 0.8;
  @property({ type: Number }) public moldSustainedMinutes = 30;
  @property({ type: Boolean }) public moldPreventionEnabled = false;
  @property({ type: String }) public moldPreventionIntensity: "light" | "medium" | "strong" =
    "medium";

  // Evaporator drying (coil dry) settings
  @property({ type: Boolean }) public coilDryEnabled = false;
  @property({ type: Number }) public coilDryMinutes = 20;
  @property({ type: String }) public coilDryMode: "fan_only" | "dry" = "fan_only";
  @property({ type: String }) public coilDryFanMode = "low";
  @property({ type: Number }) public coilDryMinCoolingMinutes = 10;
  @property({ type: Number }) public coilDryDrainMinutes = 0;
  @property({ attribute: false }) public availableFanModes: FanModeOption[] = [];

  private get _isPl(): boolean {
    return (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  render() {
    const l = this.hass.language;
    const humRooms = Object.entries(this.rooms).filter(
      ([, r]) =>
        !r.is_outdoor &&
        Boolean(
          r.humidifier_entity ||
            r.dehumidifier_entity ||
            r.humidity_min != null ||
            r.humidity_max != null ||
            (r.humidity_schedules?.length ?? 0) > 0,
        ),
    );

    return html`
      <!-- Section 1: Global Humidification & Dehumidification -->
      <div class="settings-section first">
        <h3 class="subsection-heading">
          <ha-icon icon="mdi:water-percent"></ha-icon>
          <span>${this._t("Nawilżanie i osuszanie (globalne)", "Humidification & Dehumidification")}</span>
        </h3>
        <rs-list-row
          switch
          wrap
          .heading=${this._t("Aktywna kontrola wilgotności w pokojach", "Enable room humidity control")}
          .secondary=${this._t(
            "Steruje nawilżaczami, osuszaczami i harmonogramami nawilżania we wszystkich pokojach.",
            "Controls humidifiers, dehumidifiers, and humidity schedules across all rooms.",
          )}
          .checked=${this.humidityControlEnabled}
          @toggle-changed=${(e: CustomEvent<boolean>) =>
            this._fire("humidityControlEnabled", e.detail)}
        ></rs-list-row>

        ${
          this.humidityControlEnabled
            ? html`
                <rs-list-row
                  switch
                  wrap
                  .heading=${this._t("Predykcyjne sterowanie nawilżaniem (MPC)", "Predictive humidity control (MPC)")}
                  .secondary=${this._t(
                    "Wyprzedza dryf wilgotności na podstawie wyuczonego modelu EKF pokoju.",
                    "Anticipates moisture drift using each room's learned humidity EKF model.",
                  )}
                  .checked=${this.humidityMpcEnabled}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._fire("humidityMpcEnabled", e.detail)}
                ></rs-list-row>
                ${numberRow({
                  hass: this.hass,
                  label: this._t("Domyślna min. wilgotność (nawilżaj poniżej)", "Default min humidity (humidify below)"),
                  unit: "%",
                  min: 20,
                  max: 70,
                  value: this.defaultHumidityMin,
                  onChange: (v) => this._fire("defaultHumidityMin", v),
                })}
                ${numberRow({
                  hass: this.hass,
                  label: this._t("Domyślna maks. wilgotność (osuszaj powyżej)", "Default max humidity (dehumidify above)"),
                  unit: "%",
                  min: 35,
                  max: 85,
                  value: this.defaultHumidityMax,
                  onChange: (v) => this._fire("defaultHumidityMax", v),
                })}
                <rs-list-row
                  switch
                  wrap
                  .heading=${this._t("Ostrzeżenia wilgotności w pokojach", "Room humidity warnings")}
                  .checked=${this.humidityAlertsEnabled}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._fire("humidityAlertsEnabled", e.detail)}
                ></rs-list-row>
              `
            : nothing
        }

        ${
          humRooms.length > 0
            ? html`<div class="hum-rooms-strip">
                <span class="hum-rooms-label">
                  ${this._t("Pokoje z regulacją wilgotności:", "Humidity-regulated rooms:")}
                </span>
                ${humRooms.map(([areaId, r]) => {
                  const name = r.display_name || this.hass.areas?.[areaId]?.name || areaId;
                  const rh = r.live?.current_humidity;
                  return html`<span class="hum-room-chip">
                    ${name}${rh != null ? ` · ${Math.round(rh)}%` : ""}
                  </span>`;
                })}
              </div>`
            : nothing
        }
      </div>

      <!-- Section 2: Mold Protection -->
      <div class="settings-section">
        <h3 class="subsection-heading">
          <ha-icon icon="mdi:water-alert"></ha-icon>
          <span>${localize("mold.title", l)}</span>
        </h3>
        <rs-list-row
          switch
          wrap
          .heading=${localize("mold.detection", l)}
          .checked=${this.moldDetectionEnabled}
          @toggle-changed=${(e: CustomEvent<boolean>) => this._fire("moldDetectionEnabled", e.detail)}
        >
          <rs-info-icon slot="end" .text=${localize("mold.detection_desc", l)}></rs-info-icon>
        </rs-list-row>
        ${
          this.moldDetectionEnabled
            ? html`
                ${numberRow({
                  hass: this.hass,
                  label: localize("mold.threshold", l),
                  info: localize("mold.threshold_hint", l),
                  unit: "%",
                  min: 50,
                  max: 90,
                  value: this.moldHumidityThreshold,
                  onChange: (v) => this._fire("moldHumidityThreshold", v),
                })}
                ${numberRow({
                  hass: this.hass,
                  label: localize("mold.sustained", l),
                  info: localize("mold.sustained_hint", l),
                  unit: "min",
                  min: 5,
                  max: 120,
                  value: this.moldSustainedMinutes,
                  onChange: (v) => this._fire("moldSustainedMinutes", v),
                })}
              `
            : nothing
        }

        <rs-list-row
          switch
          wrap
          .heading=${localize("mold.prevention", l)}
          .checked=${this.moldPreventionEnabled}
          @toggle-changed=${(e: CustomEvent<boolean>) =>
            this._fire("moldPreventionEnabled", e.detail)}
        >
          <rs-info-icon slot="end" .text=${localize("mold.prevention_desc", l)}></rs-info-icon>
        </rs-list-row>
        ${
          this.moldPreventionEnabled
            ? html`
                <div class="sub">
                  <rs-field
                    .label=${localize("mold.intensity", l)}
                    .info=${localize("mold.intensity_hint", l)}
                  >
                    <rs-segmented
                      wrap
                      .label=${localize("mold.intensity", l)}
                      .options=${(["light", "medium", "strong"] as const).map((v, i) => ({
                        value: v,
                        label: localize(`mold.intensity_${v}`, l, {
                          delta: formatNumber(toDisplayDelta(i + 1, this.hass), this.hass, 0, 1),
                          unit: tempUnit(this.hass),
                        }),
                      }))}
                      .value=${this.moldPreventionIntensity}
                      @value-changed=${(e: CustomEvent<{ value: string }>) => {
                        const v = e.detail.value as "light" | "medium" | "strong";
                        if (v && v !== this.moldPreventionIntensity)
                          this._fire("moldPreventionIntensity", v);
                      }}
                    ></rs-segmented>
                  </rs-field>
                </div>
              `
            : nothing
        }

        ${
          this.moldDetectionEnabled || this.moldPreventionEnabled
            ? html`
                <div class="sub">
                  <rs-field
                    .label=${localize("mold.insulation", l)}
                    .info=${localize("mold.insulation_hint", l)}
                  >
                    <rs-segmented
                      wrap
                      .label=${localize("mold.insulation", l)}
                      .options=${INSULATION_LEVELS.map((lvl) => ({
                        value: String(lvl.f_rsi),
                        label: localize(lvl.key, l),
                      }))}
                      .value=${this._insulationValue()}
                      @value-changed=${(e: CustomEvent<{ value: string }>) => {
                        const v = parseFloat(e.detail.value);
                        if (!isNaN(v) && v !== this.moldFRsi) this._fire("moldFRsi", v);
                      }}
                    ></rs-segmented>
                  </rs-field>
                </div>
              `
            : nothing
        }
      </div>

      <!-- Section 3: Evaporator Drying (Coil Dry) -->
      <div class="settings-section">
        <h3 class="subsection-heading">
          <ha-icon icon="mdi:air-filter"></ha-icon>
          <span>${localize("coil_dry.title", l)}</span>
        </h3>
        <rs-settings-coil-dry
          .hass=${this.hass}
          .coilDryEnabled=${this.coilDryEnabled}
          .coilDryMinutes=${this.coilDryMinutes}
          .coilDryMode=${this.coilDryMode}
          .coilDryFanMode=${this.coilDryFanMode}
          .coilDryMinCoolingMinutes=${this.coilDryMinCoolingMinutes}
          .coilDryDrainMinutes=${this.coilDryDrainMinutes}
          .availableFanModes=${this.availableFanModes}
          @setting-changed=${(e: CustomEvent) => {
            e.stopPropagation();
            this._fire(e.detail.key, e.detail.value);
          }}
        ></rs-settings-coil-dry>
      </div>
    `;
  }

  private _insulationValue(): string {
    const nearest = INSULATION_LEVELS.reduce((best, lvl) =>
      Math.abs(lvl.f_rsi - this.moldFRsi) < Math.abs(best.f_rsi - this.moldFRsi) ? lvl : best,
    );
    return String(nearest.f_rsi);
  }

  static styles = [
    RsSettingsBase.settingsBaseStyles,
    css`
      .subsection-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 var(--rs-space-2);
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--secondary-text-color);
        --mdc-icon-size: 17px;
      }

      .sub {
        margin-top: var(--rs-space-3);
      }

      .hum-rooms-strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: var(--rs-space-3);
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--rs-fill);
        font-size: 12px;
      }

      .hum-rooms-label {
        color: var(--secondary-text-color);
      }

      .hum-room-chip {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--card-background-color, var(--primary-background-color));
        border: 1px solid var(--divider-color);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings-mold": RsSettingsMold;
  }
}
