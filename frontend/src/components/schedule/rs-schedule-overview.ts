/**
 * rs-schedule-overview – Every Home Assistant schedule helper with the rooms that use it,
 * grouped by schedule kind: Heating/Temperature, AC (Cooling), Humidification, Ventilation, and Covers.
 * Admins can create new schedules of any kind directly here.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig } from "../../types";
import { localize } from "../../utils/localize";
import { isAdmin } from "../../utils/schedule-api";
import { formatClock, haTimeZone, sameDayInZone } from "../../utils/analytics-time";
import { openEntityInfo } from "../../utils/events";
import { roomNameOf, usageText, type ScheduleKind } from "../../utils/schedule-usage";
import { tokens } from "../../styles/tokens";
import "../shared/rs-list-card";
import "../shared/rs-list-row";
import "./rs-schedule-create";
import "../shared/rs-segmented";

interface ScheduleItem {
  entityId: string;
  name: string;
  rooms: string[];
  acRooms: string[];
  humidityRooms: string[];
  ventilationRooms: string[];
  coverRooms: string[];
}

const KIND_ICON: Record<ScheduleKind, string> = {
  climate: "mdi:calendar-clock",
  ac: "mdi:snowflake",
  humidity: "mdi:air-humidifier",
  ventilation: "mdi:fan",
  cover: "mdi:blinds",
};

@customElement("rs-schedule-overview")
export class RsScheduleOverview extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};

  @state() private _creating = false;
  @state() private _createKind: ScheduleKind = "climate";

  private get _isPl(): boolean {
    return (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  private _items(): ScheduleItem[] {
    const lang = this.hass.language;
    const roomName = (id: string) =>
      this.rooms[id]?.display_name || this.hass.areas?.[id]?.name || id;
    return Object.keys(this.hass.states)
      .filter((id) => id.startsWith("schedule."))
      .map((entityId) => {
        const uses = (list: { entity_id: string }[] | undefined) =>
          (list ?? []).some((s) => s.entity_id === entityId);
        const rooms = Object.values(this.rooms);
        return {
          entityId,
          name: (this.hass.states[entityId].attributes?.friendly_name as string) || entityId,
          rooms: rooms.filter((r) => uses(r.schedules)).map((r) => roomName(r.area_id)),
          acRooms: rooms.filter((r) => uses(r.ac_schedules)).map((r) => roomName(r.area_id)),
          humidityRooms: rooms
            .filter((r) => uses(r.humidity_schedules))
            .map((r) => roomName(r.area_id)),
          ventilationRooms: rooms
            .filter((r) => uses(r.ventilation_schedules))
            .map((r) => roomName(r.area_id)),
          coverRooms: rooms.filter((r) => uses(r.cover_schedules)).map((r) => roomName(r.area_id)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, lang));
  }

  render() {
    const l = this.hass.language;
    const items = this._items();
    const acOnly = items.filter((i) => i.acRooms.length && !i.rooms.length);
    const humOnly = items.filter(
      (i) => i.humidityRooms.length && !i.rooms.length && !acOnly.includes(i),
    );
    const ventOnly = items.filter(
      (i) =>
        i.ventilationRooms.length &&
        !i.rooms.length &&
        !acOnly.includes(i) &&
        !humOnly.includes(i),
    );
    const covers = items.filter(
      (i) =>
        i.coverRooms.length &&
        !i.rooms.length &&
        !acOnly.includes(i) &&
        !humOnly.includes(i) &&
        !ventOnly.includes(i),
    );
    const special = new Set([...acOnly, ...humOnly, ...ventOnly, ...covers]);
    const rooms = items.filter((i) => !special.has(i));

    return html`
      <rs-list-card .heading=${localize("schedules.rooms_title", l)}>
        ${
          rooms.length
            ? rooms.map((i) => this._renderRow(i, "climate"))
            : html`<p class="empty">${localize("schedules.empty", l)}</p>`
        }
        ${isAdmin(this.hass) ? this._renderCreate() : nothing}
      </rs-list-card>
      ${
        acOnly.length
          ? html`<rs-list-card .heading=${this._t("Klimatyzacja (AC)", "Air Conditioning (AC)")}>
              ${acOnly.map((i) => this._renderRow(i, "ac"))}
            </rs-list-card>`
          : nothing
      }
      ${
        humOnly.length
          ? html`<rs-list-card .heading=${this._t("Nawilżanie i osuszanie", "Humidification & Dehumidification")}>
              ${humOnly.map((i) => this._renderRow(i, "humidity"))}
            </rs-list-card>`
          : nothing
      }
      ${
        ventOnly.length
          ? html`<rs-list-card .heading=${this._t("Wentylacja / Rekuperacja", "Ventilation")}>
              ${ventOnly.map((i) => this._renderRow(i, "ventilation"))}
            </rs-list-card>`
          : nothing
      }
      ${
        covers.length
          ? html`<rs-list-card .heading=${localize("schedules.covers_title", l)}>
              ${covers.map((i) => this._renderRow(i, "cover"))}
            </rs-list-card>`
          : nothing
      }
      <p class="note">${localize("schedules.note", l)}</p>
    `;
  }

  private _renderRow(item: ScheduleItem, kind: ScheduleKind) {
    const l = this.hass.language;
    const used = usageText(
      this.rooms,
      item.entityId,
      kind,
      roomNameOf(this.rooms, this.hass.areas),
      l,
    );
    const on = this.hass.states[item.entityId]?.state === "on";
    const openKind: "" | ScheduleKind =
      kind === "climate" && !item.rooms.length ? "" : kind;
    return html`<rs-list-row
      clickable
      chevron
      wrap
      icon=${KIND_ICON[kind]}
      icon-label=${localize("detail.more_info", l)}
      .iconColor=${on ? "var(--primary-color)" : ""}
      .heading=${item.name}
      .secondary=${[used || localize("schedules.unused", l), this._stateText(item.entityId)]
        .filter(Boolean)
        .join(" · ")}
      @row-click=${() => this._open(item.entityId, openKind)}
      @icon-click=${() => this._moreInfo(item.entityId)}
    ></rs-list-row>`;
  }

  /** "On until 22:00", "Off until Mon 06:00"; just on/off without a next change. */
  private _stateText(entityId: string): string {
    const l = this.hass.language;
    const st = this.hass.states[entityId];
    if (!st || (st.state !== "on" && st.state !== "off")) return "";
    const on = st.state === "on";
    const next = Date.parse(String(st.attributes?.next_event ?? ""));
    if (!Number.isFinite(next)) return localize(on ? "schedules.on" : "schedules.off", l);
    const zone = haTimeZone(this.hass);
    const time = sameDayInZone(next, Date.now(), zone)
      ? formatClock(next, l, zone)
      : new Intl.DateTimeFormat(l, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: zone,
        }).format(next);
    return localize(on ? "schedules.on_until" : "schedules.off_until", l, { time });
  }

  private _renderCreate() {
    const l = this.hass.language;
    if (!this._creating) {
      return html`<rs-list-row
        clickable
        plain-icon
        variant="primary"
        icon="mdi:plus"
        .heading=${localize("schedule_editor.create", l)}
        @row-click=${() => (this._creating = true)}
      ></rs-list-row>`;
    }
    return html`<div class="create">
      <span class="kind-label">${localize("schedules.kind_label", l)}</span>
      <rs-segmented
        wrap
        .label=${localize("schedules.kind_label", l)}
        .options=${[
          {
            value: "climate",
            label: localize("schedules.kind_climate", l),
            icon: "mdi:thermometer",
          },
          { value: "ac", label: this._t("Klimatyzacja", "AC"), icon: "mdi:snowflake" },
          { value: "humidity", label: this._t("Nawilżanie", "Humidity"), icon: "mdi:air-humidifier" },
          { value: "ventilation", label: this._t("Wentylacja", "Ventilation"), icon: "mdi:fan" },
          { value: "cover", label: localize("schedules.kind_cover", l), icon: "mdi:blinds" },
        ]}
        .value=${this._createKind}
        @value-changed=${(e: CustomEvent<{ value: string }>) => {
          const v = e.detail.value as ScheduleKind;
          if (v) this._createKind = v;
        }}
      ></rs-segmented>
      <rs-schedule-create
        .hass=${this.hass}
        .kind=${this._createKind}
        @create-cancelled=${() => (this._creating = false)}
        @schedule-created=${(e: CustomEvent<{ entityId: string; kind: ScheduleKind }>) => {
          this._creating = false;
          this._open(e.detail.entityId, e.detail.kind);
        }}
      ></rs-schedule-create>
    </div>`;
  }

  private _open(entityId: string, kind: "" | ScheduleKind) {
    this.dispatchEvent(
      new CustomEvent("open-schedule-editor", {
        detail: { entityId, areaId: "", kind },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _moreInfo(entityId: string) {
    openEntityInfo(this, entityId);
  }

  static styles = [
    tokens,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-4);
        max-width: 760px;
        margin: 0 auto;
      }
      .empty {
        margin: 0;
        padding: var(--rs-space-2) var(--rs-space-4) var(--rs-space-3);
        color: var(--secondary-text-color);
        font-size: var(--rs-font-md);
      }
      .create {
        display: flex;
        flex-direction: column;
        gap: var(--rs-space-2);
        padding: var(--rs-space-2) var(--rs-space-4) 0;
      }
      .kind-label {
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .note {
        margin: 0;
        padding: 0 var(--rs-space-1);
        font-size: 13px;
        line-height: 1.5;
        color: var(--secondary-text-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-schedule-overview": RsScheduleOverview;
  }
}
