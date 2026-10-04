-- Inventory reservations: commit available stock against purchase-order lines.

CREATE TABLE IF NOT EXISTS "inventory_reservations" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "order_line_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Active',
  "reference_label" TEXT,
  "note" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'operator',
  "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  "issued_at" TIMESTAMP(3),

  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventory_reservations_inventory_item_id_status_idx"
  ON "inventory_reservations"("inventory_item_id", "status");

CREATE INDEX IF NOT EXISTS "inventory_reservations_order_id_idx"
  ON "inventory_reservations"("order_id");

CREATE INDEX IF NOT EXISTS "inventory_reservations_order_line_id_idx"
  ON "inventory_reservations"("order_line_id");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_active_order_line_id_key"
  ON "inventory_reservations"("order_line_id")
  WHERE "status" = 'Active';
