/**
 * rs-settings-compressor – Compressor protection group management.
 */
import { html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  CompressorGroup,
  ConflictResolution,
  MasterOffMode,
  HeatPlantConfig,
  HeatPlantLive,
  BoilerMode,
} from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import { fireSaveStatus, getSelectValue } from "../../utils/events";
import "../shared/rs-confirm-button";
import "../shared/rs-icon-button";
import "../shared/rs-edit-dialog";
import { numberRow } from "../shared/number-row";
import "../shared/rs-list-row";
import "../shared/rs-field";
import "../shared/rs-info-icon";
import "../shared/rs-segmented";
import { inputStyles } from "../../styles/input-styles";
import { formStyles } from "../../styles/form-styles";
import { formatTempLocale, tempUnit, toCelsius } from "../../utils/temperature";
import { alertStyles } from "../../styles/tokens";
import { RsSettingsBase } from "./rs-settings-base";

/**
 * Why a group cannot be saved yet, mirroring the backend checks of settings/save: a group needs a
 * member, a device belongs to one group, a main device is no member and drives one group.
 * Groups with a problem stay in the page as drafts and are left out of the save.
 */
export function compressorGroupProblem(
  group: CompressorGroup,
  groups: readonly CompressorGroup[],
): TranslationKey | null {
  if (group.members.length === 0) return "compressor.draft_no_members";
  const others = groups.filter((g) => g !== group);
  if (group.members.some((m) => others.some((g) => g.members.includes(m))))
    return "error.duplicate_member";
  const master = group.master_entity;
  if (master) {
    if (group.members.includes(master)) return "error.master_in_members";
    if (others.some((g) => g.members.includes(master))) return "error.master_is_other_member";
    if (others.some((g) => g.master_entity === master)) return "error.duplicate_master";
  }
  return null;
}

/** A main device gets a mode (climate) or is turned on and off (switch, input_boolean). */
const MASTER_DOMAINS = ["climate", "switch", "input_boolean"];

@customElement("rs-settings-compressor")
export class RsSettingsCompressor extends RsSettingsBase {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Array }) public compressorGroups: CompressorGroup[] = [];
  @property({ attribute: false }) public heatPlants: HeatPlantConfig[] = [];
  @property({ attribute: false }) public heatPlantsLive: Record<string, HeatPlantLive> = {};

  /** Id of the group whose dialog is open. */
  @state() private _editId: string | null = null;
  /** Id of the boiler/heat plant whose quick-settings dialog is open. */
  @state() private _editPlantId: string | null = null;

  private get _isPl(): boolean {
    return (this.hass?.language ?? "en").toLowerCase().startsWith("pl");
  }

  private _t(pl: string, en: string): string {
    return this._isPl ? pl : en;
  }

  static styles = [
    ...RsSettingsBase.settingsBaseStyles,
    alertStyles,
    inputStyles,
    formStyles,
    css`
      .dialog-body {
        --rs-form-inline: var(--rs-space-6);
      }
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
      .members {
        display: flex;
        flex-direction: column;
      }
      .delete-row {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--rs-space-6);
      }
      .draft-note {
        margin: 0;
        font-size: var(--rs-font-sm);
        line-height: 1.4;
        color: var(--secondary-text-color);
      }
      .group-problem {
        margin: 0 0 var(--rs-space-2);
      }
      .rs-alert {
        margin: 0;
      }
      ha-textfield,
      ha-select {
        width: 100%;
      }
    `,
  ];

  render() {
    const l = this.hass.language;
    const groups = this.compressorGroups;
    const editing = groups.findIndex((g) => g.id === this._editId);
    const editingPlant = this.heatPlants.find((p) => p.id === this._editPlantId);

    return html`
      <!-- Section 1: Boilers & Heat Plants -->
      <div class="settings-section first">
        <h3 class="subsection-heading">
          <ha-icon icon="mdi:fire"></ha-icon>
          <span>${this._t("Piece i źródła ciepła (Kotłownia)", "Boilers & Heat Plants")}</span>
        </h3>
        ${
          this.heatPlants.length > 0
            ? this.heatPlants.map((plant) => this._renderPlantRow(plant))
            : html`<p class="draft-note">
                ${this._t(
                  "Brak skonfigurowanych pieców / źródeł ciepła. Otwórz panel Kotłownia, aby dodać piec na ekogroszek, kocioł gazowy, kominek lub pompę ciepła.",
                  "No boilers or heat plants configured yet. Open the Boiler Room tab to add a boiler, fireplace, or heat pump.",
                )}
              </p>`
        }
        <rs-list-row
          clickable
          plain-icon
          chevron
          variant="primary"
          icon="mdi:fire-circle"
          .heading=${this._t(
            "Otwórz pełną konfigurację kotłowni i czujników pieca",
            "Open full Boiler Room & sensor configuration",
          )}
          .secondary=${this._t(
            "Czujniki sterownika, kaloryfery, zasypy worków, pompy C.O./CWU i powiadomienia",
            "Controller sensors, radiator loss sensors, fuel refills, pumps & alerts",
          )}
          @row-click=${() =>
            this.dispatchEvent(
              new CustomEvent("open-heat-plants", { bubbles: true, composed: true }),
            )}
        ></rs-list-row>
      </div>

      <!-- Section 2: Shared Compressor / Outdoor Unit Groups -->
      <div class="settings-section">
        <h3 class="subsection-heading">
          <ha-icon icon="mdi:heat-pump-outline"></ha-icon>
          <span>${this._t("Grupy wspólnego agregatu / sterowania nadrzędnego", "Shared Outdoor Unit / Compressor Groups")}</span>
        </h3>
        ${groups.map((group, idx) => this._renderGroupRow(group, idx))}
        <rs-list-row
          clickable
          plain-icon
          variant="primary"
          icon="mdi:plus"
          .heading=${localize("compressor.add_group", l)}
          .secondary=${groups.length ? "" : localize("compressor.no_groups", l)}
          @row-click=${this._addGroup}
        ></rs-list-row>
      </div>

      ${editing >= 0 ? this._renderDialog(groups[editing], editing) : nothing}
      ${editingPlant ? this._renderPlantQuickDialog(editingPlant) : nothing}
    `;
  }

  private _renderPlantRow(plant: HeatPlantConfig) {
    const lv = this.heatPlantsLive[plant.id];
    const unit = tempUnit(this.hass);
    const parts: string[] = [];
    if (lv?.supply_temp != null) {
      parts.push(
        `${this._t("Kocioł", "Boiler")}: ${formatTempLocale(lv.supply_temp, this.hass, 1, 1)} / ${formatTempLocale(plant.target_supply_temp, this.hass, 0, 1)}${unit}`,
      );
    } else {
      parts.push(
        `${this._t("Zadana", "Target")}: ${formatTempLocale(plant.target_supply_temp, this.hass, 0, 1)}${unit}`,
      );
    }
    if (plant.dhw_temp_sensor || lv?.dhw_temp != null) {
      parts.push(
        `CWU: ${lv?.dhw_temp != null ? formatTempLocale(lv.dhw_temp, this.hass, 1, 1) : "—"} / ${formatTempLocale(plant.dhw_target_temp, this.hass, 0, 1)}${unit}`,
      );
    }
    const radCount = plant.radiator_sensors?.length ?? 0;
    if (radCount > 0) {
      parts.push(`${radCount} ${this._t("czujn. kaloryferów", "radiator sensors")}`);
    }
    const warnCount = lv?.warnings?.length ?? 0;
    if (warnCount > 0) {
      parts.push(`⚠ ${warnCount} ${this._t("ostrzeżeń", "warnings")}`);
    }
    return html`
      <rs-list-row
        clickable
        chevron
        icon=${plant.plant_type === "fireplace" ? "mdi:fireplace" : "mdi:water-boiler"}
        .heading=${plant.name || plant.id}
        .secondary=${parts.join(" · ")}
        .status=${plant.enabled ? "on" : "off"}
        .variant=${warnCount > 0 ? "warn" : "default"}
        @row-click=${() => (this._editPlantId = plant.id)}
      ></rs-list-row>
    `;
  }

  private _renderPlantQuickDialog(plant: HeatPlantConfig) {
    const unit = tempUnit(this.hass);
    return html`<rs-edit-dialog
      open
      icon="mdi:fire"
      .heading=${`${plant.name} — ${this._t("Nastawy i ostrzeżenia pieca", "Boiler Setpoints & Warnings")}`}
      @rs-dialog-closed=${() => (this._editPlantId = null)}
    >
      <div class="dialog-body">
        <section class="group">
          <rs-field .label=${this._t("Tryb pracy pieca", "Boiler operating mode")}>
            <rs-segmented
              wrap
              .label=${this._t("Tryb pracy", "Boiler mode")}
              .options=${[
                { value: "auto", label: this._t("Auto", "Auto") },
                { value: "heating", label: this._t("Zima / Grzanie", "Winter") },
                { value: "summer_dhw_only", label: this._t("Lato (CWU)", "Summer (DHW)") },
                { value: "hold", label: this._t("Podtrzymanie", "Hold") },
              ]}
              .value=${plant.boiler_mode ?? "auto"}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                void this._savePlantPatch(plant.id, { boiler_mode: e.detail.value as BoilerMode })}
            ></rs-segmented>
          </rs-field>

          ${numberRow({
            hass: this.hass,
            label: this._t("Zadana temperatura kotła (C.O.)", "Target boiler supply temperature"),
            unit,
            min: 20,
            max: 88,
            value: plant.target_supply_temp,
            onChange: (v) => void this._savePlantPatch(plant.id, { target_supply_temp: v }),
          })}
          ${numberRow({
            hass: this.hass,
            label: this._t("Temperatura w podtrzymaniu / czuwaniu", "Fire-hold / idle temperature"),
            unit,
            min: 15,
            max: 75,
            value: plant.idle_supply_temp,
            onChange: (v) => void this._savePlantPatch(plant.id, { idle_supply_temp: v }),
          })}
          ${numberRow({
            hass: this.hass,
            label: this._t("Zadana temperatura CWU", "Target DHW temperature"),
            unit,
            min: 30,
            max: 75,
            value: plant.dhw_target_temp,
            onChange: (v) => void this._savePlantPatch(plant.id, { dhw_target_temp: v }),
          })}
        </section>

        <section class="group">
          <h3 class="group-title">${this._t("Ostrzeżenia i powiadomienia pieca", "Boiler Warnings & Alerts")}</h3>
          <rs-list-row
            switch
            wrap
            .heading=${this._t("Powiadomienia o ostrzeżeniach pieca", "Send boiler warning notifications")}
            .checked=${plant.notify_warnings_enabled ?? true}
            @toggle-changed=${(e: CustomEvent<boolean>) =>
              void this._savePlantConfigPatch(plant.id, { notify_warnings_enabled: e.detail })}
          ></rs-list-row>
          ${numberRow({
            hass: this.hass,
            label: this._t("Alarm temp. podajnika (cofnięcie żaru)", "Feeder burn-back alarm temp"),
            unit,
            min: 35,
            max: 95,
            value: plant.feeder_max_temp ?? 60,
            onChange: (v) => void this._savePlantConfigPatch(plant.id, { feeder_max_temp: v }),
          })}
          ${numberRow({
            hass: this.hass,
            label: this._t("Alarm temp. spalin", "High flue temp alarm"),
            unit,
            min: 100,
            max: 450,
            value: plant.flue_max_temp ?? 220,
            onChange: (v) => void this._savePlantConfigPatch(plant.id, { flue_max_temp: v }),
          })}
          ${numberRow({
            hass: this.hass,
            label: this._t("Ostrzeżenie strat przesyłu na rurach", "Pipe distribution loss warning"),
            unit: "%",
            min: 5,
            max: 60,
            value: plant.distribution_loss_alert_pct ?? 20,
            onChange: (v) =>
              void this._savePlantConfigPatch(plant.id, { distribution_loss_alert_pct: v }),
          })}
        </section>
      </div>
    </rs-edit-dialog>`;
  }

  private async _savePlantPatch(
    plantId: string,
    payload: {
      target_supply_temp?: number;
      idle_supply_temp?: number;
      dhw_target_temp?: number;
      boiler_mode?: BoilerMode;
    },
  ) {
    this.heatPlants = this.heatPlants.map((p) => (p.id === plantId ? { ...p, ...payload } : p));
    fireSaveStatus(this, "saving");
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

  private async _savePlantConfigPatch(plantId: string, patch: Partial<HeatPlantConfig>) {
    const next = this.heatPlants.map((p) => (p.id === plantId ? { ...p, ...patch } : p));
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

  private _groupLabel(group: CompressorGroup, idx: number): string {
    return group.name || `${localize("compressor.group", this.hass.language)} ${idx + 1}`;
  }

  /** One group: name, its devices and main device at a glance; the dialog edits it. */
  private _renderGroupRow(group: CompressorGroup, idx: number) {
    const l = this.hass.language;
    const n = group.members.length;
    const parts = [
      n === 1
        ? localize("settings.summary.devices_one", l)
        : localize("settings.summary.devices", l, { count: n }),
    ];
    if (group.master_entity) {
      const name =
        (this.hass.states[group.master_entity]?.attributes?.friendly_name as string) ||
        group.master_entity;
      parts.push(localize("compressor.summary_master", l, { name }));
    }
    if ((group.min_rooms ?? 1) > 1)
      parts.push(localize("compressor.summary_rooms", l, { count: group.min_rooms ?? 1 }));
    const problem = compressorGroupProblem(group, this.compressorGroups);
    return html`
      <rs-list-row
        clickable
        chevron
        icon=${group.master_entity.startsWith("climate.") ? "mdi:water-boiler" : "mdi:hvac"}
        .heading=${this._groupLabel(group, idx)}
        .secondary=${parts.join(" · ")}
        variant=${problem && problem !== "compressor.draft_no_members" ? "warn" : "default"}
        @row-click=${() => (this._editId = group.id)}
      ></rs-list-row>
    `;
  }

  private _renderDialog(group: CompressorGroup, idx: number) {
    const l = this.hass.language;
    const label = this._groupLabel(group, idx);
    return html`<rs-edit-dialog
      open
      icon="mdi:hvac"
      .heading=${label}
      @rs-dialog-closed=${() => (this._editId = null)}
    >
      <div class="dialog-body">
        ${this._renderProblem(group)}
        <section class="group">
          <ha-textfield
            .value=${group.name}
            .label=${localize("compressor.group_name", l)}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              this._updateGroup(idx, "name", v);
            }}
          ></ha-textfield>
        </section>

        <section class="group">
          <h3 class="group-title">
            ${localize("compressor.members", l)}
            <rs-info-icon .text=${localize("compressor.members_hint", l)}></rs-info-icon>
          </h3>
          ${
            group.members.length > 0
              ? html`<div class="members">
                  ${group.members.map((eid) => this._renderMember(eid, idx))}
                </div>`
              : nothing
          }
          <ha-entity-picker
            .hass=${this.hass}
            .value=${""}
            .includeDomains=${["climate"]}
            .entityFilter=${this._memberFilter}
            @value-changed=${(e: CustomEvent) => {
              const v = (e.detail?.value as string) ?? "";
              if (!v) return;
              const updated = [...this.compressorGroups];
              updated[idx] = { ...updated[idx], members: [...updated[idx].members, v] };
              this._fireGroups(updated);
              const picker = e.target as HTMLElement & { value?: string };
              if (picker) picker.value = "";
            }}
          ></ha-entity-picker>
        </section>

        <section class="group">
          <h3 class="group-title">${localize("compressor.section_protection", l)}</h3>
          <div>
            ${numberRow({
              hass: this.hass,
              label: localize("compressor.min_run", l),
              info: localize("compressor.min_run_hint", l),
              unit: localize("compressor.min_run_suffix", l),
              min: 1,
              max: 60,
              value: group.min_run_minutes,
              onChange: (v) => this._updateGroup(idx, "min_run_minutes", v),
            })}
            ${numberRow({
              hass: this.hass,
              label: localize("compressor.min_off", l),
              info: localize("compressor.min_off_hint", l),
              unit: localize("compressor.min_off_suffix", l),
              min: 1,
              max: 30,
              value: group.min_off_minutes,
              onChange: (v) => this._updateGroup(idx, "min_off_minutes", v),
            })}
          </div>
        </section>

        <section class="group">
          <h3 class="group-title">
            ${localize("compressor.master_entity", l)}
            <rs-info-icon .text=${localize("compressor.master_entity_hint", l)}></rs-info-icon>
          </h3>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${group.master_entity || ""}
            .includeDomains=${MASTER_DOMAINS}
            .entityFilter=${this._masterFilter}
            @value-changed=${(e: CustomEvent) => {
              this._updateGroup(idx, "master_entity", (e.detail?.value as string) ?? "");
            }}
          ></ha-entity-picker>
          ${group.master_entity || group.action_script ? this._renderMasterOptions(group, idx) : nothing}
        </section>

        <section class="group">
          <h3 class="group-title">${localize("compressor.section_more", l)}</h3>
          <rs-list-row
            switch
            wrap
            .heading=${localize("compressor.enforce_uniform_mode", l)}
            .checked=${group.enforce_uniform_mode || false}
            @toggle-changed=${(e: CustomEvent<boolean>) => {
              this._updateGroup(idx, "enforce_uniform_mode", e.detail);
            }}
          >
            <rs-info-icon
              slot="end"
              .text=${localize("compressor.enforce_uniform_mode_hint", l)}
            ></rs-info-icon>
          </rs-list-row>
          ${
            group.master_entity || group.enforce_uniform_mode
              ? html`<rs-field .info=${localize("compressor.conflict_resolution_hint", l)}>
                  <ha-select
                    .label=${localize("compressor.conflict_resolution", l)}
                    .value=${group.conflict_resolution || "heating_priority"}
                    .options=${[
                      {
                        value: "heating_priority",
                        label: localize("compressor.conflict_heating_priority", l),
                      },
                      {
                        value: "cooling_priority",
                        label: localize("compressor.conflict_cooling_priority", l),
                      },
                      { value: "majority", label: localize("compressor.conflict_majority", l) },
                      {
                        value: "outdoor_temp",
                        label: localize("compressor.conflict_outdoor_temp", l),
                      },
                    ]}
                    @selected=${(e: Event) => {
                      const v = getSelectValue(e);
                      if (v) this._updateGroup(idx, "conflict_resolution", v);
                    }}
                    @closed=${(e: Event) => e.stopPropagation()}
                    fixedMenuPosition
                  ></ha-select>
                </rs-field>`
              : nothing
          }
          <rs-field .info=${localize("compressor.action_script_hint", l)}>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${group.action_script || ""}
              .includeDomains=${["script"]}
              .label=${localize("compressor.action_script", l)}
              @value-changed=${(e: CustomEvent) => {
                this._updateGroup(idx, "action_script", (e.detail?.value as string) ?? "");
              }}
            ></ha-entity-picker>
          </rs-field>
        </section>

        <div class="delete-row">
          <rs-confirm-button
            destructive
            icon="mdi:delete-outline"
            .label=${localize("compressor.delete", l)}
            .accessibleLabel=${`${localize("compressor.delete", l)}: ${label}`}
            .confirmMessage=${localize("compressor.delete_confirm", l).replace("{name}", label)}
            @confirmed=${() => {
              this._editId = null;
              this._fireGroups(this.compressorGroups.filter((_, i) => i !== idx));
            }}
          ></rs-confirm-button>
        </div>
      </div>
    </rs-edit-dialog>`;
  }

  /** Rooms needed, start delay and run-on; setpoints and how it switches off for a thermostat. */
  private _renderMasterOptions(group: CompressorGroup, idx: number) {
    const l = this.hass.language;
    const thermostat = group.master_entity.startsWith("climate.");
    const setpoints = group.on_temperature != null;
    return html`
      <div>
        ${numberRow({
          hass: this.hass,
          label: localize("compressor.min_rooms", l),
          info: localize("compressor.min_rooms_hint", l),
          min: 1,
          max: 50,
          value: group.min_rooms ?? 1,
          onChange: (v) => this._updateGroup(idx, "min_rooms", v),
        })}
        ${numberRow({
          hass: this.hass,
          label: localize("compressor.start_delay", l),
          info: localize("compressor.start_delay_hint", l),
          unit: "s",
          min: 0,
          max: 3600,
          step: 30,
          value: group.start_delay_seconds ?? 0,
          onChange: (v) => this._updateGroup(idx, "start_delay_seconds", v),
        })}
        ${numberRow({
          hass: this.hass,
          label: localize("compressor.run_on", l),
          info: localize("compressor.run_on_hint", l),
          unit: "s",
          min: 0,
          max: 3600,
          step: 30,
          value: group.run_on_seconds ?? 0,
          onChange: (v) => this._updateGroup(idx, "run_on_seconds", v),
        })}
        ${
          thermostat
            ? html`
                <rs-list-row
                  switch
                  wrap
                  .heading=${localize("compressor.setpoints", l)}
                  .checked=${setpoints}
                  @toggle-changed=${(e: CustomEvent<boolean>) => this._setSetpoints(group, idx, e.detail)}
                >
                  <rs-info-icon
                    slot="end"
                    .text=${localize("compressor.setpoints_hint", l)}
                  ></rs-info-icon>
                </rs-list-row>
                ${
                  setpoints
                    ? html`
                        ${numberRow({
                          hass: this.hass,
                          kind: "temperature",
                          label: localize("compressor.on_temperature", l),
                          info: localize("compressor.on_temperature_hint", l),
                          min: 5,
                          max: 90,
                          value: group.on_temperature ?? 60,
                          onChange: (v) => this._updateGroup(idx, "on_temperature", v),
                        })}
                        ${numberRow({
                          hass: this.hass,
                          kind: "temperature",
                          label: localize("compressor.off_temperature", l),
                          info: localize("compressor.off_temperature_hint", l),
                          min: 5,
                          max: 90,
                          value: group.off_temperature ?? 5,
                          onChange: (v) => this._updateGroup(idx, "off_temperature", v),
                        })}
                      `
                    : nothing
                }
              `
            : nothing
        }
      </div>
      ${
        thermostat && setpoints
          ? html`<rs-field
              .label=${localize("compressor.off_mode", l)}
              .info=${localize("compressor.off_mode_hint", l)}
            >
              <rs-segmented
                wrap
                .label=${localize("compressor.off_mode", l)}
                .options=${[
                  { value: "off", label: localize("compressor.off_mode_off", l) },
                  { value: "temperature", label: localize("compressor.off_mode_temperature", l) },
                ]}
                .value=${group.off_mode ?? "off"}
                @value-changed=${(e: CustomEvent<{ value: string }>) => {
                  if (e.detail.value)
                    this._updateGroup(idx, "off_mode", e.detail.value as MasterOffMode);
                }}
              ></rs-segmented>
            </rs-field>`
          : nothing
      }
    `;
  }

  /** Setpoints on: start from the thermostat's own setpoint and lowest value; off: mode only. */
  private _setSetpoints(group: CompressorGroup, idx: number, on: boolean) {
    const updated = [...this.compressorGroups];
    if (!on) {
      updated[idx] = { ...group, on_temperature: null, off_temperature: null, off_mode: "off" };
    } else {
      const attrs = this.hass.states[group.master_entity]?.attributes ?? {};
      const inRange = (v: unknown, fallback: number) => {
        const c = typeof v === "number" ? toCelsius(v, this.hass) : NaN;
        return c >= 5 && c <= 90 ? Math.round(c * 2) / 2 : fallback;
      };
      updated[idx] = {
        ...group,
        on_temperature: inRange(attrs.temperature, 60),
        off_temperature: inRange(attrs.min_temp, 5),
      };
    }
    this._fireGroups(updated);
  }

  private _renderMember(entityId: string, groupIdx: number) {
    const l = this.hass.language;
    const state = this.hass.states[entityId];
    const name = (state?.attributes?.friendly_name as string) || entityId;
    const areaId = this.hass.entities[entityId]?.area_id;
    const areaName = areaId ? this.hass.areas[areaId]?.name : undefined;
    return html`
      <rs-list-row
        icon=${(state?.attributes?.icon as string) || "mdi:air-conditioner"}
        .heading=${name}
        .secondary=${state ? (areaName ?? "") : localize("detail.devices.unavailable", l)}
      >
        <rs-icon-button
          slot="end"
          icon="mdi:close"
          .label=${localize("common.remove_named", l, { name })}
          @click=${() => {
            const updated = [...this.compressorGroups];
            updated[groupIdx] = {
              ...updated[groupIdx],
              members: updated[groupIdx].members.filter((m) => m !== entityId),
            };
            this._fireGroups(updated);
          }}
        ></rs-icon-button>
      </rs-list-row>
    `;
  }

  /** Draft note or validation error at the group, so it is seen where it is fixed. */
  private _renderProblem(group: CompressorGroup) {
    const problem = compressorGroupProblem(group, this.compressorGroups);
    if (!problem) return nothing;
    const l = this.hass.language;
    if (problem === "compressor.draft_no_members")
      return html`<p class="draft-note">${localize(problem, l)}</p>`;
    return html`<p class="rs-alert" role="alert">
      ${localize("settings.save_error", l, { error: localize(problem, l) })}
    </p>`;
  }

  private _memberFilter = (entity: { entity_id: string }): boolean => {
    const id = entity.entity_id;
    if (id.substring(id.indexOf(".") + 1).startsWith("roommind_")) return false;
    for (const g of this.compressorGroups) {
      if (g.members.includes(id)) return false;
      if (g.master_entity === id) return false;
    }
    return true;
  };

  private _masterFilter = (entity: { entity_id: string }): boolean => {
    const id = entity.entity_id;
    if (id.substring(id.indexOf(".") + 1).startsWith("roommind_")) return false;
    for (const g of this.compressorGroups) {
      if (g.members.includes(id)) return false;
      if (g.master_entity === id) return false;
    }
    return true;
  };

  private _updateGroup(
    idx: number,
    field: keyof CompressorGroup,
    value: CompressorGroup[keyof CompressorGroup],
  ) {
    const updated = [...this.compressorGroups];
    updated[idx] = { ...updated[idx], [field]: value };
    this._fireGroups(updated);
  }

  private _addGroup() {
    const id =
      self.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._editId = id;
    this._fireGroups([
      ...this.compressorGroups,
      {
        id,
        name: "",
        members: [],
        min_run_minutes: 15,
        min_off_minutes: 5,
        master_entity: "",
        conflict_resolution: "heating_priority" as ConflictResolution,
        action_script: "",
        enforce_uniform_mode: false,
        min_rooms: 1,
        start_delay_seconds: 0,
        run_on_seconds: 0,
        on_temperature: null,
        off_temperature: null,
        off_mode: "off",
      },
    ]);
  }

  private _fireGroups(groups: CompressorGroup[]) {
    this._fire("compressorGroups", groups);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings-compressor": RsSettingsCompressor;
  }
}
