import { InventoryError } from "./errors.ts";
import { deepFreeze, frozenCopy, touchesSku } from "./events.ts";
import type { EventBody, InventoryEvent } from "./events.ts";
import { Projection } from "./state.ts";
import type { StateData } from "./state.ts";
import type { OrderLine, ReturnLine, StockRow } from "./types.ts";

/** Plain data: the whole state, and the `seq` of the last event it includes. */
export interface Snapshot extends StateData {
  seq: number;
}

/**
 * Stock in several warehouses, reservations for orders, transfers and returns.
 *
 * Every change is an event appended to a log; the state is what the events add up to. A command checks
 * everything first and appends one event only when nothing is wrong, so a refused call leaves no trace.
 * The maps' insertion order is part of the behaviour (see README.md); the projection keeps it and the
 * snapshot carries it as arrays.
 */
export class Inventory {
  #state = new Projection();
  #log: InventoryEvent[] = [];
  #seq = 0;

  // ---- warehouses ----

  addWarehouse(id: string): void {
    this.#checkId(id, "warehouse id");
    if (this.#state.stock.has(id)) throw new InventoryError("DUPLICATE_WAREHOUSE", `warehouse ${id} already exists`);
    this.#append({ type: "warehouse-added", warehouse: id });
  }

  warehouses(): string[] {
    return [...this.#state.stock.keys()];
  }

  // ---- changes ----

  /** Units arrive in a warehouse. */
  receive(warehouse: string, sku: string, qty: number): void {
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#append({ type: "received", warehouse, sku, qty });
  }

  /** Units leave a warehouse without an order. Only units that are not reserved can go. */
  ship(warehouse: string, sku: string, qty: number): void {
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#needAvailable(warehouse, sku, qty);
    this.#append({ type: "shipped", warehouse, sku, qty });
  }

  /** Set units aside for an order. Calling it again for the same warehouse and sku adds to the line. */
  reserve(orderId: string, warehouse: string, sku: string, qty: number): void {
    this.#checkId(orderId, "order id");
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    if (this.#state.shipped.has(orderId)) throw new InventoryError("ORDER_CLOSED", `order ${orderId} is already fulfilled`);
    this.#needAvailable(warehouse, sku, qty);
    this.#append({ type: "reserved", orderId, warehouse, sku, qty });
  }

  /** Give up an open order's reservations. The order is unknown again afterwards. */
  release(orderId: string): void {
    const lines = this.#needOpenOrder(orderId);
    this.#append({ type: "released", orderId, lines: [...lines.values()].map((l) => ({ ...l })) });
  }

  /** Ship everything an open order reserved. The order is closed: it can still take returns. */
  fulfill(orderId: string): void {
    const lines = this.#needOpenOrder(orderId);
    this.#append({ type: "fulfilled", orderId, lines: [...lines.values()].map((l) => ({ ...l })) });
  }

  /** Move available units from one warehouse to another. */
  transfer(from: string, to: string, sku: string, qty: number): void {
    this.#needWarehouse(from);
    this.#needWarehouse(to);
    if (from === to) throw new InventoryError("SAME_WAREHOUSE", `cannot transfer within the same warehouse ${from}`);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#needAvailable(from, sku, qty);
    this.#append({ type: "transferred", from, to, sku, qty });
  }

  /** Units of a fulfilled order come back to the warehouse they shipped from. */
  returnItems(orderId: string, warehouse: string, sku: string, qty: number): void {
    this.#checkId(orderId, "order id");
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    const shipped = this.#state.shipped.get(orderId);
    if (!shipped) {
      if (this.#state.reservations.has(orderId)) throw new InventoryError("NOT_SHIPPED", `order ${orderId} has not shipped`);
      throw new InventoryError("UNKNOWN_ORDER", `unknown order ${orderId}`);
    }
    const line = [...shipped.values()].find((l) => l.warehouse === warehouse && l.sku === sku);
    if (!line) throw new InventoryError("NOT_SHIPPED", `order ${orderId} did not ship ${sku} from ${warehouse}`);
    const left = line.qty - line.returned;
    if (qty > left) throw new InventoryError("OVER_RETURN", `cannot return ${qty} of ${sku} for order ${orderId}: only ${left} left to return`);
    this.#append({ type: "returned", orderId, warehouse, sku, qty });
  }

  // ---- questions ----

  onHand(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return this.#state.stock.get(warehouse)!.get(sku) ?? 0;
  }

  reserved(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return this.#state.reservedQty(warehouse, sku);
  }

  available(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return this.#state.available(warehouse, sku);
  }

  /** Every sku seen so far, in the order each first appeared in any warehouse. */
  skus(): string[] {
    return [...this.#state.skus];
  }

  /** Total units on hand of a sku over all warehouses. */
  totalOnHand(sku: string): number {
    let total = 0;
    for (const rows of this.#state.stock.values()) total += rows.get(sku) ?? 0;
    return total;
  }

  /** One row per warehouse and sku that has ever held stock: warehouses in creation order, skus in the order they first appeared there. */
  listStock(warehouse?: string): StockRow[] {
    if (warehouse !== undefined) this.#needWarehouse(warehouse);
    const rows: StockRow[] = [];
    for (const [w, skus] of this.#state.stock) {
      if (warehouse !== undefined && w !== warehouse) continue;
      for (const [sku, onHand] of skus) {
        const reserved = this.#state.reservedQty(w, sku);
        rows.push({ warehouse: w, sku, onHand, reserved, available: onHand - reserved });
      }
    }
    return rows;
  }

  /** Rows whose available units are below the threshold: fewest first, ties by sku, then in listing order. */
  lowStock(threshold: number): StockRow[] {
    return this.listStock()
      .filter((r) => r.available < threshold)
      .sort((a, b) => a.available - b.available || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  }

  /** The open reservation lines of an order, in the order they were first reserved. Empty for any other order. */
  orderLines(orderId: string): OrderLine[] {
    return [...(this.#state.reservations.get(orderId)?.values() ?? [])].map((l) => ({ ...l }));
  }

  orderStatus(orderId: string): "open" | "fulfilled" | "unknown" {
    if (this.#state.reservations.has(orderId)) return "open";
    if (this.#state.shipped.has(orderId)) return "fulfilled";
    return "unknown";
  }

  /** What a fulfilled order shipped and how much of it came back. Empty for any other order. */
  returnsOf(orderId: string): ReturnLine[] {
    return [...(this.#state.shipped.get(orderId)?.values() ?? [])].map((l) => ({ ...l }));
  }

  // ---- the log ----

  /** The whole log, oldest first (a new array each time). */
  events(): readonly InventoryEvent[] {
    return [...this.#log];
  }

  /** The events that changed the units of a sku, oldest first. */
  history(sku: string): InventoryEvent[] {
    return this.#log.filter((e) => touchesSku(e, sku));
  }

  /** A deep copy of the state as plain data, with the seq of the last event in it. */
  snapshot(): Snapshot {
    return { seq: this.#seq, ...this.#state.toData() };
  }

  /** The state a log adds up to. */
  static replay(events: readonly InventoryEvent[]): Inventory {
    const inv = new Inventory();
    inv.#applyTail(events);
    return inv;
  }

  /** The state of a snapshot, then the events after it. */
  static restore(snapshot: Snapshot, tail: readonly InventoryEvent[] = []): Inventory {
    const inv = new Inventory();
    inv.#state = Projection.fromData(snapshot);
    inv.#seq = snapshot.seq;
    inv.#applyTail(tail);
    return inv;
  }

  // ---- internals ----

  /** Apply events that continue the log: older ones are skipped, the rest must follow on without a gap. */
  #applyTail(events: readonly InventoryEvent[]): void {
    const fresh = events.filter((e) => e.seq > this.#seq);
    let expected = this.#seq + 1;
    for (const e of fresh) {
      if (e.seq !== expected) throw new InventoryError("BAD_EVENT_LOG", `event log is not continuous: expected seq ${expected}, got ${e.seq}`);
      expected++;
    }
    for (const e of fresh) {
      const event = frozenCopy(e);
      this.#state.apply(event);
      this.#log.push(event);
      this.#seq = event.seq;
    }
  }

  #append(body: EventBody): void {
    const event = deepFreeze({ seq: this.#seq + 1, ...body }) as InventoryEvent;
    this.#state.apply(event);
    this.#log.push(event);
    this.#seq = event.seq;
  }

  #checkId(value: unknown, what: string): void {
    if (typeof value !== "string" || value === "") throw new InventoryError("INVALID_ID", `${what} must be a non-empty string`);
  }

  #checkQty(qty: unknown): void {
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) throw new InventoryError("INVALID_QUANTITY", `quantity must be a positive integer, got ${String(qty)}`);
  }

  #needWarehouse(id: string): void {
    if (!this.#state.stock.has(id)) throw new InventoryError("UNKNOWN_WAREHOUSE", `unknown warehouse ${id}`);
  }

  #needAvailable(warehouse: string, sku: string, qty: number): void {
    const available = this.#state.available(warehouse, sku);
    if (qty > available) throw new InventoryError("INSUFFICIENT_STOCK", `insufficient stock for ${sku} in ${warehouse}: wanted ${qty}, available ${available}`);
  }

  #needOpenOrder(orderId: string): Map<string, OrderLine> {
    const lines = this.#state.reservations.get(orderId);
    if (lines) return lines;
    if (this.#state.shipped.has(orderId)) throw new InventoryError("ORDER_CLOSED", `order ${orderId} is already fulfilled`);
    throw new InventoryError("UNKNOWN_ORDER", `unknown order ${orderId}`);
  }
}
