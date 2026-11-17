export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type Repeat =
  | { type: "daily"; every: number }
  | { type: "weekly"; days: Weekday[] }
  | { type: "monthly"; day: number }
  | { type: "monthly"; last: Weekday };

export interface Rule {
  zone: string;
  start: string;
  time: string;
  repeat: Repeat;
  until?: string;
  count?: number;
}

export interface Window {
  from?: Date;
  to?: Date;
  limit?: number;
}

/** A calendar date without a zone. `m` is 1 to 12. */
export interface CivilDate {
  y: number;
  m: number;
  d: number;
}
