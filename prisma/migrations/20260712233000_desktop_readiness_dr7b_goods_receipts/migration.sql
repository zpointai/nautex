-- DR-7B: first-class goods receipt headers and lines.
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

CREATE TABLE "goods_receipts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "purchase_order_id" TEXT NOT NULL,
  "supplier_id" TEXT,
  "party_id" TEXT,
  "receipt_number" TEXT,
  "source_key" TEXT NOT NULL,
  "supplier_delivery_note" TEXT,
  "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'Draft',
  "warehouse" TEXT,
  "notes" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_id" TEXT,
  "received_by_name" TEXT,
  "posted_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goods_receipts_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goods_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "goods_receipts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "goods_receipt_lines" (
  "id" TEXT NOT NULL,
  "goods_receipt_id" TEXT NOT NULL,
  "purchase_order_line_id" TEXT NOT NULL,
  "inventory_item_id" TEXT,
  "inventory_movement_id" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "goods_receipt_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "goods_receipt_lines_inventory_movement_id_fkey" FOREIGN KEY ("inventory_movement_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "goods_receipts_source_key_key" ON "goods_receipts"("source_key");
CREATE UNIQUE INDEX "goods_receipts_organization_id_receipt_number_key" ON "goods_receipts"("organization_id", "receipt_number");
CREATE INDEX "goods_receipts_organization_id_status_received_at_idx" ON "goods_receipts"("organization_id", "status", "received_at");
CREATE INDEX "goods_receipts_purchase_order_id_status_idx" ON "goods_receipts"("purchase_order_id", "status");
CREATE INDEX "goods_receipts_supplier_id_received_at_idx" ON "goods_receipts"("supplier_id", "received_at");
CREATE INDEX "goods_receipts_party_id_idx" ON "goods_receipts"("party_id");
CREATE UNIQUE INDEX "goods_receipt_lines_inventory_movement_id_key" ON "goods_receipt_lines"("inventory_movement_id");
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_purchase_order_line_id_key" ON "goods_receipt_lines"("goods_receipt_id", "purchase_order_line_id");
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines"("purchase_order_line_id");
CREATE INDEX "goods_receipt_lines_inventory_item_id_idx" ON "goods_receipt_lines"("inventory_item_id");
