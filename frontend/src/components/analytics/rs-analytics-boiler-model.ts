/**
 * rs-analytics-boiler-model – Full Boiler MPC & combustion analytics card.
 *
 * Uses the exact same visual design as `rs-analytics-model` (room MPC) so the boiler analytics
 * tab presents confidence, observations, learning stages / "what the boiler model sees now",
 * comprehensive physics & combustion stat tiles (calorific value, real efficiency, burn rate,
 * weather load slope, heat-up/cool-down rates, pipe distribution losses, cost per kWh, refill
 * calibration factor, temperature prediction MAE), and recent refill history.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, HeatPlantConfig, HeatPlantLive, BoilerModelInfo } from "../../types";
import { formatAgo, formatNumber, formatPercent } from "../../utils/format";
import { formatTempLocale, tempUnit } from "../../utils/temperature";
import { tokens, srOnly } from "../../styles/tokens";
import "../shared/rs-list-card";
import "../shared/rs-stat-tile";
import "../shared/rs-hint-chip";
import "../shared/rs-info-icon";

const MIN_BOILER_OBS = 15;
const MIN_BOILER_HEAT = 6;
const PENDING = "—";

type StageState = "done" | "current" | "todo";

interface Stage {
  title: string;
  sub: string;
  icon: string;
  state: StageState;
  reached?: boolean;
}

interface BoilerTile {
  icon: string;
  tone?: "default" | "heat" | "cool" | "ok";
  label: string;
  value: string | null;
  sub?: string;
  info: string;
}

@customElement("rs-analytics-boiler-model")
export class RsAnalyticsBoilerModel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public plant!: HeatPlantConfig;
  @property({ attribute: false }) public live?: HeatPlantLive;
  @property({ attribute: false }) public outdoorTemp: number | null = null;
  @property({ type: String }) public language = "en";

  private get _isPl(): boolean {
    return (this.language || this.hass?.language || "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  render() {
    if (!this.plant) return nothing;
    const m: BoilerModelInfo | undefined = this.live?.model;
    const confidence = m?.confidence ?? 0;
    const observations = m?.n_observations ?? 0;
    const mpcActive = !!m?.mpc_active;

    return html`
      <rs-list-card
        .heading=${this._t(
          `Model pieca i spalania (MPC) — ${this.plant.name}`,
          `Boiler & Combustion Model (MPC) — ${this.plant.name}`,
        )}
      >
        <rs-hint-chip
          slot="header-extras"
          .variant=${mpcActive ? "ok" : "default"}
          .icon=${mpcActive ? "mdi:brain" : "mdi:school-outline"}
          .text=${
            mpcActive
              ? this._t("MPC pieca AKTYWNE", "Boiler MPC ACTIVE")
              : this._t("Uczenie charakterystyki pieca", "Learning boiler physics")
          }
        ></rs-hint-chip>

        <div class="wrap">
          <div class="top">
            <div class="status">
              <div class="confidence">
                <span class="confidence-value"
                  >${formatPercent(Math.round(confidence * 100), this.hass)}</span
                >
                <span class="confidence-label"
                  >${this._t("Pewność", "Confidence")}
                  <rs-info-icon
                    .text=${this._t(
                      "Pewność modelu kotła rośnie wraz z liczbą cykli grzania, postojów i kalibracją na podstawie raportowanych zasypów opału.",
                      "Boiler model confidence grows with heating cycles, standby observations, and reported fuel refills.",
                    )}
                  ></rs-info-icon
                ></span>
              </div>
              <div class="points">
                ${formatNumber(observations, this.hass)} ${this._t("obserwacji", "observations")}
                · ${m?.n_heating ?? 0} ${this._t("grzania", "heat")} / ${m?.n_cooling ?? 0}
                ${this._t("stygnięcia", "cool")}
              </div>
              ${
                m?.last_update_at
                  ? html`<div class="updated">
                      ${this._t("Ostatnie uczenie", "Last learned")}:
                      ${formatAgo(m.last_update_at, this.language)}
                    </div>`
                  : nothing
              }
            </div>
            ${mpcActive && m ? this._renderNow(m) : this._renderStages(m)}
          </div>

          <div class="tiles">${this._tiles(m).map((t) => this._renderTile(t))}</div>

          ${this._renderRefillHistory(m)}
        </div>
      </rs-list-card>
    `;
  }

  private _stages(m?: BoilerModelInfo): Stage[] {
    const obs = m?.n_observations ?? 0;
    const heat = m?.n_heating ?? 0;
    const mpcActive = !!m?.mpc_active;
    const dataDone = mpcActive || (obs >= MIN_BOILER_OBS && heat >= MIN_BOILER_HEAT);
    const learnDone = mpcActive || (dataDone && (m?.confidence ?? 0) >= 0.45);

    return [
      {
        title: this._t("Zbieranie telemetrii kotła", "Collect boiler telemetry"),
        sub: this._t(
          "Odczyt temperatur zasilania/powrotu/spalin, cyklu podajnika i strat na kaloryferach.",
          "Reading supply/return/flue temperatures, feeder cycle, and radiator pipe losses.",
        ),
        icon: "mdi:database-outline",
        state: dataDone ? "done" : "current",
      },
      {
        title: this._t("Uczenie spalania i krzywej grzewczej", "Learn combustion & heating curve"),
        sub: this._t(
          "Kalibracja rzeczywistej sprawności (Siegert), spalania kg/24h i autokalibracji po zasypie worków.",
          "Calibrating real combustion efficiency (Siegert), kg/24h burn rate, and refill auto-calibration.",
        ),
        icon: "mdi:school-outline",
        state: learnDone ? "done" : dataDone ? "current" : "todo",
      },
      {
        title: this._t("Predykcja i rekomendacja nastaw (MPC)", "Prediction & setpoint advisory (MPC)"),
        sub: this._t(
          "Rekomendacja temperatury zadanej kotła względem pogody, prognoza autonomii zasobnika i wykrywanie strat.",
          "Weather-compensated supply target recommendation, hopper autonomy forecast, and loss diagnostics.",
        ),
        icon: "mdi:brain",
        state: learnDone ? "current" : "todo",
        reached: mpcActive,
      },
    ];
  }

  private _renderStages(m?: BoilerModelInfo) {
    const stages = this._stages(m);
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

  private _renderNow(m: BoilerModelInfo) {
    const unit = tempUnit(this.hass);
    const lv = this.live;
    const fuelUnit = lv?.fuel_unit || "kg";
    const recSupply = lv?.recommended_supply_temp ?? m.recommended_supply_temp;
    const autonomy = m.predicted_autonomy_hours ?? lv?.hours_until_refill;

    const facts: Array<{ icon: string; label: string; value: string }> = [];
    if (recSupply != null) {
      facts.push({
        icon: "mdi:thermometer-auto",
        label: this._t("Rekomendowana temp. kotła (MPC)", "Recommended boiler target (MPC)"),
        value: `${formatTempLocale(recSupply, this.hass, 1, 1)} ${unit}`,
      });
    }
    facts.push({
      icon: "mdi:fire-circle",
      label: this._t("Wyuczone spalanie dobowe", "Learned daily fuel burn"),
      value: `${formatNumber(m.learned_burn_rate_kg_24h, this.hass, 1)} ${fuelUnit}/24h`,
    });
    if (m.refill_avg_kg_24h != null) {
      facts.push({
        icon: "mdi:sack",
        label: this._t("Średnia z realnych zasypów", "Real refill average"),
        value: `${formatNumber(m.refill_avg_kg_24h, this.hass, 1)} ${fuelUnit}/24h`,
      });
    }
    if (autonomy != null) {
      const days = autonomy / 24;
      facts.push({
        icon: "mdi:silo",
        label: this._t("Prognoza do kolejnego zasypu", "Forecast until refill"),
        value:
          days >= 1.5
            ? `${formatNumber(days, this.hass, 1)} d (${formatNumber(autonomy, this.hass, 0)} h)`
            : `${formatNumber(autonomy, this.hass, 1)} h`,
      });
    }

    const supStr =
      lv?.supply_temp != null ? `${formatTempLocale(lv.supply_temp, this.hass, 1, 1)} ${unit}` : "—";
    const outStr =
      this.outdoorTemp != null ? `${formatTempLocale(this.outdoorTemp, this.hass, 1, 1)} ${unit}` : null;

    return html`<div class="now">
      <div class="step current reached">
        <span class="dot" aria-hidden="true"><ha-icon icon="mdi:brain"></ha-icon></span>
        <div class="step-text">
          <span class="step-title">
            ${this._t("Co model kotła widzi teraz", "What the boiler model sees now")}
          </span>
          <small>
            ${this._t("Kocioł", "Boiler")}: ${supStr}${outStr ? ` · ${this._t("Zewnątrz", "Outdoor")}: ${outStr}` : ""}
            · ${this._t("Zadana", "Target")}:
            ${formatTempLocale(this.plant.target_supply_temp, this.hass, 0, 1)} ${unit}
          </small>
        </div>
      </div>
      <dl class="facts">
        ${facts.map(
          (f) => html`<div class="fact">
            <dt><ha-icon .icon=${f.icon} aria-hidden="true"></ha-icon>${f.label}</dt>
            <dd>${f.value}</dd>
          </div>`,
        )}
      </dl>
    </div>`;
  }

  private _tiles(m?: BoilerModelInfo): BoilerTile[] {
    const lv = this.live;
    const unit = tempUnit(this.hass);
    const fuelUnit = lv?.fuel_unit || "kg";
    const currency = this.plant.currency || "PLN";
    const hasObs = (m?.n_observations ?? 0) >= 3;
    const calMj = m?.calorific_value_mj_kg ?? this.plant.calorific_value_mj_kg;
    const usableKwhKg = m?.usable_kwh_per_kg ?? lv?.usable_kwh_per_kg ?? 0;
    const realEff = lv?.real_efficiency_pct ?? m?.learned_efficiency_pct ?? this.plant.efficiency_pct;

    const tiles: BoilerTile[] = [
      {
        icon: "mdi:fire",
        tone: "heat",
        label: this._t("Kaloryczność opału", "Fuel calorific value"),
        value: `${formatNumber(calMj, this.hass, 1)} MJ/${fuelUnit}`,
        sub: `${formatNumber(usableKwhKg, this.hass, 2)} kWh ${this._t("użyteczne", "usable")}/${fuelUnit}`,
        info: this._t(
          "Wartość opałowa węgla/pelletu oraz realna ilość energii cieplnej przekazywana do wody z 1 kg po uwzględnieniu sprawności.",
          "Fuel calorific value and usable thermal energy delivered per kg after combustion efficiency.",
        ),
      },
      {
        icon: "mdi:gauge",
        tone: "ok",
        label: this._t("Rzeczywista sprawność", "Real combustion efficiency"),
        value: `${formatNumber(realEff, this.hass, 1)} %`,
        sub:
          lv?.flue_loss_pct != null
            ? this._t(
                `strata kominowa ${formatNumber(lv.flue_loss_pct, this.hass, 1)}% (Siegert)`,
                `flue stack loss ${formatNumber(lv.flue_loss_pct, this.hass, 1)}% (Siegert)`,
              )
            : this._t(`znamionowa ${this.plant.efficiency_pct}%`, `rated ${this.plant.efficiency_pct}%`),
        info: this._t(
          "Sprawność wyliczana z temperatury spalin (wzór Siegerta) i temperatury kotłowni.",
          "Combustion efficiency computed from flue gas temperature (Siegert formula) and ambient temperature.",
        ),
      },
      {
        icon: "mdi:scale-balance",
        tone: "heat",
        label: this._t("Spalanie dobowe (model)", "Daily fuel burn (model)"),
        value:
          lv?.burn_rate_per_24h != null || m?.learned_burn_rate_kg_24h
            ? `${formatNumber(lv?.burn_rate_per_24h ?? m?.learned_burn_rate_kg_24h ?? 0, this.hass, 1)} ${fuelUnit}/24h`
            : null,
        sub: `${formatNumber(lv?.burn_rate_per_h ?? m?.learned_burn_rate_kg_h ?? 0, this.hass, 2)} ${fuelUnit}/h`,
        info: this._t(
          "Średnie i chwilowe zużycie opału obliczone z cyklu podajnika, przepływu ΔT oraz kalibracji zasypów.",
          "Fuel burn rate derived from feeder work/pause cycle, hydraulic ΔT, and refill calibration.",
        ),
      },
      {
        icon: "mdi:cash-multiple",
        label: this._t("Koszt 1 kWh ciepła", "Cost per 1 kWh heat"),
        value:
          lv?.cost_per_kwh_thermal != null
            ? `${formatNumber(lv.cost_per_kwh_thermal, this.hass, 3)} ${currency}`
            : null,
        sub:
          lv?.cost_per_hour != null
            ? `${formatNumber(lv.cost_per_hour, this.hass, 2)} ${currency}/h`
            : undefined,
        info: this._t(
          "Rzeczywisty koszt wytworzenia 1 kWh energii cieplnej na podstawie ceny opału, kaloryczności i aktualnej sprawności.",
          "Real cost to produce 1 kWh of heat given fuel price, calorific value, and real efficiency.",
        ),
      },
      {
        icon: "mdi:trending-up",
        tone: "heat",
        label: this._t("Tempo nagrzewania kotła", "Boiler heat-up rate"),
        value:
          hasObs && (m?.n_heating ?? 0) >= 2
            ? `+${formatNumber(m!.heat_up_rate_c_per_h, this.hass, 1)} ${unit}/h`
            : null,
        info: this._t(
          "Średnia szybkość wzrostu temperatury wody na zasilaniu podczas palenia.",
          "Learned rate of supply temperature rise during active firing.",
        ),
      },
      {
        icon: "mdi:trending-down",
        tone: "cool",
        label: this._t("Tempo stygnięcia", "Standby cool-down rate"),
        value:
          hasObs && (m?.n_cooling ?? 0) >= 2
            ? `−${formatNumber(m!.cool_down_rate_c_per_h, this.hass, 1)} ${unit}/h`
            : null,
        info: this._t(
          "Szybkość wychładzania kotła podczas podtrzymania lub postoju.",
          "Rate of boiler temperature drop during standby or fire-hold.",
        ),
      },
      {
        icon: "mdi:pipe-leak",
        label: this._t("Straty przesyłu (piec → kaloryfer)", "Pipe heat loss (boiler → rads)"),
        value:
          lv?.distribution_loss_pct != null
            ? `${formatNumber(lv.distribution_loss_pct, this.hass, 1)} %`
            : m && m.learned_pipe_loss_pct > 0
              ? `${formatNumber(m.learned_pipe_loss_pct, this.hass, 1)} %`
              : null,
        sub:
          lv?.distribution_temp_drop_k != null
            ? `ΔT −${formatNumber(lv.distribution_temp_drop_k, this.hass, 1)} K · ${formatNumber(lv.distribution_loss_kw ?? 0, this.hass, 2)} kW`
            : this._t("Dodaj czujniki na kaloryferach", "Add radiator sensors to measure"),
        info: this._t(
          "Udział ciepła traconego na rurach między wyjściem kotła a czujnikami zamontowanymi na grzejnikach.",
          "Share of heat lost along pipes between boiler outlet and radiator temperature sensors.",
        ),
      },
      {
        icon: "mdi:tune-variant",
        label: this._t("Współczynnik kalibracji zasypów", "Refill calibration factor"),
        value: m ? `×${formatNumber(m.fuel_calibration_factor, this.hass, 2)}` : "×1.00",
        sub:
          m?.refill_avg_kg_24h != null
            ? this._t(
                `śr. ${formatNumber(m.refill_avg_kg_24h, this.hass, 1)} kg/24h z zasypów`,
                `avg ${formatNumber(m.refill_avg_kg_24h, this.hass, 1)} kg/24h from refills`,
              )
            : this._t("kalibruje się po zasypaniu worków", "calibrates when you report refills"),
        info: this._t(
          "Automatyczna korekta wyliczeń spalania na podstawie worków/kg wsypanych przez użytkownika do zasobnika.",
          "Automatic fuel-rate calibration derived from refilled bags/kg reported by the user.",
        ),
      },
      {
        icon: "mdi:weather-snowy",
        label: this._t("Wrażliwość pogodowa", "Weather burn slope"),
        value:
          hasObs && m && m.kg_per_day_per_k > 0
            ? `${formatNumber(m.kg_per_day_per_k, this.hass, 2)} ${fuelUnit}/24h·K`
            : null,
        sub: this._t("przyrost spalania na 1°C mrozu", "extra daily fuel per 1°C colder"),
        info: this._t(
          "Ile dodatkowego opału na dobę wymaga dom przy spadku temperatury zewnętrznej o 1 K.",
          "Additional daily fuel needed for each 1 K drop in outdoor temperature.",
        ),
      },
      {
        icon: "mdi:bullseye-arrow",
        label: this._t("Błąd prognozy temp. kotła", "Boiler temp forecast MAE"),
        value:
          m?.temp_mae_c != null
            ? `±${formatNumber(m.temp_mae_c, this.hass, 2)} ${unit}`
            : null,
        sub:
          m?.learned_delta_t_k
            ? `ΔT śr. ${formatNumber(m.learned_delta_t_k, this.hass, 1)} K`
            : undefined,
        info: this._t(
          "Średni bezwzględny błąd przewidywania temperatury zasilania kotła między cyklami.",
          "Mean absolute error of one-step boiler supply temperature prediction.",
        ),
      },
    ];

    return tiles;
  }

  private _renderTile(t: BoilerTile) {
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

  private _renderRefillHistory(m?: BoilerModelInfo) {
    const hist = m?.refill_history ?? [];
    if (hist.length === 0) return nothing;
    const recent = [...hist].reverse().slice(0, 6);
    const fuelUnit = this.live?.fuel_unit || "kg";
    return html`
      <div class="refill-history">
        <div class="refill-title">
          <ha-icon icon="mdi:history"></ha-icon>
          <span>${this._t("Ostatnie zasypy i autokalibracja spalania", "Recent refills & burn calibration")}</span>
        </div>
        <div class="refill-list">
          ${recent.map((r) => {
            const dt = new Date(r.ts * 1000).toLocaleDateString(this.language || "pl", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
            return html`
              <div class="refill-row">
                <span class="refill-date">${dt}</span>
                <span class="refill-amount">
                  +${formatNumber(r.kg, this.hass, 1)} ${fuelUnit}
                  ${r.bags != null ? html`(${formatNumber(r.bags, this.hass, 1)} ${this._t("worków", "bags")})` : nothing}
                </span>
                <span class="refill-rate">
                  ${
                    r.avg_kg_24h != null
                      ? `${formatNumber(r.avg_kg_24h, this.hass, 1)} ${fuelUnit}/24h`
                      : r.filled_to_full
                        ? this._t("do pełna", "full")
                        : ""
                  }
                </span>
              </div>
            `;
          })}
        </div>
      </div>
    `;
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
        padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-3);
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
        background: var(--rs-heat, var(--primary-color));
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

      .step.todo .step-title {
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

      .facts {
        margin: var(--rs-space-3) 0 0;
        padding: 0 0 0 36px;
        max-width: 460px;
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

      .refill-history {
        margin-top: var(--rs-space-4);
        padding-top: var(--rs-space-3);
        border-top: 1px solid var(--rs-border);
      }

      .refill-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 8px;
        --mdc-icon-size: 16px;
        color: var(--secondary-text-color);
      }

      .refill-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .refill-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 6px;
        background: var(--rs-fill);
        font-variant-numeric: tabular-nums;
      }

      .refill-date {
        color: var(--secondary-text-color);
      }

      .refill-amount {
        font-weight: 500;
      }

      .refill-rate {
        color: var(--rs-heat, var(--primary-color));
        font-weight: 500;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-boiler-model": RsAnalyticsBoilerModel;
  }
}
