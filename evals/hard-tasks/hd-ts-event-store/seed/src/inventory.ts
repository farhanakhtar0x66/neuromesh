import { InventoryError } from "./errors.ts";
import type { OrderLine, ReturnLine, StockRow } from "./types.ts";

const keyOf = (warehouse: string, sku: string): string => `${warehouse}\u0000${sku}`;

interface Shipped extends OrderLine {
  returned: number;
}

/**
 * Stock in several warehouses, reservations for orders, transfers and returns.
 *
 * State lives in mutable maps and every method changes them in place. The maps' insertion order is
 * part of the behaviour: listings come out in the order things first appeared (see README.md).
 */
export class Inventory {
  /** warehouse -> sku -> units on hand. A row stays when it reaches zero. */
  #stock = new Map<string, Map<string, number>>();
  /** Every sku in the order it first appeared anywhere. */
  #skus = new Set<string>();
  /** order id -> its open reservation lines, in the order they were first reserved. Only open orders are here. */
  #reservations = new Map<string, Map<string, OrderLine>>();
  /** order id -> what shipped when it was fulfilled, with how much has come back. Only fulfilled orders are here. */
  #shipped = new Map<string, Map<string, Shipped>>();

  // ---- warehouses ----

  addWarehouse(id: string): void {
    this.#checkId(id, "warehouse id");
    if (this.#stock.has(id)) throw new InventoryError("DUPLICATE_WAREHOUSE", `warehouse ${id} already exists`);
    this.#stock.set(id, new Map());
  }

  warehouses(): string[] {
    return [...this.#stock.keys()];
  }

  // ---- changes ----

  /** Units arrive in a warehouse. */
  receive(warehouse: string, sku: string, qty: number): void {
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#add(warehouse, sku, qty);
  }

  /** Units leave a warehouse without an order. Only units that are not reserved can go. */
  ship(warehouse: string, sku: string, qty: number): void {
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#needAvailable(warehouse, sku, qty);
    this.#add(warehouse, sku, -qty);
  }

  /** Set units aside for an order. Calling it again for the same warehouse and sku adds to the line. */
  reserve(orderId: string, warehouse: string, sku: string, qty: number): void {
    this.#checkId(orderId, "order id");
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    if (this.#shipped.has(orderId)) throw new InventoryError("ORDER_CLOSED", `order ${orderId} is already fulfilled`);
    this.#needAvailable(warehouse, sku, qty);
    let lines = this.#reservations.get(orderId);
    if (!lines) {
      lines = new Map();
      this.#reservations.set(orderId, lines);
    }
    const line = lines.get(keyOf(warehouse, sku));
    if (line) line.qty += qty;
    else lines.set(keyOf(warehouse, sku), { warehouse, sku, qty });
  }

  /** Give up an open order's reservations. The order is unknown again afterwards. */
  release(orderId: string): void {
    this.#needOpenOrder(orderId);
    this.#reservations.delete(orderId);
  }

  /** Ship everything an open order reserved. The order is closed: it can still take returns. */
  fulfill(orderId: string): void {
    const lines = this.#needOpenOrder(orderId);
    const shipped = new Map<string, Shipped>();
    for (const [k, line] of lines) {
      this.#add(line.warehouse, line.sku, -line.qty);
      shipped.set(k, { ...line, returned: 0 });
    }
    this.#reservations.delete(orderId);
    this.#shipped.set(orderId, shipped);
  }

  /** Move available units from one warehouse to another. */
  transfer(from: string, to: string, sku: string, qty: number): void {
    this.#needWarehouse(from);
    this.#needWarehouse(to);
    if (from === to) throw new InventoryError("SAME_WAREHOUSE", `cannot transfer within the same warehouse ${from}`);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    this.#needAvailable(from, sku, qty);
    this.#add(from, sku, -qty);
    this.#add(to, sku, qty);
  }

  /** Units of a fulfilled order come back to the warehouse they shipped from. */
  returnItems(orderId: string, warehouse: string, sku: string, qty: number): void {
    this.#checkId(orderId, "order id");
    this.#needWarehouse(warehouse);
    this.#checkId(sku, "sku");
    this.#checkQty(qty);
    const shipped = this.#shipped.get(orderId);
    if (!shipped) {
      if (this.#reservations.has(orderId)) throw new InventoryError("NOT_SHIPPED", `order ${orderId} has not shipped`);
      throw new InventoryError("UNKNOWN_ORDER", `unknown order ${orderId}`);
    }
    const line = shipped.get(keyOf(warehouse, sku));
    if (!line) throw new InventoryError("NOT_SHIPPED", `order ${orderId} did not ship ${sku} from ${warehouse}`);
    const left = line.qty - line.returned;
    if (qty > left) throw new InventoryError("OVER_RETURN", `cannot return ${qty} of ${sku} for order ${orderId}: only ${left} left to return`);
    line.returned += qty;
    this.#add(warehouse, sku, qty);
  }

  // ---- questions ----

  onHand(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return this.#stock.get(warehouse)!.get(sku) ?? 0;
  }

  reserved(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return this.#reservedQty(warehouse, sku);
  }

  available(warehouse: string, sku: string): number {
    this.#needWarehouse(warehouse);
    return (this.#stock.get(warehouse)!.get(sku) ?? 0) - this.#reservedQty(warehouse, sku);
  }

  /** Every sku seen so far, in the order each first appeared in any warehouse. */
  skus(): string[] {
    return [...this.#skus];
  }

  /** Total units on hand of a sku over all warehouses. */
  totalOnHand(sku: string): number {
    let total = 0;
    for (const rows of this.#stock.values()) total += rows.get(sku) ?? 0;
    return total;
  }

  /** One row per warehouse and sku that has ever held stock: warehouses in creation order, skus in the order they first appeared there. */
  listStock(warehouse?: string): StockRow[] {
    if (warehouse !== undefined) this.#needWarehouse(warehouse);
    const rows: StockRow[] = [];
    for (const [w, skus] of this.#stock) {
      if (warehouse !== undefined && w !== warehouse) continue;
      for (const [sku, onHand] of skus) {
        const reserved = this.#reservedQty(w, sku);
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
    return [...(this.#reservations.get(orderId)?.values() ?? [])].map((l) => ({ ...l }));
  }

  orderStatus(orderId: string): "open" | "fulfilled" | "unknown" {
    if (this.#reservations.has(orderId)) return "open";
    if (this.#shipped.has(orderId)) return "fulfilled";
    return "unknown";
  }

  /** What a fulfilled order shipped and how much of it came back. Empty for any other order. */
  returnsOf(orderId: string): ReturnLine[] {
    return [...(this.#shipped.get(orderId)?.values() ?? [])].map((l) => ({ ...l }));
  }

  // ---- internals ----

  #checkId(value: unknown, what: string): void {
    if (typeof value !== "string" || value === "") throw new InventoryError("INVALID_ID", `${what} must be a non-empty string`);
  }

  #checkQty(qty: unknown): void {
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) throw new InventoryError("INVALID_QUANTITY", `quantity must be a positive integer, got ${String(qty)}`);
  }

  #needWarehouse(id: string): void {
    if (!this.#stock.has(id)) throw new InventoryError("UNKNOWN_WAREHOUSE", `unknown warehouse ${id}`);
  }

  #needAvailable(warehouse: string, sku: string, qty: number): void {
    const available = (this.#stock.get(warehouse)!.get(sku) ?? 0) - this.#reservedQty(warehouse, sku);
    if (qty > available) throw new InventoryError("INSUFFICIENT_STOCK", `insufficient stock for ${sku} in ${warehouse}: wanted ${qty}, available ${available}`);
  }

  #needOpenOrder(orderId: string): Map<string, OrderLine> {
    const lines = this.#reservations.get(orderId);
    if (lines) return lines;
    if (this.#shipped.has(orderId)) throw new InventoryError("ORDER_CLOSED", `order ${orderId} is already fulfilled`);
    throw new InventoryError("UNKNOWN_ORDER", `unknown order ${orderId}`);
  }

  #reservedQty(warehouse: string, sku: string): number {
    let total = 0;
    for (const lines of this.#reservations.values()) total += lines.get(keyOf(warehouse, sku))?.qty ?? 0;
    return total;
  }

  #add(warehouse: string, sku: string, delta: number): void {
    const rows = this.#stock.get(warehouse)!;
    rows.set(sku, (rows.get(sku) ?? 0) + delta);
    this.#skus.add(sku);
  }
}
