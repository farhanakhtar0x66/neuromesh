// The oracle: the same rules computed with Temporal (Node 26), which resolves a local time with
// disambiguation "compatible": a skipped time moves forward by the gap, a repeated time takes the earlier instant.
// Dates come from PlainDate/PlainYearMonth arithmetic, so none of the solution's calendar code is reused.

export interface OracleRule {
  zone: string;
  start: string;
  time: string;
  repeat: { type: "daily"; every: number } | { type: "weekly"; days: string[] } | { type: "monthly"; day: number } | { type: "monthly"; last: string };
  until?: string;
  count?: number;
}

const DOW: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function* dates(rule: OracleRule): Generator<Temporal.PlainDate> {
  const start = Temporal.PlainDate.from(rule.start);
  const r = rule.repeat;
  if (r.type === "daily") {
    for (let i = 0; ; i++) yield start.add({ days: i * r.every });
  } else if (r.type === "weekly") {
    const want = new Set(r.days.map((d) => DOW[d]));
    for (let i = 0; ; i++) {
      const d = start.add({ days: i });
      if (want.has(d.dayOfWeek)) yield d;
    }
  } else {
    for (let k = 0; ; k++) {
      const ym = start.toPlainYearMonth().add({ months: k });
      let d: Temporal.PlainDate;
      if ("last" in r) {
        d = ym.toPlainDate({ day: ym.daysInMonth });
        while (d.dayOfWeek !== DOW[r.last]) d = d.subtract({ days: 1 });
      } else {
        d = Temporal.PlainDate.from({ year: ym.year, month: ym.month, day: r.day }, { overflow: "constrain" });
      }
      if (Temporal.PlainDate.compare(d, start) >= 0) yield d;
    }
  }
}

/** All occurrences of the rule as epoch milliseconds, restricted to the window like occurrences() does. */
export function oracle(rule: OracleRule, window: { from?: number; to?: number; limit?: number } = {}): number[] {
  const [hour, minute] = rule.time.split(":").map(Number) as [number, number];
  const until = rule.until ? Temporal.PlainDate.from(rule.until) : undefined;
  const out: number[] = [];
  let n = 0;
  for (const d of dates(rule)) {
    if (until && Temporal.PlainDate.compare(d, until) > 0) break;
    if (rule.count !== undefined && n >= rule.count) break;
    const t = Temporal.ZonedDateTime.from(
      { timeZone: rule.zone, year: d.year, month: d.month, day: d.day, hour, minute },
      { disambiguation: "compatible" },
    ).epochMilliseconds;
    if (window.to !== undefined && t >= window.to) break;
    n++;
    if (window.from !== undefined && t < window.from) continue;
    out.push(t);
    if (window.limit !== undefined && out.length >= window.limit) break;
  }
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Times of day that sit on or next to a clock change somewhere in the zone's year, plus an ordinary one. */
export const ZONES: Record<string, string[]> = {
  "America/New_York": ["00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "09:00"],
  "Europe/London": ["00:30", "01:00", "01:30", "02:00", "12:00"],
  "Australia/Lord_Howe": ["01:30", "01:45", "02:00", "02:15", "02:30", "12:00"],
  "Asia/Kolkata": ["00:00", "09:30", "23:59"],
  "America/Santiago": ["23:00", "23:30", "00:00", "00:30", "01:00", "12:00"],
  "Pacific/Chatham": ["02:45", "03:00", "03:30", "03:45", "12:00"],
};

export const WINDOW = { from: Date.UTC(2025, 0, 1), to: Date.UTC(2028, 0, 1) };
