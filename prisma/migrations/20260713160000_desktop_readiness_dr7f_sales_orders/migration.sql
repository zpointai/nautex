-- DR-7F: canonical sales orders with compatibility fulfillment links.
CREATE TYPE "SalesOrderStatus" AS ENUM ('Confirmed', 'InFulfillment', 'PartiallyDelivered', 'Delivered', 'Cancelled');
CREATE TYPE "SalesOrderLineStatus" AS ENUM ('Open', 'PartiallyDelivered', 'Delivered', 'Cancelled');

CREATE TABLE "sales_orders" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "customer_id" TEXT NOT NULL,
  "party_id" TEXT,
  "quote_id" TEXT NOT NULL,
  "rfq_id" TEXT,
  "fulfillment_order_id" TEXT NOT NULL,
  "sales_order_number" TEXT,
  "source_key" TEXT NOT NULL,
  "status" "SalesOrderStatus" NOT NULL DEFAULT 'Confirmed',
  "customer_po_reference" TEXT,
  "vessel_name" TEXT,
  "vessel_imo" TEXT,
  "port" TEXT,
  "requested_delivery_at" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "payment_terms" TEXT NOT NULL,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "vat_amount" DECIMAL(14,2) NOT NULL,
  "gross_amount" DECIMAL(14,2) NOT NULL,
  "cost_amount" DECIMAL(14,2) NOT NULL,
  "margin_pct" DECIMAL(8,2) NOT NULL,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfillment_started_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "customer_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_orders_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sales_order_lines" (
  "id" TEXT NOT NULL,
  "sales_order_id" TEXT NOT NULL,
  "quote_line_id" TEXT NOT NULL,
  "rfq_line_id" TEXT,
  "fulfillment_order_line_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "delivered_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL,
  "impa_code" TEXT,
  "unit_cost" DECIMAL(14,4) NOT NULL,
  "unit_price" DECIMAL(14,4) NOT NULL,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "margin_pct" DECIMAL(8,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "SalesOrderLineStatus" NOT NULL DEFAULT 'Open',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sales_order_lines_quote_line_id_fkey" FOREIGN KEY ("quote_line_id") REFERENCES "customer_quote_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_lines_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sales_order_lines_fulfillment_order_line_id_fkey" FOREIGN KEY ("fulfillment_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sales_orders_quote_id_key" ON "sales_orders"("quote_id");
CREATE UNIQUE INDEX "sales_orders_fulfillment_order_id_key" ON "sales_orders"("fulfillment_order_id");
CREATE UNIQUE INDEX "sales_orders_source_key_key" ON "sales_orders"("source_key");
CREATE UNIQUE INDEX "sales_orders_organization_id_sales_order_number_key" ON "sales_orders"("organization_id", "sales_order_number");
CREATE INDEX "sales_orders_organization_id_status_requested_delivery_at_idx" ON "sales_orders"("organization_id", "status", "requested_delivery_at");
CREATE INDEX "sales_orders_customer_id_status_idx" ON "sales_orders"("customer_id", "status");
CREATE INDEX "sales_orders_party_id_idx" ON "sales_orders"("party_id");
CREATE INDEX "sales_orders_rfq_id_idx" ON "sales_orders"("rfq_id");
CREATE UNIQUE INDEX "sales_order_lines_quote_line_id_key" ON "sales_order_lines"("quote_line_id");
CREATE UNIQUE INDEX "sales_order_lines_fulfillment_order_line_id_key" ON "sales_order_lines"("fulfillment_order_line_id");
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_number_key" ON "sales_order_lines"("sales_order_id", "line_number");
CREATE INDEX "sales_order_lines_sales_order_id_status_idx" ON "sales_order_lines"("sales_order_id", "status");
CREATE INDEX "sales_order_lines_rfq_line_id_idx" ON "sales_order_lines"("rfq_line_id");
