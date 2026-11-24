/**
 * Core type definitions for RoomMind frontend.
 */

export type ClimateMode = "auto" | "heat_only" | "cool_only";

export type HumidityMode = "auto" | "humidify_only" | "dehumidify_only";

export type RoomMode = "idle" | "heating" | "cooling";

export type HumidityAction = "idle" | "humidifying" | "dehumidifying";

export type OverrideType = "boost" | "eco" | "custom";

export interface NotificationTarget {
  entity_id: string;
  person_entity: string;
  notify_when: "always" | "home_only";
}

export interface ScheduleEntry {
  entity_id: string;
}

export interface CoverScheduleEntry {
  entity_id: string;
  mode?: "force" | "gate";
}

/** What RoomMind makes of a room's sun sensor (#303). */
export interface SolarSensorLive {
  kind: "irradiance" | "illuminance" | "percent" | null;
  /** learning: scale not known yet (weather model in use); unavailable: weather model meanwhile. */
  state: "learning" | "active" | "unavailable" | "unsupported";
  position: "inside" | "outside" | null;
}

export interface RoomLiveData {
  current_temp: number | null;
  current_humidity: number | null;
  target_temp: number | null;
  heat_target: number | null;
  cool_target: number | null;
  mode: RoomMode;
  heating_power: number; // 0-100
  device_setpoint: number | null; // Device target temp in Full Control mode
  override_active: boolean;
  override_type: OverrideType | null;
  override_heat: number | null;
  override_cool: number | null;
  override_until: number | null;
  override_suppressed: boolean;
  active_schedule_index: number;
  window_open: boolean;
  confidence: number | null;
  mpc_active: boolean;
  presence_away: boolean;
  occupancy_vacant?: boolean;
  /** Air quality readings (#267), null without sensor or reading. */
  co2?: number | null;
  voc?: number | null;
  pm25?: number | null;
  pm10?: number | null;
  pm1?: number | null;
  air_quality_bad?: boolean;
  air_quality_reason?: "co2" | "voc" | "pm25" | "pm10" | "pm1" | null;
  /** RoomMind runs the room's ventilation entity for bad air. */
  ventilation_active?: boolean;
  /** Past the room's humidity limits (#518, #526), with hysteresis. */
  humidity_high?: boolean;
  humidity_low?: boolean;
  /** Too humid and the outdoor air dries: the room wants its ventilation for humidity. */
  humidity_ventilate?: boolean;
  /** Too humid, but the outdoor air is not drier: no ventilation for humidity. */
  humidity_vent_blocked?: boolean;
  /** RoomMind runs the room's dehumidifier / humidifier. */
  dehumidifier_active?: boolean;
  /** An AC runs in dry for the too humid room (#440). */
  ac_dry_active?: boolean;
  humidifier_active?: boolean;
  /** MPC / schedule humidity control live values. */
  humidify_target?: number | null;
  dehumidify_target?: number | null;
  target_humidity?: number | null;
  humidity_action?: HumidityAction;
  humidifying_power?: number;
  humidity_device_setpoint?: number | null;
  humidity_mpc_active?: boolean;
  humidity_confidence?: number | null;
  prehumidify?: boolean;
  override_humidity_active?: boolean;
  override_humidity_type?: OverrideType | null;
  override_humidify?: number | null;
  override_dehumidify?: number | null;
  override_humidity_until?: number | null;
  /** Sun sensor (#303); null without one. */
  solar_sensor?: SolarSensorLive | null;
  /** RoomMind runs the room fan while the room heats or cools (#266). */
  room_fan_active?: boolean;
  mold_risk_level: "ok" | "warning" | "critical";
  mold_surface_rh: number | null;
  mold_surface_temp: number | null;
  mold_prevention_active: boolean;
  /** Applied electricity price shift per side (K), 0 when none. */
  price_shift_heat?: number;
  price_shift_cool?: number;
  price_level?: "cheap" | "normal" | "expensive" | null;
  /** Stricter target a running pre-heat (pre-cool) aims at and when it starts (Unix s). */
  preheat?: { mode: "heating" | "cooling"; target: number; at: number } | null;
  /** Devices kept on at their setback target while the room is idle; `until` = earliest switch-off (Unix s). */
  setback?: { devices: string[]; until: number | null } | null;
  mold_prevention_delta: number;
  blind_position: number | null;
  cover_auto_paused: boolean;
  cover_override_until?: number | null;
  cover_forced_reason: string;
  cover_reason?: string;
  active_cover_schedule_index: number;
  active_heat_sources: string | null;
  learning_paused_reason: "outdoor_unavailable" | null;
  /** Model updates so far (one per ~3 min of learning). */
  n_observations?: number;
  /** `n_observations` when "learn faster" was last used, null if never (counts the fade). */
  boost_applied_at?: number | null;
  compressor_protection_active: boolean;
  compressor_protection_reason: "min_off" | "min_run" | "uniform_mode" | null;
  /** While its "All in the same mode" group holds the room: the way the group runs or turns to. */
  uniform_group_mode?: "heat" | "cool" | null;
  compressor_protection_until: number | null;
  coil_dry_active: boolean;
  coil_dry_phase: "drain" | "blow" | null;
  coil_dry_until: number | null;
  coil_dry_entities: string[];
  schedule_temp_warnings: ScheduleTempWarning[];
  /** Last 6 h of room temperature, `[unix_ts, temp, target]`, oldest first (dashboard cards). */
  recent_temps?: [number, number | null, number | null][];
}

/** A schedule block temperature the backend discarded as implausible (#395). */
export interface ScheduleTempWarning {
  day: string; // lowercase English weekday, e.g. "monday"
  from: string; // "HH:MM:SS"
  field: "temperature" | "heat_temperature" | "cool_temperature";
  value: string; // the offending raw value; may not be numeric
}

export type DeviceType = "trv" | "ac";
export type DeviceRole = "primary" | "secondary" | "auto";

export interface DeviceConfig {
  entity_id: string;
  type: DeviceType;
  role: DeviceRole;
  heating_system_type?: string;
  idle_action?: "off" | "fan_only" | "setback" | "low"; // default "off"
  idle_fan_mode?: string; // default "low"
  setback_auto_off?: boolean; // setback ends in off after an hour without demand, default off (#255)
  setpoint_mode?: "proportional" | "direct"; // default "proportional"
  setpoint_offset?: number; // °C added to the room target in direct mode, default 0
  coil_dry?: "inherit" | "on" | "off"; // default "inherit"
  coil_dry_minutes?: number; // 0 = inherit global
  coil_dry_mode?: "" | "fan_only" | "dry"; // "" = inherit global
  coil_dry_fan_mode?: string; // "" = inherit global, "__keep__" = keep current
  valve_opening_entity?: string; // number entity for direct valve opening degree (0-100%)
  valve_closing_entity?: string; // number entity for direct valve closing degree (0-100%)
  valve_closing_mode?: "closing_degree" | "idle_opening"; // idle_opening: the second entity is the opening while idle (SONOFF TRV-ZBT)
}

export type ConflictResolution =
  "heating_priority" | "cooling_priority" | "majority" | "outdoor_temp";

/** A stored room whose Home Assistant area was deleted; it rests until the area is back (#494). */
export interface RoomWithoutArea {
  area_id: string;
  display_name: string;
}

export interface CompressorGroup {
  id: string;
  name: string;
  members: string[];
  min_run_minutes: number;
  min_off_minutes: number;
  master_entity: string;
  conflict_resolution: ConflictResolution;
  action_script: string;
  enforce_uniform_mode: boolean;
  /** The main device runs only while at least this many member rooms want its action. */
  min_rooms?: number;
  /** Seconds a wanted switch must hold before the main device follows: on, off. */
  start_delay_seconds?: number;
  run_on_seconds?: number;
  /** Climate main device: setpoint when heating and when off (its own unit), null = mode only. */
  on_temperature?: number | null;
  off_temperature?: number | null;
  /** "off": switch the thermostat off, "temperature": keep its heat mode at the off temperature. */
  off_mode?: MasterOffMode;
}

export type RoomFanMode = "heat" | "cool" | "both";

/** What a room does when nobody is home: eco, devices off, or its own away level. */
export type PresenceAwayAction = "eco" | "off" | "away";

export type MasterOffMode = "off" | "temperature";

export type HeatPlantType =
  | "coal_boiler"
  | "pellet_boiler"
  | "wood_boiler"
  | "fireplace"
  | "gas_boiler"
  | "electric_heater"
  | "air_heater"
  | "heat_pump";

export type FuelType = "coal" | "pellet" | "wood" | "gas" | "electricity";

export interface HeatPlantConfig {
  id: string;
  name: string;
  plant_type: HeatPlantType;
  enabled: boolean;
  priority?: number;
  parent_plant_id?: string;
  cannot_extinguish?: boolean;
  min_power_pct?: number;
  assigned_devices: string[];
  assigned_rooms: string[];
  source_entity: string;
  target_supply_temp: number;
  idle_supply_temp: number;
  off_mode: "off" | "temperature";
  min_rooms_demand: number;
  supply_temp_sensor: string;
  return_temp_sensor: string;
  dhw_temp_sensor: string;
  flue_temp_sensor: string;
  ch_pump_entity: string;
  ch_pump_min_supply_temp: number;
  ch_pump_overrun_temp: number;
  ufh_pump_entity?: string;
  ufh_supply_temp_sensor?: string;
  ufh_min_supply_temp?: number;
  ufh_max_supply_temp?: number;
  dhw_pump_entity: string;
  dhw_target_temp: number;
  dhw_hysteresis: number;
  dhw_min_supply_delta: number;
  fuel_type: FuelType;
  calorific_value_mj_kg: number;
  calorific_value_kwh_m3: number;
  efficiency_pct: number;
  cop: number;
  nominal_power_kw: number;
  fuel_price: number;
  currency: string;
  energy_sensor: string;
  fuel_consumption_sensor: string;
  feeder_entity?: string;
  feeder_kg_per_hour?: number;
  hopper_capacity_kg?: number;
  hopper_level_sensor?: string;
  ash_content_pct?: number;
  notify_refill_enabled?: boolean;
  refill_alert_kg?: number;
  refill_alert_pct?: number;
  notify_ash_enabled?: boolean;
  ash_clean_interval_kg?: number;
  ash_clean_interval_days?: number;
  notify_chimney_enabled?: boolean;
  chimney_clean_interval_kg?: number;
  chimney_clean_interval_days?: number;
}

export interface HeatPlantLive {
  id: string;
  name?: string;
  plant_type?: HeatPlantType;
  cannot_extinguish?: boolean;
  in_fire_hold?: boolean;
  priority?: number;
  parent_plant_id?: string;
  child_demands?: string[];
  assisted_by?: string[];
  state:
    | "heating"
    | "dhw"
    | "heating_and_dhw"
    | "overheat_protect"
    | "hold"
    | "active"
    | "idle";
  source_active: boolean;
  heating_demand: boolean;
  dhw_demand: boolean;
  overheat_protect: boolean;
  ufh_overheat_protect?: boolean;
  low_return_warning?: boolean;
  supply_temp: number | null;
  return_temp: number | null;
  ufh_supply_temp?: number | null;
  delta_t: number | null;
  dhw_temp: number | null;
  flue_temp: number | null;
  ch_pump_active: boolean;
  ch_pump_blocked_cold: boolean;
  ufh_pump_active?: boolean;
  ufh_pump_blocked_cold?: boolean;
  dhw_pump_active: boolean;
  dhw_pump_blocked_cold: boolean;
  demanding_rooms: string[];
  active_devices: string[];
  mean_power_pct: number;
  max_power_pct: number;
  fuel_unit: "kg" | "m³" | "kWh";
  fuel_source_mode?: "fuel_sensor" | "feeder" | "energy_sensor" | "estimated";
  feeder_active?: boolean;
  chemical_kwh_per_kg: number;
  usable_kwh_per_kg: number;
  current_thermal_kw: number;
  current_input_kw: number;
  burn_rate_per_h: number;
  cost_per_hour: number;
  cost_per_kwh_thermal: number;
  runtime_hours_today: number;
  runtime_hours_total: number;
  thermal_kwh_today: number;
  thermal_kwh_total: number;
  input_kwh_today: number;
  input_kwh_total: number;
  fuel_consumed_today: number;
  fuel_consumed_total: number;
  cost_today: number;
  cost_total: number;
  fuel_remaining_kg?: number | null;
  hopper_pct?: number | null;
  hours_until_refill?: number | null;
  fuel_since_refill_kg?: number;
  fuel_since_ash_clean_kg?: number;
  estimated_ash_kg?: number;
  ash_fill_pct?: number;
  days_since_ash_clean?: number;
  fuel_since_chimney_clean_kg?: number;
  chimney_wear_pct?: number;
  days_since_chimney_clean?: number;
  refill_needed?: boolean;
  ash_clean_needed?: boolean;
  chimney_clean_needed?: boolean;
  maintenance_alerts?: Array<"refill" | "ash" | "chimney">;
}

export interface HeatPlantHistoryPoint {
  ts: number;
  state: string;
  supply_temp: number | null;
  return_temp: number | null;
  dhw_temp: number | null;
  flue_temp: number | null;
  delta_t: number | null;
  thermal_kw: number | null;
  burn_rate_per_h: number | null;
  fuel_consumed_today: number | null;
  fuel_remaining_kg: number | null;
  cost_today: number | null;
  ch_pump_active: boolean;
  dhw_pump_active: boolean;
}

export interface RoomConfig {
  area_id: string;
  thermostats: string[];
  acs: string[];
  devices?: DeviceConfig[];
  temperature_sensor: string;
  humidity_sensor: string;
  occupancy_sensors?: string[];
  occupancy_eco_enabled?: boolean;
  occupancy_eco_delay?: number;
  co2_sensor?: string;
  /** ppm; good again below 80 % of it. */
  co2_threshold?: number;
  voc_sensor?: string;
  /** In the VOC sensor's unit; null = shown, not judged. */
  voc_threshold?: number | null;
  /** Particulate matter sensors (µg/m³). */
  pm25_sensor?: string;
  pm25_threshold?: number | null;
  pm10_sensor?: string;
  pm10_threshold?: number | null;
  pm1_sensor?: string;
  pm1_threshold?: number | null;
  /** fan.*, switch.* or input_boolean.* RoomMind switches on for bad air. */
  ventilation_entity?: string;
  /** % RH; null = not regulated. Too humid from max on, too dry from min on (#518, #526). */
  humidity_max?: number | null;
  humidity_min?: number | null;
  humidity_mode?: HumidityMode;
  comfort_humidify?: number | null;
  comfort_dehumidify?: number | null;
  eco_humidify?: number | null;
  eco_dehumidify?: number | null;
  away_humidify?: number | null;
  away_dehumidify?: number | null;
  prehumidify_enabled?: boolean;
  humidifier_setpoint_mode?: "proportional" | "direct";
  humidifier_setpoint_offset?: number;
  dehumidifier_setpoint_mode?: "proportional" | "direct";
  dehumidifier_setpoint_offset?: number;
  /** humidifier.*, switch.* or input_boolean.* RoomMind runs past the limits. */
  dehumidifier_entity?: string;
  humidifier_entity?: string;
  /** Sunlight on the room: W/m², lx or % (#303). */
  solar_sensor?: string;
  /** fan.*, switch.* or input_boolean.* RoomMind runs while the room heats or cools (#266). */
  room_fan_entity?: string;
  room_fan_mode?: RoomFanMode;
  /** An AC with `dry` may dry the room past humidity_max (#440); missing = on. */
  ac_dry_enabled?: boolean;
  preheat_enabled?: boolean;
  /** K the schedule target may move with the electricity price, 0 = off. */
  price_shift?: number;
  follow_device_setpoint?: boolean;
  window_sensors: string[];
  window_open_delay: number;
  window_close_delay: number;
  climate_mode: ClimateMode;
  schedules: ScheduleEntry[];
  schedule_selector_entity: string;
  comfort_temp?: number;
  eco_temp?: number;
  comfort_heat: number;
  comfort_cool: number;
  eco_heat: number;
  eco_cool: number;
  /** Levels while nobody is home with presence_away_action "away"; unset or null = eco. */
  away_heat?: number | null;
  away_cool?: number | null;
  override_heat?: number | null;
  override_cool?: number | null;
  override_until?: number | null;
  override_type?: OverrideType | null;
  presence_persons?: string[];
  display_name?: string;
  heating_system_type?: string;
  covers?: string[];
  covers_auto_enabled?: boolean;
  covers_deploy_threshold?: number;
  covers_min_position?: number;
  covers_override_minutes?: number;
  cover_schedules?: CoverScheduleEntry[];
  cover_schedule_selector_entity?: string;
  cover_orientations?: Record<string, number>;
  covers_outdoor_min_temp?: number | null;
  covers_night_close?: boolean;
  covers_night_position?: number;
  covers_night_close_elevation?: number;
  covers_night_close_offset_minutes?: number;
  covers_snap_deploy?: boolean;
  covers_window_hold?: boolean;
  cover_min_positions?: Record<string, number>;
  ignore_presence?: boolean;
  is_outdoor?: boolean;
  valve_protection_exclude?: string[];
  heat_source_orchestration?: boolean;
  heat_source_primary_delta?: number;
  heat_source_outdoor_threshold?: number;
  heat_source_ac_min_outdoor?: number;
  /** Orchestration: expensive electricity prefers the primary source, cheap the AC. */
  heat_source_price_aware?: boolean;
  climate_control_enabled?: boolean;
  live?: RoomLiveData;
}

/** What RoomMind reads from the price source (rooms/list ``price_status``). */
export interface PriceStatus {
  entity_id: string;
  readable: boolean;
  kind: "forecast" | "history" | "switch" | null;
  price: number | null;
  level: "cheap" | "normal" | "expensive" | null;
  forecast_hours: number;
  history_hours: number;
  history_needed: number;
}

export interface GlobalSettings {
  outdoor_temp_sensor: string;
  price_entity?: string;
  outdoor_humidity_sensor: string;
  outdoor_cooling_min?: number;
  outdoor_heating_max?: number;
  control_mode?: "mpc" | "bangbang";
  comfort_weight?: number;
  weather_entity?: string;
  outdoor_unavailable_notify?: boolean;
  climate_control_active?: boolean;
  learning_disabled_rooms?: string[];
  hidden_rooms?: string[];
  prediction_enabled?: boolean;
  vacation_temp?: number;
  vacation_until?: number | null;
  presence_enabled?: boolean;
  presence_persons?: string[];
  presence_away_action?: PresenceAwayAction;
  presence_clears_override?: boolean;
  schedule_off_action?: "eco" | "off";
  valve_protection_enabled?: boolean;
  valve_protection_interval_days?: number;
  coil_dry_enabled?: boolean;
  coil_dry_minutes?: number;
  coil_dry_mode?: "fan_only" | "dry";
  coil_dry_fan_mode?: string;
  coil_dry_min_cooling_minutes?: number;
  coil_dry_drain_minutes?: number;
  mold_detection_enabled?: boolean;
  mold_humidity_threshold?: number;
  mold_f_rsi?: number;
  mold_sustained_minutes?: number;
  mold_notification_cooldown?: number;
  mold_notifications_enabled?: boolean;
  mold_notification_targets?: NotificationTarget[];
  mold_prevention_enabled?: boolean;
  mold_prevention_intensity?: "light" | "medium" | "strong";
  mold_prevention_notify_enabled?: boolean;
  mold_prevention_notify_targets?: NotificationTarget[];
  heat_plant_notifications_enabled?: boolean;
  heat_plant_notification_targets?: NotificationTarget[];
  heat_plant_notification_cooldown?: number;
  compressor_groups?: CompressorGroup[];
  heat_plants?: HeatPlantConfig[];
  room_order?: string[];
  group_by_floor?: boolean;
  floor_order?: string[];
  boost_applied_at?: Record<string, number>;
}

// HA types for panel integration
export interface HassConnection {
  addEventListener(event: string, callback: () => void): void;
  removeEventListener(event: string, callback: () => void): void;
}

export interface HomeAssistant {
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>;
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>;
  states: Record<string, HassEntity>;
  areas: Record<string, HassArea>;
  floors?: Record<string, HassFloor>;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDeviceRegistryEntry>;
  language: string;
  config: { unit_system: { temperature: string }; time_zone?: string };
  user?: { is_admin: boolean; name?: string };
  connection?: HassConnection;
  /** Translated state as Home Assistant shows it (e.g. "Heizen"); missing in old releases. */
  formatEntityState?: (stateObj: HassEntity) => string;
  formatEntityAttributeValue?: (stateObj: HassEntity, attribute: string, value?: unknown) => string;
  /** HA's own light/dark choice (may differ from the OS). */
  themes?: { darkMode?: boolean };
}

export interface HassArea {
  area_id: string;
  name: string;
  picture: string | null;
  floor_id: string | null;
  icon?: string | null;
}

export interface HassFloor {
  floor_id: string;
  name: string;
  level: number | null;
}

export interface HassEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  platform: string;
}

export interface HassDeviceRegistryEntry {
  id: string;
  area_id: string | null;
  name?: string | null;
  name_by_user?: string | null;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
}

export interface AnalyticsDataPoint {
  ts: number;
  room_temp: number | null;
  outdoor_temp: number | null;
  target_temp: number | null;
  mode: string;
  predicted_temp: number | null;
  window_open: boolean;
  heating_power: number | null;
  solar_irradiance: number | null;
  blind_position?: number | null;
  cover_reason?: string;
  device_setpoint?: number | null;
  humidity?: number | null;
  /** Room CO2 in ppm (#267). */
  co2?: number | null;
  /** Room particulate matter in µg/m³. */
  pm25?: number | null;
  pm10?: number | null;
  /** Humidity control telemetry. */
  humidity_action?: string;
  humidify_target?: number | null;
  dehumidify_target?: number | null;
  humidifying_power?: number | null;
  heat_target?: number | null;
  cool_target?: number | null;
  /** What set the target: "" schedule, else a TargetReason. */
  target_reason?: string;
  mold_boost?: number | null;
  price?: number | null;
  price_level?: string;
  /** Heat-side shift the electricity price applied (cool side moves the other way). */
  price_shift?: number | null;
}

export interface RunOvershoot {
  runs: number;
  mean: number;
  max: number;
}

export interface AnalyticsStats {
  hours: number;
  heating_hours: number;
  cooling_hours: number;
  window_hours: number;
  heating_starts: number;
  cooling_starts: number;
  humidifying_hours?: number;
  dehumidifying_hours?: number;
  humidifying_starts?: number;
  dehumidifying_starts?: number;
  humidity_comfort?: {
    below_pct: number;
    within_pct: number;
    above_pct: number;
  } | null;
  /** How far past the target the room went after the runs, null without runs. */
  heat_overshoot?: RunOvershoot | null;
  /** Run hours by price level, null without a price source. */
  price?: {
    heating_hours: Partial<Record<"cheap" | "normal" | "expensive", number>>;
    cooling_hours: Partial<Record<"cheap" | "normal" | "expensive", number>>;
    shifted_hours: number;
  } | null;
  cool_overshoot?: RunOvershoot | null;
  comfort: {
    below_pct: number;
    within_pct: number;
    above_pct: number;
    mean_deviation: number;
    /** Mean distance while off target, null when the room never was. */
    miss_deviation: number | null;
  } | null;
}

export interface RhythmDay {
  date: string;
  heat: Array<number | null>;
  cool: Array<number | null>;
  window: Array<number | null>;
  deviation: Array<number | null>;
  /** Share of the judged time too cold / too warm, same tolerance as the period figures. */
  below: Array<number | null>;
  above: Array<number | null>;
  temp: Array<number | null>;
  humidity: Array<number | null>;
  outdoor: Array<number | null>;
  /** The day's judged share on target, null without judged samples. */
  within: number | null;
}

export interface AnalyticsRhythm {
  days: RhythmDay[];
}

export interface ModelDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  confidence: number;
  mpc_active: boolean;
  /** Mean absolute error of the ~3-min forecast that day (K), null without measurements. */
  error: number | null;
  error_steps: number;
}

export interface HumidityModelInfo {
  confidence: number;
  model: Record<string, number>;
  n_samples: number;
  n_observations: number;
  n_humidifying: number;
  n_dehumidifying: number;
  applicable_modes: string[];
  mpc_active: boolean;
}

export interface AnalyticsData {
  detail: AnalyticsDataPoint[];
  history: AnalyticsDataPoint[];
  forecast?: AnalyticsDataPoint[];
  stats?: AnalyticsStats;
  rhythm?: AnalyticsRhythm | null;
  /** Unit of the price source (ct/kWh, EUR/kWh, ...), empty for a switch or none. */
  price_unit?: string;
  humidity_model?: HumidityModelInfo;
  heat_plants?: HeatPlantConfig[];
  heat_plants_live?: Record<string, HeatPlantLive>;
  heat_plants_history?: Record<string, HeatPlantHistoryPoint[]>;
  model: {
    confidence: number;
    /** One entry per local day, oldest first. */
    daily_history?: ModelDay[];
    model: {
      C: number;
      U: number;
      Q_heat: number;
      Q_cool: number;
      Q_solar: number;
      Q_occupancy: number;
      Q_fast?: number;
    };
    n_samples: number;
    n_observations: number;
    /** Unix time of the model's last learning step, null before the first or from an older store */
    last_update_at?: number | null;
    n_heating: number;
    n_cooling: number;
    applicable_modes: string[];
    mpc_active: boolean;
    sigma_e: number;
    prediction_std_idle: number;
    prediction_std_heating: number;
    has_occupancy_sensors: boolean;
    /** Sun / occupancy were in the data (variance below its start), else the gain is the start guess */
    solar_learned?: boolean;
    occupancy_learned?: boolean;
    solar_gain_now?: number;
    solar_gain_today_max?: number;
    /** Radiator rooms: rise a regular run's stored heat gives after the stop (°C), its decay time */
    afterglow_k?: number;
    afterglow_minutes?: number;
    afterglow_learned?: boolean;
    /** The model one hour ahead on this range (backend model_backtest), null without a model. */
    backtest?: ModelBacktest | null;
  };
}

export interface BacktestFigures {
  /** Hours (overlapping, one per recorded point) that went into the figure. */
  n: number;
  /** Mean absolute deviation after the horizon (°C), null below the minimum of hours. */
  mae: number | null;
  /** Mean signed deviation: model minus measured, negative = room warmer than the model says. */
  bias: number | null;
}

export interface ModelBacktest {
  horizon_minutes: number;
  idle: BacktestFigures;
  /** Hours with heating or cooling. */
  active: BacktestFigures;
}

export type TimeRange = "12h" | "24h" | "2d" | "7d" | "14d" | "30d" | "90d";
