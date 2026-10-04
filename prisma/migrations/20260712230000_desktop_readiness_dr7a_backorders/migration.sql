-- DR-7A: first-class backorder cases and affected lines.
CREATE TYPE "BackorderStatus" AS ENUM ('Open', 'Escalated', 'Resolved', 'Dismissed');
CREATE TYPE "BackorderPriority" AS ENUM ('Normal', 'High', 'Critical');
CREATE TYPE "BackorderLineStatus" AS ENUM ('Open', 'Resolved', 'Cancelled');

CREATE TABLE "backorders" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "purchase_order_id" TEXT NOT NULL,
  "supplier_id" TEXT,
  "backorder_number" TEXT,
  "source_key" TEXT NOT NULL,
  "status" "BackorderStatus" NOT NULL DEFAULT 'Open',
  "priority" "BackorderPriority" NOT NULL DEFAULT 'Normal',
  "reason" TEXT,
  "notes" TEXT,
  "owner_id" TEXT,
  "owner_name" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "escalated_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  "last_reviewed_at" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'purchase_order_lines',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "backorders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backorders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "backorders_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "backorders_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "backorders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "backorder_lines" (
  "id" TEXT NOT NULL,
  "backorder_id" TEXT NOT NULL,
  "purchase_order_line_id" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "requested_date" TIMESTAMP(3),
  "expected_date" TIMESTAMP(3),
  "status" "BackorderLineStatus" NOT NULL DEFAULT 'Open',
  "notes" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "backorder_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backorder_lines_backorder_id_fkey" FOREIGN KEY ("backorder_id") REFERENCES "backorders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "backorder_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "backorders_purchase_order_id_key" ON "backorders"("purchase_order_id");
CREATE UNIQUE INDEX "backorders_source_key_key" ON "backorders"("source_key");
CREATE UNIQUE INDEX "backorders_organization_id_backorder_number_key" ON "backorders"("organization_id", "backorder_number");
CREATE INDEX "backorders_organization_id_status_priority_idx" ON "backorders"("organization_id", "status", "priority");
CREATE INDEX "backorders_supplier_id_status_idx" ON "backorders"("supplier_id", "status");
CREATE UNIQUE INDEX "backorder_lines_backorder_id_purchase_order_line_id_key" ON "backorder_lines"("backorder_id", "purchase_order_line_id");
CREATE INDEX "backorder_lines_purchase_order_line_id_idx" ON "backorder_lines"("purchase_order_line_id");
CREATE INDEX "backorder_lines_backorder_id_status_idx" ON "backorder_lines"("backorder_id", "status");
