import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { HeatPlantConfig, HeatPlantLive, HomeAssistant, PriceStatus } from "../../types";
import { floorGroups, type AreaInfo, type FloorOrder } from "../../utils/dashboard";
import { hasDevices } from "../../utils/room-state";
import { localize, type TranslationKey } from "../../utils/localize";
import { formatNumber, formatPercent } from "../../utils/format";
import { formatTempLocale, tempUnit } from "../../utils/temperature";
import { VACATION_SENTINEL } from "../../utils/constants";
import { tokens } from "../../styles/tokens";
import { dashboardStyles } from "./dashboard-styles";
import "./rs-room-card";
import "../shared/rs-pill";

export interface HouseSummary {
  vacationActive: boolean;
  vacationUntil: number | null;
  presenceEnabled: boolean;
  anyoneHome: boolean;
  outdoorTemp: number | null;
  priceEntity: string;
  priceStatus: PriceStatus | null;
}

const PRICE_LEVEL_KEYS: Record<"cheap" | "normal" | "expensive", TranslationKey> = {
  cheap: "settings.price_level_cheap",
  normal: "settings.price_level_normal",
  expensive: "settings.price_level_expensive",
};

/** Rooms tab: house summary pills, distinct-color humidification stats, heat plant sensors, and room cards. */
@customElement("rs-dashboard")
export class RsDashboard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  /** All areas in display order, hidden ones included. */
  @property({ attribute: false }) public infos: AreaInfo[] = [];
  @property({ attribute: false }) public hiddenRooms: string[] = [];
  @property({ type: Boolean }) public groupByFloor = false;
  @property({ attribute: false }) public floorOrder: FloorOrder = { ha: [], own: [] };
  @property({ type: String }) public controlMode: "mpc" | "bangbang" = "mpc";
  @property({ type: Boolean }) public climateControlActive = true;
  @property({ attribute: false }) public summary!: HouseSummary;
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};

  static styles = [tokens, dashboardStyles];

  private get _isPl(): boolean {
    return (this.hass?.language ?? "pl").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  render() {
    const l = this.hass.language;
    if (this.infos.length === 0) {
      return html`<div class="placeholder">
        <ha-icon icon="mdi:home"></ha-icon>
        <p>${localize("panel.no_areas", l)}<br />${localize("panel.no_areas_hint", l)}</p>
      </div>`;
    }
    const hidden = new Set(this.hiddenRooms);
    const visible = this.infos.filter((i) => !hidden.has(i.area.area_id));
    if (visible.length === 0) {
      return html`${this._renderPills(visible)}
        <div class="placeholder">
          <ha-icon icon="mdi:eye-off-outline"></ha-icon>
          <p>${localize("panel.all_hidden", l)}</p>
          <ha-button @click=${this._requestEdit}>${localize("panel.edit_rooms", l)}</ha-button>
        </div>`;
    }
    const groups = floorGroups(visible, this.hass, this.groupByFloor, this.floorOrder);
    return html`
      ${this._renderPills(visible)}
      ${this._renderHumidificationStats(visible)}
      ${this._renderHeatPlantsStrip()}
      ${groups.map(
        (g) => html`
          ${
            g.name
              ? html`<h2 class="floor">${g.name} <span class="count">${g.items.length}</span></h2>`
              : nothing
          }
          <div class="grid">
            ${repeat(
              g.items,
              (i) => i.area.area_id,
              (i) =>
                html`<rs-room-card
                  .hass=${this.hass}
                  .area=${i.area}
                  .config=${i.config}
                  .climateEntityCount=${i.climateEntityCount}
                  .tempSensorCount=${i.tempSensorCount}
                  .controlMode=${this.controlMode}
                  .climateControlActive=${this.climateControlActive}
                ></rs-room-card>`,
            )}
          </div>
        `,
      )}
    `;
  }

  private _humidityControlledRooms(visible: AreaInfo[]): AreaInfo[] {
    return visible.filter(
      (i) =>
        !i.config?.is_outdoor &&
        (!!i.config?.humidifier_entity ||
          !!i.config?.dehumidifier_entity ||
          i.config?.humidity_min != null ||
          i.config?.humidity_max != null ||
          i.config?.comfort_humidify != null ||
          i.config?.comfort_dehumidify != null),
    );
  }

  private _renderPills(visible: AreaInfo[]) {
    const l = this.hass.language;
    const s = this.summary;
    // Rooms RoomMind controls: outdoor areas and rooms without devices only measure
    const configured = visible.filter((i) => hasDevices(i.config) && !i.config?.is_outdoor);
    const heating = visible.filter((i) => i.config?.live?.mode === "heating").length;
    const cooling = visible.filter((i) => i.config?.live?.mode === "cooling").length;
    const humRooms = this._humidityControlledRooms(visible);
    const humidifying = humRooms.filter(
      (i) => i.config?.live?.humidity_action === "humidifying" || i.config?.live?.humidifier_active,
    ).length;
    const dehumidifying = humRooms.filter(
      (i) =>
        i.config?.live?.humidity_action === "dehumidifying" ||
        i.config?.live?.dehumidifier_active ||
        i.config?.live?.ac_dry_active,
    ).length;
    const avgHumVals = visible
      .filter((i) => !i.config?.is_outdoor && i.config?.live?.current_humidity != null)
      .map((i) => i.config!.live!.current_humidity!);
    const avgHum =
      avgHumVals.length > 0
        ? Math.round(avgHumVals.reduce((a, b) => a + b, 0) / avgHumVals.length)
        : null;
    const mold = visible.filter(
      (i) =>
        i.config?.live?.mold_risk_level === "warning" ||
        i.config?.live?.mold_risk_level === "critical",
    ).length;
    const pmBad = visible.filter(
      (i) =>
        i.config?.live?.air_quality_bad &&
        (i.config.live.air_quality_reason === "pm25" ||
          i.config.live.air_quality_reason === "pm10" ||
          i.config.live.air_quality_reason === "pm1"),
    ).length;
    const level = s.priceEntity ? s.priceStatus?.level : null;
    const vacationUntil =
      s.vacationActive && s.vacationUntil && s.vacationUntil < VACATION_SENTINEL
        ? new Intl.DateTimeFormat(l, { day: "numeric", month: "short" }).format(
            new Date(s.vacationUntil * 1000),
          )
        : null;

    const pills = [
      configured.length
        ? html`<rs-pill icon="mdi:home-thermometer-outline"
            >${localize("panel.pill.rooms", l)} <b>${configured.length}</b></rs-pill
          >`
        : nothing,
      configured.length
        ? html`<rs-pill icon="mdi:fire" .tone=${heating ? "heat" : "default"}
            >${localize("panel.pill.heating", l)} <b>${heating}</b></rs-pill
          >`
        : nothing,
      cooling
        ? html`<rs-pill icon="mdi:snowflake" tone="cool"
            >${localize("panel.pill.cooling", l)} <b>${cooling}</b></rs-pill
          >`
        : nothing,
      humRooms.length
        ? html`<rs-pill icon="mdi:air-humidifier" tone="humidify"
            >${this._t("Nawilżanie", "Humidifying")} <b>${humidifying}/${humRooms.length}</b>${
              avgHum != null ? html` · <b>${formatPercent(avgHum, this.hass)}</b>` : nothing
            }</rs-pill
          >`
        : nothing,
      dehumidifying
        ? html`<rs-pill icon="mdi:water-minus" tone="dehumidify"
            >${this._t("Osuszanie", "Dehumidifying")} <b>${dehumidifying}</b></rs-pill
          >`
        : nothing,
      s.outdoorTemp != null
        ? html`<rs-pill icon="mdi:thermometer"
            >${localize("panel.pill.outdoor", l)}
            <b
              >${formatTempLocale(s.outdoorTemp, this.hass)}&nbsp;${tempUnit(this.hass)}</b
            ></rs-pill
          >`
        : nothing,
      level
        ? html`<rs-pill
            icon="mdi:cash-clock"
            .tone=${level === "cheap" ? "ok" : level === "expensive" ? "warn" : "default"}
            >${localize("panel.pill.price", l)}
            <b>${localize(PRICE_LEVEL_KEYS[level], l)}</b></rs-pill
          >`
        : nothing,
      s.vacationActive
        ? html`<rs-pill icon="mdi:airplane" tone="ok"
            >${
              vacationUntil
                ? localize("panel.pill.vacation_until", l, { date: vacationUntil })
                : localize("panel.stat.vacation", l)
            }</rs-pill
          >`
        : nothing,
      s.presenceEnabled && !s.anyoneHome
        ? html`<rs-pill icon="mdi:home-export-outline">${localize("panel.pill.away", l)}</rs-pill>`
        : nothing,
      mold
        ? html`<rs-pill icon="mdi:water-alert" tone="warn"
            ><b>${mold}</b> ${localize("panel.pill.mold", l)}</rs-pill
          >`
        : nothing,
      pmBad
        ? html`<rs-pill icon="mdi:blur" tone="warn"
            ><b>${pmBad}</b> ${this._t("Smog / PM", "PM alert")}</rs-pill
          >`
        : nothing,
    ].filter((p) => p !== nothing);
    if (!pills.length) return nothing;
    return html`<div class="pills" role="list" aria-label=${localize("panel.pill.label", l)}>
      ${pills.map((p) => html`<span role="listitem">${p}</span>`)}
    </div>`;
  }

  /** Distinct-color humidification control statistics panel on the main dashboard. */
  private _renderHumidificationStats(visible: AreaInfo[]) {
    const humRooms = this._humidityControlledRooms(visible);
    if (humRooms.length === 0) return nothing;

    const activeHum = humRooms.filter(
      (i) => i.config?.live?.humidity_action === "humidifying" || i.config?.live?.humidifier_active,
    );
    const activeDehum = humRooms.filter(
      (i) =>
        i.config?.live?.humidity_action === "dehumidifying" ||
        i.config?.live?.dehumidifier_active ||
        i.config?.live?.ac_dry_active,
    );
    const mpcCount = humRooms.filter((i) => i.config?.live?.humidity_mpc_active).length;
    const rhValues = humRooms
      .map((i) => i.config?.live?.current_humidity)
      .filter((v): v is number => v != null);
    const avgRh =
      rhValues.length > 0 ? rhValues.reduce((a, b) => a + b, 0) / rhValues.length : null;
    const avgPower =
      activeHum.length > 0
        ? Math.round(
            activeHum.reduce((sum, i) => sum + (i.config?.live?.humidifying_power || 100), 0) /
              activeHum.length,
          )
        : 0;

    return html`<section class="hum-stats-card" aria-label=${this._t("Sterowanie nawilżaniem", "Humidification control")}>
      <div class="hum-stats-head">
        <span class="hum-stats-title">
          <ha-icon icon="mdi:air-humidifier"></ha-icon>
          ${this._t("Statystyki sterowania nawilżaniem", "Humidification Control Statistics")}
        </span>
        <div class="hum-stats-kpis">
          <span class="kpi">
            ${this._t("Nawilżanie", "Humidifying")}: ${activeHum.length}/${humRooms.length}
            ${avgPower > 0 ? ` (${avgPower}%)` : ""}
          </span>
          ${
            activeDehum.length > 0
              ? html`<span class="kpi dehum"
                  >${this._t("Osuszanie", "Dehumidifying")}: ${activeDehum.length}</span
                >`
              : nothing
          }
          ${
            avgRh != null
              ? html`<span class="kpi"
                  >${this._t("Śr. RH", "Avg RH")}: ${formatPercent(Math.round(avgRh), this.hass)}</span
                >`
              : nothing
          }
          ${
            mpcCount > 0
              ? html`<span class="kpi">MPC: ${mpcCount}/${humRooms.length}</span>`
              : nothing
          }
        </div>
      </div>
      <div class="hum-chips">
        ${humRooms.map((info) => {
          const live = info.config?.live;
          const name = info.config?.display_name || info.area.name;
          const cur = live?.current_humidity;
          const tgt = live?.target_humidity ?? live?.humidify_target ?? live?.dehumidify_target;
          const action =
            live?.humidity_action === "humidifying" || live?.humidifier_active
              ? "humidifying"
              : live?.humidity_action === "dehumidifying" ||
                  live?.dehumidifier_active ||
                  live?.ac_dry_active
                ? "dehumidifying"
                : "idle";
          const power = live?.humidifying_power ?? 0;
          const icon =
            action === "humidifying"
              ? "mdi:water-plus"
              : action === "dehumidifying"
                ? "mdi:water-minus"
                : "mdi:water-check";
          return html`<button
            type="button"
            class="hum-chip ${action}"
            @click=${() => this._openArea(info.area.area_id)}
          >
            <ha-icon .icon=${icon}></ha-icon>
            <span>${name}</span>
            <b>${cur != null ? formatPercent(Math.round(cur), this.hass) : "--"}</b>
            ${
              tgt != null
                ? html`<small>→ ${formatPercent(Math.round(tgt), this.hass)}</small>`
                : nothing
            }
            ${action !== "idle" && power > 0 ? html`<small>· ${power}%</small>` : nothing}
          </button>`;
        })}
      </div>
    </section>`;
  }

  /** Live heat plant / boiler / fireplace / underfloor sensors strip on the main dashboard. */
  private _renderHeatPlantsStrip() {
    if (!this.heatPlants.length) return nothing;
    const unit = tempUnit(this.hass);
    const fmtTemp = (v: number | null | undefined) =>
      v != null ? `${formatTempLocale(v, this.hass, 1, 1)}\u00a0${unit}` : "--";

    return html`<div class="plants-strip">
      ${this.heatPlants.map((plant) => {
        const live = this.heatPlantsLive[plant.id];
        const state = live?.state ?? "idle";
        const cls =
          state === "overheat_protect"
            ? "overheat"
            : state === "hold"
              ? "hold"
              : state === "heating" || state === "dhw" || state === "heating_and_dhw" || state === "active"
                ? "active"
                : "";
        const icon =
          plant.plant_type === "fireplace"
            ? "mdi:fireplace"
            : plant.plant_type === "heat_pump"
              ? "mdi:heat-pump-outline"
              : plant.plant_type === "gas_boiler"
                ? "mdi:water-boiler"
                : "mdi:fire";
        const stateLabel =
          !plant.enabled
            ? this._t("Wyłączony", "Disabled")
            : state === "overheat_protect"
              ? this._t("Przegrzanie!", "Overheat!")
              : state === "hold"
                ? this._t("Podtrzymanie ognia", "Fire hold")
                : state === "heating_and_dhw"
                  ? this._t("C.O. + CWU", "C.O. + DHW")
                  : state === "heating"
                    ? this._t("Grzanie C.O.", "Heating")
                    : state === "dhw"
                      ? this._t("CWU", "DHW")
                      : state === "active"
                        ? this._t("Praca", "Active")
                        : this._t("Czuwanie", "Standby");
        const fuelUnit = live?.fuel_unit ?? "kg";
        const alerts = live?.maintenance_alerts ?? [];

        return html`<button type="button" class="plant-mini ${cls}" @click=${this._openHeatPlants}>
          <div class="plant-mini-top">
            <ha-icon .icon=${icon}></ha-icon>
            <span class="plant-mini-name">${plant.name}</span>
            <span class="plant-mini-state ${cls}">${stateLabel}</span>
          </div>
          <div class="plant-mini-sensors">
            ${
              live?.supply_temp != null
                ? html`<span>
                    <ha-icon icon="mdi:thermometer-chevron-up"></ha-icon>
                    ${this._t("Zas.", "Sup.")} <b>${fmtTemp(live.supply_temp)}</b>
                  </span>`
                : nothing
            }
            ${
              live?.return_temp != null
                ? html`<span>
                    <ha-icon icon="mdi:thermometer-chevron-down"></ha-icon>
                    ${this._t("Powr.", "Ret.")} <b>${fmtTemp(live.return_temp)}</b>
                  </span>`
                : nothing
            }
            ${
              live?.dhw_temp != null
                ? html`<span>
                    <ha-icon icon="mdi:water-thermometer"></ha-icon>
                    CWU <b>${fmtTemp(live.dhw_temp)}</b>
                  </span>`
                : nothing
            }
            ${
              live?.feeder_temp != null
                ? html`<span>
                    <ha-icon icon="mdi:screw-machine-flat-top"></ha-icon>
                    ${this._t("Podajn.", "Feed.")} <b>${fmtTemp(live.feeder_temp)}</b>
                  </span>`
                : nothing
            }
            ${
              live?.blower_pct != null
                ? html`<span>
                    <ha-icon icon="mdi:fan"></ha-icon>
                    ${live.blower_mode ? `${live.blower_mode} ` : ""}<b>${formatNumber(live.blower_pct, this.hass, 0)}%</b>
                  </span>`
                : nothing
            }
            ${
              live?.flue_temp != null
                ? html`<span>
                    <ha-icon icon="mdi:smoke"></ha-icon>
                    ${this._t("Spal.", "Flue")} <b>${fmtTemp(live.flue_temp)}</b>
                  </span>`
                : nothing
            }
            <span>
              <ha-icon icon="mdi:flash"></ha-icon>
              <b>${formatNumber(live?.current_thermal_kw ?? 0, this.hass, 1)} kW</b>
              ${
                live?.burn_rate_per_24h != null
                  ? html`· <b>${formatNumber(live.burn_rate_per_24h, this.hass, 1)} ${fuelUnit}/24h</b>`
                  : nothing
              }
            </span>
            <span>
              <ha-icon icon="mdi:scale-balance"></ha-icon>
              ${this._t("Dziś", "Today")}:
              <b>${formatNumber(live?.fuel_consumed_today ?? 0, this.hass, 1)} ${fuelUnit}</b>
              (${formatNumber(live?.cost_today ?? 0, this.hass, 2)} ${plant.currency})
            </span>
            ${
              live?.distribution_loss_pct != null
                ? html`<span>
                    <ha-icon icon="mdi:pipe-leak"></ha-icon>
                    ${this._t("Straty rur", "Pipe loss")}:
                    <b>${formatNumber(live.distribution_loss_pct, this.hass, 1)}%</b>
                  </span>`
                : nothing
            }
            ${
              live?.fuel_remaining_kg != null
                ? html`<span>
                    <ha-icon icon="mdi:silo"></ha-icon>
                    ${this._t("Zasobnik", "Hopper")}:
                    <b>${formatNumber(live.fuel_remaining_kg, this.hass, 0)} kg</b>
                    (${Math.round(live.hopper_pct ?? 0)}%)
                  </span>`
                : nothing
            }
          </div>
          ${
            alerts.length > 0 || (live?.warnings?.length ?? 0) > 0 || live?.low_return_warning
              ? html`<div class="plant-mini-alerts">
                  ${(live?.warnings ?? []).map(
                    (w) => html`<span class="plant-alert-badge"
                      ><ha-icon
                        icon=${w.severity === "critical" ? "mdi:alert-octagon" : "mdi:alert-outline"}
                      ></ha-icon
                      >${w.title}</span
                    >`,
                  )}
                  ${alerts.includes("refill")
                    ? html`<span class="plant-alert-badge"
                        ><ha-icon icon="mdi:fire-alert"></ha-icon>${this._t(
                          "Dołóż opału!",
                          "Refill needed!",
                        )}</span
                      >`
                    : nothing}
                  ${alerts.includes("ash")
                    ? html`<span class="plant-alert-badge"
                        ><ha-icon icon="mdi:delete-alert"></ha-icon>${this._t(
                          "Opróżnij popielnik!",
                          "Empty ash tray!",
                        )}</span
                      >`
                    : nothing}
                  ${alerts.includes("chimney")
                    ? html`<span class="plant-alert-badge"
                        ><ha-icon icon="mdi:chimney"></ha-icon>${this._t(
                          "Wyczyść komin!",
                          "Clean chimney!",
                        )}</span
                      >`
                    : nothing}
                </div>`
              : nothing
          }
        </button>`;
      })}
    </div>`;
  }

  private _openArea(areaId: string) {
    this.dispatchEvent(
      new CustomEvent("area-selected", {
        detail: { areaId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openHeatPlants = () => {
    this.dispatchEvent(new CustomEvent("open-heat-plants", { bubbles: true, composed: true }));
  };

  private _requestEdit() {
    this.dispatchEvent(new CustomEvent("edit-requested", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-dashboard": RsDashboard;
  }
}
