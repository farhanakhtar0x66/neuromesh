import unittest

from inventory import Inventory


class InventoryTest(unittest.TestCase):
    def test_add_and_value(self):
        inv = Inventory()
        inv.add("bolt", 10, 0.5)
        inv.add("bolt", 5, 0.5)
        self.assertEqual(inv.get("bolt").quantity, 15)
        self.assertEqual(inv.total_value(), 7.5)


if __name__ == "__main__":
    unittest.main()
