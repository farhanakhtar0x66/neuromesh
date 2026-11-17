export interface StockRow {
  warehouse: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface OrderLine {
  warehouse: string;
  sku: string;
  qty: number;
}

export interface ReturnLine extends OrderLine {
  /** How many of the shipped units have come back so far. */
  returned: number;
}
