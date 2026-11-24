/**
 * rs-analytics – Analytics tab orchestrator.
 * Delegates rendering to rs-analytics-toolbar, -summary, -chart, -rhythm and -model.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  RoomConfig,
  AnalyticsData,
  AnalyticsDataPoint,
  HeatPlantConfig,
  HeatPlantLive,
} from "../types";
import { localize } from "../utils/localize";
import { boostHoursLeft } from "../utils/learning";
import {
  QUICK_RANGE_DAYS,
  haTimeZone,
  isoDateInZone,
  quickRange,
  startOfDayInZone,
} from "../utils/analytics-time";
import { formatNumber, formatPercent } from "../utils/format";
import { tokens } from "../styles/tokens";
import "./shared/rs-list-card";
import "./analytics/rs-analytics-toolbar";
import "./analytics/rs-analytics-summary";
import "./analytics/rs-analytics-chart";
import "./analytics/rs-analytics-rhythm";
import "./analytics/rs-analytics-model";
import "./analytics/rs-analytics-heat-plants";

/** What a room can show: the summary, rhythm, chart and model card use the same flags. */
function roomFlags(room: RoomConfig | undefined) {
  return {
    canHeat: room?.climate_mode !== "cool_only",
    canCool:
      room?.climate_mode !== "heat_only" && (room?.devices ?? []).some((d) => d.type === "ac"),
    hasWindowSensor: (room?.window_sensors?.length ?? 0) > 0,
    hasHumidityControl: Boolean(
      room?.humidifier_entity ||
        room?.dehumidifier_entity ||
        room?.humidity_min != null ||
        room?.humidity_max != null ||
        room?.comfort_humidify != null ||
        room?.comfort_dehumidify != null,
    ),
    // The price only matters where it moves something
    followsPrice:
      !room?.is_outdoor && ((room?.price_shift ?? 0) > 0 || !!room?.heat_source_price_aware),
  };
}

/** Sides a room is judged on, same rule as the summary (one-sided rooms on their own side only). */
function bandSides(mode: string | undefined): "both" | "heat" | "cool" {
  if (mode === "heat_only") return "heat";
  if (mode === "cool_only") return "cool";
  return "both";
}

@customElement("rs-analytics")
export class RsAnalytics extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Object }) public rooms: Record<string, RoomConfig> = {};
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};
  @property() public initialRoom = "";
  @property() public controlMode: "mpc" | "bangbang" = "mpc";

  @state() private _selectedRoom = "";
  // Browser midnight until hass is known, then today in HA's zone (willUpdate)
  @state() private _rangeStart: number = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  @state() private _rangeEnd: number = Date.now();
  @state() private _data: AnalyticsData | null = null;
  @state() private _chartAnchor: number = Date.now();
  @state() private _loading = false;
  @state() private _activeQuick: string | null = "24h";

  private _refreshInterval?: ReturnType<typeof setInterval>;
  private _dataRoom = "";
  private _pointsOf: AnalyticsData | null = null;
  private _pointsCache: AnalyticsDataPoint[] = [];
  private _fetchId = 0;
  private _zoneApplied = false;

  connectedCallback() {
    super.connectedCallback();
    this._refreshInterval = setInterval(() => this._silentRefresh(), 60_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }

  protected willUpdate(changedProps: Map<string, unknown>) {
    if (!this._zoneApplied && this.hass && this._activeQuick) {
      this._zoneApplied = true;
      this._applyQuickRange();
    }
    if (changedProps.has("initialRoom") && this.initialRoom) {
      this._selectedRoom = this.initialRoom;
    }
    let autoSelected = false;
    if (changedProps.has("rooms") && !this._selectedRoom) {
      const configured = Object.keys(this.rooms);
      if (configured.length > 0) {
        this._selectedRoom = configured[0];
        autoSelected = true;
        this.dispatchEvent(
          new CustomEvent("room-selected", {
            detail: { areaId: configured[0] },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
    if (
      autoSelected ||
      changedProps.has("_selectedRoom") ||
      changedProps.has("_rangeStart") ||
      changedProps.has("_rangeEnd")
    ) {
      if (this._selectedRoom) {
        this._fetchData();
      }
    }
  }

  protected render() {
    const l = this.hass.language;
    const flags = roomFlags(this.rooms[this._selectedRoom]);
    const plants = this._data?.heat_plants ?? this.heatPlants;
    const plantsLive = this._data?.heat_plants_live ?? this.heatPlantsLive;
    const plantsHistory = this._data?.heat_plants_history ?? {};

    return html`
      <rs-analytics-toolbar
        .hass=${this.hass}
        .rooms=${this.rooms}
        .selectedRoom=${this._selectedRoom}
        .rangeStart=${this._rangeStart}
        .rangeEnd=${this._rangeEnd}
        .activeQuick=${this._activeQuick}
        .data=${this._data}
        .language=${l}
        @room-selected=${this._onRoomSelected}
        @range-changed=${this._onRangeChanged}
      ></rs-analytics-toolbar>
      ${
        plants.length > 0
          ? html`<rs-analytics-heat-plants
              .hass=${this.hass}
              .heatPlants=${plants}
              .heatPlantsLive=${plantsLive}
              .heatPlantsHistory=${plantsHistory}
              .rangeStart=${this._rangeStart}
              .rangeEnd=${this._rangeEnd}
              @heat-plants-updated=${() => this._silentRefresh()}
            ></rs-analytics-heat-plants>`
          : nothing
      }
      ${
        this._selectedRoom
          ? this._loading && !this._data
            ? html`<div class="loading">${localize("panel.loading", l)}</div>`
            : html`
                ${this._renderSummary()}
                <rs-analytics-chart
                  .hass=${this.hass}
                  .data=${this._data}
                  .rangeStart=${this._rangeStart}
                  .rangeEnd=${this._rangeEnd}
                  .chartAnchor=${this._chartAnchor}
                  .language=${l}
                  .isOutdoor=${this.rooms[this._selectedRoom]?.is_outdoor ?? false}
                  .targetBand=${bandSides(this.rooms[this._selectedRoom]?.climate_mode)}
                  .showPrice=${flags.followsPrice}
                ></rs-analytics-chart>
                ${
                  !this.rooms[this._selectedRoom]?.is_outdoor
                    ? html`<rs-analytics-rhythm
                        .hass=${this.hass}
                        .rhythm=${this._data?.rhythm ?? null}
                        .rangeStart=${this._rangeStart}
                        .rangeEnd=${this._rangeEnd}
                        .language=${l}
                        .canHeat=${flags.canHeat}
                        .canCool=${flags.canCool}
                        .hasWindowSensor=${flags.hasWindowSensor}
                        .bandSides=${bandSides(this.rooms[this._selectedRoom]?.climate_mode)}
                        @day-selected=${this._onDaySelected}
                      ></rs-analytics-rhythm>`
                    : nothing
                }
                ${
                  !this.rooms[this._selectedRoom]?.is_outdoor
                    ? html` <rs-analytics-model
                        .hass=${this.hass}
                        .data=${this._data}
                        .language=${l}
                        .controlMode=${this.controlMode}
                        .managed=${!this.rooms[this._selectedRoom]?.temperature_sensor}
                        .canHeat=${flags.canHeat}
                        .canCool=${flags.canCool}
                        .boostHours=${boostHoursLeft(
                          this.rooms[this._selectedRoom]?.live?.boost_applied_at,
                          this.rooms[this._selectedRoom]?.live?.n_observations,
                        )}
                      ></rs-analytics-model>`
                    : nothing
                }
                ${this._renderHumidityModel()}
              `
          : html`
              <div class="no-data">
                <ha-icon
                  icon="mdi:chart-line"
                  style="--mdc-icon-size: 48px; opacity: 0.4"
                ></ha-icon>
                <p>${localize("analytics.select_room", l)}</p>
              </div>
            `
      }
    `;
  }

  private _renderSummary() {
    const room = this.rooms[this._selectedRoom];
    if (!room || room.is_outdoor) return nothing;
    const flags = roomFlags(room);
    return html`<rs-analytics-summary
      .hass=${this.hass}
      .stats=${this._data?.stats ?? null}
      .points=${this._points()}
      .rangeStart=${this._rangeStart}
      .rangeEnd=${this._rangeEnd}
      .bandSides=${bandSides(room.climate_mode)}
      .canHeat=${flags.canHeat}
      .canCool=${flags.canCool}
      .hasWindowSensor=${flags.hasWindowSensor}
      .hasHumidityControl=${flags.hasHumidityControl}
      .showPrice=${flags.followsPrice}
      .language=${this.hass.language}
    ></rs-analytics-summary>`;
  }

  private _renderHumidityModel() {
    const hm = this._data?.humidity_model;
    if (!hm) return nothing;
    const isPl = (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
    const t = (pl: string, en: string) => (isPl ? pl : en);
    const pct = Math.round((hm.confidence ?? 0) * 100);
    return html`
      <rs-list-card
        class="hum-model-card"
        .heading=${t("Model nawilżania (MPC)", "Humidification MPC Model")}
      >
        <div class="hum-model-body">
          <div class="hum-model-badge ${hm.mpc_active ? "active" : ""}">
            <ha-icon icon="mdi:water-percent"></ha-icon>
            ${
              hm.mpc_active
                ? t("MPC nawilżania AKTYWNE", "Humidity MPC ACTIVE")
                : t("Uczenie modelu nawilżania", "Humidity MPC learning")
            }
          </div>
          <div class="hum-model-grid">
            <div class="hum-stat">
              <span class="hum-stat-label">${t("Pewność modelu", "Confidence")}</span>
              <span class="hum-stat-val">${formatPercent(pct, this.hass)}</span>
            </div>
            <div class="hum-stat">
              <span class="hum-stat-label">${t("Obserwacje", "Observations")}</span>
              <span class="hum-stat-val">${formatNumber(hm.n_observations, this.hass, 0)}</span>
            </div>
            <div class="hum-stat">
              <span class="hum-stat-label">${t("Próbki nawilżania", "Humidifying samples")}</span>
              <span class="hum-stat-val">${formatNumber(hm.n_humidifying, this.hass, 0)}</span>
            </div>
            <div class="hum-stat">
              <span class="hum-stat-label">${t("Próbki osuszania", "Dehumidifying samples")}</span>
              <span class="hum-stat-val">${formatNumber(hm.n_dehumidifying, this.hass, 0)}</span>
            </div>
          </div>
        </div>
      </rs-list-card>
    `;
  }

  /** History and detail as loaded; one array per answer so the summary does not redraw needlessly. */
  private _points(): AnalyticsDataPoint[] {
    const data = this._data;
    if (!data) return [];
    if (this._pointsOf !== data) {
      this._pointsOf = data;
      this._pointsCache = [...data.history, ...data.detail];
    }
    return this._pointsCache;
  }

  private _onRoomSelected(e: CustomEvent) {
    const areaId = e.detail.areaId;
    if (areaId && areaId !== this._selectedRoom) {
      this._selectedRoom = areaId;
      this.dispatchEvent(
        new CustomEvent("room-selected", {
          detail: { areaId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _onRangeChanged(e: CustomEvent) {
    const { activeQuick, rangeStart, rangeEnd, chartAnchor } = e.detail;
    this._activeQuick = activeQuick;
    this._rangeStart = rangeStart;
    this._rangeEnd = rangeEnd;
    this._chartAnchor = chartAnchor;
  }

  /** Recompute the active quick range up to now (today moves on, a new day starts at midnight). */
  private _applyQuickRange() {
    const days = this._activeQuick ? QUICK_RANGE_DAYS[this._activeQuick] : undefined;
    if (!days) return;
    const { start, end } = quickRange(days, haTimeZone(this.hass));
    this._rangeStart = start;
    this._rangeEnd = end;
  }

  private async _onDaySelected(e: CustomEvent<string>) {
    const now = Date.now();
    const zone = haTimeZone(this.hass);
    const start = startOfDayInZone(e.detail, zone);
    const today = e.detail === isoDateInZone(now, zone);
    this._activeQuick = today ? "24h" : null;
    this._rangeStart = start;
    // The day's last second: midnight of the next day minus one, found via noon (DST)
    const end = startOfDayInZone(isoDateInZone(start + 36 * 3600_000, zone), zone) - 1000;
    this._rangeEnd = today ? now : end;
    this._chartAnchor = this._rangeEnd;
    await this.updateComplete;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderRoot
      .querySelector("rs-analytics-chart")
      ?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }

  private _buildWsParams(): Record<string, unknown> {
    return {
      type: "roommind/analytics/get",
      area_id: this._selectedRoom,
      start_ts: this._rangeStart / 1000,
      end_ts: this._rangeEnd / 1000,
    };
  }

  private async _fetchData() {
    if (!this._selectedRoom) return;
    const fetchId = ++this._fetchId;
    this._loading = true;
    // Same room: the old data stays up, so a new range does not reset scroll and open views
    if (this._dataRoom !== this._selectedRoom) this._data = null;
    this._dataRoom = this._selectedRoom;
    this._chartAnchor = this._rangeEnd;

    try {
      const result = await this.hass.callWS<AnalyticsData>(this._buildWsParams());
      if (fetchId === this._fetchId) this._data = result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[RoomMind] fetchData:", err);
      if (fetchId === this._fetchId) this._data = null;
    } finally {
      if (fetchId === this._fetchId) this._loading = false;
    }
  }

  private async _silentRefresh() {
    if (!this._selectedRoom || this._loading) return;
    if (this._activeQuick) {
      // A new end (and after midnight a new start) refetches through willUpdate; same room,
      // so the data stays up meanwhile and _fetchId drops answers that come too late
      this._applyQuickRange();
      return;
    }
    const fetchId = this._fetchId;
    const room = this._selectedRoom;
    try {
      const result = await this.hass.callWS<AnalyticsData>(this._buildWsParams());
      if (fetchId !== this._fetchId || room !== this._selectedRoom) return;
      this._data = result;
      this._chartAnchor = Date.now();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[RoomMind] silentRefresh:", err);
    }
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      rs-analytics-chart {
        scroll-margin-top: 120px;
      }

      .hum-model-card {
        display: block;
        margin-bottom: var(--rs-space-4);
      }

      .hum-model-body {
        padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-3);
      }

      .hum-model-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
        --mdc-icon-size: 16px;
      }

      .hum-model-badge.active {
        background: color-mix(in srgb, var(--rs-humidify) 16%, transparent);
        color: var(--rs-humidify-text);
      }

      .hum-model-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px;
      }

      .hum-stat {
        padding: 10px 12px;
        border-radius: var(--rs-radius-sm);
        background: var(--rs-fill);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .hum-stat-label {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .hum-stat-val {
        font-size: 17px;
        font-weight: 500;
        color: var(--rs-humidify-text);
        font-variant-numeric: tabular-nums;
      }

      .no-data {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px 16px;
        text-align: center;
        color: var(--secondary-text-color);
      }

      .no-data p {
        font-size: 15px;
        max-width: 400px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 80px 16px;
        color: var(--secondary-text-color);
        font-size: 14px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics": RsAnalytics;
  }
}
