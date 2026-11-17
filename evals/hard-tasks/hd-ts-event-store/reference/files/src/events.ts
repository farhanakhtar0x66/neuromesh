import type { OrderLine } from "./types.ts";

/** What each kind of event carries, without its `seq`. Plain data only: it must survive JSON.stringify unchanged. */
export type EventBody =
  | { type: "warehouse-added"; warehouse: string }
  | { type: "received"; warehouse: string; sku: string; qty: number }
  | { type: "shipped"; warehouse: string; sku: string; qty: number }
  | { type: "reserved"; orderId: string; warehouse: string; sku: string; qty: number }
  | { type: "released"; orderId: string; lines: OrderLine[] }
  | { type: "fulfilled"; orderId: string; lines: OrderLine[] }
  | { type: "transferred"; from: string; to: string; sku: string; qty: number }
  | { type: "returned"; orderId: string; warehouse: string; sku: string; qty: number };

export type InventoryEvent = EventBody & { readonly seq: number };

/** Freeze a value and everything inside it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** A frozen deep copy: events given to replay and restore are not the caller's to freeze. */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/** Does the event change the units, on hand or reserved, of this sku? */
export function touchesSku(event: InventoryEvent, sku: string): boolean {
  switch (event.type) {
    case "warehouse-added":
      return false;
    case "released":
    case "fulfilled":
      return event.lines.some((l) => l.sku === sku);
    default:
      return event.sku === sku;
  }
}
