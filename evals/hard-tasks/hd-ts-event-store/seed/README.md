# stockroom

Stock in several warehouses, reservations for orders, transfers between warehouses and returns, as a small
TypeScript library. Node runs it directly (no build step); `npm test` runs the tests.

```ts
import { Inventory } from "./src/index.ts";

const inv = new Inventory();
inv.addWarehouse("north");
inv.addWarehouse("south");
inv.receive("north", "bolt-8", 100);
inv.reserve("order-1", "north", "bolt-8", 30);   // set aside, still on hand
inv.fulfill("order-1");                           // ships what the order reserved
inv.transfer("north", "south", "bolt-8", 20);
inv.returnItems("order-1", "north", "bolt-8", 5); // some came back
inv.listStock();                                  // rows: warehouse, sku, onHand, reserved, available
```

## What it does

- **Warehouses** are created with `addWarehouse`. Everything else refuses an unknown warehouse.
- **On hand** is what is physically there; **reserved** is what open orders have set aside; **available** is the
  difference. `ship`, `reserve` and `transfer` only ever use available units.
- An **order** is *open* while it holds reservations (it may reserve several warehouse and sku pairs, and reserving
  the same pair again adds to the line), *fulfilled* after `fulfill` ships everything it reserved, and *unknown*
  otherwise, which includes an order whose reservations were all released. A fulfilled order cannot reserve, release
  or fulfil again; it can take `returnItems`, at most what it shipped from that warehouse, in as many steps as you like.
- Every refusal is an `InventoryError` with a `code` and a message. A refused call changes nothing.
- Quantities are positive integers. Ids (warehouse, sku, order) are non-empty strings.

## Order is part of the behaviour

Listings come out in the order things first happened, because the state lives in `Map`s and `Set`s:

- `warehouses()` and `listStock()` go by warehouse creation order.
- Within a warehouse, `listStock()` goes by the order each sku first appeared in *that* warehouse (received into it,
  or transferred to it). A row stays listed when its quantity falls to zero.
- `skus()` lists every sku once, in the order it first appeared in any warehouse.
- `orderLines()` and `returnsOf()` go by the order the lines were first reserved.
- `lowStock(n)` is sorted: fewest available first, ties by sku (plain `<` on the strings), remaining ties in
  `listStock()` order.

The tests in `test/` pin all of it down. The next step for this library, an event log, is described in
[docs/EVENTS.md](docs/EVENTS.md).

## Layout

- `src/inventory.ts`: `Inventory`
- `src/errors.ts`: `InventoryError` and its codes
- `src/types.ts`: the row types
