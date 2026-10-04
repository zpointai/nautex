-- Inventory operations foundation: item metadata, stock counters, and movement ledger.

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "item_code" TEXT,
  ADD COLUMN IF NOT EXISTS "catalog_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "location_bin" TEXT,
  ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inbound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "last_counted_at" TIMESTAMP(3);

UPDATE "inventory_items"
SET "reserved" = COALESCE("reserved", 0),
    "inbound" = COALESCE("inbound", 0);

UPDATE "inventory_items" AS inv
SET
  "item_code" = COALESCE(inv."item_code", item."impa_code"),
  "catalog_item_id" = COALESCE(inv."catalog_item_id", item."id"),
  "category" = COALESCE(inv."category", item."category")
FROM "items" AS item
WHERE LOWER(inv."description") = LOWER(item."description");

UPDATE "inventory_items"
SET "location_bin" = CASE
  WHEN "location_bin" IS NOT NULL THEN "location_bin"
  WHEN "warehouse" ILIKE '%Cold%' THEN 'COLD-01'
  WHEN "warehouse" ILIKE '%Safety%' THEN 'SAFE-01'
  WHEN "warehouse" ILIKE '%Technical%' THEN 'TECH-01'
  WHEN "warehouse" ILIKE '%Bonded%' THEN 'BOND-01'
  ELSE 'GEN-01'
END;

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "movement_type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "quantity_before" INTEGER NOT NULL,
  "quantity_after" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "reference_type" TEXT,
  "reference_id" TEXT,
  "reference_label" TEXT,
  "note" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'operator',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventory_items_item_code_idx" ON "inventory_items"("item_code");
CREATE INDEX IF NOT EXISTS "inventory_items_warehouse_idx" ON "inventory_items"("warehouse");
CREATE INDEX IF NOT EXISTS "inventory_items_catalog_item_id_idx" ON "inventory_items"("catalog_item_id");
CREATE INDEX IF NOT EXISTS "inventory_movements_inventory_item_id_created_at_idx" ON "inventory_movements"("inventory_item_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");
