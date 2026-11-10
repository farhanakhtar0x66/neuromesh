// A shopping cart. Prices are in dollars, taxRate is a fraction (0.1 = 10%).
export class Cart {
  constructor(taxRate = 0) {
    this.taxRate = taxRate;
    this.items = [];
    this.discountPercent = 0;
  }

  add(name, price, quantity = 1) {
    this.items.push({ name, price, quantity });
  }

  applyDiscount(percent) {
    this.discountPercent = percent;
  }

  subtotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  total() {
    const taxed = this.subtotal() * (1 + this.taxRate);
    return taxed * (1 - this.discountPercent / 100);
  }
}
