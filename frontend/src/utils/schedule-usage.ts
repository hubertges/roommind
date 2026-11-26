import type { RoomConfig } from "../types";
import { localize } from "./localize";

export type ScheduleKind = "climate" | "ac" | "humidity" | "ventilation" | "cover";

/** Rooms (area ids) using a schedule helper across all room schedule kinds. */
export function scheduleUsage(
  rooms: Record<string, RoomConfig>,
  entityId: string,
): Record<ScheduleKind, string[]> {
  const uses = (list: { entity_id: string }[] | undefined) =>
    (list ?? []).some((s) => s.entity_id === entityId);
  const all = Object.values(rooms);
  return {
    climate: all.filter((r) => uses(r.schedules)).map((r) => r.area_id),
    ac: all.filter((r) => uses(r.ac_schedules)).map((r) => r.area_id),
    humidity: all.filter((r) => uses(r.humidity_schedules)).map((r) => r.area_id),
    ventilation: all.filter((r) => uses(r.ventilation_schedules)).map((r) => r.area_id),
    cover: all.filter((r) => uses(r.cover_schedules)).map((r) => r.area_id),
  };
}

function kindPrefix(kind: ScheduleKind, language: string): string {
  const isPl = (language ?? "en").toLowerCase().startsWith("pl");
  switch (kind) {
    case "climate":
      return isPl ? "Ogrzewanie" : "Heating";
    case "ac":
      return isPl ? "Klimatyzacja" : "AC";
    case "humidity":
      return isPl ? "Nawilżanie" : "Humidity";
    case "ventilation":
      return isPl ? "Wentylacja" : "Ventilation";
    case "cover":
      return isPl ? "Rolety" : "Covers";
  }
}

/**
 * Where a helper is used, seen from a list of `kind`: "Küche, Bad · Rollläden: Wohnzimmer".
 * With `exceptRoom` (a room's own dialog) that room is left out of its own kind and the rest
 * reads "Auch in Küche, Bad". Empty when nobody else uses it.
 */
export function usageText(
  rooms: Record<string, RoomConfig>,
  entityId: string,
  kind: ScheduleKind,
  nameOf: (areaId: string) => string,
  language: string,
  exceptRoom = "",
): string {
  const usage = scheduleUsage(rooms, entityId);
  const same = usage[kind].filter((id) => id !== exceptRoom).map(nameOf);
  const parts: string[] = [];
  if (same.length) {
    parts.push(
      exceptRoom
        ? localize("schedules.also_in", language, { rooms: same.join(", ") })
        : same.join(", "),
    );
  }
  const otherKinds: ScheduleKind[] = (
    ["climate", "ac", "humidity", "ventilation", "cover"] as const
  ).filter((k) => k !== kind);
  for (const other of otherKinds) {
    const elsewhere = usage[other].map(nameOf);
    if (!elsewhere.length) continue;
    if (other === "cover") {
      parts.push(localize("schedules.covers_in", language, { rooms: elsewhere.join(", ") }));
    } else if (other === "climate") {
      parts.push(localize("schedules.temperature_in", language, { rooms: elsewhere.join(", ") }));
    } else {
      parts.push(`${kindPrefix(other, language)}: ${elsewhere.join(", ")}`);
    }
  }
  return parts.join(" · ");
}

/** Name of a room as the panel shows it. */
export function roomNameOf(
  rooms: Record<string, RoomConfig>,
  areas: Record<string, { name: string }> | undefined,
): (areaId: string) => string {
  return (id) => rooms[id]?.display_name || areas?.[id]?.name || id;
}
