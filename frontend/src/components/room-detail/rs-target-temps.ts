import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, ClimateMode } from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import { tokens } from "../../styles/tokens";
import { tempRowStyles } from "../../styles/temp-row-styles";
import { tempRow } from "../shared/temp-row";
import {
  DEFAULT_HUMIDITY_MAX,
  DEFAULT_HUMIDITY_MIN,
  HUMIDITY_LIMIT_GAP,
  MAX_HUMIDITY_MAX,
  MAX_HUMIDITY_MIN,
  MIN_HUMIDITY_MAX,
  MIN_HUMIDITY_MIN,
} from "../../utils/constants";
import "../shared/rs-info-icon";
import "../shared/rs-stepper";
import "../shared/rs-list-row";

/**
 * Comfort and eco targets of a room (content of the temperatures & humidifier dialog): a level each,
 * with the heat and/or cool side the climate mode uses, plus the away level when presence uses one,
 * and optional humidifier/dehumidifier targets alongside temperature (including turning off the
 * humidifier in Eco / at night).
 */
@customElement("rs-target-temps")
export class RsTargetTemps extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Number }) public comfortHeat = 21.0;
  @property({ type: Number }) public comfortCool = 24.0;
  @property({ type: Number }) public ecoHeat = 17.0;
  @property({ type: Number }) public ecoCool = 27.0;
  /** Show the away level (presence_away_action "away"); unset sides show eco. */
  @property({ type: Boolean }) public showAway = false;
  @property({ attribute: false }) public awayHeat: number | null = null;
  @property({ attribute: false }) public awayCool: number | null = null;
  @property({ type: String }) public climateMode: ClimateMode = "auto";
  /** Humidifier & dehumidifier targets alongside temperature in Schedule & temperatures. */
  @property({ type: Boolean }) public hasHumidifier = false;
  @property({ type: Boolean }) public hasDehumidifier = false;
  @property({ attribute: false }) public comfortHumidify: number | null = null;
  @property({ attribute: false }) public comfortDehumidify: number | null = null;
  @property({ attribute: false }) public ecoHumidify: number | null = null;
  @property({ attribute: false }) public ecoDehumidify: number | null = null;
  @property({ attribute: false }) public awayHumidify: number | null = null;
  @property({ attribute: false }) public awayDehumidify: number | null = null;

  static styles = [
    tokens,
    tempRowStyles,
    css`
      :host {
        display: block;
      }

      .level + .level {
        margin-top: var(--rs-space-5);
      }

      .level-title {
        display: flex;
        align-items: center;
        gap: var(--rs-space-1);
        margin: 0;
        font-size: var(--rs-font-md);
        font-weight: 500;
      }
    `,
  ];

  private get _isPl(): boolean {
    return (this.hass?.language ?? "pl").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  render() {
    const l = this.hass.language;
    const heat = this.climateMode !== "cool_only";
    const cool = this.climateMode !== "heat_only";
    const showHum = this.hasHumidifier || this.comfortHumidify != null || this.ecoHumidify != null;
    const showDehum =
      this.hasDehumidifier || this.comfortDehumidify != null || this.ecoDehumidify != null;

    const humRow = (
      kind: "humidify" | "dehumidify",
      title: string,
      label: string,
      value: number,
      min: number,
      max: number,
      cb: (v: number) => void,
    ) => html`<div class="temp-row ${kind === "humidify" ? "cool" : "heat"}">
      <span>
        <ha-icon
          icon=${kind === "humidify" ? "mdi:air-humidifier" : "mdi:water-minus"}
          aria-hidden="true"
        ></ha-icon>
        ${label}
      </span>
      <rs-stepper
        .editable=${true}
        unit="%"
        .language=${l}
        .label=${`${title}, ${label}`}
        .value=${value}
        .min=${min}
        .max=${max}
        .step=${1}
        @value-changed=${(e: CustomEvent<{ value: number }>) => cb(e.detail.value)}
      ></rs-stepper>
    </div>`;

    const cHumVal = this.comfortHumidify ?? DEFAULT_HUMIDITY_MIN;
    const cDehumVal = this.comfortDehumidify ?? DEFAULT_HUMIDITY_MAX;
    const eHumEnabled = this.ecoHumidify != null && this.ecoHumidify > 0;
    const eHumVal = eHumEnabled ? this.ecoHumidify! : cHumVal;
    const eDehumVal = this.ecoDehumidify ?? cDehumVal;

    const level = (
      mode: "comfort" | "eco" | "away",
      title: string,
      info: string,
      heatC: number,
      coolC: number,
      onHeat: (v: number) => void,
      onCool: (v: number) => void,
    ) => {
      const row = (
        side: "heat" | "cool",
        key: TranslationKey,
        celsius: number,
        cb: (v: number) => void,
      ) => {
        const label = localize(key, l);
        return tempRow({
          hass: this.hass,
          side,
          label,
          ariaLabel: `${title}, ${label}`,
          celsius,
          onChange: cb,
        });
      };
      return html`<section class="level">
        <h4 class="level-title">${title}<rs-info-icon .text=${info}></rs-info-icon></h4>
        ${heat ? row("heat", "schedule_editor.heat_below", heatC, onHeat) : nothing}
        ${cool ? row("cool", "schedule_editor.cool_above", coolC, onCool) : nothing}
        ${
          mode === "comfort" && showHum
            ? humRow(
                "humidify",
                title,
                this._t("Nawilżaj poniżej", "Humidify below"),
                cHumVal,
                MIN_HUMIDITY_MIN,
                Math.min(MAX_HUMIDITY_MIN, (showDehum ? cDehumVal : 100) - HUMIDITY_LIMIT_GAP),
                this._onComfortHumidify,
              )
            : nothing
        }
        ${
          mode === "comfort" && showDehum
            ? humRow(
                "dehumidify",
                title,
                this._t("Osuszaj powyżej", "Dehumidify above"),
                cDehumVal,
                Math.max(MIN_HUMIDITY_MAX, (showHum ? cHumVal : 0) + HUMIDITY_LIMIT_GAP),
                MAX_HUMIDITY_MAX,
                this._onComfortDehumidify,
              )
            : nothing
        }
        ${
          mode === "eco" && showHum
            ? html`
                <rs-list-row
                  switch
                  wrap
                  icon=${eHumEnabled ? "mdi:air-humidifier" : "mdi:air-humidifier-off"}
                  .heading=${this._t(
                    "Nawilżanie w trybie Eco / w nocy (poza harmonogramem)",
                    "Humidify during Eco / at night (when schedule is off)",
                  )}
                  .secondary=${
                    eHumEnabled
                      ? this._t(
                          `Włączone — utrzymuje min. ${eHumVal}% w nocy / Eco`,
                          `Enabled — keeps at least ${eHumVal}% during Eco / night`,
                        )
                      : this._t(
                          "Wyłączone — nawilżacz nie włącza się w nocy ani poza harmonogramem",
                          "Disabled — humidifier stays off at night / outside schedule blocks",
                        )
                  }
                  .checked=${eHumEnabled}
                  @toggle-changed=${(e: CustomEvent<boolean>) =>
                    this._onEcoHumidifyToggle(e.detail, cHumVal)}
                ></rs-list-row>
                ${
                  eHumEnabled
                    ? humRow(
                        "humidify",
                        title,
                        this._t("Nawilżaj poniżej (Eco / noc)", "Humidify below (Eco / night)"),
                        eHumVal,
                        MIN_HUMIDITY_MIN,
                        Math.min(
                          MAX_HUMIDITY_MIN,
                          (showDehum ? eDehumVal : 100) - HUMIDITY_LIMIT_GAP,
                        ),
                        this._onEcoHumidify,
                      )
                    : nothing
                }
              `
            : nothing
        }
        ${
          mode === "eco" && showDehum
            ? humRow(
                "dehumidify",
                title,
                this._t("Osuszaj powyżej (Eco / noc)", "Dehumidify above (Eco / night)"),
                eDehumVal,
                Math.max(
                  MIN_HUMIDITY_MAX,
                  (showHum && eHumEnabled ? eHumVal : 0) + HUMIDITY_LIMIT_GAP,
                ),
                MAX_HUMIDITY_MAX,
                this._onEcoDehumidify,
              )
            : nothing
        }
      </section>`;
    };
    return html`
      ${level(
        "comfort",
        localize("schedule.column_comfort", l),
        localize("schedule.comfort_hint", l),
        this.comfortHeat,
        this.comfortCool,
        this._onComfortHeat,
        this._onComfortCool,
      )}
      ${level(
        "eco",
        localize("schedule.column_eco", l),
        localize("schedule.eco_hint", l),
        this.ecoHeat,
        this.ecoCool,
        this._onEcoHeat,
        this._onEcoCool,
      )}
      ${
        this.showAway
          ? level(
              "away",
              localize("override.away", l),
              localize("schedule.away_hint", l),
              this.awayHeat ?? this.ecoHeat,
              this.awayCool ?? this.ecoCool,
              this._onAwayHeat,
              this._onAwayCool,
            )
          : nothing
      }
    `;
  }

  private _fire(name: string, value: number | null) {
    this.dispatchEvent(new CustomEvent(name, { detail: { value }, bubbles: true, composed: true }));
  }

  private _onComfortHumidify = (val: number) => {
    this._fire("comfort-humidify-changed", val);
  };

  private _onComfortDehumidify = (val: number) => {
    this._fire("comfort-dehumidify-changed", val);
  };

  private _onEcoHumidifyToggle = (enabled: boolean, fallbackComfort: number) => {
    this._fire("eco-humidify-changed", enabled ? fallbackComfort : null);
  };

  private _onEcoHumidify = (val: number) => {
    this._fire("eco-humidify-changed", val);
  };

  private _onEcoDehumidify = (val: number) => {
    this._fire("eco-dehumidify-changed", val);
  };

  private _onComfortHeat = (val: number) => {
    this._fire("comfort-heat-changed", val);
    if (this.comfortCool < val) this._fire("comfort-cool-changed", val);
  };

  private _onComfortCool = (val: number) => {
    this._fire("comfort-cool-changed", val);
    if (this.comfortHeat > val) this._fire("comfort-heat-changed", val);
  };

  private _onEcoHeat = (val: number) => {
    this._fire("eco-heat-changed", val);
    if (this.ecoCool < val) this._fire("eco-cool-changed", val);
  };

  private _onEcoCool = (val: number) => {
    this._fire("eco-cool-changed", val);
    if (this.ecoHeat > val) this._fire("eco-heat-changed", val);
  };

  private _onAwayHeat = (val: number) => {
    this._fire("away-heat-changed", val);
    if ((this.awayCool ?? this.ecoCool) < val) this._fire("away-cool-changed", val);
  };

  private _onAwayCool = (val: number) => {
    this._fire("away-cool-changed", val);
    if ((this.awayHeat ?? this.ecoHeat) > val) this._fire("away-heat-changed", val);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-target-temps": RsTargetTemps;
  }
}
