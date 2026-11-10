// Orders come as CSV: order_id,customer,item,quantity,unit_price_cents
export function parseOrders(text) {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [orderId, customer, item, quantity, unitPriceCents] = line.split(",").map((s) => s.trim());
      return { orderId, customer, item, quantity: Number(quantity), unitPriceCents: Number(unitPriceCents) };
    });
}
