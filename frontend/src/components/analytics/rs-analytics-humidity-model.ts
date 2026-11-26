/**
 * rs-analytics-humidity-model – Humidity MPC model status card.
 *
 * Matches the exact layout, typography, confidence indicator, learning stepper / "what the model
 * sees now" panel, and stat-tile grid of `rs-analytics-model`, containing only humidity-relevant
 * figures (moisture time constant, exchange rate, humidifying/dehumidifying rates, occupancy
 * moisture gain when sensors exist, and prediction deviation).
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, AnalyticsData, HumidityModelInfo } from "../../types";
import { localize } from "../../utils/localize";
import {
  formatAgo,
  formatHours,
  formatMinutes,
  formatNumber,
  formatPercent,
} from "../../utils/format";
import { tokens, srOnly } from "../../styles/tokens";
import "../shared/rs-list-card";
import "../shared/rs-stat-tile";
import "../shared/rs-hint-chip";
import "../shared/rs-info-icon";

const HUMIDITY_REF_DELTA_RH = 10;
const MIN_HUM_IDLE_SAMPLES = 20;
const MIN_HUM_ACTIVE_SAMPLES = 10;
const MAX_HUM_PRED_STD = 2.0; // % RH
const PENDING = "—";

type StageState = "done" | "current" | "todo" | "off";

interface Stage {
  title: string;
  sub: string;
  icon: string;
  state: StageState;
  reached?: boolean;
}

interface HumTile {
  icon: string;
  tone?: "default" | "humidify" | "dehumidify" | "ok";
  label: string;
  value: string | null;
  sub?: string;
  info: string;
}

@customElement("rs-analytics-humidity-model")
export class RsAnalyticsHumidityModel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: String }) public language = "en";
  @property({ type: String }) public controlMode: "mpc" | "bangbang" = "mpc";
  @property({ type: Boolean }) public canHumidify = false;
  @property({ type: Boolean }) public canDehumidify = false;

  private get _isPl(): boolean {
    return (this.language || this.hass?.language || "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  private get _hm(): HumidityModelInfo | undefined {
    return this.data?.humidity_model;
  }

  render() {
    const hm = this._hm;
    if (!hm) return nothing;

    const l = this.language;
    const confidence = hm.confidence ?? 0;
    const observations = hm.n_observations ?? hm.n_samples ?? 0;

    return html`
      <rs-list-card .heading=${this._t("Status modelu nawilżania (MPC)", "Humidity Model Status (MPC)")}>
        ${this._controlChip(hm)}
        <div class="wrap">
          <div class="top">
            <div class="status">
              <div class="confidence">
                <span class="confidence-value"
                  >${formatPercent(Math.round(confidence * 100), this.hass)}</span
                >
                <span class="confidence-label"
                  >${localize("analytics.confidence", l)}
                  <rs-info-icon
                    .text=${this._t(
                      `Pewność rośnie wraz ze spadkiem niepewności prognozy wilgotności poniżej ±${MAX_HUM_PRED_STD} % RH.`,
                      `Confidence grows as humidity forecast uncertainty drops below ±${MAX_HUM_PRED_STD} % RH.`,
                    )}
                  ></rs-info-icon
                ></span>
              </div>
              <div class="points">
                ${formatNumber(observations, this.hass)} ${localize("analytics.data_points", l)}
                <rs-info-icon
                  .text=${this._t(
                    "Liczba kroków uczenia filtra EKF wilgotności (~co 3 min).",
                    "Number of humidity EKF learning updates (~every 3 min).",
                  )}
                ></rs-info-icon>
              </div>
              ${
                hm.last_update_at
                  ? html`<div class="updated">
                      ${localize("analytics.last_learned", l, {
                        time: formatAgo(hm.last_update_at, l),
                      })}
                    </div>`
                  : nothing
              }
            </div>
            ${this._mpcRunning(hm) ? this._renderNow(hm) : this._renderStages(hm)}
          </div>
          <div class="tiles">${this._tiles(hm).map((t) => this._renderTile(t))}</div>
        </div>
      </rs-list-card>
    `;
  }

  private _controlChip(hm: HumidityModelInfo) {
    if (this.controlMode === "bangbang") {
      return html`<rs-hint-chip
        slot="header-extras"
        icon="mdi:power"
        .text=${this._t("Tryb prosty", "Simple mode")}
      ></rs-hint-chip>`;
    }
    const active = !!hm.mpc_active;
    return html`<rs-hint-chip
      slot="header-extras"
      .variant=${active ? "ok" : "default"}
      .icon=${active ? "mdi:water-percent" : "mdi:school-outline"}
      .text=${
        active
          ? this._t("Sterowanie predykcyjne (MPC)", "Predictive control (MPC)")
          : this._t("Uczenie modelu", "Learning model")
      }
    ></rs-hint-chip>`;
  }

  private _mpcRunning(hm: HumidityModelInfo): boolean {
    return this.controlMode !== "bangbang" && !!hm.mpc_active;
  }

  private _stages(hm: HumidityModelInfo): Stage[] {
    const mpcActive = !!hm.mpc_active;
    const nHum = hm.n_humidifying ?? 0;
    const nDehum = hm.n_dehumidifying ?? 0;
    const nIdle = hm.n_idle ?? Math.max(0, (hm.n_samples ?? 0) - nHum - nDehum);
    const modes = new Set(hm.applicable_modes ?? []);
    const canH = this.canHumidify || modes.has("humidifying");
    const canD = this.canDehumidify || modes.has("dehumidifying");
    const activeRuns = canH && canD ? Math.max(nHum, nDehum) : canD && !canH ? nDehum : nHum;

    const idleDone = nIdle >= MIN_HUM_IDLE_SAMPLES;
    const dataDone = mpcActive || (idleDone && (activeRuns >= MIN_HUM_ACTIVE_SAMPLES || (!canH && !canD)));
    const accurate =
      hm.prediction_std_idle != null &&
      hm.prediction_std_idle < MAX_HUM_PRED_STD &&
      (nHum < MIN_HUM_ACTIVE_SAMPLES ||
        hm.prediction_std_humidify == null ||
        hm.prediction_std_humidify < MAX_HUM_PRED_STD) &&
      (nDehum < MIN_HUM_ACTIVE_SAMPLES ||
        hm.prediction_std_dehumidify == null ||
        hm.prediction_std_dehumidify < MAX_HUM_PRED_STD);
    const learnDone = mpcActive || (dataDone && accurate);

    const dataSub =
      !dataDone && idleDone
        ? this._t(
            "Zebrano spoczynek — oczekiwanie na cykle nawilżania / osuszania.",
            "Idle baseline collected — waiting for humidify / dehumidify runs.",
          )
        : this._t(
            "Zbieranie pomiarów wilgotności w spoczynku i podczas pracy urządzeń.",
            "Collecting room humidity readings while idle and during active runs.",
          );

    const control: Stage =
      this.controlMode === "bangbang"
        ? {
            title: this._t("Sterowanie predykcyjne", "Predictive control"),
            sub: this._t("Wyłączone — aktywne proste sterowanie progowe.", "Disabled — simple threshold control active."),
            icon: "mdi:power",
            state: "off",
          }
        : {
            title: this._t("Sterowanie predykcyjne (MPC)", "Predictive control (MPC)"),
            sub: this._t(
              "Model wyprzedza zmiany wilgotności i optymalizuje czas pracy.",
              "Model anticipates humidity drift and optimizes runtime.",
            ),
            icon: "mdi:water-percent",
            state: learnDone ? "current" : "todo",
            reached: mpcActive,
          };

    return [
      {
        title: this._t("Zbieranie danych", "Collect data"),
        sub: dataSub,
        icon: "mdi:database-outline",
        state: dataDone ? "done" : "current",
      },
      {
        title: this._t("Uczenie dynamiki wilgotności", "Learn moisture dynamics"),
        sub: this._t(
          "Kalibracja szybkości wymiany wilgoci i mocy nawilżacza / osuszacza.",
          "Calibrating moisture exchange rate and humidifier / dehumidifier power.",
        ),
        icon: "mdi:school-outline",
        state: learnDone ? "done" : dataDone ? "current" : "todo",
      },
      control,
    ];
  }

  private _latestHumidity(): { room: number; outdoorEq: number | null } | null {
    const hm = this._hm;
    if (hm?.current_humidity != null) {
      return {
        room: hm.current_humidity,
        outdoorEq: hm.outdoor_humidity_eq ?? hm.outdoor_humidity ?? null,
      };
    }
    const points = this.data?.detail ?? [];
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].humidity != null) {
        return { room: points[i].humidity!, outdoorEq: hm?.outdoor_humidity_eq ?? null };
      }
    }
    return null;
  }

  private _nowFacts(hm: HumidityModelInfo): Array<{ icon: string; label: string; value: string }> {
    const model = hm.model;
    const now = this._latestHumidity();
    if (!model || !now) return [];
    const kVent = model.k_vent ?? 0;
    const qHum = model.Q_humidify ?? 0;
    const qDehum = model.Q_dehumidify ?? 0;
    const outEq = now.outdoorEq ?? 45;
    const drift = kVent * (outEq - now.room); // % RH / h when idle
    const modes = new Set(hm.applicable_modes ?? []);
    const canH = this.canHumidify || modes.has("humidifying");
    const canD = this.canDehumidify || modes.has("dehumidifying");
    const facts: Array<{ icon: string; label: string; value: string }> = [];

    const step5Minutes = (netRate: number) =>
      netRate > 0.2
        ? this._t(`ok. ${formatMinutes((60 * 5) / netRate, this.language)}`, `~${formatMinutes((60 * 5) / netRate, this.language)}`)
        : this._t("zbyt mała rezerwa mocy", "insufficient capacity");

    if (canH && (hm.n_humidifying ?? 0) >= MIN_HUM_ACTIVE_SAMPLES && qHum > 0) {
      facts.push({
        icon: "mdi:water-plus",
        label: this._t("Podniesienie o +5% RH", "Raise by +5% RH"),
        value: step5Minutes(qHum + drift),
      });
    }
    if (canD && (hm.n_dehumidifying ?? 0) >= MIN_HUM_ACTIVE_SAMPLES && qDehum > 0) {
      facts.push({
        icon: "mdi:water-minus",
        label: this._t("Obniżenie o −5% RH", "Lower by −5% RH"),
        value: step5Minutes(qDehum - drift),
      });
    }
    if (kVent > 0) {
      const sign = drift >= 0.05 ? "+" : drift <= -0.05 ? "\u2212" : "";
      facts.push({
        icon: "mdi:weather-windy",
        label: this._t("Dryf wilgotności bez urządzeń", "Natural moisture drift"),
        value: `${sign}${formatNumber(Math.abs(drift), this.hass, 1)} % RH/h`,
      });
    }
    return facts;
  }

  private _renderNow(hm: HumidityModelInfo) {
    const now = this._latestHumidity();
    const facts = this._nowFacts(hm);
    return html`<div class="now">
      <div class="step current reached">
        <span class="dot" aria-hidden="true"><ha-icon icon="mdi:water-percent"></ha-icon></span>
        <div class="step-text">
          <span class="step-title"
            >${this._t("Co model widzi teraz", "What the model sees now")}
            ${
              facts.length
                ? html`<rs-info-icon
                    .text=${this._t(
                      "Aktualne tempo zmian wilgotności na podstawie wyuczonych parametrów i powietrza zewnętrznego.",
                      "Current humidity change rates based on learned parameters and outdoor air.",
                    )}
                  ></rs-info-icon>`
                : nothing
            }</span
          >
          <small
            >${
              now
                ? this._t(
                    `Pokój ${formatNumber(now.room, this.hass, 1)}% RH${now.outdoorEq != null ? ` · równoważnik zewn. ${formatNumber(now.outdoorEq, this.hass, 0)}% RH` : ""}`,
                    `Room ${formatNumber(now.room, this.hass, 1)}% RH${now.outdoorEq != null ? ` · outdoor eq. ${formatNumber(now.outdoorEq, this.hass, 0)}% RH` : ""}`,
                  )
                : this._t("MPC aktywnie planuje nawilżanie i osuszanie.", "MPC actively schedules humidification.")
            }</small
          >
        </div>
      </div>
      ${
        facts.length
          ? html`<dl class="facts">
              ${facts.map(
                (f) =>
                  html`<div class="fact">
                    <dt><ha-icon .icon=${f.icon} aria-hidden="true"></ha-icon>${f.label}</dt>
                    <dd>${f.value}</dd>
                  </div>`,
              )}
            </dl>`
          : nothing
      }
    </div>`;
  }

  private _renderStages(hm: HumidityModelInfo) {
    const stages = this._stages(hm);
    return html`<ol class="steps">
      ${stages.map(
        (s, i) =>
          html`<li
            class="step ${s.state} ${s.reached ? "reached" : ""}"
            aria-current=${s.state === "current" ? "step" : "false"}
          >
            <span class="dot" aria-hidden="true">
              ${
                s.state === "done"
                  ? html`<ha-icon icon="mdi:check"></ha-icon>`
                  : s.state === "current"
                    ? html`<ha-icon .icon=${s.icon}></ha-icon>`
                    : s.state === "off"
                      ? html`<ha-icon icon="mdi:minus"></ha-icon>`
                      : formatNumber(i + 1, this.hass)
              }
            </span>
            <div class="step-text">
              <span class="step-title">${s.title}</span>
              <small>${s.sub}</small>
            </div>
          </li>`,
      )}
    </ol>`;
  }

  private _tiles(hm: HumidityModelInfo): HumTile[] {
    const model = hm.model ?? {};
    const kVent = model.k_vent ?? 0;
    const qHum = model.Q_humidify ?? 0;
    const qDehum = model.Q_dehumidify ?? 0;
    const qOcc = model.Q_occupancy ?? 0;

    const nHum = hm.n_humidifying ?? 0;
    const nDehum = hm.n_dehumidifying ?? 0;
    const nIdle = hm.n_idle ?? Math.max(0, (hm.n_samples ?? 0) - nHum - nDehum);
    const hasIdle = nIdle >= MIN_HUM_ACTIVE_SAMPLES;
    const modes = new Set(hm.applicable_modes ?? []);
    const canH = this.canHumidify || modes.has("humidifying");
    const canD = this.canDehumidify || modes.has("dehumidifying");

    const tiles: HumTile[] = [
      {
        icon: "mdi:timer-sand",
        label: this._t("Stała czasowa wilgotności", "Moisture time constant"),
        value: hasIdle && kVent > 0 ? formatHours(1 / kVent, this.language) : null,
        info: this._t(
          "Czas potrzebny na wyrównanie 63% różnicy wilgotności między pokojem a powietrzem zewnętrznym.",
          "Time required for 63% of the humidity difference to equalize with outdoor air.",
        ),
      },
      {
        icon: "mdi:weather-windy",
        label: this._t("Wymiana wilgoci (wentylacja)", "Moisture exchange rate"),
        value:
          hasIdle && kVent > 0
            ? `${formatNumber(kVent * HUMIDITY_REF_DELTA_RH, this.hass, 2)} % RH/h`
            : null,
        sub: this._t(`przy różnicy ${HUMIDITY_REF_DELTA_RH}% RH`, `at ${HUMIDITY_REF_DELTA_RH}% RH difference`),
        info: this._t(
          "Tempo samoistnego wysychania lub zawilgacania pokoju przez wentylację i ściany.",
          "Natural rate of drying or moistening through ventilation and building envelope.",
        ),
      },
    ];

    if (canH) {
      tiles.push({
        icon: "mdi:water-plus",
        tone: "humidify",
        label: this._t("Tempo nawilżania", "Humidifying rate"),
        value:
          nHum >= MIN_HUM_ACTIVE_SAMPLES && qHum > 0
            ? `+${formatNumber(qHum, this.hass, 1)} % RH/h`
            : null,
        sub: this._t(`${nHum} próbek pracy`, `${nHum} active samples`),
        info: this._t(
          "Wyuczona wydajność nawilżacza w tym pomieszczeniu przy pełnej mocy.",
          "Learned humidifier output in this room at full capacity.",
        ),
      });
    }

    if (canD) {
      tiles.push({
        icon: "mdi:water-minus",
        tone: "dehumidify",
        label: this._t("Tempo osuszania", "Dehumidifying rate"),
        value:
          nDehum >= MIN_HUM_ACTIVE_SAMPLES && qDehum > 0
            ? `−${formatNumber(qDehum, this.hass, 1)} % RH/h`
            : null,
        sub: this._t(`${nDehum} próbek pracy`, `${nDehum} active samples`),
        info: this._t(
          "Wyuczona wydajność osuszacza lub trybu Dry klimatyzacji w tym pomieszczeniu.",
          "Learned dehumidifier or AC Dry removal rate in this room.",
        ),
      });
    }

    if (hm.has_occupancy_sensors) {
      tiles.push({
        icon: "mdi:account-group-outline",
        label: this._t("Zysk wilgoci od osób", "Occupancy moisture gain"),
        value: hm.occupancy_learned ? `+${formatNumber(qOcc, this.hass, 2)} % RH/h` : null,
        info: this._t(
          "Wzrost wilgotności względnej powodowany przez obecność domowników.",
          "Relative humidity rise contributed by occupants in the room.",
        ),
      });
    }

    tiles.push({
      icon: "mdi:bullseye-arrow",
      label: this._t("Odchylenie prognozy (spoczynek)", "Prediction error (idle)"),
      value:
        hm.prediction_std_idle != null && nIdle >= MIN_HUM_ACTIVE_SAMPLES
          ? `±${formatNumber(hm.prediction_std_idle, this.hass, 2)} % RH`
          : null,
      sub:
        hm.day_error_mae != null
          ? this._t(
              `dziś MAE ±${formatNumber(hm.day_error_mae, this.hass, 2)} % RH`,
              `today MAE ±${formatNumber(hm.day_error_mae, this.hass, 2)} % RH`,
            )
          : undefined,
      info: this._t(
        `Niepewność 1-godzinnej prognozy wilgotności w spoczynku (próg MPC: < ±${MAX_HUM_PRED_STD} % RH).`,
        `1-hour idle humidity forecast uncertainty (MPC threshold: < ±${MAX_HUM_PRED_STD} % RH).`,
      ),
    });

    if (canH || canD) {
      const activeStd =
        canH && canD
          ? Math.min(hm.prediction_std_humidify ?? 99, hm.prediction_std_dehumidify ?? 99)
          : canH
            ? hm.prediction_std_humidify
            : hm.prediction_std_dehumidify;
      const hasActive = (canH && nHum >= MIN_HUM_ACTIVE_SAMPLES) || (canD && nDehum >= MIN_HUM_ACTIVE_SAMPLES);
      tiles.push({
        icon: "mdi:bullseye",
        label: this._t("Odchylenie prognozy (praca)", "Prediction error (active)"),
        value:
          hasActive && activeStd != null && activeStd < 90
            ? `±${formatNumber(activeStd, this.hass, 2)} % RH`
            : null,
        info: this._t(
          "Niepewność prognozy wilgotności podczas pracy nawilżacza / osuszacza.",
          "Humidity forecast uncertainty while humidifying or dehumidifying.",
        ),
      });
    }

    return tiles;
  }

  private _renderTile(t: HumTile) {
    return html`<rs-stat-tile
      .icon=${t.icon}
      .tone=${t.tone ?? "default"}
      .label=${t.label}
      .value=${t.value ?? PENDING}
      .sub=${t.sub ?? ""}
      ?pending=${t.value == null}
      .info=${t.info}
    ></rs-stat-tile>`;
  }

  static styles = [
    tokens,
    srOnly,
    css`
      :host {
        display: block;
        margin-bottom: var(--rs-space-4);
      }

      .wrap {
        container-type: inline-size;
        padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-2);
      }

      .top {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--rs-space-5);
        margin-bottom: var(--rs-space-4);
      }

      @container (min-width: 760px) {
        .top {
          grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
          gap: var(--rs-space-6);
          align-items: start;
        }
      }

      .confidence {
        display: flex;
        align-items: baseline;
        gap: var(--rs-space-2);
        flex-wrap: wrap;
      }

      .confidence-value {
        font-size: 44px;
        font-weight: 300;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }

      .confidence-label,
      .points {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: var(--rs-font-md);
        color: var(--secondary-text-color);
      }

      .points {
        margin-top: 6px;
        font-size: var(--rs-font-sm);
        font-variant-numeric: tabular-nums;
      }

      .updated {
        margin-top: 2px;
        font-size: var(--rs-font-sm);
        color: var(--secondary-text-color);
      }

      .steps {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .step {
        position: relative;
        display: flex;
        gap: var(--rs-space-3);
        align-items: flex-start;
        padding-bottom: 14px;
        font-size: 13px;
      }

      .step:last-child {
        padding-bottom: 0;
      }

      .step:not(:last-child)::before {
        content: "";
        position: absolute;
        left: 11px;
        top: 26px;
        bottom: 2px;
        width: 2px;
        background: var(--rs-border);
      }

      .step.done:not(:last-child)::before {
        background: color-mix(in srgb, var(--rs-ok) 50%, transparent);
      }

      .dot {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        flex: none;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
        font-size: var(--rs-font-sm);
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 15px;
      }

      .step.done .dot {
        background: color-mix(in srgb, var(--rs-ok) 18%, transparent);
        color: var(--rs-ok);
      }

      .step.current .dot {
        background: var(--rs-humidify, var(--primary-color));
        color: var(--text-primary-color);
      }

      .step.current.reached .dot {
        background: var(--rs-ok);
      }

      .step-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding-top: 3px;
      }

      .step.todo .step-title,
      .step.off .step-title {
        color: var(--secondary-text-color);
      }

      .step small {
        font-size: var(--rs-font-sm);
        line-height: 1.4;
        color: var(--secondary-text-color);
      }

      .now .step::before {
        display: none;
      }

      .now .step-title {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .facts {
        margin: var(--rs-space-3) 0 0;
        padding: 0 0 0 36px;
        max-width: 440px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .fact {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--rs-space-3);
        font-size: 13px;
      }

      .fact dt {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: var(--secondary-text-color);
        --mdc-icon-size: 16px;
      }

      .fact dd {
        margin: 0;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .tiles {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      @container (min-width: 560px) {
        .tiles {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @container (min-width: 900px) {
        .tiles {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-humidity-model": RsAnalyticsHumidityModel;
  }
}
