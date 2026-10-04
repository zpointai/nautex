CREATE TYPE "InventoryCycleCountStatus" AS ENUM ('PendingReview', 'Approved', 'Rejected');

CREATE TABLE "inventory_transfers" (
  "id" TEXT NOT NULL,
  "source_item_id" TEXT NOT NULL,
  "destination_item_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "source_warehouse" TEXT NOT NULL,
  "source_bin" TEXT,
  "destination_warehouse" TEXT NOT NULL,
  "destination_bin" TEXT,
  "note" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'operator',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_cycle_counts" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "expected_quantity" INTEGER NOT NULL,
  "counted_quantity" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,
  "status" "InventoryCycleCountStatus" NOT NULL DEFAULT 'PendingReview',
  "note" TEXT,
  "review_note" TEXT,
  "counted_by" TEXT NOT NULL DEFAULT 'operator',
  "reviewed_by" TEXT,
  "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_cycle_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_transfers_source_item_id_created_at_idx" ON "inventory_transfers"("source_item_id", "created_at");
CREATE INDEX "inventory_transfers_destination_item_id_created_at_idx" ON "inventory_transfers"("destination_item_id", "created_at");
CREATE INDEX "inventory_cycle_counts_inventory_item_id_status_idx" ON "inventory_cycle_counts"("inventory_item_id", "status");
CREATE INDEX "inventory_cycle_counts_status_counted_at_idx" ON "inventory_cycle_counts"("status", "counted_at");

ALTER TABLE "inventory_transfers"
  ADD CONSTRAINT "inventory_transfers_source_item_id_fkey"
  FOREIGN KEY ("source_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_transfers"
  ADD CONSTRAINT "inventory_transfers_destination_item_id_fkey"
  FOREIGN KEY ("destination_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_cycle_counts"
  ADD CONSTRAINT "inventory_cycle_counts_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
