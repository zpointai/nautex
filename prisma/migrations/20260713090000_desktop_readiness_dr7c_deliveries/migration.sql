-- DR-7C: first-class outbound deliveries and delivery lines.
CREATE TYPE "DeliveryStatus" AS ENUM ('Draft', 'Ready', 'Dispatched', 'Delivered', 'Cancelled');

CREATE TABLE "deliveries" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "purchase_order_id" TEXT NOT NULL,
  "shipping_company_id" TEXT,
  "party_id" TEXT,
  "delivery_number" TEXT,
  "source_key" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL,
  "vessel" TEXT NOT NULL,
  "vessel_imo" TEXT,
  "port" TEXT,
  "delivery_address" TEXT,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'Draft',
  "scheduled_at" TIMESTAMP(3),
  "dispatched_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "delivered_to_name" TEXT,
  "notes" TEXT,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "deliveries_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "deliveries_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "deliveries_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "deliveries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "delivery_lines" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "purchase_order_line_id" TEXT NOT NULL,
  "inventory_item_id" TEXT,
  "inventory_reservation_id" TEXT,
  "inventory_movement_id" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_lines_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivery_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "delivery_lines_inventory_reservation_id_fkey" FOREIGN KEY ("inventory_reservation_id") REFERENCES "inventory_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "delivery_lines_inventory_movement_id_fkey" FOREIGN KEY ("inventory_movement_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "deliveries_source_key_key" ON "deliveries"("source_key");
CREATE UNIQUE INDEX "deliveries_organization_id_delivery_number_key" ON "deliveries"("organization_id", "delivery_number");
CREATE INDEX "deliveries_organization_id_status_scheduled_at_idx" ON "deliveries"("organization_id", "status", "scheduled_at");
CREATE INDEX "deliveries_purchase_order_id_status_idx" ON "deliveries"("purchase_order_id", "status");
CREATE INDEX "deliveries_shipping_company_id_status_idx" ON "deliveries"("shipping_company_id", "status");
CREATE INDEX "deliveries_party_id_idx" ON "deliveries"("party_id");
CREATE UNIQUE INDEX "delivery_lines_inventory_movement_id_key" ON "delivery_lines"("inventory_movement_id");
CREATE UNIQUE INDEX "delivery_lines_delivery_id_purchase_order_line_id_key" ON "delivery_lines"("delivery_id", "purchase_order_line_id");
CREATE INDEX "delivery_lines_purchase_order_line_id_idx" ON "delivery_lines"("purchase_order_line_id");
CREATE INDEX "delivery_lines_inventory_item_id_idx" ON "delivery_lines"("inventory_item_id");
CREATE INDEX "delivery_lines_inventory_reservation_id_idx" ON "delivery_lines"("inventory_reservation_id");
