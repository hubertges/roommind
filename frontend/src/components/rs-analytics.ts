/**
 * rs-analytics – Analytics tab orchestrator.
 *
 * Separates Room Analytics ("Pokoje") and Boiler / Heat Plant Analytics ("Piec / Kotłownia")
 * into dedicated sub-tabs so boiler telemetry never clutters individual room views.
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
  HeatPlantsAnalyticsData,
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
import { tokens } from "../styles/tokens";
import "./analytics/rs-analytics-toolbar";
import "./analytics/rs-analytics-summary";
import "./analytics/rs-analytics-chart";
import "./analytics/rs-analytics-rhythm";
import "./analytics/rs-analytics-model";
import "./analytics/rs-analytics-humidity-model";
import "./analytics/rs-analytics-heat-plants";

/** What a room can show: the summary, rhythm, chart and model cards use the same flags. */
function roomFlags(room: RoomConfig | undefined) {
  const canHumidify = Boolean(
    room?.humidifier_entity ||
      room?.humidity_min != null ||
      room?.comfort_humidify != null,
  );
  const canDehumidify = Boolean(
    room?.dehumidifier_entity ||
      room?.humidity_max != null ||
      room?.comfort_dehumidify != null ||
      (room?.ac_dry_enabled !== false && (room?.devices ?? []).some((d) => d.type === "ac")),
  );
  return {
    canHeat: room?.climate_mode !== "cool_only",
    canCool:
      room?.climate_mode !== "heat_only" && (room?.devices ?? []).some((d) => d.type === "ac"),
    hasWindowSensor: (room?.window_sensors?.length ?? 0) > 0,
    canHumidify,
    canDehumidify,
    hasHumidityControl: Boolean(
      room?.humidifier_entity ||
        room?.dehumidifier_entity ||
        room?.humidity_min != null ||
        room?.humidity_max != null ||
        room?.comfort_humidify != null ||
        room?.comfort_dehumidify != null ||
        (room?.humidity_schedules?.length ?? 0) > 0,
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

const BOILER_QUICK_RANGES: Array<{ key: string; labelPl: string; labelEn: string }> = [
  { key: "24h", labelPl: "Dziś (24h)", labelEn: "Today (24h)" },
  { key: "2d", labelPl: "2 dni", labelEn: "2 days" },
  { key: "7d", labelPl: "7 dni", labelEn: "7 days" },
  { key: "14d", labelPl: "14 dni", labelEn: "14 days" },
  { key: "30d", labelPl: "30 dni", labelEn: "30 days" },
];

@customElement("rs-analytics")
export class RsAnalytics extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Object }) public rooms: Record<string, RoomConfig> = {};
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};
  @property() public initialRoom = "";
  @property() public controlMode: "mpc" | "bangbang" = "mpc";

  @state() private _section: "rooms" | "boiler" = "rooms";
  @state() private _selectedRoom = "";
  // Browser midnight until hass is known, then today in HA's zone (willUpdate)
  @state() private _rangeStart: number = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  @state() private _rangeEnd: number = Date.now();
  @state() private _data: AnalyticsData | null = null;
  @state() private _boilerData: HeatPlantsAnalyticsData | null = null;
  @state() private _chartAnchor: number = Date.now();
  @state() private _loading = false;
  @state() private _boilerLoading = false;
  @state() private _activeQuick: string | null = "24h";

  private _refreshInterval?: ReturnType<typeof setInterval>;
  private _dataRoom = "";
  private _pointsOf: AnalyticsData | null = null;
  private _pointsCache: AnalyticsDataPoint[] = [];
  private _fetchId = 0;
  private _boilerFetchId = 0;
  private _zoneApplied = false;

  private get _isPl(): boolean {
    return (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

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
      this._section = "rooms";
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
    const rangeChanged = changedProps.has("_rangeStart") || changedProps.has("_rangeEnd");
    if (this._section === "rooms") {
      if (autoSelected || changedProps.has("_selectedRoom") || changedProps.has("_section") || rangeChanged) {
        if (this._selectedRoom) {
          this._fetchData();
        }
      }
    } else if (changedProps.has("_section") || rangeChanged) {
      this._fetchBoilerData();
    }
  }

  private _hasBoilerWarnings(): boolean {
    for (const p of this.heatPlants) {
      const lv = this.heatPlantsLive[p.id];
      if (!lv) continue;
      if (
        (lv.warnings && lv.warnings.length > 0) ||
        lv.overheat_protect ||
        lv.feeder_overheat_warning ||
        lv.refill_needed ||
        lv.ash_clean_needed ||
        lv.chimney_clean_needed
      ) {
        return true;
      }
    }
    return false;
  }

  protected render() {
    const hasPlants = this.heatPlants.length > 0;
    const boilerAlert = this._hasBoilerWarnings();

    return html`
      ${
        hasPlants
          ? html`
              <div class="subtab-bar" role="tablist">
                <button
                  type="button"
                  role="tab"
                  class="subtab ${this._section === "rooms" ? "active" : ""}"
                  aria-selected=${this._section === "rooms" ? "true" : "false"}
                  @click=${() => {
                    this._section = "rooms";
                  }}
                >
                  <ha-icon icon="mdi:home-analytics"></ha-icon>
                  <span>${this._t("Pokoje", "Rooms")}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  class="subtab ${this._section === "boiler" ? "active" : ""}"
                  aria-selected=${this._section === "boiler" ? "true" : "false"}
                  @click=${() => {
                    this._section = "boiler";
                  }}
                >
                  <ha-icon icon="mdi:fire"></ha-icon>
                  <span>${this._t("Piec / Kotłownia", "Boiler / Heat Plants")}</span>
                  <span class="subtab-count">${this.heatPlants.length}</span>
                  ${boilerAlert ? html`<span class="subtab-alert" aria-hidden="true"></span>` : nothing}
                </button>
              </div>
            `
          : nothing
      }
      ${this._section === "boiler" && hasPlants ? this._renderBoilerTab() : this._renderRoomsTab()}
    `;
  }

  private _renderBoilerTab() {
    const plants = this._boilerData?.heat_plants ?? this.heatPlants;
    const plantsLive = this._boilerData?.heat_plants_live ?? this.heatPlantsLive;
    const plantsHistory = this._boilerData?.heat_plants_history ?? {};
    const outdoorTemp = this._boilerData?.outdoor_temp ?? null;

    return html`
      <div class="boiler-toolbar">
        <div class="boiler-ranges" role="group">
          ${BOILER_QUICK_RANGES.map(
            (r) => html`
              <button
                type="button"
                class="range-chip ${this._activeQuick === r.key ? "active" : ""}"
                @click=${() => this._selectBoilerQuick(r.key)}
              >
                ${this._isPl ? r.labelPl : r.labelEn}
              </button>
            `,
          )}
        </div>
        <button
          type="button"
          class="refresh-btn"
          ?disabled=${this._boilerLoading}
          @click=${() => this._fetchBoilerData()}
        >
          <ha-icon icon="mdi:refresh"></ha-icon>
          <span>${this._t("Odśwież", "Refresh")}</span>
        </button>
      </div>
      ${
        this._boilerLoading && !this._boilerData
          ? html`<div class="loading">${localize("panel.loading", this.hass.language)}</div>`
          : html`
              <rs-analytics-heat-plants
                .hass=${this.hass}
                .heatPlants=${plants}
                .heatPlantsLive=${plantsLive}
                .heatPlantsHistory=${plantsHistory}
                .outdoorTemp=${outdoorTemp}
                .rangeStart=${this._rangeStart}
                .rangeEnd=${this._rangeEnd}
                @heat-plants-updated=${() => this._fetchBoilerData()}
              ></rs-analytics-heat-plants>
            `
      }
    `;
  }

  private _renderRoomsTab() {
    const l = this.hass.language;
    const room = this.rooms[this._selectedRoom];
    const flags = roomFlags(room);

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
                  .isOutdoor=${room?.is_outdoor ?? false}
                  .targetBand=${bandSides(room?.climate_mode)}
                  .showPrice=${flags.followsPrice}
                ></rs-analytics-chart>
                ${
                  !room?.is_outdoor
                    ? html`<rs-analytics-rhythm
                        .hass=${this.hass}
                        .rhythm=${this._data?.rhythm ?? null}
                        .rangeStart=${this._rangeStart}
                        .rangeEnd=${this._rangeEnd}
                        .language=${l}
                        .canHeat=${flags.canHeat}
                        .canCool=${flags.canCool}
                        .hasWindowSensor=${flags.hasWindowSensor}
                        .bandSides=${bandSides(room?.climate_mode)}
                        @day-selected=${this._onDaySelected}
                      ></rs-analytics-rhythm>`
                    : nothing
                }
                ${
                  !room?.is_outdoor
                    ? html`<rs-analytics-model
                        .hass=${this.hass}
                        .data=${this._data}
                        .language=${l}
                        .controlMode=${this.controlMode}
                        .managed=${!room?.temperature_sensor}
                        .canHeat=${flags.canHeat}
                        .canCool=${flags.canCool}
                        .boostHours=${boostHoursLeft(
                          room?.live?.boost_applied_at,
                          room?.live?.n_observations,
                        )}
                      ></rs-analytics-model>`
                    : nothing
                }
                ${
                  !room?.is_outdoor && this._data?.humidity_model
                    ? html`<rs-analytics-humidity-model
                        .hass=${this.hass}
                        .data=${this._data}
                        .language=${l}
                        .controlMode=${this.controlMode}
                        .canHumidify=${flags.canHumidify}
                        .canDehumidify=${flags.canDehumidify}
                      ></rs-analytics-humidity-model>`
                    : nothing
                }
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

  private _selectBoilerQuick(key: string) {
    this._activeQuick = key;
    this._applyQuickRange();
    this._chartAnchor = this._rangeEnd;
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

  private async _fetchBoilerData() {
    const fetchId = ++this._boilerFetchId;
    this._boilerLoading = true;
    try {
      const result = await this.hass.callWS<HeatPlantsAnalyticsData>({
        type: "roommind/heat_plants/analytics",
        start_ts: this._rangeStart / 1000,
        end_ts: this._rangeEnd / 1000,
      });
      if (fetchId === this._boilerFetchId) this._boilerData = result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[RoomMind] fetchBoilerData:", err);
    } finally {
      if (fetchId === this._boilerFetchId) this._boilerLoading = false;
    }
  }

  private async _silentRefresh() {
    if (this._section === "boiler") {
      if (this._boilerLoading) return;
      if (this._activeQuick) {
        this._applyQuickRange();
        return;
      }
      await this._fetchBoilerData();
      return;
    }
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

      .subtab-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: var(--rs-space-4);
        padding: 4px;
        border-radius: 12px;
        background: var(--rs-fill);
        width: fit-content;
      }

      .subtab {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 8px 16px;
        border: none;
        border-radius: 9px;
        background: transparent;
        color: var(--secondary-text-color);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition:
          background 0.15s,
          color 0.15s;
      }

      .subtab:hover {
        color: var(--primary-text-color);
      }

      .subtab.active {
        background: var(--card-background-color, var(--primary-background-color));
        color: var(--primary-text-color);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }

      .subtab-count {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--rs-fill);
        color: var(--secondary-text-color);
      }

      .subtab.active .subtab-count {
        background: var(--rs-fill-primary);
        color: var(--primary-color);
      }

      .subtab-alert {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--rs-err);
      }

      .boiler-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: var(--rs-space-4);
      }

      .boiler-ranges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .range-chip {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }

      .range-chip.active {
        border-color: var(--primary-color);
        background: var(--rs-fill-primary);
        color: var(--primary-color);
      }

      .refresh-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: transparent;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        --mdc-icon-size: 16px;
      }

      .refresh-btn:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      rs-analytics-chart {
        scroll-margin-top: 120px;
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
