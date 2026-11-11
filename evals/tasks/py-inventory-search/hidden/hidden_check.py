from inventory import Inventory

inv = Inventory()
for name, qty in [("Hex Bolt", 40), ("bolt washer", 5), ("Anchor", 40), ("nut", 100), ("Carriage Bolt", 0)]:
    inv.add(name, qty, 1.0)
names = lambda items: [i.name for i in items]
assert names(inv.search("bolt")) == ["bolt washer", "Carriage Bolt", "Hex Bolt"], names(inv.search("bolt"))
assert names(inv.search("BOLT", min_quantity=1)) == ["bolt washer", "Hex Bolt"]
assert names(inv.search()) == ["Anchor", "bolt washer", "Carriage Bolt", "Hex Bolt", "nut"]
assert names(inv.search("", sort_by="quantity")) == ["nut", "Anchor", "Hex Bolt", "bolt washer", "Carriage Bolt"]
assert names(inv.search("zzz")) == []
assert names(inv.search(min_quantity=40)) == ["Anchor", "Hex Bolt", "nut"]
try:
    inv.search(sort_by="price")
except ValueError:
    pass
else:
    raise AssertionError("expected ValueError")
print("hidden check passed")
