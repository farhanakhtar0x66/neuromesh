import { formatDate } from "./dates.ts";
import { localDateAt, offsetMinutesAt } from "./zone.ts";

/** "2026-03-08 09:00 -04:00  2026-03-08T13:00:00.000Z": local date and time with offset, then the instant in UTC. */
export function formatOccurrence(zone: string, instant: Date): string {
  const t = instant.getTime();
  const offset = offsetMinutesAt(zone, t);
  const local = new Date(t + offset * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${formatDate(localDateAt(zone, t))} ${hh}:${mm} ${off}  ${instant.toISOString()}`;
}
