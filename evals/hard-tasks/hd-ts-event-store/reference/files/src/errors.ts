export type ErrorCode =
  | "INVALID_ID"
  | "INVALID_QUANTITY"
  | "DUPLICATE_WAREHOUSE"
  | "UNKNOWN_WAREHOUSE"
  | "SAME_WAREHOUSE"
  | "INSUFFICIENT_STOCK"
  | "UNKNOWN_ORDER"
  | "ORDER_CLOSED"
  | "NOT_SHIPPED"
  | "OVER_RETURN"
  | "BAD_EVENT_LOG";

/** Every refusal the inventory makes is an InventoryError with a stable code and a message meant for people. */
export class InventoryError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}
