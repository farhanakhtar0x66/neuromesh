"""A small in-memory inventory."""
from dataclasses import dataclass


@dataclass
class Item:
    name: str
    quantity: int
    price: float


class Inventory:
    def __init__(self):
        self._items = {}

    def add(self, name, quantity, price):
        if name in self._items:
            self._items[name].quantity += quantity
        else:
            self._items[name] = Item(name, quantity, price)

    def remove(self, name, quantity):
        item = self._items[name]
        if quantity > item.quantity:
            raise ValueError("not enough stock")
        item.quantity -= quantity

    def get(self, name):
        return self._items.get(name)

    def total_value(self):
        return sum(i.quantity * i.price for i in self._items.values())
