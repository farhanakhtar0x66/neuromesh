import type { InventoryEvent } from "./events.ts";
import type { OrderLine } from "./types.ts";

const keyOf = (warehouse: string, sku: string): string => `${warehouse}\u0000${sku}`;

interface Shipped extends OrderLine {
  returned: number;
}

/** The snapshot's state part: plain arrays, in the order the maps hold things, so order survives JSON. */
export interface StateData {
  warehouses: { id: string; rows: [string, number][] }[];
  skus: string[];
  reservations: { orderId: string; lines: OrderLine[] }[];
  shipped: { orderId: string; lines: Shipped[] }[];
}

/**
 * The state that follows from the log. It changes only through `apply`, one event at a time; the commands in
 * `Inventory` have already decided that an event is allowed.
 */
export class Projection {
  /** warehouse -> sku -> units on hand. A row stays when it reaches zero. */
  readonly stock = new Map<string, Map<string, number>>();
  /** Every sku in the order it first appeared anywhere. */
  readonly skus = new Set<string>();
  /** order id -> its open reservation lines. */
  readonly reservations = new Map<string, Map<string, OrderLine>>();
  /** order id -> what a fulfilled order shipped and how much came back. */
  readonly shipped = new Map<string, Map<string, Shipped>>();

  apply(e: InventoryEvent): void {
    switch (e.type) {
      case "warehouse-added":
        this.stock.set(e.warehouse, new Map());
        break;
      case "received":
        this.#add(e.warehouse, e.sku, e.qty);
        break;
      case "shipped":
        this.#add(e.warehouse, e.sku, -e.qty);
        break;
      case "reserved": {
        let lines = this.reservations.get(e.orderId);
        if (!lines) {
          lines = new Map();
          this.reservations.set(e.orderId, lines);
        }
        const line = lines.get(keyOf(e.warehouse, e.sku));
        if (line) line.qty += e.qty;
        else lines.set(keyOf(e.warehouse, e.sku), { warehouse: e.warehouse, sku: e.sku, qty: e.qty });
        break;
      }
      case "released":
        this.reservations.delete(e.orderId);
        break;
      case "fulfilled": {
        const shipped = new Map<string, Shipped>();
        for (const l of e.lines) {
          this.#add(l.warehouse, l.sku, -l.qty);
          shipped.set(keyOf(l.warehouse, l.sku), { warehouse: l.warehouse, sku: l.sku, qty: l.qty, returned: 0 });
        }
        this.reservations.delete(e.orderId);
        this.shipped.set(e.orderId, shipped);
        break;
      }
      case "transferred":
        this.#add(e.from, e.sku, -e.qty);
        this.#add(e.to, e.sku, e.qty);
        break;
      case "returned":
        this.shipped.get(e.orderId)!.get(keyOf(e.warehouse, e.sku))!.returned += e.qty;
        this.#add(e.warehouse, e.sku, e.qty);
        break;
    }
  }

  reservedQty(warehouse: string, sku: string): number {
    let total = 0;
    for (const lines of this.reservations.values()) total += lines.get(keyOf(warehouse, sku))?.qty ?? 0;
    return total;
  }

  available(warehouse: string, sku: string): number {
    return (this.stock.get(warehouse)?.get(sku) ?? 0) - this.reservedQty(warehouse, sku);
  }

  toData(): StateData {
    return {
      warehouses: [...this.stock].map(([id, rows]) => ({ id, rows: [...rows].map(([sku, qty]): [string, number] => [sku, qty]) })),
      skus: [...this.skus],
      reservations: [...this.reservations].map(([orderId, lines]) => ({ orderId, lines: [...lines.values()].map((l) => ({ ...l })) })),
      shipped: [...this.shipped].map(([orderId, lines]) => ({ orderId, lines: [...lines.values()].map((l) => ({ ...l })) })),
    };
  }

  /** Build from snapshot data without keeping any of its objects, so a frozen snapshot works and stays unchanged. */
  static fromData(data: StateData): Projection {
    const p = new Projection();
    for (const w of data.warehouses) p.stock.set(w.id, new Map(w.rows.map(([sku, qty]): [string, number] => [sku, qty])));
    for (const sku of data.skus) p.skus.add(sku);
    for (const o of data.reservations) p.reservations.set(o.orderId, new Map(o.lines.map((l): [string, OrderLine] => [keyOf(l.warehouse, l.sku), { ...l }])));
    for (const o of data.shipped) p.shipped.set(o.orderId, new Map(o.lines.map((l): [string, Shipped] => [keyOf(l.warehouse, l.sku), { ...l }])));
    return p;
  }

  #add(warehouse: string, sku: string, delta: number): void {
    const rows = this.stock.get(warehouse)!;
    rows.set(sku, (rows.get(sku) ?? 0) + delta);
    this.skus.add(sku);
  }
}
